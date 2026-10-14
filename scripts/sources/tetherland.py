from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Tetherland(Source):
    source_id = "tetherland"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.tetherland.com/currencies"

    def parse(self, payload) -> list[Record]:
        u = payload["data"]["currencies"]["USDT"]
        buy = u.get("buy_price", u["price"])
        sell = u.get("sell_price", u["price"])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(buy, "toman"), sell_rial=to_rial(sell, "toman"),
            as_of="", native={"buy": buy, "sell": sell, "unit": "toman"},
            source_url=self.url(), verify_url="https://tetherland.com/",
            raw=u,
        )]
