from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any


def to_decimal(value: Any) -> Decimal:
    """Convert different numeric representations to ``Decimal``."""
    if isinstance(value, Decimal):
        return value
    if value is None:
        return Decimal("0")
    if isinstance(value, (int,)):  # ints are safe to pass directly
        return Decimal(value)
    if isinstance(value, float):
        # Convert via ``repr`` to retain as much precision as possible.
        return Decimal(repr(value))
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return Decimal("0")
        return Decimal(text)
    raise TypeError(f"Cannot convert {value!r} to Decimal")


def format_decimal(amount: Decimal | None, *, places: int | None = None, zero_as_blank: bool = False) -> str:
    """Render a ``Decimal`` as a human-friendly string for CSV output."""
    if amount is None:
        return ""
    if zero_as_blank and amount == 0:
        return ""
    value = amount
    if places is not None:
        quantizer = Decimal("1").scaleb(-places)
        value = value.quantize(quantizer, rounding=ROUND_HALF_UP)
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"
