from __future__ import annotations

import datetime

from model import Record
from sources.base import Source
from sources.cadfx import usd_cad_record

VERIFY_URL = "https://www.tangerine.ca/en/rates/exchange-rates"


class Tangerine(Source):
    """Tangerine USD exchange rates, from the JSON its public rates page loads.

    Tangerine labels sides from the customer's view ("buy" = you buy USD), so
    they are swapped here to the dealer convention used across this project.
    """
    source_id = "tangerine"
    kind = "exact"
    pair_from = "USD"
    pair_to = "CAD"

    def url(self) -> str:
        return "https://www.tangerine.ca/content/dam/tangerine-shared/product-rates/currentRates.json"

    def parse(self, payload) -> list[Record]:
        row = next((r for r in payload.get("exchange_rates", [])
                    if r.get("currency") == "USD"), None)
        if row is None:
            raise ValueError("no USD entry in Tangerine exchange_rates")
        try:
            as_of = datetime.datetime.strptime(row["date"], "%m-%d-%Y").date().isoformat()
        except (KeyError, ValueError):
            as_of = str(row.get("date", ""))
        return [usd_cad_record(
            self.source_id, buy=float(row["sell"]), sell=float(row["buy"]),
            as_of=as_of, source_url=self.url(), verify_url=VERIFY_URL, raw=row,
        )]
