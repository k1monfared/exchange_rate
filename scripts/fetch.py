from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from derive import cad_estimate
from model import Record
from registry import build_sources, load_registry
from store import rebuild_index, write_snapshot

SANITY_LOW = 0.3
SANITY_HIGH = 2.5


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
        fx_rec = next((r for r in records if r.source_id == "globalfx"), None)
        usd_rec = next(
            (r for r in records
             if r.source_id == "bonbast_archive" and r.pair_from == "USD"),
            None,
        )
        if usd_rec is None:
            usd_rec = next(
                (r for r in records
                 if r.source_id == "nerkhsanj" and r.pair_from == "USD"),
                None,
            )
        if fx_rec is not None and usd_rec is not None:
            records.append(cad_estimate(usd_rec, fx_rec))
    except Exception:  # an estimate must never abort the run or be fabricated
        pass
    write_snapshot(data_dir, date, records, now)
    rebuild_index(data_dir, registry, now)
    return records


def _default_fetch_json(url: str):
    import requests
    resp = requests.get(url, timeout=30, headers={"User-Agent": "exchange_rate/1.0"})
    resp.raise_for_status()
    return resp.json()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="exchange_rate fetch")
    ap.add_argument("--date", required=True)
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--registry", default="data/meta.json")
    ap.add_argument("--now", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    registry = load_registry(args.registry)
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
