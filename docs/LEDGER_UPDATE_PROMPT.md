# Ledger Integration Follow-Up

Current state (CRM/PO):
- Customers and suppliers now capture `ledgerCustomerId` / `ledgerSupplierId`, `ledgerControlAccountId`, and suppliers also capture `defaultExpenseAccount`.
- Purchase orders snapshot supplier ledger fields (`ledgerSupplierId`, `ledgerControlAccountId`, `defaultExpenseAccount`) when a supplier is selected.
- No ledger posting is performed yet; Firestore documents hold the references only.

When ready to post to the ledger (Postgres / Cloud Run API):
1) Customers
   - On customer create/update, if `ledgerCustomerId` is empty, call Ledger API `POST /customers` (or equivalent) with the master data and control account; store returned `ledgerCustomerId`.
   - If it exists, `PATCH /customers/{ledgerCustomerId}` to keep details in sync.
   - Persist `ledgerControlAccountId` from the ledger response if provided.
2) Suppliers
   - On supplier create/update, if `ledgerSupplierId` is empty, call `POST /suppliers` with master data (`defaultExpenseAccount`, `ledgerControlAccountId`), store returned ID.
   - If it exists, `PATCH /suppliers/{ledgerSupplierId}`.
3) Purchase Orders
   - On `purchaseOrders/{poId}` create/update (status transitions: Sent/Acknowledged/Received/Invoiced/Completed), call Ledger API `POST /purchase-orders` (or `PATCH` if already posted) using `supplierSnapshot`, `deliveryAddress`, and `lines`.
   - Include `ledgerSupplierId` and `ledgerControlAccountId` to route to the supplier/AP control account; map each line’s `expenseAccount` (or supplier `defaultExpenseAccount`) to the ledger’s chart of accounts.
   - Store `ledgerPurchaseOrderId`, `syncStatus`, `syncMessage`, `syncedAt`, and `syncPayload` on the PO document.
4) Goods Receipts (future)
   - When `goodsReceipts` is implemented, post receipt events against the ledger PO for three-way matching; update `quantityReceived`/`received` totals.

Implementation pattern (reuse from `functions/index.js` invoice sync):
- Use `functions/index.js` as reference: see `syncInvoiceToLedger` for baseUrl checks, payload shape, logging, and sync status fields.
- Add new triggers:
  - `exports.syncCustomerToLedger = onDocumentWritten('customers/{customerId}', ...)`
  - `exports.syncSupplierToLedger = onDocumentWritten('suppliers/{supplierId}', ...)`
  - `exports.syncPurchaseOrderToLedger = onDocumentWritten('purchaseOrders/{poId}', ...)`
- Each trigger:
  - Return early if `baseUrl` not configured.
  - Validate `orgId` present.
  - Build payload, call `${baseUrl}/customers|/suppliers|/purchase-orders`.
  - On success: write `ledger*Id`, `syncStatus: 'synced'`, `syncedAt`, `syncPayload`.
  - On failure: write `syncStatus: 'error'`, `syncMessage`, `syncPayload`, `syncUpdatedAt`.

API assumptions (adjust to actual ledger API):
- Customers endpoint: `{ name, email, phone, vatNumber, companyNumber, controlAccountId, currency }`.
- Suppliers endpoint: `{ name, email, phone, vatNumber, companyNumber, controlAccountId, defaultExpenseAccount, currency }`.
- Purchase orders endpoint: `{ supplierId, reference, issueDate, expectedDeliveryDate, currency, paymentTermsDays, lines: [{ description, quantity, unitPrice, taxRate, expenseAccount }], totals, deliveryAddress }`.

Testing checklist:
- Creating/updating customer populates `ledgerCustomerId` in Firestore and sets `syncStatus: 'synced'`.
- Creating/updating supplier populates `ledgerSupplierId` and `ledgerControlAccountId`.
- Creating PO with a supplier that has ledger IDs posts to ledger and stores `ledgerPurchaseOrderId`.
- Ledger API offline → `syncStatus: 'error'` with message; no crash.

Configuration:
- Set env vars: `LEDGER_API_BASE`, `LEDGER_SELLER_NAME`, `LEDGER_SELLER_ADDRESS_*`.
- If using service account auth, include bearer token header or signed JWT per ledger API spec.
