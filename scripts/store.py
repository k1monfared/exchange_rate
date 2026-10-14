from __future__ import annotations

import json
import os

from model import Record


def write_snapshot(data_dir: str, date: str, records: list[Record], generated_at: str) -> str:
    snap_dir = os.path.join(data_dir, "snapshots")
    os.makedirs(snap_dir, exist_ok=True)
    path = os.path.join(snap_dir, f"{date}.json")
    doc = {
        "date": date,
        "generated_at": generated_at,
        "records": [r.to_dict() for r in records],
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2, sort_keys=True)
    return path


def rebuild_index(data_dir: str, registry: dict, generated_at: str) -> dict:
    snap_dir = os.path.join(data_dir, "snapshots")
    dates = sorted(
        f[:-5] for f in os.listdir(snap_dir) if f.endswith(".json")
    ) if os.path.isdir(snap_dir) else []
    index = {
        "generated_at": generated_at,
        "dates": dates,
        "latest": dates[-1] if dates else None,
        "sources": [
            {
                "source_id": s["source_id"],
                "label": s["label"],
                "kind": s["kind"],
                "pair": f'{s["pair_from"]}/{s["pair_to"]}',
                "verify_url": s["verify_url"],
            }
            for s in registry["sources"]
        ],
    }
    with open(os.path.join(data_dir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2, sort_keys=True)
    return index
