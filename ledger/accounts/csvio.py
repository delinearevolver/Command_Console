from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable

from .models import ReportRow
from .utils import format_decimal, to_decimal

HEADER = ("type", "code", "name", "amount")


def read_report(csv_path: str | Path) -> list[ReportRow]:
    """Load report rows from a CSV export."""
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"Report not found: {path}")
    rows: list[ReportRow] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = [col for col in HEADER if col not in reader.fieldnames]
        if missing:
            raise ValueError(f"Report is missing columns: {', '.join(missing)}")
        for record in reader:
            rows.append(
                ReportRow(
                    type=record["type"],
                    code=record["code"],
                    name=record["name"],
                    amount=to_decimal(record.get("amount")),
                )
            )
    return rows


def write_report(
    rows: Iterable[ReportRow],
    csv_path: str | Path,
    *,
    decimal_places: int | None = None,
    zero_as_blank: bool = False,
) -> None:
    """Persist report rows to CSV with a canonical header."""
    path = Path(csv_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADER)
        for row in rows:
            writer.writerow(
                [
                    row.type,
                    row.code,
                    row.name,
                    format_decimal(row.amount, places=decimal_places, zero_as_blank=zero_as_blank),
                ]
            )
