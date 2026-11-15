from __future__ import annotations

from model import Record
from sources.base import Source
from sources.cadfx import usd_cad_record

SERIES = "FXUSDCAD"
VERIFY_URL = "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/"


class BankOfCanada(Source):
    """Bank of Canada official daily average USD/CAD (Valet API).

    Published once per business day, so ``as_of`` usually lags by a day.
    """
    source_id = "boc"
    kind = "exact"
    pair_from = "USD"
    pair_to = "CAD"

    def url(self) -> str:
        return f"https://www.bankofcanada.ca/valet/observations/{SERIES}/json?recent=5"

    def parse(self, payload) -> list[Record]:
        obs = [o for o in payload.get("observations", [])
               if (o.get(SERIES) or {}).get("v")]
        if not obs:
            raise ValueError("no Bank of Canada USD/CAD observations")
        latest = max(obs, key=lambda o: o["d"])
        return [usd_cad_record(
            self.source_id, mid=float(latest[SERIES]["v"]), as_of=latest["d"],
            source_url=self.url(), verify_url=VERIFY_URL, raw=latest,
            extra={"rate_type": "official daily average"},
        )]
