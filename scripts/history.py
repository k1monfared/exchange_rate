from __future__ import annotations

import datetime
import json
import os

HISTORY_VERSION = 1


def iso(d: str) -> str:
    return d.replace("/", "-")


def load_history(path: str) -> dict:
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    return {"version": HISTORY_VERSION, "generated_at": "", "sources": {}}


def save_history(path: str, history: dict) -> None:
    hist_dir = os.path.dirname(path)
    if hist_dir:
        os.makedirs(hist_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(history, fh, ensure_ascii=False, sort_keys=True)


def series_key(source_id: str, pair_from: str) -> str:
    return f"{source_id}:{pair_from}"


def _series(history: dict, key: str, meta: dict) -> dict:
    s = history["sources"].setdefault(key, {"points": {}})
    s.update(meta)
    return s


def add_point(history: dict, source_id: str, pair_from: str, pair_to: str, kind: str,
              verify_url: str, date: str, buy=None, sell=None, price=None) -> None:
    key = series_key(source_id, pair_from)
    s = _series(history, key, {
        "source_id": source_id, "pair_from": pair_from, "pair_to": pair_to,
        "kind": kind, "verify_url": verify_url,
    })
    s["points"][iso(date)] = [buy, sell, price]


def merge_series(dst: dict, src: dict) -> None:
    for key, s in src.get("sources", {}).items():
        d = dst["sources"].setdefault(key, {"points": {}})
        for field in ("source_id", "pair_from", "pair_to", "kind", "verify_url"):
            if field in s:
                d[field] = s[field]
        d["points"].update(s.get("points", {}))


def _usd_cad_point(d: dict):
    """[buy, sell, mid] in CAD per USD for bank quotes; None for anything else.

    Only records carrying ``cad_*`` fields qualify, so legacy ``globalfx``
    (whose history comes from the Frankfurter archive) is left alone.
    """
    if d.get("status", "ok") != "ok":
        return None
    n = d.get("native") or {}
    buy, sell, mid = n.get("cad_buy"), n.get("cad_sell"), n.get("cad_mid")
    if buy is None and sell is None and mid is None:
        return None
    if buy is not None and sell is not None:
        return [buy, sell, None]
    return [buy, sell, mid]


def add_records(history: dict, date: str, records: list) -> None:
    for r in records:
        d = r.to_dict() if hasattr(r, "to_dict") else r
        if d.get("pair_to") == "CAD" and d.get("pair_from") == "USD":
            pt = _usd_cad_point(d)
            if pt is not None:
                add_point(history, d["source_id"], "USD", "CAD", d["kind"],
                          d.get("verify_url", ""), date, *pt)
            continue
        if d.get("pair_to") != "IRR":
            continue
        add_point(history, d["source_id"], d["pair_from"], "IRR", d["kind"],
                  d.get("verify_url", ""), date,
                  d.get("buy_rial"), d.get("sell_rial"), d.get("price_rial"))


def bonbast_series(payload: dict) -> dict:
    out = {"USD": {}, "CAD": {}}
    for d, day in payload.items():
        day_u = {k.upper(): v for k, v in day.items()}
        for pair in ("USD", "CAD"):
            block = day_u.get(pair)
            if not block:
                continue
            buy = int(round(block["buy"] * 10)) if "buy" in block else None
            sell = int(round(block["sell"] * 10)) if "sell" in block else None
            out[pair][iso(d)] = [buy, sell, None]
    return out


def frankfurter_series(payload: dict) -> dict:
    out = {}
    for d, row in payload.get("rates", {}).items():
        if "CAD" in row:
            out[iso(d)] = row["CAD"]  # CAD per 1 USD
    return out


def wallex_series(payload: dict) -> dict:
    out = {}
    ts = payload.get("t", [])
    closes = payload.get("c", [])
    for t, c in zip(ts, closes):
        d = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).date().isoformat()
        out[d] = int(round(float(c) * 10))  # toman -> rial
    return out


BOC_VERIFY_URL = "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/"


def boc_series(payload: dict) -> dict:
    out = {}
    for o in payload.get("observations", []):
        v = (o.get("FXUSDCAD") or {}).get("v")
        if v:
            out[iso(o["d"])] = float(v)  # CAD per 1 USD
    return out


def build_from_archive(bonbast_payload: dict, frankfurter_payload: dict,
                       wallex_payload: dict | None, generated_at: str,
                       boc_payload: dict | None = None) -> dict:
    h = {"version": HISTORY_VERSION, "generated_at": generated_at, "sources": {}}
    bb = bonbast_series(bonbast_payload)
    for pair in ("USD", "CAD"):
        for date, pt in bb[pair].items():
            add_point(h, "bonbast_archive", pair, "IRR", "exact",
                      f"https://bonbast.com/graph/{pair.lower()}", date, *pt)
    ff = frankfurter_series(frankfurter_payload)  # date -> CAD per USD
    for date, cad_per_usd in ff.items():
        add_point(h, "globalfx", "USD", "CAD", "exact",
                  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD",
                  date, None, None, cad_per_usd)
    usd = bb["USD"]
    for date, cad_per_usd in ff.items():
        u = usd.get(date)
        if not u or not cad_per_usd:
            continue
        buy_u, sell_u = u[0], u[1]
        buy = int(round(buy_u / cad_per_usd)) if buy_u else None
        sell = int(round(sell_u / cad_per_usd)) if sell_u else None
        add_point(h, "cad_estimate", "CAD", "IRR", "estimate",
                  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD",
                  date, buy, sell, None)
    if wallex_payload:
        for date, price in wallex_series(wallex_payload).items():
            add_point(h, "wallex", "USDT", "IRR", "proxy",
                      "https://wallex.ir/", date, None, None, price)
    if boc_payload:
        for date, cad_per_usd in boc_series(boc_payload).items():
            add_point(h, "boc", "USD", "CAD", "exact", BOC_VERIFY_URL,
                      date, None, None, cad_per_usd)
    return h


def cad_estimate_record(usd_buy, usd_sell, cad_per_usd, verify_url: str) -> dict:
    from model import Input, Record
    inputs = []
    if usd_sell:
        inputs.append(Input(source_id="bonbast_archive", value=usd_sell, kind="exact",
                            verify_url="https://bonbast.com/graph/usd", unit="rial"))
    if usd_buy and usd_buy != usd_sell:
        inputs.append(Input(source_id="bonbast_archive", value=usd_buy, kind="exact",
                            verify_url="https://bonbast.com/graph/usd", unit="rial"))
    inputs.append(Input(source_id="globalfx", value=cad_per_usd, kind="exact",
                        verify_url=verify_url, unit="ratio"))
    return Record(
        source_id="cad_estimate", kind="estimate", pair_from="CAD", pair_to="IRR",
        buy_rial=int(round(usd_buy / cad_per_usd)) if usd_buy else None,
        sell_rial=int(round(usd_sell / cad_per_usd)) if usd_sell else None,
        formula="sell: IRR_per_CAD = USD_sell / CAD_per_USD ; buy: IRR_per_CAD = USD_buy / CAD_per_USD",
        inputs=inputs,
    )
