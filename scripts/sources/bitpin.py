from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Bitpin(Source):
    source_id = "bitpin"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.bitpin.ir/v1/mkt/markets/"

    def parse(self, payload) -> list[Record]:
        row = next(m for m in payload["results"] if m.get("code") == "USDT_IRT")
        price = float(row["price"])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            price_rial=to_rial(price, "toman"), single_sided=True,
            as_of=row.get("order_book_info", {}).get("time", ""),
            native={"value": row["price"], "unit": "toman"},
            source_url=self.url(), verify_url="https://bitpin.ir/",
            raw={"price": row["price"]},
        )]
