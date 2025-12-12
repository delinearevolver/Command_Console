import { PDFDocument, StandardFonts } from 'pdf-lib';

const formatCurrency = (value = 0, currency = 'GBP') => {
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(value) || 0);
    } catch (error) {
        return `${currency} ${(Number(value) || 0).toFixed(2)}`;
    }
};

const chunkString = (input = '', size = 76) => {
    const chunks = [];
    for (let index = 0; index < input.length; index += size) {
        chunks.push(input.slice(index, index + size));
    }
    return chunks.join('\r\n');
};

const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
};

const formatDate = (value) => {
    if (!value) return '';
    return new Date(value).toISOString().slice(0, 10);
};

const wrapText = (text, font, size, maxWidth) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];
    const lines = [];
    let current = words.shift();
    while (words.length > 0) {
        const nextWord = words[0];
        const candidate = `${current} ${nextWord}`;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
            current = candidate;
            words.shift();
        } else {
            lines.push(current);
            current = words.shift();
        }
    }
    lines.push(current);
    return lines;
};

const parseDecimal = (input, fallback = 0) => {
    if (input === null || input === undefined) return fallback;
    if (typeof input === 'number') {
        return Number.isFinite(input) ? input : fallback;
    }
    const normalized = String(input)
        .replace(/[^\d.,-]/g, '')
        .replace(/,/g, '');
    if (!normalized.trim()) return fallback;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const formatVatSummaryRate = (value) => {
    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) return String(value);
    const fixed = numeric.toFixed(2);
    return fixed
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
};

const splitMultiline = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .flatMap(entry => splitMultiline(entry))
            .filter(Boolean);
    }
    if (typeof value === 'object') {
        const orderedKeys = [
            'line1',
            'line2',
            'line3',
            'street',
            'street1',
            'street2',
            'city',
            'state',
            'county',
            'region',
            'postal',
            'postcode',
            'zip',
            'country',
            'formatted',
        ];
        const collected = orderedKeys
            .map(key => value[key])
            .filter(entry => entry !== null && entry !== undefined);
        if (collected.length) {
            return collected
                .flatMap(entry => splitMultiline(entry))
                .filter(Boolean);
        }
        return Object.values(value)
            .flatMap(entry => splitMultiline(entry))
            .filter(Boolean);
    }
    return String(value)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
};

const normalizeCreditToken = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const hasCreditMarker = (value) => {
    const token = normalizeCreditToken(value);
    if (!token) return false;
    if (token.includes('credit')) return true;
    if (token.startsWith('cred')) return true;
    if (token.startsWith('cn')) return true;
    return false;
};

const documentAmountsLookCredit = (document = {}) => {
    const totals = document?.totals || {};
    const numericValues = [totals.net, totals.gross, totals.tax, totals.rounding];
    if (numericValues.some(value => {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric < 0;
    })) {
        return true;
    }
    const linesSource = Array.isArray(document?.lines) && document.lines.length
        ? document.lines
        : Array.isArray(document?.lineItems) ? document.lineItems : [];
    if (linesSource.length) {
        const derivedNet = linesSource.reduce((sum, line) => {
            const qty = Number(line?.quantity) || 0;
            const price = Number(line?.unitPrice) || 0;
            return sum + (qty * price);
        }, 0);
        if (derivedNet < 0) {
            return true;
        }
    }
    return false;
};

const isCreditDocument = (document = {}) => {
    if (!document) return false;
    if (document.isCredit === true || document.isCreditNote === true) return true;
    const candidates = [
        document.kind,
        document.invoiceKind,
        document.documentType,
        document.documentLabel,
        document.type,
        document.reference,
        document.referencePrefix,
        document.buyerReference,
        document.payment?.paymentReference,
        document.payment?.endToEndId,
    ];
    if (candidates.some(hasCreditMarker)) return true;
    if (documentAmountsLookCredit(document)) return true;
    return false;
};

export const buildInvoicePdf = async ({ invoice, organization = {}, customer = {} }) => {
    if (!invoice) throw new Error('Invoice data is required');

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 11;

    const pageSize = [841.89, 595.28]; // A4 landscape in points
    const leftMargin = 40;
    const lineHeight = 14;
    const tableFontSize = 10;
    const tableLineHeight = 12;
    const marginTop = 40;
    const marginBottom = 60;

    let page;
    let width;
    let height;
    let cursorY;

    const createPage = () => {
        page = doc.addPage(pageSize);
        ({ width, height } = page.getSize());
        cursorY = height - marginTop;
    };

    const computeIsoWeek = (dateValue) => {
        if (!dateValue) return '';
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return '';
        const tmp = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
        const day = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
        return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    };

    const formatWeekLabel = (isoValue) => {
        if (!isoValue) return '';
        const part = isoValue.includes('-W') ? isoValue.split('-W')[1] : isoValue.replace(/^W/, '');
        const normalized = part ? part.padStart(2, '0') : '';
        return normalized ? `W${normalized}` : '';
    };

    const ensureSpace = (amount = lineHeight) => {
        if (amount <= 0) return;
        if (cursorY - amount < marginBottom) {
            createPage();
        }
    };

    const serviceArrow = '->';
    const drawText = (text, options = {}) => {
        const {
            x = leftMargin,
            y = cursorY,
            size = fontSize,
            fontType = font,
        } = options;
        page.drawText(String(text ?? ''), { x, y, size, font: fontType });
    };

    const moveCursor = (amount) => {
        if (!amount) return;
        ensureSpace(amount);
        cursorY -= amount;
    };

    createPage();

    const documentIsCredit = isCreditDocument(invoice);
    const documentTitleCase = documentIsCredit ? 'Credit Note' : 'Invoice';
    const documentHeading = documentIsCredit ? 'CREDIT NOTE' : 'INVOICE';
    const documentIdLabel = documentIsCredit ? 'Credit note ID' : 'Invoice ID';
    const documentFilenamePrefix = documentIsCredit ? 'CreditNote' : 'Invoice';

    const seller = invoice.seller || {};
    const payment = invoice.payment || {};
    const buyerIdentifiers = invoice.buyerIdentifiers || {};
    const currencyCode = (invoice.currency || 'GBP').toUpperCase();
    const invoiceReference = String(invoice.reference || '').trim()
        || String(invoice.invoiceId || '').trim()
        || String(invoice.id || '').trim()
        || documentTitleCase;
    const remittanceReference = (payment.paymentReference && payment.paymentReference.trim()) || invoiceReference;
    const isoWeekDocument = computeIsoWeek(invoice.issueDate);

    const linesRaw = Array.isArray(invoice.lines) ? invoice.lines : [];
    let earliestDate = null;
    let latestDate = null;
    const vatSummary = new Map();
    let sumNet = 0;
    let sumVat = 0;

    const processedLines = linesRaw.map(raw => {
        const quantity = parseDecimal(raw.quantity, 0);
        const unitValue = parseDecimal(raw.unitPrice, 0);
        const lineNet = quantity * unitValue;
        const vatPercent = parseDecimal(raw.taxRate ?? 0, 0);
        const vatAmount = lineNet * (vatPercent / 100);
        const lineTotal = lineNet + vatAmount;
        sumNet += lineNet;
        sumVat += vatAmount;
        const vatKey = vatPercent.toFixed(2);
        vatSummary.set(vatKey, (vatSummary.get(vatKey) || 0) + vatAmount);
        const lineDateValue = raw.lineDate || invoice.issueDate;
        const lineDateObj = lineDateValue ? new Date(lineDateValue) : null;
        if (lineDateObj && !Number.isNaN(lineDateObj)) {
            if (!earliestDate || lineDateObj < earliestDate) earliestDate = lineDateObj;
            if (!latestDate || lineDateObj > latestDate) latestDate = lineDateObj;
        }
        const isoWeekValue = raw.isoWeek || computeIsoWeek(lineDateValue);
        const dateStr = formatDate(lineDateValue) || '';
        const weekDisplay = formatWeekLabel(isoWeekValue);
        const skuStr = raw.sku || '';
        const descriptionText = raw.description || 'Line item';
        const uomText = (raw.unitCode || raw.unit || 'EA').toString().toUpperCase();
        const qtyText = Number.isInteger(quantity) ? quantity.toString() : quantity.toFixed(2);
        const unitPriceText = formatCurrency(unitValue, currencyCode);
        const lineNetText = formatCurrency(lineNet, currencyCode);
        const vatPercentText = vatPercent.toFixed(2);
        const vatAmountText = formatCurrency(vatAmount, currencyCode);
        const lineTotalText = formatCurrency(lineTotal, currencyCode);
        return {
            ...raw,
            quantity,
            unitValue,
            lineNet,
            vatPercent,
            vatAmount,
            lineTotal,
            isoWeekValue,
            lineDateValue,
            formatted: {
                date: dateStr,
                week: weekDisplay,
                sku: skuStr,
                description: descriptionText,
                uom: uomText,
                qty: qtyText,
                unitPrice: unitPriceText,
                lineNet: lineNetText,
                vatPercent: vatPercentText,
                vatAmount: vatAmountText,
                lineTotal: lineTotalText,
            },
        };
    });
    if (vatSummary.size === 0) {
        vatSummary.set('0.00', 0);
    }

    const mmToPoints = (mm) => (mm * 72) / 25.4;
    const columnPadding = mmToPoints(3);
    const doubleColumnPadding = columnPadding * 2;

    const columnConfigs = [
        { key: 'date', header: 'Date', align: 'left', getValue: line => line.formatted?.date || '' },
        { key: 'week', header: 'Week', align: 'left', getValue: line => line.formatted?.week || '' },
        { key: 'sku', header: 'SKU', align: 'left', getValue: line => line.formatted?.sku || '' },
        { key: 'description', header: 'Description', align: 'left', getValue: line => line.formatted?.description || '' },
        { key: 'uom', header: 'UoM', align: 'left', getValue: line => line.formatted?.uom || '' },
        { key: 'qty', header: 'Qty', align: 'right', getValue: line => line.formatted?.qty || '' },
        { key: 'unitPrice', header: 'Unit price', align: 'right', getValue: line => line.formatted?.unitPrice || '' },
        { key: 'lineNet', header: 'Line net', align: 'right', getValue: line => line.formatted?.lineNet || '' },
        { key: 'vatPercent', header: 'VAT %', align: 'right', getValue: line => line.formatted?.vatPercent || '' },
        { key: 'vatAmount', header: 'VAT amt', align: 'right', getValue: line => line.formatted?.vatAmount || '' },
        { key: 'lineTotal', header: 'Line total', align: 'right', getValue: line => line.formatted?.lineTotal || '' },
    ];

    const columnLayouts = columnConfigs.map(config => {
        const headerWidth = boldFont.widthOfTextAtSize(config.header, tableFontSize);
        const valueWidth = processedLines.reduce((max, line) => {
            const text = config.getValue(line);
            const width = font.widthOfTextAtSize(String(text || ''), tableFontSize);
            return Math.max(max, width);
        }, headerWidth);
        return {
            ...config,
            width: valueWidth + doubleColumnPadding,
        };
    });

    const availableTableWidth = width - (leftMargin * 2);
    const descriptionColumn = columnLayouts.find(column => column.key === 'description');
    const fixedWidth = columnLayouts
        .filter(column => column.key !== 'description')
        .reduce((sum, column) => sum + column.width, 0);
    const minimumDescriptionWidth = descriptionColumn ? descriptionColumn.width : 0;
    if (descriptionColumn) {
        const remainingWidth = availableTableWidth - fixedWidth;
        if (remainingWidth > minimumDescriptionWidth) {
            descriptionColumn.width = remainingWidth;
        } else {
            descriptionColumn.width = Math.max(minimumDescriptionWidth, remainingWidth);
        }
    }

    let totalTableWidth = columnLayouts.reduce((sum, column) => sum + column.width, 0);
    if (totalTableWidth > availableTableWidth && descriptionColumn) {
        const overflow = totalTableWidth - availableTableWidth;
        const minimumAllowedDescriptionWidth = Math.max(doubleColumnPadding + 40, minimumDescriptionWidth);
        const adjustedDescriptionWidth = Math.max(minimumAllowedDescriptionWidth, descriptionColumn.width - overflow);
        if (adjustedDescriptionWidth < descriptionColumn.width) {
            descriptionColumn.width = adjustedDescriptionWidth;
            totalTableWidth = columnLayouts.reduce((sum, column) => sum + column.width, 0);
        }
    }
    if (totalTableWidth > availableTableWidth) {
        const scale = availableTableWidth / totalTableWidth;
        columnLayouts.forEach(column => {
            column.width *= scale;
        });
        totalTableWidth = availableTableWidth;
    }

    let runningX = leftMargin;
    columnLayouts.forEach(column => {
        column.x = runningX;
        runningX += column.width;
    });
    const tableRightEdge = runningX;
    const descriptionTextWidth = descriptionColumn
        ? Math.max(10, descriptionColumn.width - doubleColumnPadding)
        : Math.max(10, availableTableWidth / 4);

    const serviceStart = earliestDate ? formatDate(earliestDate) : '';
    const serviceEnd = latestDate ? formatDate(latestDate) : '';

    const rawSellerContactEmail = (seller.contactEmail || '').trim();
    const sellerContactEmail = rawSellerContactEmail && rawSellerContactEmail.toLowerCase() !== 'accounts@cmquo.co.uk'
        ? rawSellerContactEmail
        : ((organization.email || '').trim() || 'sbakerthe@gmail.com');
    const sellerContactPhone = (seller.contactPhone || '').trim() || (organization.phone || '').trim();
    const supplierLines = [
        seller.companyName || organization.name || 'Supplier',
        seller.companyId ? `Registered in England & Wales No. ${seller.companyId}` : null,
        `VAT ID: ${seller.vatId ? seller.vatId : 'Not Registered'}`,
        `Registered office: ${[seller.addressStreet, seller.addressCity, seller.addressPostal, seller.addressCountry].filter(Boolean).join(', ')}`,
        (sellerContactEmail || sellerContactPhone) ? `Contact: ${[sellerContactEmail, sellerContactPhone].filter(Boolean).join(', ')}` : null,
    ].filter(Boolean);

    const issueDateText = formatDate(invoice.issueDate);
    const dueDateTextRaw = formatDate(invoice.dueDate);
    const dueDateText = dueDateTextRaw || 'On receipt';
    const invoiceInfoLines = [
        `${documentIdLabel}: ${invoiceReference}`,
        `Issue date: ${issueDateText || '-'}`,
        `Due date: ${dueDateText}${payment.paymentTerms ? ` - ${payment.paymentTerms}` : ''}`,
        `Currency: ${currencyCode}`,
        `Buyer reference: ${invoice.buyerReference || '-'}`,
        (serviceStart && serviceEnd) ? `Service period: ${serviceStart} ${serviceArrow} ${serviceEnd}` : null,
        isoWeekDocument ? `ISO week: ${isoWeekDocument}` : null,
    ].filter(Boolean);

    const supplierHeadingY = height - marginTop;
    const supplierHeadingSize = 16;
    page.drawText('Supplier', { x: leftMargin, y: supplierHeadingY, size: supplierHeadingSize, font: boldFont });

    const supplierLinesToRender = supplierLines.length ? supplierLines : ['Supplier details not set'];
    const supplierContentStartY = supplierHeadingY - (lineHeight + 4);
    let supplierBottomY = supplierContentStartY;
    supplierLinesToRender.forEach((line, index) => {
        const lineY = supplierContentStartY - (index * lineHeight);
        page.drawText(String(line), { x: leftMargin, y: lineY, size: fontSize, font });
        supplierBottomY = lineY;
    });
    if (!supplierLinesToRender.length) {
        supplierBottomY = supplierContentStartY;
    }

    const invoiceTitle = documentHeading;
    const invoiceTitleSize = 30;
    const invoiceTitleWidth = boldFont.widthOfTextAtSize(invoiceTitle, invoiceTitleSize);
    const invoiceTitleX = width - leftMargin - invoiceTitleWidth;
    const invoiceTitleBaseline = supplierHeadingY - Math.max(0, invoiceTitleSize - supplierHeadingSize);
    page.drawText(invoiceTitle, {
        x: invoiceTitleX,
        y: invoiceTitleBaseline,
        size: invoiceTitleSize,
        font: boldFont,
    });

    const infoGap = Math.max(lineHeight, invoiceTitleSize * 0.5);
    const invoiceInfoStartY = invoiceTitleBaseline - invoiceTitleSize - infoGap;
    let invoiceInfoBottomY = invoiceInfoStartY;
    const invoiceInfoRightEdge = width - leftMargin;
    invoiceInfoLines.forEach((line, index) => {
        const text = String(line);
        const lineWidth = font.widthOfTextAtSize(text, fontSize);
        const lineY = invoiceInfoStartY - (index * lineHeight);
        page.drawText(text, { x: invoiceInfoRightEdge - lineWidth, y: lineY, size: fontSize, font });
        invoiceInfoBottomY = lineY;
    });
    if (!invoiceInfoLines.length) {
        invoiceInfoBottomY = invoiceInfoStartY;
    }

    const billToHeadingY = supplierBottomY - (lineHeight * 1.5);
    page.drawText('Bill-to', { x: leftMargin, y: billToHeadingY, size: supplierHeadingSize, font: boldFont });
    const billToFirstLineY = billToHeadingY - (lineHeight + 2);
    let billToBottomY = billToFirstLineY;
    const billToName = customer.name || invoice.customerName || 'Customer';
    const addressLines = splitMultiline(invoice.customerAddress || customer.address);
    const contactParts = [
        invoice.customerEmail || customer.email || '',
        invoice.customerPhone || customer.phone || '',
    ].filter(Boolean);
    const customerLines = [
        billToName,
        buyerIdentifiers.vatId ? `VAT ID: ${buyerIdentifiers.vatId}` : null,
        buyerIdentifiers.companyId ? `Company ID: ${buyerIdentifiers.companyId}` : null,
        buyerIdentifiers.lei ? `LEI: ${buyerIdentifiers.lei}` : null,
        ...addressLines,
        contactParts.length ? `Contact: ${contactParts.join(', ')}` : null,
    ].filter(Boolean);
    customerLines.forEach((line, index) => {
        const lineY = billToFirstLineY - (index * lineHeight);
        page.drawText(String(line), { x: leftMargin, y: lineY, size: fontSize, font });
        billToBottomY = lineY;
    });
    if (!customerLines.length) {
        billToBottomY = billToFirstLineY;
    }

    const headerBottomY = Math.min(invoiceInfoBottomY, billToBottomY);
    cursorY = headerBottomY - (lineHeight * 2);

    const drawLineItemsHeader = (continued = false) => {
        const title = continued ? 'Line items (continued)' : 'Line items';
        ensureSpace(tableLineHeight * 3);
        drawText(title, { fontType: boldFont });
        moveCursor(tableLineHeight + 2);

        const headerY = cursorY;
        columnLayouts.forEach(column => {
            const headerText = column.header;
            const headerWidth = boldFont.widthOfTextAtSize(headerText, tableFontSize);
            const headerX = column.align === 'right'
                ? column.x + column.width - columnPadding - headerWidth
                : column.x + columnPadding;
            page.drawText(headerText, { x: headerX, y: headerY, size: tableFontSize, font: boldFont });
        });
        moveCursor(tableLineHeight);
        page.drawLine({
            start: { x: leftMargin, y: cursorY + 4 },
            end: { x: tableRightEdge, y: cursorY + 4 },
            thickness: 0.5,
        });
    };

    drawLineItemsHeader(false);

    processedLines.forEach(line => {
        const descriptionText = line.formatted?.description || 'Line item';
        const descLines = wrapText(descriptionText, font, tableFontSize, descriptionTextWidth);
        const rowHeight = Math.max(tableLineHeight, descLines.length * tableLineHeight);
        const requiredSpace = rowHeight + tableLineHeight;
        if (cursorY - requiredSpace < marginBottom) {
            createPage();
            drawLineItemsHeader(true);
        }
        moveCursor(tableLineHeight);
        const rowTop = cursorY;

        if (rowHeight > tableLineHeight) {
            moveCursor(rowHeight - tableLineHeight);
        }

        columnLayouts.forEach(column => {
            const cellValue = column.getValue(line);
            if (column.key === 'description') {
                descLines.forEach((segment, index) => {
                    const textX = column.x + columnPadding;
                    const textY = rowTop - (index * tableLineHeight);
                    page.drawText(segment, { x: textX, y: textY, size: tableFontSize, font });
                });
            } else {
                const text = String(cellValue || '');
                const textWidth = font.widthOfTextAtSize(text, tableFontSize);
                const textX = column.align === 'right'
                    ? column.x + column.width - columnPadding - textWidth
                    : column.x + columnPadding;
                page.drawText(text, { x: textX, y: rowTop, size: tableFontSize, font });
            }
        });

        page.drawLine({
            start: { x: leftMargin, y: cursorY - 2 },
            end: { x: tableRightEdge, y: cursorY - 2 },
            thickness: 0.3,
        });
    });
    moveCursor(lineHeight);

    const totalsSource = invoice.totals || {};
    const invoiceNet = totalsSource.net ?? sumNet;
    const invoiceVat = totalsSource.tax ?? sumVat;
    const invoiceRounding = totalsSource.rounding ?? 0;
    const invoiceGross = totalsSource.gross ?? (invoiceNet + invoiceVat);
    const vatSummaryEntries = Array
        .from(vatSummary.entries())
        .sort((a, b) => parseDecimal(a[0], 0) - parseDecimal(b[0], 0));
    
    const amountPayable = invoiceGross + invoiceRounding;

    const totalsLinesCount = 7 + vatSummaryEntries.length;
    ensureSpace((totalsLinesCount + 2) * lineHeight);

    const totalsLabelX = width - leftMargin - 220;
    const totalsValueRight = width - leftMargin;
    drawText('Totals', { x: totalsLabelX, fontType: boldFont });
    moveCursor(lineHeight);
    const drawTotalLine = (label, value, options = {}) => {
        const textFont = options.bold ? boldFont : font;
        page.drawText(String(label), { x: totalsLabelX, y: cursorY, size: fontSize, font: textFont });
        const valueText = formatCurrency(value || 0, currencyCode);
        const valueWidth = textFont.widthOfTextAtSize(valueText, fontSize);
        page.drawText(valueText, { x: totalsValueRight - valueWidth, y: cursorY, size: fontSize, font: textFont });
        moveCursor(lineHeight);
    };

    drawTotalLine('Line extension (net)', invoiceNet);
    drawTotalLine('Tax exclusive', invoiceNet);
    vatSummaryEntries.forEach(([rate, amount]) => {
        drawTotalLine(`VAT @ ${formatVatSummaryRate(rate)}%`, amount);
    });
    drawTotalLine('Tax total', invoiceVat);
    drawTotalLine('Tax inclusive', invoiceGross);
    drawTotalLine('Rounding', invoiceRounding);
    drawTotalLine('Amount payable', amountPayable, { bold: true });
    moveCursor(lineHeight);

    const notesLines = [];
    if (invoice.notes) {
        notesLines.push(...String(invoice.notes).split(/\r?\n/).filter(Boolean));
    }
    if (!seller.vatId || seller.vatId.toLowerCase().includes('not')) {
        notesLines.push(`Supplier not VAT registered; VAT charged: ${formatCurrency(invoiceVat, currencyCode)}.`);
    }
    if (notesLines.length) {
        ensureSpace((notesLines.length + 2) * lineHeight);
        drawText('Notes', { fontType: boldFont });
        moveCursor(lineHeight + 2);
        notesLines.forEach(noteLine => {
            ensureSpace(lineHeight);
            drawText(noteLine);
            moveCursor(lineHeight);
        });
        moveCursor(lineHeight);
    }

    const endToEndId = (payment.endToEndId && payment.endToEndId.trim())
        || `E2E-${remittanceReference.replace(/\s+/g, '-').toUpperCase()}`;
    const paymentLines = [
        `Terms: ${payment.paymentTerms || 'NET 15'}`,
        'Pay to (credit transfer):',
        `Account name: ${payment.accountName || '-'}`,
        `Sort code: ${payment.sortCode || '-'}`,
        `Account number: ${payment.accountNumber || '-'}`,
        `IBAN: ${payment.iban || '-'}`,
        `BIC: ${payment.bic || '-'}`,
        payment.bankName ? `Bank: ${payment.bankName}` : null,
        payment.bankAddress ? `Bank address: ${payment.bankAddress}` : null,
        `Remittance reference: ${remittanceReference}`,
        `End-to-End ID: ${endToEndId}`,
    ].filter(Boolean);

    ensureSpace((paymentLines.length + 2) * lineHeight);
    drawText('Payment details', { fontType: boldFont });
    moveCursor(lineHeight + 2);
    paymentLines.forEach(line => {
        ensureSpace(lineHeight);
        drawText(line);
        moveCursor(lineHeight);
    });

    const pages = doc.getPages();
    const totalPages = pages.length;
    if (totalPages > 0) {
        const footerFontSize = 9;
        pages.forEach((pageInstance, index) => {
            // Center legal-style page numbering in the footer
            const label = `${index + 1} of ${totalPages}`;
            const { width: pageWidth } = pageInstance.getSize();
            const textWidth = font.widthOfTextAtSize(label, footerFontSize);
            const footerX = (pageWidth - textWidth) / 2;
            const footerY = marginBottom / 2;
            pageInstance.drawText(label, {
                x: footerX,
                y: footerY,
                size: footerFontSize,
                font,
            });
        });
    }

    const pdfBytes = await doc.save();
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const base64 = arrayBufferToBase64(pdfBytes);
    const safeReference = invoiceReference.replace(/[^A-Za-z0-9._-]/g, '_') || 'draft';
    return {
        blob: pdfBlob,
        base64,
        filename: `${documentFilenamePrefix}-${safeReference}.pdf`,
    };
};

export const buildEmailDraftBlob = ({ from, to, cc, subject, body, attachment }) => {
    if (!attachment || !attachment.base64 || !attachment.filename) {
        throw new Error('Attachment information is required');
    }

    const boundary = '----=_Boundary_' + Math.random().toString(36).slice(2, 12);
    const lines = [
        `From: ${from || 'billing@command-console.local'}`,
        `To: ${to || ''}`,
        cc ? `Cc: ${cc}` : null,
        `Subject: ${subject || 'Invoice'}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        body || 'Please find the invoice attached.',
        '',
        `--${boundary}`,
        `Content-Type: application/pdf; name="${attachment.filename}"`,
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        chunkString(attachment.base64),
        '',
        `--${boundary}--`,
        '',
    ].filter((line) => line !== null);

    return new Blob([lines.join('\r\n')], { type: 'message/rfc822' });
};
