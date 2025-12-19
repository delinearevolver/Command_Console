from accounts import (
    generate_balance_sheet,
    generate_profit_and_loss,
    load_balance_sheet_report,
    load_profit_and_loss_report,
)

LEDGER = "ledger.db"
PL_CSV = "reports/pl_ytd.csv"
BS_CSV = "reports/balance_sheet_asof.csv"

pl_rows = generate_profit_and_loss(LEDGER)
bs_rows = generate_balance_sheet(LEDGER)

print("Profit & Loss (generated):")
for row in pl_rows:
    print(row.as_tuple())

print("\nBalance Sheet (generated):")
for row in bs_rows:
    print(row.as_tuple())

print("\nComparing against existing CSV exports...")
pl_existing = [r.as_tuple() for r in load_profit_and_loss_report(PL_CSV)]
bs_existing = [r.as_tuple() for r in load_balance_sheet_report(BS_CSV)]

print("P&L match:", pl_existing == [r.as_tuple() for r in pl_rows])
print("Balance sheet match:", bs_existing == [r.as_tuple() for r in bs_rows])
