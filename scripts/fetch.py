from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import history as hist
from derive import cad_estimate
from model import Record
from registry import build_sources, load_registry
from store import rebuild_index, write_snapshot
from validate import validate_records

SANITY_LOW = 0.3
SANITY_HIGH = 2.5

BONBAST_URL = ("https://raw.githubusercontent.com/SamadiPour/"
               "rial-exchange-rates-archive/data/gregorian_all.min.json")
FRANKFURTER_URL = "https://api.frankfurter.dev/v1/1999-01-01..2100-01-01?base=USD&symbols=CAD"
WALLEX_HISTORY_URL = ("https://api.wallex.ir/v1/udf/history?"
                      "symbol=USDTTMN&resolution=1D&from={frm}&to=9999999999")


def _prior_values(data_dir: str, source_id: str) -> list[int]:
    snap_dir = os.path.join(data_dir, "snapshots")
    if not os.path.isdir(snap_dir):
        return []
    dates = sorted(f[:-5] for f in os.listdir(snap_dir) if f.endswith(".json"))
    if not dates:
        return []
    doc = json.load(open(os.path.join(snap_dir, dates[-1] + ".json"), encoding="utf-8"))
    vals = []
    for r in doc["records"]:
        if r["source_id"] == source_id:
            for k in ("buy_rial", "sell_rial", "price_rial"):
                if r.get(k):
                    vals.append(r[k])
    return vals


def _is_suspect(data_dir: str, rec: Record) -> bool:
    prior = _prior_values(data_dir, rec.source_id)
    if not prior:
        return False
    ref = sum(prior) / len(prior)
    for v in (rec.buy_rial, rec.sell_rial, rec.price_rial):
        if v is not None and (v < SANITY_LOW * ref or v > SANITY_HIGH * ref):
            return True
    return False


def _has_usable_usd_price(rec: Record) -> bool:
    return (rec.sell_rial is not None or rec.buy_rial is not None
            or rec.price_rial is not None)


def run(date: str, data_dir: str, registry: dict,
        fetch_json: Callable[[str], object], now: str) -> list[Record]:
    sources = build_sources(registry)
    records: list[Record] = []
    for source_id, src in sources.items():
        try:
            payload = fetch_json(src.url())
            recs = src.parse(payload)
        except Exception as exc:  # one source must never abort the run
            try:
                url = src.url()
            except Exception:
                url = ""
            meta = next(
                (s for s in registry["sources"] if s["source_id"] == source_id), {}
            )
            records.append(Record(
                source_id=source_id, kind=meta.get("kind", "proxy"),
                pair_from=str(meta.get("pair_from", source_id)).split(",")[0],
                pair_to=meta.get("pair_to", "IRR"),
                status="error", error=f"{type(exc).__name__}: {exc}",
                source_url=url, verify_url=meta.get("verify_url", ""),
            ))
            continue
        for rec in recs:
            if _is_suspect(data_dir, rec):
                rec.status = "suspect"
            records.append(rec)
    try:
        fx_rec = next(
            (r for r in records
             if r.source_id == "globalfx" and r.status == "ok"
             and r.value is not None),
            None,
        )
        usd_rec = next(
            (r for r in records
             if r.source_id == "bonbast_archive" and r.pair_from == "USD"
             and r.status == "ok" and _has_usable_usd_price(r)),
            None,
        )
        if usd_rec is None:
            usd_rec = next(
                (r for r in records
                 if r.source_id == "nerkhsanj" and r.pair_from == "USD"
                 and r.status == "ok" and _has_usable_usd_price(r)),
                None,
            )
        if fx_rec is not None and usd_rec is not None:
            records.append(cad_estimate(usd_rec, fx_rec))
    except Exception:  # an estimate must never abort the run or be fabricated
        pass
    validate_records(records)
    write_snapshot(data_dir, date, records, now)
    rebuild_index(data_dir, registry, now)
    merge_history(data_dir, date, records, now)
    return records


def merge_history(data_dir: str, date: str, records: list, now: str) -> None:
    path = os.path.join(data_dir, "history.json")
    h = hist.load_history(path)
    hist.add_records(h, date, records)
    h["generated_at"] = now
    hist.save_history(path, h)


def _recent_wallex_from(days: int) -> int:
    import time
    return int(time.time()) - max(days, 90) * 86400


def build_history(fetch_json, days: int = 90) -> dict:
    bonbast = fetch_json(BONBAST_URL)
    frankfurter = fetch_json(FRANKFURTER_URL)
    try:
        wallex = fetch_json(WALLEX_HISTORY_URL.format(frm=_recent_wallex_from(days)))
    except Exception:
        wallex = None
    return hist.build_from_archive(bonbast, frankfurter, wallex, "")


def backfill(days: int, data_dir: str, registry: dict, fetch_json, now: str) -> list[str]:
    h = build_history(fetch_json, days)
    bb_points = {k: v["points"] for k, v in h["sources"].items() if k.startswith("bonbast_archive:")}
    usd = bb_points.get("bonbast_archive:USD", {})
    all_dates = sorted(usd.keys())
    targets = all_dates[-days:] if days else []
    # date -> CAD per USD, for the CAD estimate inputs
    frankfurter = fetch_json(FRANKFURTER_URL)
    cad_per_usd = hist.frankfurter_series(frankfurter)
    wallex_pts = h["sources"].get("wallex:USDT", {}).get("points", {})
    written = []
    for date in targets:
        recs: list[Record] = []
        for pair in ("USD", "CAD"):
            pt = bb_points.get(f"bonbast_archive:{pair}", {}).get(date)
            if not pt:
                continue
            recs.append(Record(
                source_id="bonbast_archive", kind="exact", pair_from=pair, pair_to="IRR",
                buy_rial=pt[0], sell_rial=pt[1],
                single_sided=(pt[0] is None or pt[1] is None),
                as_of=date, source_url=BONBAST_URL,
                verify_url=f"https://bonbast.com/graph/{pair.lower()}",
            ))
        u = usd.get(date)
        fx = cad_per_usd.get(date)
        if u and fx:
            recs.append(hist.cad_estimate_record(u[0], u[1], fx, FRANKFURTER_URL))
        price = wallex_pts.get(date)
        if price:
            recs.append(Record(
                source_id="wallex", kind="proxy", pair_from="USDT", pair_to="IRR",
                price_rial=price, single_sided=True, as_of=date,
                source_url=WALLEX_HISTORY_URL.format(frm=_recent_wallex_from(days)),
                verify_url="https://wallex.ir/",
            ))
        validate_records(recs)
        write_snapshot(data_dir, date, recs, now)
        hist.add_records(h, date, recs)
        written.append(date)
    h["generated_at"] = now
    hist.save_history(os.path.join(data_dir, "history.json"), h)
    rebuild_index(data_dir, registry, now)
    return written


def _default_fetch_json(url: str):
    import requests
    resp = requests.get(url, timeout=30, headers={"User-Agent": "exchange_rate/1.0"})
    resp.raise_for_status()
    return resp.json()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="exchange_rate fetch")
    ap.add_argument("--date", default="")
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--registry", default="data/meta.json")
    ap.add_argument("--now", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--backfill", type=int, default=0,
                    help="write per-day snapshots for the last N archive dates")
    ap.add_argument("--archive", action="store_true",
                    help="build data/history.json from the full bonbast + frankfurter archives")
    args = ap.parse_args(argv)

    registry = load_registry(args.registry)

    if args.archive:
        h = build_history(_default_fetch_json, 400)
        h["generated_at"] = args.now
        hist.save_history(os.path.join(args.data_dir, "history.json"), h)
        n = sum(len(s["points"]) for s in h["sources"].values())
        print(f"wrote {args.data_dir}/history.json: {len(h['sources'])} series, {n} points")
        return 0

    if args.backfill:
        written = backfill(args.backfill, args.data_dir, registry, _default_fetch_json, args.now)
        print(f"backfilled {len(written)} days: {written[0] if written else '-'}..{written[-1] if written else '-'}")
        return 0

    if not args.date:
        ap.error("--date is required unless --archive or --backfill is given")

    if args.dry_run:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            recs = run(args.date, tmp, registry, _default_fetch_json, args.now)
            print(json.dumps([r.to_dict() for r in recs], ensure_ascii=False, indent=2))
        return 0

    run(args.date, args.data_dir, registry, _default_fetch_json, args.now)
    print(f"wrote snapshot {args.date} to {args.data_dir}/snapshots/{args.date}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
