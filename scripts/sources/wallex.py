from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Wallex(Source):
    source_id = "wallex"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.wallex.ir/v1/markets"

    def parse(self, payload) -> list[Record]:
        s = payload["result"]["symbols"]["USDTTMN"]["stats"]
        buy = float(s["bidPrice"])
        sell = float(s["askPrice"])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(buy, "toman"), sell_rial=to_rial(sell, "toman"),
            as_of="", native={"buy": s["bidPrice"], "sell": s["askPrice"], "unit": "toman"},
            source_url=self.url(), verify_url="https://wallex.ir/",
            raw=s,
        )]
