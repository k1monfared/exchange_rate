from __future__ import annotations

import re

from jalali import jalaali_to_iso
from model import Record
from normalize import to_rial
from sources.base import Source


def _date_iso(d: str) -> str:
    m = re.match(r"^(\d{4})/(\d{2})/(\d{2})$", d or "")
    if not m:
        return d or ""
    try:
        return jalaali_to_iso(*(int(x) for x in m.groups()))
    except ValueError:
        return d


class Nerkhsanj(Source):
    source_id = "nerkhsanj"
    kind = "exact"

    def url(self) -> str:
        return "https://nerkh.jahankhahan.shop/data/live.json"

    def parse(self, payload) -> list[Record]:
        rates = payload["rates"]
        as_of = _date_iso(payload.get("date", ""))
        out = []
        for pair, key in (("USD", "dollar"), ("CAD", "cad")):
            raw = rates[key]
            out.append(Record(
                source_id=self.source_id,
                kind=self.kind,
                pair_from=pair,
                pair_to="IRR",
                price_rial=to_rial(raw, "toman"),
                single_sided=True,
                as_of=as_of,
                native={"value": raw, "unit": "toman"},
                source_url=self.url(),
                verify_url="https://nerkh.jahankhahan.shop/developers/en",
                raw={"key": key, "value": raw},
            ))
        return out
