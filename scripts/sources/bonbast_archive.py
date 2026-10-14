from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class BonbastArchive(Source):
    source_id = "bonbast_archive"
    kind = "exact"

    def url(self) -> str:
        return ("https://raw.githubusercontent.com/SamadiPour/"
                "rial-exchange-rates-archive/data/gregorian_all.min.json")

    def parse(self, payload) -> list[Record]:
        latest = sorted(payload.keys())[-1]
        day = {k.upper(): v for k, v in payload[latest].items()}
        out = []
        for pair in ("USD", "CAD"):
            block = day.get(pair)
            if not block:
                continue
            out.append(Record(
                source_id=self.source_id,
                kind=self.kind,
                pair_from=pair,
                pair_to="IRR",
                buy_rial=to_rial(block["buy"], "toman") if "buy" in block else None,
                sell_rial=to_rial(block["sell"], "toman") if "sell" in block else None,
                single_sided="buy" not in block or "sell" not in block,
                as_of=latest.replace("/", "-"),
                native={"buy": block.get("buy"), "sell": block.get("sell"), "unit": "toman"},
                source_url=self.url(),
                verify_url="https://bonbast.com/graph/" + pair.lower(),
                raw=block,
            ))
        return out
