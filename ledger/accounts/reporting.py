from __future__ import annotations

from pathlib import Path

from .csvio import read_report, write_report
from .models import ReportRow
from .sqlite import DateLike, Ledger


def generate_profit_and_loss(
    db_path: str | Path,
    *,
    start: DateLike = None,
    end: DateLike = None,
    csv_path: str | Path | None = None,
    decimal_places: int | None = None,
    zero_as_blank: bool = False,
) -> list[ReportRow]:
    ledger = Ledger(db_path)
    rows = ledger.profit_and_loss(start=start, end=end)
    if csv_path is not None:
        write_report(rows, csv_path, decimal_places=decimal_places, zero_as_blank=zero_as_blank)
    return rows


def generate_balance_sheet(
    db_path: str | Path,
    *,
    as_of: DateLike = None,
    csv_path: str | Path | None = None,
    decimal_places: int | None = None,
    zero_as_blank: bool = False,
) -> list[ReportRow]:
    ledger = Ledger(db_path)
    rows = ledger.balance_sheet(as_of=as_of)
    if csv_path is not None:
        write_report(rows, csv_path, decimal_places=decimal_places, zero_as_blank=zero_as_blank)
    return rows


def load_profit_and_loss_report(csv_path: str | Path) -> list[ReportRow]:
    return read_report(csv_path)


def load_balance_sheet_report(csv_path: str | Path) -> list[ReportRow]:
    return read_report(csv_path)
