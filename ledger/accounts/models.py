from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class ReportRow:
    """Represents a single row in an accounting report."""

    type: str
    code: str
    name: str
    amount: Decimal

    def as_tuple(self) -> tuple[str, str, str, Decimal]:
        """Return the row data as a tuple; useful for testing or serialization."""
        return (self.type, self.code, self.name, self.amount)
