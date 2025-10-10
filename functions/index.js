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
const {google} = require("googleapis");
const functions = require("firebase-functions");

initializeApp();

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
    line1: addressParts[0] || '',
    city: addressParts[1] || '',
    postcode: addressParts[2] || '',
    country: (customer?.country || invoice.customerCountry || seller.country || 'GB').toUpperCase(),
  };

  const payload = {
    invoiceId: invoiceId || event.params.invoiceId,
    issueDate,
    currency,
    buyer: {
      name: buyerName,
      address: buyerAddress,
    },
    seller: {
      name: seller.name,
      address: {
        line1: seller.line1,
        city: seller.city,
        postcode: seller.postcode,
        country: seller.country,
      },
    },
    lines,
    totals,
  };

  if (dueDate) {
    payload.dueDate = dueDate;
  }

  functions.logger.info('Posting invoice to ledger', {
    invoiceId: payload.invoiceId,
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

    functions.logger.info('Ledger response received', { invoiceId: payload.invoiceId, status: response.status });

    if (!response.ok) {
      const body = await response.text();
      functions.logger.error('Ledger API rejected invoice', { invoiceId: payload.invoiceId, status: response.status, body });
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
      ledgerInvoiceId: payload.invoiceId,
    }, { merge: true });
    functions.logger.info('Invoice synced to ledger', { invoiceId: payload.invoiceId });
  } catch (error) {
    functions.logger.error('Failed to sync invoice to ledger', { invoiceId: payload.invoiceId, error });
    await invoiceRef.set({
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
