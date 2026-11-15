from __future__ import annotations

import datetime
import re

from model import Record
from sources.base import Source
from sources.cadfx import usd_cad_record

VERIFY_URL = "https://www.td.com/ca/en/personal-banking/solutions/exchange/currency-converter"
_TZ = {"Eastern Daylight Time": "-04:00", "Eastern Standard Time": "-05:00"}


def _iso_timestamp(ts: str) -> str:
    """'Sat Oct 31 2026 5:45 PM Eastern Daylight Time' -> '2026-10-31T17:45:00-04:00'."""
    m = re.match(r"^\w{3} (\w{3} \d{1,2} \d{4} \d{1,2}:\d{2} [AP]M) (.+)$", ts or "")
    if not m or m.group(2) not in _TZ:
        return ts
    try:
        dt = datetime.datetime.strptime(m.group(1), "%b %d %Y %I:%M %p")
    except ValueError:
        return ts
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + _TZ[m.group(2)]


class TD(Source):
    """TD Canada Trust non-cash (account transfer) USD rates, smallest amount tier.

    The feed backs TD's public currency converter. Larger tiers get slightly
    better rates; the smallest tier is what an everyday conversion pays.
    """
    source_id = "td"
    kind = "exact"
    pair_from = "USD"
    pair_to = "CAD"

    def url(self) -> str:
        return "https://ix0.apps.td.com/api/fxcal/non-cash-gfx-rates/en"

    def parse(self, payload) -> list[Record]:
        rows = [r for r in payload.get("conversionTableFXCAL", [])
                if r.get("currencyCode") == "USD"]
        if not rows:
            raise ValueError("no USD rows in TD rate table")
        row = min(rows, key=lambda r: float(r["currencyTier"]))
        ts = payload.get("timestamp", "")
        return [usd_cad_record(
            self.source_id,
            buy=float(row["currencyRateRec"]), sell=float(row["currencyRatePay"]),
            as_of=_iso_timestamp(ts), source_url=self.url(), verify_url=VERIFY_URL,
            raw={"timestamp": ts, "row": row},
            extra={"rate_type": "non-cash", "tier_max_usd": float(row["currencyTier"])},
        )]
