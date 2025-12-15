# Using the `accounts` Package

The `accounts` Python package exposes a thin layer over the shared `ledger.db` so you can generate accounting outputs without re-implementing SQL or CSV handling.

## Prerequisites
- Python 3.11 or later (tested with 3.11.9 via `py` launcher)
- The repository root as the working directory so relative paths resolve to `ledger.db` and `reports/`

## Quick Start

```bash
py -c "from accounts import generate_profit_and_loss, generate_balance_sheet, write_report; pl = generate_profit_and_loss('ledger.db'); bs = generate_balance_sheet('ledger.db'); write_report(pl, 'reports/pl_ytd.csv', zero_as_blank=True); write_report(bs, 'reports/balance_sheet_asof.csv', zero_as_blank=True)"
```

- `generate_profit_and_loss` and `generate_balance_sheet` each return a `list[ReportRow]` for in-memory use.
- `write_report` serialises rows back to CSV (blanking zero balances if desired).

### Working with Custom Periods

Both generators accept optional date parameters:

```python
from accounts import generate_profit_and_loss, generate_balance_sheet

# Profit & Loss for a specific window
pl_rows = generate_profit_and_loss('ledger.db', start='2025-01-01', end='2025-09-30')

# Balance sheet as-of a date
bs_rows = generate_balance_sheet('ledger.db', as_of='2025-09-30')
```

`start`, `end`, and `as_of` accept ISO date strings, `datetime.date`, or `datetime.datetime` objects.

### Loading Existing CSVs

```python
from accounts import load_profit_and_loss_report

pl_snapshot = load_profit_and_loss_report('reports/pl_ytd.csv')
```

## Surfacing Data in a UI

You can adapt any backend (Express, Flask, serverless, etc.) to call the package and return JSON to the UI. A simple pattern:

1. **Expose an endpoint** that calls the generators and converts `ReportRow` objects to dictionaries.
   ```python
   # Example FastAPI snippet
   from fastapi import FastAPI
   from accounts import generate_balance_sheet

   app = FastAPI()

   @app.get('/api/balance-sheet')
   def balance_sheet(as_of: str | None = None):
       rows = generate_balance_sheet('ledger.db', as_of=as_of)
       return [row.__dict__ for row in rows]
   ```

2. **UI layer** fetches the endpoint and displays the rows (tables, charts, etc.).

3. **Automate refreshing CSVs** via a worker or scheduled job using the quick-start command if the UI needs static downloads.

### Optional Enhancements
- Wrap the helpers in REST endpoints within the existing Express API service (translate the Python logic to TypeScript or expose a Python microservice).
- Add caching or pre-computed snapshots if the ledger grows larger.
- Introduce additional report helpers (trial balance, aged debtors) using the `Ledger.trial_balance` method as a template.

## Troubleshooting
- If you get “ledger database not found,” ensure the working directory contains `ledger.db`.
- Missing CSV columns raise `ValueError` when using `load_*` helpers; regenerate with `write_report` to fix headers.
- Python launcher: use `py` on Windows; `python3` on Unix.
