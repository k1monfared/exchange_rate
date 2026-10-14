import json
import os

from model import Record
from store import write_snapshot, rebuild_index

REGISTRY = {"version": 1, "sources": [
    {"source_id": "nobitex", "label": "Nobitex", "kind": "proxy", "pair_from": "USDT",
     "pair_to": "IRR", "verify_url": "https://nobitex.ir/"},
]}


def _rec():
    return Record(source_id="nobitex", kind="proxy", pair_from="USDT", pair_to="IRR",
                  buy_rial=2600990, sell_rial=2601040)


def test_write_snapshot_is_idempotent(tmp_path):
    d = str(tmp_path)
    write_snapshot(d, "2026-10-13", [_rec()], "2026-10-13T18:00:00+03:30")
    write_snapshot(d, "2026-10-13", [_rec()], "2026-10-13T18:00:00+03:30")
    files = os.listdir(os.path.join(d, "snapshots"))
    assert files == ["2026-10-13.json"]


def test_rebuild_index_lists_dates_and_sources(tmp_path):
    d = str(tmp_path)
    write_snapshot(d, "2026-10-12", [_rec()], "2026-10-12T18:00:00+03:30")
    write_snapshot(d, "2026-10-13", [_rec()], "2026-10-13T18:00:00+03:30")
    idx = rebuild_index(d, REGISTRY, "2026-10-13T18:00:00+03:30")
    assert idx["dates"] == ["2026-10-12", "2026-10-13"]
    assert idx["latest"] == "2026-10-13"
    assert idx["sources"][0]["source_id"] == "nobitex"
    on_disk = json.load(open(os.path.join(d, "index.json")))
    assert on_disk["latest"] == "2026-10-13"
