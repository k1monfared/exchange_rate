from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Input:
    source_id: str
    value: float
    kind: str
    verify_url: str
    unit: str = "rial"
    leg: Optional[str] = None

    def to_dict(self) -> dict:
        d = {
            "source_id": self.source_id,
            "value": self.value,
            "kind": self.kind,
            "verify_url": self.verify_url,
            "unit": self.unit,
        }
        if self.leg is not None:
            d["leg"] = self.leg
        return d


@dataclass
class Record:
    source_id: str
    kind: str
    pair_from: str
    pair_to: str
    buy_rial: Optional[int] = None
    sell_rial: Optional[int] = None
    price_rial: Optional[int] = None
    value: Optional[float] = None
    single_sided: bool = False
    as_of: str = ""
    native: dict = field(default_factory=dict)
    source_url: str = ""
    verify_url: str = ""
    status: str = "ok"
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)
    formula: Optional[str] = None
    inputs: list = field(default_factory=list)

    def to_dict(self) -> dict:
        d = {
            "source_id": self.source_id,
            "kind": self.kind,
            "pair_from": self.pair_from,
            "pair_to": self.pair_to,
            "buy_rial": self.buy_rial,
            "sell_rial": self.sell_rial,
            "price_rial": self.price_rial,
            "value": self.value,
            "single_sided": self.single_sided,
            "as_of": self.as_of,
            "native": self.native,
            "source_url": self.source_url,
            "verify_url": self.verify_url,
            "status": self.status,
            "error": self.error,
            "raw": self.raw,
        }
        if self.formula is not None:
            d["formula"] = self.formula
        if self.inputs:
            d["inputs"] = [i.to_dict() if isinstance(i, Input) else i for i in self.inputs]
        return d
