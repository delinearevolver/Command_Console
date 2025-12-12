# CMQUO Standards Codex

## I. Identity of Money & Time

### ISO 4217 — Currency Codes & Minor Units
All amounts use correct 3-letter codes and ISO-defined minor units.

### ISO 8601 — Time Format
All timestamps formatted in UTC, full ISO 8601 precision.
Example: `2025-11-24T07:22:00Z`.

## II. Entity Identification

### ISO 17442 — LEI
20-character Legal Entity Identifier required for counterparties.

### ISO 6166 — ISIN
Required when securities appear.

### ISO 10962 — CFI
Classification for securities when ISIN is present.

### ISO 10383 — MIC
Required when a trading venue is referenced.

## III. Payments Standards

### ISO 20022
Payment messages structured using:
- `pain.001` (customer credit transfer)
- `pacs.008` (FI-to-FI credit transfer)
- `camt.053` (bank statement)
- `camt.054` (notification)

Structured remittance fields, purpose codes, and ultimateDebtor/ultimateCreditor fields enforced.

**Coexistence note:** SWIFT MT ↔ ISO 20022 CBPR+ coexistence ends **22 November 2025**.

### IBAN — ISO 13616  
### BIC — ISO 9362

## IV. Invoicing & Data Exchange

### UBL 2.x
Invoices and credit notes compliant with UBL structures:
- SupplierParty / CustomerParty
- LegalMonetaryTotal
- TaxTotal
- PaymentMeans
- LineItem
- ISO week and ISO date stamping

## V. Ledger, Controls & Audit

### Double-Entry Accounting
All postings balanced.

### SHA-256 Audit Chain
Every journal entry hashed and chained for forward audit integrity.

### CMQUO JSON Schema
```json
{
  "entries": [],
  "documents": [],
  "controls": [],
  "ids": {
    "currency": "",
    "lei": "",
    "isin": "",
    "mic": ""
  }
}
```

## VI. Risk & Compliance

- Sanctions-screening completeness checks.
- Purpose-of-payment and structured remittance guidance.
- Cross-border field validation.
- Reconciliation steps for bank, AP, AR, and tax.
