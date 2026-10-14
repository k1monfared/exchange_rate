from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Tabdeal(Source):
    source_id = "tabdeal"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.tabdeal.org/r/api/v1/depth/?symbol=USDTIRT"

    def parse(self, payload) -> list[Record]:
        buy = float(payload["bids"][0][0])
        sell = float(payload["asks"][0][0])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(buy, "toman"), sell_rial=to_rial(sell, "toman"),
            as_of="", native={"buy": payload["bids"][0][0], "sell": payload["asks"][0][0], "unit": "toman"},
            source_url=self.url(), verify_url="https://tabdeal.org/",
            raw={"best_bid": payload["bids"][0], "best_ask": payload["asks"][0]},
        )]
