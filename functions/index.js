/**
 * Import function triggers from their respective sub-packages.
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
const {onCall} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler"); // Modern syntax for scheduled functions
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const vision = require("@google-cloud/vision");
const {google} = require("googleapis");
const functions = require("firebase-functions");

initializeApp();
const visionClient = new vision.ImageAnnotatorClient();

// Helper to remove undefined values from objects for Firestore
const cleanForFirestore = (obj) => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanForFirestore).filter(x => x !== undefined);
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = cleanForFirestore(value);
    }
  }
  return cleaned;
};

const distinctStrings = (input = []) => {
  if (!Array.isArray(input)) return [];
  const values = [];
  for (const value of input) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed && !values.includes(trimmed)) values.push(trimmed);
    }
  }
  return values;
};

const mergeStringSets = (...sources) => {
  const merged = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
        }
      }
    } else if (typeof source === 'string') {
      const trimmed = source.trim();
      if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
    }
  }
  return merged;
};

const normalizeRoles = (role, roles, ...extras) => {
  const merged = mergeStringSets(roles, role, ...extras);
  if (!merged.length) merged.push('worker');
  return merged;
};

const arraysMatch = (a = [], b = []) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const assertAuthenticated = (auth) => {
  if (!auth || !auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in to perform this action.');
  }
};

const fetchUserRecord = async (uid) => {
  if (!uid) return null;
  const snapshot = await getFirestore().collection('users').doc(uid).get();
  return snapshot.exists ? snapshot.data() : null;
};

const isSuperAdminEmail = (email) => {
  if (typeof email !== 'string') return false;
  return email.trim().toLowerCase() === 'delinearevolver@gmail.com';
};

const callerHasOrgAuthority = (caller, organizationId) => {
  if (!caller) return false;
  if (caller.role && ['master', 'owner', 'admin'].includes(String(caller.role).toLowerCase())) return true;
  const roles = Array.isArray(caller.roles) ? caller.roles.map((role) => String(role).toLowerCase()) : [];
  if (roles.some((role) => ['master', 'owner', 'admin'].includes(role))) return true;
  const orgIds = mergeStringSets(caller.orgIds, caller.organizations, caller.orgId);
  return organizationId ? orgIds.includes(organizationId) : orgIds.length > 0;
};

exports.createOrganization = onCall(async (request) => {
  assertAuthenticated(request.auth);
  const db = getFirestore();
  const callerEmail = request.auth.token?.email || '';
  const caller = await fetchUserRecord(request.auth.uid);

  if (!isSuperAdminEmail(callerEmail) && !callerHasOrgAuthority(caller)) {
    throw new functions.https.HttpsError('permission-denied', 'Only authorised administrators can create new organizations.');
  }

  const name = typeof request.data?.name === 'string' ? request.data.name.trim() : '';
  if (!name) {
    throw new functions.https.HttpsError('invalid-argument', 'Organization name is required.');
  }
  const description = typeof request.data?.description === 'string' ? request.data.description.trim() : '';

  const now = FieldValue.serverTimestamp();
  const orgRef = db.collection('organizations').doc();
  const payload = cleanForFirestore({
    name,
    description: description || null,
    owners: mergeStringSets([request.auth.uid], caller?.owners),
    admins: mergeStringSets([request.auth.uid], caller?.admins),
    members: mergeStringSets([request.auth.uid], caller?.members),
    createdBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    orgId: orgRef.id,
  });
  await orgRef.set(payload);

  const aliasRef = db.collection('orgs').doc(orgRef.id);
  await aliasRef.set(cleanForFirestore({
    name,
    description: description || null,
    ownerId: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  }), { merge: true });

  const mergedOrgIds = mergeStringSets(caller?.orgIds, caller?.organizations, caller?.orgId, orgRef.id);
  const mergedRoles = normalizeRoles(caller?.role || 'master', caller?.roles, 'master', 'owner');
  if (!mergedRoles.includes('master')) mergedRoles.unshift('master');
  if (!mergedRoles.includes('owner')) mergedRoles.push('owner');

  await db.collection('users').doc(request.auth.uid).set(cleanForFirestore({
    orgId: orgRef.id,
    orgIds: mergedOrgIds,
    organizations: mergedOrgIds,
    role: caller?.role || 'master',
    roles: mergedRoles,
    updatedAt: now,
  }), { merge: true });

  return { organizationId: orgRef.id };
});

exports.assignOrganization = onCall(async (request) => {
  assertAuthenticated(request.auth);
  const userId = typeof request.data?.userId === 'string' ? request.data.userId.trim() : '';
  const organizationId = typeof request.data?.organizationId === 'string' ? request.data.organizationId.trim() : '';

  if (!userId || !organizationId) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID and Organization ID are required.');
  }

  const db = getFirestore();
  const callerEmail = request.auth.token?.email || '';
  const callerRecord = await fetchUserRecord(request.auth.uid);
  const organizationSnap = await db.collection('organizations').doc(organizationId).get();

  if (!organizationSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Organization not found.');
  }
  const organization = organizationSnap.data();

  if (
    !isSuperAdminEmail(callerEmail) &&
    !callerHasOrgAuthority(callerRecord, organizationId) &&
    !mergeStringSets(organization.admins, organization.owners).includes(request.auth.uid)
  ) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have permission to assign users to this organization.');
  }

  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Target user not found.');
  }

  const userData = userSnap.data() || {};
  const orgIds = mergeStringSets(userData.orgIds, userData.organizations, userData.orgId, organizationId);
  const now = FieldValue.serverTimestamp();

  await userSnap.ref.set(cleanForFirestore({
    orgId: organizationId,
    orgIds,
    organizations: orgIds,
    updatedAt: now,
  }), { merge: true });

  const members = mergeStringSets(organization.members, userId);
  await organizationSnap.ref.set(cleanForFirestore({
    members,
    updatedAt: now,
  }), { merge: true });

  await db.collection('orgs').doc(organizationId).set(cleanForFirestore({
    members,
    updatedAt: now,
  }), { merge: true });

  return { userId, organizationId };
});

// Helper function to initialize OAuth2 client
const getOauth2Client = () => {
  return new google.auth.OAuth2(
      functions.config().google.client_id,
      functions.config().google.client_secret,
      // This must match the URI in your Google Cloud Console credentials
      `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/oauthcallback`,
  );
};

/**
 * Generates a Google Auth URL for the user to grant permissions.
 */
exports.getGoogleAuthUrl = onCall((request) => {
  const oauth2Client = getOauth2Client();

  // Scopes define the level of access you are requesting
  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    // A unique identifier for the user's session
    state: request.auth.uid,
  });

  return {url};
});

/**
 * Handles the OAuth callback from Google, exchanges the code for tokens,
 * and saves them securely.
 */
exports.oauthcallback = functions.https.onRequest(async (req, res) => {
  const code = req.query.code;
  const userId = req.query.state; // We passed the UID in the state parameter

  if (!code || !userId) {
    return res.status(400).send("Missing authorization code or user state.");
  }

  try {
    const oauth2Client = getOauth2Client();
    const {tokens} = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Securely store the tokens for the user
    // NOTE: In a production app, encrypt these tokens before storing.
    const db = getFirestore();
    const userRef = db.collection("users").doc(userId);

    await userRef.update({
      "integrations.google.tokens": tokens,
      "integrations.google.status": "connected",
    });

    // You can redirect the user back to your app with a success message
    return res.redirect("https://fearless-leader.web.app?integration=success");
  } catch (error) {
    console.error("Error exchanging auth code for tokens:", error);
    return res.status(500).send("Authentication failed.");
  }
});

/**
 * A scheduled function to sync calendar events.
 * This function will run automatically on a defined schedule.
 * THIS IS THE CORRECTED V2 SYNTAX
 */
exports.syncCalendarEvents = onSchedule("every 15 minutes", async (event) => {
  const db = getFirestore();
  // Find all users who have connected their Google account
  const usersSnapshot = await db.collection("users")
      .where("integrations.google.status", "==", "connected")
      .get();

  if (usersSnapshot.empty) {
    console.log("No users with active Google integrations.");
    return null;
  }

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const tokens = userData.integrations.google.tokens;
    const companyId = userData.companyId;

    if (!tokens || !companyId) {
      continue; // Skip if tokens or companyId are missing
    }

    const oauth2Client = getOauth2Client();
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({version: "v3", auth: oauth2Client});

    try {
      // Fetch events from the primary calendar for the next 24 hours
      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: (new Date()).toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = response.data.items;
      if (!events || events.length === 0) {
        console.log(`No upcoming events for user ${userDoc.id}.`);
        continue;
      }

      // In a real app, you would add logic here to check for duplicates
      // before adding new items to the inbox.
      const inboxRef = db.collection(`companies/${companyId}/inbox`);
      for (const event of events) {
        await inboxRef.add({
          type: "Google Calendar",
          title: event.summary,
          details: event.description || "No details provided.",
          sourceId: event.id,
          createdAt: new Date(),
        });
      }
      console.log(`Synced ${events.length} events for user ${userDoc.id}.`);
    } catch (error) {
      console.error(`Failed to sync calendar for user ${userDoc.id}:`,
          error,
      );
      // If refresh token is invalid, update user status
      if (error.code === 401) {
        await userDoc.ref.update({
          "integrations.google.status": "disconnected",
        });
      }
    }
  }
  return null;
});const buildLedgerConfig = () => {
  const defaults = {
    baseUrl: (process.env.LEDGER_API_BASE || '').trim(),
    seller: {
      name: (process.env.LEDGER_SELLER_NAME || '').trim() || 'CMQUO Limited',
      line1: (process.env.LEDGER_SELLER_ADDRESS_LINE1 || '').trim(),
      city: (process.env.LEDGER_SELLER_ADDRESS_CITY || '').trim(),
      postcode: (process.env.LEDGER_SELLER_ADDRESS_POSTCODE || '').trim(),
      country: ((process.env.LEDGER_SELLER_ADDRESS_COUNTRY || 'GB')).trim().toUpperCase(),
    },
  };

  const config = {}; // Removed functions.config() - using process.env directly
  const value = (src, fallback) => {
    if (typeof src === 'string' && src.trim() && src.trim().toLowerCase() !== 'y') {
      return src.trim();
    }
    if (typeof fallback === 'string') {
      return fallback.trim();
    }
    return fallback;
  };

  const resolvedBaseUrl = value(config.api_base, defaults.baseUrl);
  return {
    baseUrl: resolvedBaseUrl,
    seller: {
      name: value(config.seller_name, defaults.seller.name),
      line1: value(config.seller_address_line1, defaults.seller.line1),
      city: value(config.seller_address_city, defaults.seller.city),
      postcode: value(config.seller_address_postcode, defaults.seller.postcode),
      country: value(config.seller_address_country, defaults.seller.country).toUpperCase() || 'GB',
    },
  };
};

const normaliseLines = (invoiceDoc) => {
  const raw = Array.isArray(invoiceDoc.lineItems) ? invoiceDoc.lineItems : [];
  return raw
    .map((line, idx) => {
      const qty = Number(line.quantity ?? line.qty ?? 0);
      const unitPrice = Number(line.unitPrice ?? 0);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice)) {
        return null;
      }
      const taxRate = line.taxRate === undefined ? undefined : Number(line.taxRate);
      return {
        lineNo: idx + 1,
        description: line.description || line.name || line.sku || `Line ${idx + 1}`,
        qty,
        unitPrice,
        taxRate: Number.isFinite(taxRate) ? taxRate : undefined,
      };
    })
    .filter(Boolean);
};

const computeTotals = (invoiceDoc, lines) => {
  const totals = typeof invoiceDoc.totals === 'object' && invoiceDoc.totals !== null ? invoiceDoc.totals : {};
  let net = Number(totals.net);
  let tax = Number(totals.tax);
  let gross = Number(totals.gross);

  if (![net, tax, gross].every(Number.isFinite)) {
    net = 0;
    tax = 0;
    for (const line of lines) {
      const lineNet = line.qty * line.unitPrice;
      net += lineNet;
      if (line.taxRate) {
        tax += lineNet * (line.taxRate / 100);
      }
    }
    gross = net + tax;
  }

  return {
    net: Number(net.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    gross: Number(gross.toFixed(2)),
  };
};

const computeClaimTotals = (lines = []) => {
  const safeLines = Array.isArray(lines) ? lines : [];
  let net = 0;
  let vat = 0;
  for (const line of safeLines) {
    net += Number(line?.netAmount || 0);
    vat += Number(line?.vatAmount || 0);
  }
  const gross = net + vat;
  return {
    netTotal: Math.round(net * 100) / 100,
    vatTotal: Math.round(vat * 100) / 100,
    grossTotal: Math.round(gross * 100) / 100,
  };
};

const ensureLedgerBudget = async (type, limitPerHour = 10) => {
  const db = getFirestore();
  const ref = db.collection('system').doc('ledgerCallBudget');
  const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  let allowed = false;
  let used = 0;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const bucket = data[type] || {};
    used = Number(bucket[hourKey] || 0);
    if (used >= limitPerHour) {
      allowed = false;
      return;
    }
    allowed = true;
    used += 1;
    tx.set(ref, {
      [type]: {
        ...bucket,
        [hourKey]: used,
      },
    }, {merge: true});
  });
  return {allowed, used, hourKey};
};

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

exports.syncInvoiceToLedger = onDocumentWritten('invoices/{invoiceId}', async (event) => {
  if (!event.data) {
    return;
  }

  const { baseUrl, seller } = buildLedgerConfig();
  const invoiceRef = event.data.after.ref;

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    functions.logger.warn('Ledger API base URL not configured; skipping sync.', { invoiceId: event.params.invoiceId });
    await invoiceRef.set({
      syncStatus: 'blocked',
      syncMessage: 'Ledger integration not configured',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const invoice = event.data.after.data();
  const invoiceId = (invoice.invoiceId || invoice.reference || event.params.invoiceId || '').toString().trim();
  const invoiceReference = invoice.reference || invoice.invoiceId || invoiceId;
  const issueDate = invoice.issueDate || new Date().toISOString().slice(0, 10);
  const dueDate = invoice.dueDate ? invoice.dueDate : undefined;
  const currency = (invoice.currency || 'GBP').toUpperCase();

  const lines = normaliseLines(invoice);
  if (lines.length === 0) {
    functions.logger.error('Invoice has no billable lines; cannot sync to ledger.', { invoiceId });
    await invoiceRef.set({
      syncStatus: 'error',
      syncMessage: 'No valid invoice lines to post',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const totals = computeTotals(invoice, lines);

  const customerId = invoice.customerId || null;
  let customer;
  if (customerId) {
    try {
      const snapshot = await getFirestore().collection('customers').doc(customerId).get();
      if (snapshot.exists) {
        customer = snapshot.data();
      }
    } catch (error) {
      functions.logger.error('Unable to fetch customer for invoice', { invoiceId, customerId, error });
    }
  }

  const buyerName = invoice.customerName || customer?.name || 'Unknown customer';
  const addressSource = invoice.customerAddress || customer?.billingAddress || '';
  const normalizedAddress = Array.isArray(addressSource)
    ? addressSource.join('\n')
    : String(addressSource || '');
  const addressParts = normalizedAddress
    .replace(/\r+/g, '')
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const buyerAddress = {
    street: addressParts[0] || '',
    city: addressParts[1] || '',
    postal: addressParts[2] || '',
    country: (customer?.country || invoice.customerCountry || seller.country || 'GB').toUpperCase(),
  };

  const computedNet = lines.reduce((acc, line) => acc + (Number(line.qty) || 0) * (Number(line.unitPrice) || 0), 0);
  const computedVat = lines.reduce((acc, line) => {
    const rate = Number(line.taxRate ?? 0);
    return acc + ((Number(line.qty) || 0) * (Number(line.unitPrice) || 0) * (rate / 100));
  }, 0);
  const invoiceNet = totals.net ?? computedNet;
  const invoiceVat = totals.tax ?? computedVat;
  const invoiceGross = totals.gross ?? (invoiceNet + invoiceVat);
  const invoiceRounding = totals.rounding ?? 0;
  const amountPayable = invoiceGross + invoiceRounding;

  const originalLineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  const ledgerLines = lines.map((line, idx) => {
    const source = originalLineItems[idx] || {};
    const quantity = Number(line.qty) || 0;
    const taxPercent = Number(line.taxRate ?? source.taxRate ?? 0);
    const unitPrice = Number(line.unitPrice) || 0;
    const unitCode = (source.unitCode || source.unit || 'EA').toString().toUpperCase();
    const taxCategory = taxPercent > 0 ? 'S' : 'Z';
    return {
      id: String(line.lineNo || idx + 1),
      description: line.description,
      quantity: quantity.toFixed(2),
      unit_code: unitCode,
      price: unitPrice.toFixed(2),
      tax_category: taxCategory,
      tax_percent: taxPercent.toFixed(2),
    };
  });

  const toMoneyString = (value) => (Number(value) || 0).toFixed(2);

  const sellerDetails = invoice.seller || {};
  const sellerPayload = {
    name: seller.name,
    company_id: sellerDetails.companyId || null,
    vat_id: sellerDetails.vatId || null,
    lei: sellerDetails.lei || null,
    address: {
      street: sellerDetails.addressStreet || seller.line1 || '',
      city: sellerDetails.addressCity || seller.city || '',
      postal: sellerDetails.addressPostal || seller.postcode || '',
      country: (sellerDetails.addressCountry || seller.country || 'GB').toUpperCase(),
    },
  };

  const buyerIdentifiers = invoice.buyerIdentifiers || {};
  const buyerPayload = {
    name: buyerName,
    company_id: buyerIdentifiers.companyId || customer?.companyId || null,
    vat_id: buyerIdentifiers.vatId || customer?.vatId || null,
    lei: buyerIdentifiers.lei || null,
    address: buyerAddress,
  };

  const paymentDetails = invoice.payment || {};
  const remittanceReference = (paymentDetails.paymentReference && paymentDetails.paymentReference.trim()) || invoiceReference;
  const structuredReference = paymentDetails.structuredReference && paymentDetails.structuredReference.reference
    ? {
        scheme: paymentDetails.structuredReference.scheme || 'SCOR',
        reference: paymentDetails.structuredReference.reference,
      }
    : null;
  const paymentPayload = {
    payment_means_code: paymentDetails.paymentMeansCode || '42',
    payment_terms: paymentDetails.paymentTerms || 'NET 15',
    end_to_end_id: paymentDetails.endToEndId || `E2E-${remittanceReference.replace(/\s+/g, '-').toUpperCase()}`,
    iban: paymentDetails.iban || '',
    bic: paymentDetails.bic || '',
    remittance_unstructured: remittanceReference,
    remittance_structured: structuredReference,
  };

  const payload = {
    invoice: {
      id: invoiceReference,
      issue_date: issueDate,
      due_date: dueDate || null,
      currency,
      buyer_reference: invoice.buyerReference || null,
      note: invoice.notes || null,
      tax_point_date: invoice.taxPointDate || null,
    },
    seller: sellerPayload,
    buyer: buyerPayload,
    lines: ledgerLines,
    charges: [],
    allowances: [],
    totals: {
      line_extension: toMoneyString(invoiceNet),
      tax_exclusive: toMoneyString(invoiceNet),
      tax_total: toMoneyString(invoiceVat),
      tax_inclusive: toMoneyString(invoiceGross),
      payable_rounding: toMoneyString(invoiceRounding),
      payable_amount: toMoneyString(amountPayable),
    },
    payment: {
      ...paymentPayload,
      iban: paymentPayload.iban || sellerDetails.iban || '',
      bic: paymentPayload.bic || sellerDetails.bic || '',
    },
    attachments: [],
  };
  if (dueDate) {
  }

  functions.logger.info('Posting invoice to ledger', {
    invoiceId: payload.invoice.id,
    apiUrl: trimTrailingSlash(baseUrl) + '/invoices',
    lineCount: lines.length,
    totals,
  });

  try {
    const response = await fetch(trimTrailingSlash(baseUrl) + '/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    functions.logger.info('Ledger response received', { invoiceId: payload.invoice.id, status: response.status });

    if (!response.ok) {
      const body = await response.text();
      functions.logger.error('Ledger API rejected invoice', { invoiceId: payload.invoice.id, status: response.status, body });
      await invoiceRef.set({
        syncStatus: 'error',
        syncMessage: `Ledger API error (${response.status})`,
        syncPayload: cleanForFirestore(payload),
        syncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    await invoiceRef.set({
      syncStatus: 'synced',
      syncedAt: FieldValue.serverTimestamp(),
      ledgerInvoiceId: payload.invoice.id,
    }, { merge: true });
    functions.logger.info('Invoice synced to ledger', { invoiceId: payload.invoice.id });
  } catch (error) {
    functions.logger.error('Failed to sync invoice to ledger', { invoiceId: payload.invoice.id, error });
    await invoiceRef.set({
      syncStatus: 'error',
      syncMessage: error.message || 'Ledger sync failed',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
});

exports.syncCustomerToLedger = onDocumentWritten('customers/{customerId}', async (event) => {
  if (!event.data || !event.data.after?.exists) return;
  const after = event.data.after;
  const customer = after.data() || {};
  const customerRef = after.ref;
  const { baseUrl } = buildLedgerConfig();

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    await customerRef.set({
      syncStatus: 'blocked',
      syncMessage: 'Ledger integration not configured',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const ledgerId = (customer.ledgerCustomerId || '').trim();
  const endpointBase = trimTrailingSlash(baseUrl) + '/customers';
  const endpoint = ledgerId ? `${endpointBase}/${encodeURIComponent(ledgerId)}` : endpointBase;
  const method = ledgerId ? 'PATCH' : 'POST';

  const payload = {
    name: customer.name || 'Customer',
    email: customer.email || null,
    phone: customer.phone || null,
    vat_id: customer.vatNumber || null,
    company_id: customer.companyNumber || null,
    control_account_id: customer.ledgerControlAccountId || null,
    currency: (customer.currency || 'GBP').toUpperCase(),
  };

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      functions.logger.error('Ledger API rejected customer', { customerId: event.params.customerId, status: response.status, body });
      await customerRef.set({
        syncStatus: 'error',
        syncMessage: `Ledger API error (${response.status})`,
        syncPayload: cleanForFirestore(payload),
        syncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const body = await response.json().catch(() => ({}));
    const resolvedId = body.id || ledgerId || event.params.customerId;

    await customerRef.set({
      ledgerCustomerId: resolvedId,
      syncStatus: 'synced',
      syncMessage: 'Customer synced to ledger',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    functions.logger.info('Customer synced to ledger', { customerId: event.params.customerId, ledgerCustomerId: resolvedId });
  } catch (error) {
    functions.logger.error('Failed to sync customer to ledger', { customerId: event.params.customerId, error });
    await customerRef.set({
      syncStatus: 'error',
      syncMessage: error.message || 'Ledger sync failed',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
});

exports.syncSupplierToLedger = onDocumentWritten('suppliers/{supplierId}', async (event) => {
  if (!event.data || !event.data.after?.exists) return;
  const after = event.data.after;
  const supplier = after.data() || {};
  const supplierRef = after.ref;
  const { baseUrl } = buildLedgerConfig();

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    await supplierRef.set({
      syncStatus: 'blocked',
      syncMessage: 'Ledger integration not configured',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const ledgerId = (supplier.ledgerSupplierId || '').trim();
  const endpointBase = trimTrailingSlash(baseUrl) + '/suppliers';
  const endpoint = ledgerId ? `${endpointBase}/${encodeURIComponent(ledgerId)}` : endpointBase;
  const method = ledgerId ? 'PATCH' : 'POST';

  const payload = {
    name: supplier.name || 'Supplier',
    email: supplier.email || null,
    phone: supplier.phone || null,
    vat_id: supplier.vatNumber || null,
    company_id: supplier.companyNumber || null,
    control_account_id: supplier.ledgerControlAccountId || null,
    default_expense_account: supplier.defaultExpenseAccount || null,
    currency: (supplier.currency || 'GBP').toUpperCase(),
  };

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      functions.logger.error('Ledger API rejected supplier', { supplierId: event.params.supplierId, status: response.status, body });
      await supplierRef.set({
        syncStatus: 'error',
        syncMessage: `Ledger API error (${response.status})`,
        syncPayload: cleanForFirestore(payload),
        syncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const body = await response.json().catch(() => ({}));
    const resolvedId = body.id || ledgerId || event.params.supplierId;

    await supplierRef.set({
      ledgerSupplierId: resolvedId,
      syncStatus: 'synced',
      syncMessage: 'Supplier synced to ledger',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    functions.logger.info('Supplier synced to ledger', { supplierId: event.params.supplierId, ledgerSupplierId: resolvedId });
  } catch (error) {
    functions.logger.error('Failed to sync supplier to ledger', { supplierId: event.params.supplierId, error });
    await supplierRef.set({
      syncStatus: 'error',
      syncMessage: error.message || 'Ledger sync failed',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
});

exports.syncPurchaseOrderToLedger = onDocumentWritten('purchaseOrders/{poId}', async (event) => {
  if (!event.data || !event.data.after?.exists) return;
  const after = event.data.after;
  const po = after.data() || {};
  const poRef = after.ref;
  const { baseUrl } = buildLedgerConfig();

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    await poRef.set({
      syncStatus: 'blocked',
      syncMessage: 'Ledger integration not configured',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const lines = Array.isArray(po.lines) ? po.lines : [];
  if (lines.length === 0) {
    await poRef.set({
      syncStatus: 'error',
      syncMessage: 'No line items to post',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const ledgerId = (po.ledgerPurchaseOrderId || '').trim();
  const endpointBase = trimTrailingSlash(baseUrl) + '/purchase-orders';
  const endpoint = ledgerId ? `${endpointBase}/${encodeURIComponent(ledgerId)}` : endpointBase;
  const method = ledgerId ? 'PATCH' : 'POST';

  const payload = {
    id: po.id || event.params.poId,
    supplier_id: po.supplierSnapshot?.ledgerSupplierId || po.supplierLedgerId || null,
    control_account_id: po.supplierSnapshot?.ledgerControlAccountId || null,
    reference: po.supplierReference || po.id || event.params.poId,
    issue_date: po.issueDate || new Date().toISOString().slice(0, 10),
    expected_delivery_date: po.expectedDeliveryDate || null,
    currency: (po.currency || 'GBP').toUpperCase(),
    payment_terms_days: Number(po.paymentTermsDays) || 0,
    delivery_address: po.deliveryAddress || null,
    lines: lines.map((line, idx) => ({
      id: String(line.lineNumber || idx + 1),
      description: line.description || '',
      quantity: Number(line.quantity) || 0,
      unit_price: Number(line.unitPrice) || 0,
      tax_rate: Number(line.taxRate) || 0,
      expense_account: line.expenseAccount || po.supplierSnapshot?.defaultExpenseAccount || null,
    })),
    totals: po.totals || {},
  };

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      functions.logger.error('Ledger API rejected purchase order', { poId: event.params.poId, status: response.status, body });
      await poRef.set({
        syncStatus: 'error',
        syncMessage: `Ledger API error (${response.status})`,
        syncPayload: cleanForFirestore(payload),
        syncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const body = await response.json().catch(() => ({}));
    const resolvedId = body.id || ledgerId || po.id || event.params.poId;

    await poRef.set({
      ledgerPurchaseOrderId: resolvedId,
      syncStatus: 'synced',
      syncMessage: 'Purchase order synced to ledger',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    functions.logger.info('Purchase order synced to ledger', { poId: event.params.poId, ledgerPurchaseOrderId: resolvedId });
  } catch (error) {
    functions.logger.error('Failed to sync purchase order to ledger', { poId: event.params.poId, error });
    await poRef.set({
      syncStatus: 'error',
      syncMessage: error.message || 'Ledger sync failed',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
});

const parseReceiptText = (text = '', fallback = {}) => {
  const cleaned = String(text || '').replace(/\r/g, '\n');
  const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
  const vendor = lines[0] || fallback.vendor || '';
  const dateMatch = cleaned.match(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\b/);
  const numbers = (cleaned.match(/(\d+[.,]\d{2})/g) || []).map((n) => Number(n.replace(',', '.'))).filter((n) => Number.isFinite(n));
  const grossGuess = numbers.length ? Math.max(...numbers) : (fallback.grossAmount || 0);
  const vatGuess = numbers.length > 1 ? Math.min(...numbers) : (fallback.vatAmount || 0);
  const netGuess = grossGuess && vatGuess ? grossGuess - vatGuess : (fallback.netAmount || grossGuess);
  const vatRate = grossGuess && netGuess ? Math.round(((grossGuess - netGuess) / netGuess) * 100) : (fallback.vatRate || 0);
  return {
    vendor,
    description: fallback.description || 'Receipt',
    expenseDate: dateMatch ? dateMatch[1].replace(/\./g, '-').replace(/\//g, '-') : fallback.expenseDate || new Date().toISOString().slice(0, 10),
    netAmount: netGuess || 0,
    vatAmount: vatGuess || 0,
    vatRate: vatRate || 0,
  };
};

exports.extractReceipt = onCall(async (request) => {
  assertAuthenticated(request.auth);
  const claimId = typeof request.data?.claimId === 'string' ? request.data.claimId.trim() : '';
  const filePath = typeof request.data?.filePath === 'string' ? request.data.filePath.replace(/^\/+/, '') : '';
  const fileName = typeof request.data?.fileName === 'string' ? request.data.fileName.trim() : '';
  const lineIndex = Number.isInteger(request.data?.lineIndex) ? request.data.lineIndex : 0;

  if (!claimId || !filePath) {
    throw new functions.https.HttpsError('invalid-argument', 'claimId and filePath are required.');
  }

  const db = getFirestore();
  const claimSnap = await db.collection('expenseClaims').doc(claimId).get();
  if (!claimSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Expense claim not found.');
  }
  const claim = claimSnap.data() || {};
  const caller = await fetchUserRecord(request.auth.uid);
  const callerRole = String(caller?.role || '').toLowerCase();
  const allowedRoles = ['owner', 'master', 'admin', 'manager'];
  const sameOrg = !claim.orgId || !caller?.orgId || claim.orgId === caller.orgId;
  const canHandle = (claim.claimantId === request.auth.uid) || (allowedRoles.includes(callerRole) && sameOrg);

  if (!canHandle) {
    throw new functions.https.HttpsError('permission-denied', 'Not allowed to extract receipts for this claim.');
  }

  const bucket = getStorage().bucket();
  const file = bucket.file(filePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new functions.https.HttpsError('not-found', 'Receipt file not found.');
  }

  let extracted = null;
  try {
    const gcsUri = `gs://${file.bucket.name}/${file.name}`;
    const [result] = await visionClient.documentTextDetection(gcsUri);
    const text = result?.fullTextAnnotation?.text || '';
    extracted = parseReceiptText(text, {
      vendor: claim.lines?.[lineIndex]?.vendor,
      description: claim.lines?.[lineIndex]?.description || fileName || 'Expense receipt',
      netAmount: claim.lines?.[lineIndex]?.netAmount,
      vatAmount: claim.lines?.[lineIndex]?.vatAmount,
      expenseDate: claim.lines?.[lineIndex]?.expenseDate || claim.accountingDate,
    });
    functions.logger.info('Receipt parsed via Vision', { claimId, filePath, lineIndex });
  } catch (err) {
    functions.logger.error('Vision parse failed; falling back', { error: err.message, claimId, filePath });
  }

  const fallback = extracted || {
    vendor: claim.lines?.[lineIndex]?.vendor || 'Parsed Vendor',
    description: claim.lines?.[lineIndex]?.description || (fileName || 'Expense receipt'),
    expenseDate: claim.accountingDate || new Date().toISOString().slice(0, 10),
    netAmount: claim.lines?.[lineIndex]?.netAmount || 20,
    vatAmount: claim.lines?.[lineIndex]?.vatAmount || 4,
    vatRate: claim.lines?.[lineIndex]?.vatRate || 20,
  };

  try {
    const lines = Array.isArray(claim.lines) ? [...claim.lines] : [];
    if (!lines[lineIndex]) lines[lineIndex] = {};
    const existing = lines[lineIndex] || {};
    const merged = {
      ...existing,
      storagePath: filePath,
      extractedData: fallback,
    };
    if (!existing.vendor && fallback.vendor) merged.vendor = fallback.vendor;
    if (!existing.description && fallback.description) merged.description = fallback.description;
    if (!existing.expenseDate && fallback.expenseDate) merged.expenseDate = fallback.expenseDate;
    if (!(Number(existing.netAmount) > 0) && Number(fallback.netAmount) > 0) merged.netAmount = fallback.netAmount;
    if (!(Number(existing.vatAmount) >= 0) && Number(fallback.vatAmount) >= 0) merged.vatAmount = fallback.vatAmount;
    if (!(Number(existing.vatRate) > 0) && Number(fallback.vatRate) > 0) merged.vatRate = fallback.vatRate;

    lines[lineIndex] = merged;
    const totals = computeClaimTotals(lines);

    await claimSnap.ref.set({
      lines,
      totals,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: request.auth.token?.email || request.auth.uid || 'extractReceipt',
    }, {merge: true});
  } catch (err) {
    functions.logger.error('Failed to persist extraction to claim', { error: err.message, claimId, filePath, lineIndex });
  }

  return { extractedLine: fallback };
});

exports.syncExpenseClaimToLedger = onDocumentWritten('expenseClaims/{claimId}', async (event) => {
  if (!event.data || !event.data.after?.exists) return;
  const after = event.data.after;
  const claim = after.data() || {};
  const claimRef = after.ref;
  const { baseUrl } = buildLedgerConfig();

  const status = (claim.status || '').toLowerCase();
  if (!['approved', 'paid'].includes(status)) return;
  if (claim.syncStatus === 'synced' && claim.ledgerExpenseClaimId) return;

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    await claimRef.set({
      syncStatus: 'blocked',
      syncMessage: 'Ledger integration not configured',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const lines = Array.isArray(claim.lines) ? claim.lines : [];
  if (lines.length === 0) {
    await claimRef.set({
      syncStatus: 'error',
      syncMessage: 'No expense lines to post',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const budget = await ensureLedgerBudget('expenseClaims', 10);
  if (!budget.allowed) {
    await claimRef.set({
      syncStatus: 'blocked',
      syncMessage: 'Rate limit exceeded (10/hr)',
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const ledgerId = (claim.ledgerExpenseClaimId || '').trim();
  const endpointBase = trimTrailingSlash(baseUrl) + '/expense-claims';
  const endpoint = ledgerId ? `${endpointBase}/${encodeURIComponent(ledgerId)}` : endpointBase;
  const method = ledgerId ? 'PATCH' : 'POST';

  const payload = {
    id: claim.id || event.params.claimId,
    reference: claim.reference || claim.period || claim.id || event.params.claimId,
    claimant_id: claim.claimantId || null,
    claimant_name: claim.claimantName || null,
    claimant_email: claim.claimantEmail || null,
    period: claim.period || null,
    accounting_date: claim.accountingDate || new Date().toISOString().slice(0, 10),
    currency: (claim.currency || 'GBP').toUpperCase(),
    totals: claim.totals || computeClaimTotals(lines),
    lines: lines.map((line, idx) => ({
      id: String(line.lineNumber || idx + 1),
      description: line.description || line.vendor || 'Expense',
      vendor: line.vendor || null,
      net_amount: Number(line.netAmount) || 0,
      vat_amount: Number(line.vatAmount) || 0,
      vat_rate: Number(line.vatRate) || 0,
      gl_account_id: line.glAccountId || null,
      cost_center: line.costCenter || claim.costCenter || null,
      project_id: line.projectId || null,
      payment_method: line.paymentMethod || 'reimbursable',
      currency: line.currency ? String(line.currency).toUpperCase() : (claim.currency || 'GBP').toUpperCase(),
      fx_rate: Number(line.fxRate) || 1,
      reclaimable: line.reclaimable !== false,
    })),
  };

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      functions.logger.error('Ledger API rejected expense claim', { claimId: event.params.claimId, status: response.status, body });
      await claimRef.set({
        syncStatus: 'error',
        syncMessage: `Ledger API error (${response.status})`,
        syncPayload: cleanForFirestore(payload),
        syncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const body = await response.json().catch(() => ({}));
    const resolvedId = body.id || ledgerId || claim.id || event.params.claimId;

    await claimRef.set({
      ledgerExpenseClaimId: resolvedId,
      syncStatus: 'synced',
      syncMessage: 'Expense claim synced to ledger',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    functions.logger.info('Expense claim synced to ledger', { claimId: event.params.claimId, ledgerExpenseClaimId: resolvedId });
  } catch (error) {
    functions.logger.error('Failed to sync expense claim to ledger', { claimId: event.params.claimId, error });
    await claimRef.set({
      syncStatus: 'error',
      syncMessage: error.message || 'Ledger sync failed',
      syncPayload: cleanForFirestore(payload),
      syncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
});

exports.ensureUserDefaults = onDocumentWritten('users/{userId}', async (event) => {
  const after = event.data.after;
  if (!after.exists) return;

  const user = after.data() || {};
  const updates = {};
  let shouldWrite = false;

  const normalizedRole = typeof user.role === 'string' && user.role.trim() ? user.role.trim() : 'worker';
  if (normalizedRole !== user.role) {
    updates.role = normalizedRole;
    shouldWrite = true;
  }

  const desiredRoles = normalizeRoles(updates.role || user.role, user.roles);
  if (!arraysMatch(desiredRoles, Array.isArray(user.roles) ? user.roles : [])) {
    updates.roles = desiredRoles;
    shouldWrite = true;
  }

  const normalizedProjects = distinctStrings(user.assignedProjects);
  if (!arraysMatch(normalizedProjects, Array.isArray(user.assignedProjects) ? user.assignedProjects : [])) {
    updates.assignedProjects = normalizedProjects;
    shouldWrite = true;
  }

  const normalizedProcesses = distinctStrings(user.assignedProcesses);
  if (!arraysMatch(normalizedProcesses, Array.isArray(user.assignedProcesses) ? user.assignedProcesses : [])) {
    updates.assignedProcesses = normalizedProcesses;
    shouldWrite = true;
  }

  const orgIds = mergeStringSets(user.orgIds, user.organizations, user.orgId);
  if (orgIds.length) {
    if (!arraysMatch(orgIds, Array.isArray(user.orgIds) ? user.orgIds : [])) {
      updates.orgIds = orgIds;
      shouldWrite = true;
    }
    if (!arraysMatch(orgIds, Array.isArray(user.organizations) ? user.organizations : [])) {
      updates.organizations = orgIds;
      shouldWrite = true;
    }
    if (!orgIds.includes(typeof user.orgId === 'string' ? user.orgId : '')) {
      updates.orgId = orgIds[0];
      shouldWrite = true;
    }
  }

  if (!user.createdAt) {
    updates.createdAt = FieldValue.serverTimestamp();
    shouldWrite = true;
  }

  if (shouldWrite) {
    updates.updatedAt = FieldValue.serverTimestamp();
    await after.ref.set(cleanForFirestore(updates), { merge: true });
  }
});

exports.hardenProjectContext = onDocumentWritten('projects/{projectId}', async (event) => {
  const after = event.data.after;
  if (!after.exists) return;

  const project = after.data() || {};
  const updates = {};
  let shouldWrite = false;
  const db = getFirestore();

  const programId = typeof project.programId === 'string' ? project.programId.trim() : '';
  if (programId) {
    const programSnap = await db.collection('programs').doc(programId).get();
    if (programSnap.exists) {
      const program = programSnap.data() || {};
      const programOrgId = mergeStringSets(program.orgId, program.orgIds)[0];
      if (programOrgId && project.orgId !== programOrgId) {
        updates.orgId = programOrgId;
        shouldWrite = true;
      }
      if (program.name && project.programName !== program.name) {
        updates.programName = program.name;
        shouldWrite = true;
      }
      if (project.isOrphaned) {
        updates.isOrphaned = false;
        shouldWrite = true;
      }
    } else if (!project.isOrphaned) {
      updates.isOrphaned = true;
      shouldWrite = true;
    }
  }

  if (!project.createdAt) {
    updates.createdAt = FieldValue.serverTimestamp();
    shouldWrite = true;
  }

  if (shouldWrite) {
    updates.updatedAt = FieldValue.serverTimestamp();
    await after.ref.set(cleanForFirestore(updates), { merge: true });
  }
});

exports.syncProcessMetadata = onDocumentWritten('processes/{processId}', async (event) => {
  const after = event.data.after;
  if (!after.exists) return;

  const process = after.data() || {};
  const updates = {};
  let shouldWrite = false;
  const db = getFirestore();
  const projectId = typeof process.projectId === 'string' ? process.projectId.trim() : '';

  if (projectId) {
    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (projectSnap.exists) {
      const project = projectSnap.data() || {};
      const projectOrgId = mergeStringSets(project.orgId, project.orgIds)[0];
      if (projectOrgId && process.orgId !== projectOrgId) {
        updates.orgId = projectOrgId;
        shouldWrite = true;
      }
      const programId = typeof project.programId === 'string' ? project.programId.trim() : '';
      if (programId && process.programId !== programId) {
        updates.programId = programId;
        shouldWrite = true;
      }
      if (project.name && process.projectName !== project.name) {
        updates.projectName = project.name;
        shouldWrite = true;
      }
      if (process.isOrphaned) {
        updates.isOrphaned = false;
        shouldWrite = true;
      }
    } else if (!process.isOrphaned) {
      updates.isOrphaned = true;
      shouldWrite = true;
    }
  } else if (!process.isOrphaned) {
    updates.isOrphaned = true;
    shouldWrite = true;
  }

  if (!process.createdAt) {
    updates.createdAt = FieldValue.serverTimestamp();
    shouldWrite = true;
  }

  if (shouldWrite) {
    updates.updatedAt = FieldValue.serverTimestamp();
    await after.ref.set(cleanForFirestore(updates), { merge: true });
  }
});

exports.syncTaskMetadata = onDocumentWritten('tasks/{taskId}', async (event) => {
  const after = event.data.after;
  if (!after.exists) return;

  const task = after.data() || {};
  const updates = {};
  let shouldWrite = false;
  const db = getFirestore();

  const allowedStatuses = ['todo', 'inprogress', 'done'];
  const currentStatus = typeof task.status === 'string' ? task.status.trim().toLowerCase() : '';
  if (!allowedStatuses.includes(currentStatus)) {
    updates.status = 'todo';
    shouldWrite = true;
  }

  const normalizedAssignees = distinctStrings(task.assignedTo);
  if (!arraysMatch(normalizedAssignees, Array.isArray(task.assignedTo) ? task.assignedTo : [])) {
    updates.assignedTo = normalizedAssignees;
    shouldWrite = true;
  }

  const processId = typeof task.processId === 'string' ? task.processId.trim() : '';
  const projectId = typeof task.projectId === 'string' ? task.projectId.trim() : '';

  let processData = null;

  if (processId) {
    const processSnap = await db.collection('processes').doc(processId).get();
    if (processSnap.exists) {
      processData = processSnap.data() || {};
      const processOrgId = mergeStringSets(processData.orgId, processData.orgIds)[0];
      if (processOrgId && task.orgId !== processOrgId) {
        updates.orgId = processOrgId;
        shouldWrite = true;
      }

      const processProjectId = typeof processData.projectId === 'string' ? processData.projectId.trim() : '';
      if (processProjectId && processProjectId !== projectId) {
        updates.projectId = processProjectId;
        shouldWrite = true;
      }

      const processProgramId = typeof processData.programId === 'string' ? processData.programId.trim() : '';
      if (processProgramId && task.programId !== processProgramId) {
        updates.programId = processProgramId;
        shouldWrite = true;
      }

      if (processData.name && task.processName !== processData.name) {
        updates.processName = processData.name;
        shouldWrite = true;
      }

      if (task.isOrphaned) {
        updates.isOrphaned = false;
        shouldWrite = true;
      }
    } else if (!task.isOrphaned) {
      updates.isOrphaned = true;
      shouldWrite = true;
    }
  }

  const effectiveProjectId = updates.projectId || projectId;
  if (effectiveProjectId) {
    const projectSnap = await db.collection('projects').doc(effectiveProjectId).get();
    if (projectSnap.exists) {
      const projectData = projectSnap.data() || {};
      const projectOrgId = mergeStringSets(projectData.orgId, projectData.orgIds)[0];
      if (projectOrgId && (updates.orgId || task.orgId) !== projectOrgId) {
        updates.orgId = projectOrgId;
        shouldWrite = true;
      }
      const projectProgramId = typeof projectData.programId === 'string' ? projectData.programId.trim() : '';
      if (projectProgramId && task.programId !== projectProgramId && updates.programId !== projectProgramId) {
        updates.programId = projectProgramId;
        shouldWrite = true;
      }
      if (projectData.name && task.projectName !== projectData.name) {
        updates.projectName = projectData.name;
        shouldWrite = true;
      }
    }
  }

  if (!task.createdAt) {
    updates.createdAt = FieldValue.serverTimestamp();
    shouldWrite = true;
  }

  if (shouldWrite) {
    updates.updatedAt = FieldValue.serverTimestamp();
    await after.ref.set(cleanForFirestore(updates), { merge: true });
  }
});
