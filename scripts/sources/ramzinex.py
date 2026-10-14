from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Ramzinex(Source):
    source_id = "ramzinex"
    kind = "proxy"

    def url(self) -> str:
        return ("https://publicapi.ramzinex.com/exchange/api/v1.0/"
                "exchange/orderbooks/11/buys_sells")

    def parse(self, payload) -> list[Record]:
        d = payload["data"]
        best_buy = d["buys"][0][0]
        best_sell = d["sells"][0][0]
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(best_buy, "rial"), sell_rial=to_rial(best_sell, "rial"),
            as_of="", native={"buy": best_buy, "sell": best_sell, "unit": "rial"},
            source_url=self.url(), verify_url="https://ramzinex.com/exchange/usdt-irr",
            raw={"best_buy": best_buy, "best_sell": best_sell},
        )]
