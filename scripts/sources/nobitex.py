from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Nobitex(Source):
    source_id = "nobitex"
    kind = "proxy"

    def url(self) -> str:
        return "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls"

    def parse(self, payload) -> list[Record]:
        s = payload["stats"]["usdt-rls"]
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(float(s["bestBuy"]), "rial"),
            sell_rial=to_rial(float(s["bestSell"]), "rial"),
            as_of="", native={"buy": s["bestBuy"], "sell": s["bestSell"], "unit": "rial"},
            source_url=self.url(), verify_url="https://nobitex.ir/markets/usdt-rls",
            raw=s,
        )]
