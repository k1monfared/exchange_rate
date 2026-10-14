from __future__ import annotations

from model import Input, Record


def mid(rec: Record) -> int | None:
    if rec.buy_rial is None or rec.sell_rial is None:
        return None
    return round((rec.buy_rial + rec.sell_rial) / 2)


def _side(rec: Record, side: str) -> int | None:
    return rec.sell_rial if side == "sell" else rec.buy_rial


def cad_estimate(usd_rec: Record, fx_rec: Record) -> Record:
    # 1 CAD = (IRR per USD) / (CAD per USD)  where CAD per USD = 1 / value
    cad_per_usd = 1.0 / fx_rec.value
    usd_sell = usd_rec.sell_rial if usd_rec.sell_rial is not None else usd_rec.price_rial
    usd_buy = usd_rec.buy_rial if usd_rec.buy_rial is not None else usd_rec.price_rial
    inputs = [
        Input(source_id=usd_rec.source_id,
              value=usd_sell,
              kind=usd_rec.kind,
              verify_url=usd_rec.verify_url),
        Input(source_id=fx_rec.source_id, value=fx_rec.value, kind=fx_rec.kind,
              verify_url=fx_rec.verify_url, unit="ratio"),
    ]
    return Record(
        source_id="cad_estimate",
        kind="estimate",
        pair_from="CAD",
        pair_to="IRR",
        buy_rial=round(usd_buy / cad_per_usd) if usd_buy is not None else None,
        sell_rial=round(usd_sell / cad_per_usd) if usd_sell is not None else None,
        formula="IRR_per_CAD = IRR_per_USD / CAD_per_USD",
        inputs=inputs,
    )


def enabled_average(records: list[Record], side: str) -> Record | None:
    chosen = [(r, _side(r, side)) for r in records]
    chosen = [(r, v) for r, v in chosen if v is not None]
    if len(chosen) < 2:
        return None
    inputs = [Input(source_id=r.source_id, value=v, kind=r.kind, verify_url=r.verify_url)
              for r, v in chosen]
    avg = round(sum(v for _, v in chosen) / len(chosen))
    kwargs = {"buy_rial": avg} if side == "buy" else {"sell_rial": avg}
    return Record(
        source_id=f"average_{side}",
        kind="estimate",
        pair_from="USD",
        pair_to="IRR",
        formula=f"{side}_average = mean(enabled sources' {side})",
        inputs=inputs,
        **kwargs,
    )
