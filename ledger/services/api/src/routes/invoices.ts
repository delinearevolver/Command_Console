import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { z } from 'zod';
import { jsonToUBL } from '../lib/json2ubl.js';
import type { PoolClient } from 'pg';
import { getPool } from '../lib/db.js';
import { trackSuccess, trackError } from '../index.js';

const pool = getPool();
const router = Router();

type InvoiceCreatedResponse = { ok: true; id: string };

type InvoiceDocument = {
    invoice_id: string;
    issue_date: string;
    currency: string;
    net: string;
    tax: string;
    gross: string;
};

const templatePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../templates/invoice.hbs.html'
);
const invoiceTemplate = Handlebars.compile(fs.readFileSync(templatePath, 'utf8'));

const invoiceSchema = z.object({
    invoiceId: z.string(),
    issueDate: z.string(),
    dueDate: z.string().optional(),
    currency: z.string().length(3),
    
    // New: Buyer Reference (PO Number etc.)
    buyerReference: z.string().optional(),
    
    // New: Service Period
    servicePeriod: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
    }).optional(),

    buyer: z.object({
        name: z.string(),
        companyId: z.string().optional(), // Reg/Company No
        taxId: z.string().optional(),     // VAT No
        address: z.object({
            line1: z.string(),
            line2: z.string().optional(),
            city: z.string(),
            postcode: z.string(),
            country: z.string(),
        }),
        // New: Contact Details
        contact: z.object({
            name: z.string().optional(),
            email: z.string().email().optional(),
            phone: z.string().optional(),
        }).optional(),
    }),

    seller: z.object({
        name: z.string(),
        companyId: z.string().optional(),
        taxId: z.string().optional(),
        address: z.object({
            line1: z.string(),
            line2: z.string().optional(),
            city: z.string(),
            postcode: z.string(),
            country: z.string(),
        }),
        contact: z.object({
            name: z.string().optional(),
            email: z.string().email().optional(),
            phone: z.string().optional(),
        }).optional(),
    }),

    lines: z.array(
        z.object({
            lineNo: z.number().int(),
            // New: Product Details
            sku: z.string().optional(),
            itemDate: z.string().optional(),
            description: z.string(),
            qty: z.number(),
            // New: Unit of Measure
            unitCode: z.string().optional(), 
            unitPrice: z.number(),
            taxRate: z.number().optional(),
            // New: Explicit line totals (optional override)
            lineExtensionAmount: z.number().optional(),
        })
    ),

    totals: z.object({
        net: z.number(),
        tax: z.number(),
        gross: z.number(),
        paid: z.number().optional(),
    }),
    
    notes: z.string().optional(),
});

const REQUIRED_ACCOUNT_CODES = ['1100-AR', '4000-Sales:Services', '2000-VAT Payable'];

function mustGetAccount(map: Map<string, number>, code: string) {
    const value = map.get(code);
    if (value === undefined) {
        throw new Error(`Missing configured account: ${code}`);
    }

    return value;
}

type PgClient = PoolClient;

type AccountRow = {
    code: string;
    id: number;
};

async function getAccountMap(client: PgClient) {
    const { rows } = await client.query<AccountRow>(
        'SELECT code, id FROM accounts WHERE code = ANY($1::text[])',
        [REQUIRED_ACCOUNT_CODES]
    );
    const map = new Map<string, number>();
    for (const row of rows) {
        map.set(row.code, row.id);
    }

    const missing = REQUIRED_ACCOUNT_CODES.filter((code) => !map.has(code));
    if (missing.length > 0) {
        throw new Error(`Required ledger accounts not found: ${missing.join(', ')}`);
    }

    return map;
}

router.post(
    '/',
    async (req: Request, res: Response<InvoiceCreatedResponse>, next: NextFunction) => {
        try {
            const data = invoiceSchema.parse(req.body);
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                await client.query(
                    `INSERT INTO invoices (invoice_id, issue_date, currency, net, tax, gross, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (invoice_id)
                     DO UPDATE SET issue_date = EXCLUDED.issue_date,
                                   currency   = EXCLUDED.currency,
                                   net        = EXCLUDED.net,
                                   tax        = EXCLUDED.tax,
                                   gross      = EXCLUDED.gross,
                                   status     = EXCLUDED.status`,
                    [
                        data.invoiceId,
                        data.issueDate,
                        data.currency,
                        data.totals.net,
                        data.totals.tax,
                        data.totals.gross,
                        'Sent',
                    ]
                );

                await client.query('DELETE FROM postings WHERE invoice_id = $1', [data.invoiceId]);
                await client.query("DELETE FROM journals WHERE ref = $1 AND source = 'api'", [data.invoiceId]);

                const accountMap = await getAccountMap(client);

                const journalResult = await client.query<{ id: number }>(
                    'INSERT INTO journals (date, memo, source, ref) VALUES (CURRENT_DATE, $1, $2, $3) RETURNING id',
                    ['Invoice posted', 'api', data.invoiceId]
                );
                const journalId = journalResult.rows[0]?.id;
                if (!journalId) {
                    throw new Error('Failed to create journal entry');
                }

                await client.query(
                    'INSERT INTO postings (journal_id, account_id, debit, credit, invoice_id) VALUES ($1, $2, $3, $4, $5)',
                    [journalId, mustGetAccount(accountMap, '1100-AR'), data.totals.gross, 0, data.invoiceId]
                );
                await client.query(
                    'INSERT INTO postings (journal_id, account_id, debit, credit, invoice_id) VALUES ($1, $2, $3, $4, $5)',
                    [journalId, mustGetAccount(accountMap, '4000-Sales:Services'), 0, data.totals.net, data.invoiceId]
                );
                if (data.totals.tax > 0) {
                    await client.query(
                        'INSERT INTO postings (journal_id, account_id, debit, credit, invoice_id) VALUES ($1, $2, $3, $4, $5)',
                        [journalId, mustGetAccount(accountMap, '2000-VAT Payable'), 0, data.totals.tax, data.invoiceId]
                    );
                }

                await client.query('COMMIT');
                trackSuccess();
                res.status(201).json({ ok: true, id: data.invoiceId });
            } catch (err) {
                await client.query('ROLLBACK');
                trackError();
                throw err;
            } finally {
                client.release();
            }
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/:id/export/ubl',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { rows } = await pool.query<InvoiceDocument>(
                'SELECT * FROM invoices WHERE invoice_id = $1',
                [req.params.id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'not found' });
            }

            const invoice = rows[0];
            const payload = {
                invoiceId: invoice.invoice_id,
                issueDate: invoice.issue_date,
                currency: invoice.currency,
                seller: {
                    name: 'CMQUO Limited',
                    address: {
                        line1: '1 Solar Way',
                        city: 'Doncaster',
                        postcode: 'DN1 1AA',
                        country: 'GB',
                    },
                },
                buyer: {
                    name: 'Unknown',
                    address: {
                        line1: '',
                        city: '',
                        postcode: '',
                        country: 'GB',
                    },
                },
                lines: [
                    {
                        lineNo: 1,
                        description: 'Refer to source',
                        qty: 1,
                        unitPrice: Number(invoice.net),
                    },
                ],
                totals: {
                    net: Number(invoice.net),
                    tax: Number(invoice.tax),
                    gross: Number(invoice.gross),
                },
            };

            const xml = jsonToUBL(payload);
            res.type('application/xml').send(xml);
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/:id/export/html',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { rows } = await pool.query<InvoiceDocument>(
                'SELECT * FROM invoices WHERE invoice_id = $1',
                [req.params.id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'not found' });
            }

            const invoice = rows[0];
            const html = invoiceTemplate({
                invoiceId: invoice.invoice_id,
                issueDate: invoice.issue_date,
                currency: invoice.currency,
                seller: {
                    name: 'CMQUO Limited',
                    address: {
                        line1: '1 Solar Way',
                        city: 'Doncaster',
                        postcode: 'DN1 1AA',
                        country: 'GB',
                    },
                },
                buyer: {
                    name: 'Unknown',
                    address: {
                        line1: '',
                        city: '',
                        postcode: '',
                        country: 'GB',
                    },
                },
                lines: [
                    {
                        lineNo: 1,
                        description: 'Refer to source',
                        qty: 1,
                        unitPrice: Number(invoice.net),
                        lineTotal: Number(invoice.net),
                        taxRate:
                            Number(invoice.net) > 0
                                ? Math.round((Number(invoice.tax) / Number(invoice.net)) * 100)
                                : 0,
                    },
                ],
                totals: {
                    net: Number(invoice.net),
                    tax: Number(invoice.tax),
                    gross: Number(invoice.gross),
                },
                paymentTerms: {
                    netDays: 14,
                },
            });

            res.type('text/html').send(html);
        } catch (error) {
            next(error);
        }
    }
);

export const invoicesRouter = router;
