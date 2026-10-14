from __future__ import annotations

from model import Record
from sources.base import Source


class GlobalFx(Source):
    source_id = "globalfx"
    kind = "exact"

    def url(self) -> str:
        return "https://open.er-api.com/v6/latest/USD"

    def parse(self, payload) -> list[Record]:
        cad_per_usd = float(payload["rates"]["CAD"])
        usd_per_cad = 1.0 / cad_per_usd
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USD", pair_to="CAD",
            value=usd_per_cad, as_of=payload.get("time_last_update_utc", ""),
            native={"cad_per_usd": cad_per_usd, "unit": "ratio"},
            source_url=self.url(), verify_url=self.url(),
            raw={"CAD": payload["rates"]["CAD"]},
        )]
