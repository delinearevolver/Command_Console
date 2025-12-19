from __future__ import annotations

import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Sequence

from .models import ReportRow
from .utils import to_decimal

AccountType = str
DateLike = str | date | datetime | None

__all__ = ["Ledger", "DateLike"]

_PNL_ORDER = {"Income": 0, "Expense": 1}
_BALANCE_ORDER = {"Asset": 0, "Liability": 1, "Equity": 2}
_TRIAL_ORDER = {"Asset": 0, "Liability": 1, "Equity": 2, "Income": 3, "Expense": 4}


def _normalise_date(value: DateLike) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        text = value.strip()
        return text or None
    raise TypeError(f"Unsupported date value: {value!r}")


class Ledger:
    """Helper for running accounting reports directly from the SQLite ledger."""

    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        if not self.path.exists():
            raise FileNotFoundError(f"Ledger database not found: {self.path}")

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def profit_and_loss(
        self,
        *,
        start: DateLike = None,
        end: DateLike = None,
        include_zero: bool = True,
    ) -> list[ReportRow]:
        rows = self._aggregate_accounts(("Income", "Expense"), start, end)
        result: list[ReportRow] = []
        for row in rows:
            debit = to_decimal(row["debit"])
            credit = to_decimal(row["credit"])
            amount = debit - credit
            if not include_zero and amount == 0:
                continue
            result.append(ReportRow(row["type"], row["code"], row["name"], amount))
        result.sort(key=lambda item: (_PNL_ORDER.get(item.type, 99), item.code))
        return result

    def balance_sheet(
        self,
        *,
        as_of: DateLike = None,
        include_zero: bool = True,
    ) -> list[ReportRow]:
        rows = self._aggregate_accounts(("Asset", "Liability", "Equity"), None, as_of)
        result: list[ReportRow] = []
        for row in rows:
            debit = to_decimal(row["debit"])
            credit = to_decimal(row["credit"])
            account_type = row["type"]
            if account_type == "Asset":
                amount = debit - credit
            elif account_type in {"Liability", "Equity"}:
                amount = credit - debit
            else:
                amount = debit - credit
            if not include_zero and amount == 0:
                continue
            result.append(ReportRow(account_type, row["code"], row["name"], amount))
        result.sort(key=lambda item: (_BALANCE_ORDER.get(item.type, 99), item.code))
        return result

    def trial_balance(
        self,
        *,
        start: DateLike = None,
        end: DateLike = None,
        include_zero: bool = True,
        account_types: Sequence[AccountType] | None = None,
    ) -> list[ReportRow]:
        types = tuple(account_types or ("Asset", "Liability", "Equity", "Income", "Expense"))
        rows = self._aggregate_accounts(types, start, end)
        result: list[ReportRow] = []
        for row in rows:
            debit = to_decimal(row["debit"])
            credit = to_decimal(row["credit"])
            amount = debit - credit
            if not include_zero and amount == 0:
                continue
            result.append(ReportRow(row["type"], row["code"], row["name"], amount))
        result.sort(key=lambda item: (_TRIAL_ORDER.get(item.type, 99), item.code))
        return result

    def _aggregate_accounts(
        self,
        account_types: Sequence[AccountType],
        start: DateLike,
        end: DateLike,
    ) -> list[sqlite3.Row]:
        start_str = _normalise_date(start)
        end_str = _normalise_date(end)
        placeholders = ",".join("?" for _ in account_types)
        if not placeholders:
            return []
        query = f"""
            WITH filtered_postings AS (
                SELECT p.account_id, p.debit, p.credit
                FROM postings p
                JOIN journals j ON j.id = p.journal_id
                WHERE (? IS NULL OR j.date >= ?)
                  AND (? IS NULL OR j.date <= ?)
            )
            SELECT a.id AS account_id,
                   a.type AS type,
                   a.code AS code,
                   a.name AS name,
                   COALESCE(SUM(fp.debit), 0) AS debit,
                   COALESCE(SUM(fp.credit), 0) AS credit
            FROM accounts a
            LEFT JOIN filtered_postings fp ON fp.account_id = a.id
            WHERE a.type IN ({placeholders})
            GROUP BY a.id
            ORDER BY a.code
        """
        params: list[object] = [start_str, start_str, end_str, end_str, *account_types]
        with self._connect() as conn:
            return conn.execute(query, params).fetchall()
