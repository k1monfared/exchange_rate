import json
import os

import fetch
from fetch import run
from sources import globalfx as _globalfx
from sources.base import Source

REGISTRY = {"version": 1, "sources": [
    {"source_id": "nobitex", "label": "Nobitex", "kind": "proxy", "pair_from": "USDT",
     "pair_to": "IRR", "verify_url": "https://nobitex.ir/"},
    {"source_id": "globalfx", "label": "Global", "kind": "exact", "pair_from": "USD",
     "pair_to": "CAD", "verify_url": "https://open.er-api.com/v6/latest/USD"},
]}


def _good(url):
    if "nobitex" in url:
        return {"stats": {"usdt-rls": {"bestBuy": "2600990", "bestSell": "2601040"}}}
    if "er-api" in url:
        return {"rates": {"CAD": 1.4221}, "time_last_update_utc": "x"}
    raise AssertionError(url)


def test_run_writes_snapshot_and_index(tmp_path):
    d = str(tmp_path)
    recs = run("2026-10-13", d, REGISTRY, _good, "2026-10-13T18:00:00+03:30")
    assert any(r.source_id == "nobitex" for r in recs)
    assert any(r.source_id == "globalfx" for r in recs)
    assert os.path.exists(os.path.join(d, "snapshots", "2026-10-13.json"))
    assert os.path.exists(os.path.join(d, "index.json"))


def test_one_source_failure_does_not_abort(tmp_path):
    d = str(tmp_path)

    def flaky(url):
        if "nobitex" in url:
            raise RuntimeError("boom")
        return _good(url)

    recs = run("2026-10-13", d, REGISTRY, flaky, "x")
    nobitex = next(r for r in recs if r.source_id == "nobitex")
    assert nobitex.status == "error"
    assert "boom" in (nobitex.error or "")
    assert any(r.source_id == "globalfx" and r.status == "ok" for r in recs)


def test_suspect_value_flagged(tmp_path):
    d = str(tmp_path)
    # 100x jump vs the prior good value for this source
    os.makedirs(os.path.join(d, "snapshots"))
    prev = {"date": "2026-10-12", "generated_at": "x", "records": [
        {"source_id": "nobitex", "kind": "proxy", "pair_from": "USDT", "pair_to": "IRR",
         "buy_rial": 2600000, "sell_rial": 2600000, "price_rial": None, "single_sided": False,
         "as_of": "", "native": {}, "source_url": "", "verify_url": "", "status": "ok",
         "error": None, "raw": {}}]}
    json.dump(prev, open(os.path.join(d, "snapshots", "2026-10-12.json"), "w"))

    def wild(url):
        if "nobitex" in url:
            return {"stats": {"usdt-rls": {"bestBuy": "260000000", "bestSell": "260000000"}}}
        return _good(url)

    recs = run("2026-10-13", d, REGISTRY, wild, "x")
    nobitex = next(r for r in recs if r.source_id == "nobitex")
    assert nobitex.status == "suspect"


class _BoomSource(Source):
    source_id = "boom"
    kind = "exact"

    def url(self):
        raise RuntimeError("no url")

    def parse(self, payload):
        raise AssertionError("parse must not be reached")


def test_source_whose_url_raises_does_not_abort(tmp_path, monkeypatch):
    d = str(tmp_path)
    monkeypatch.setattr(
        fetch, "build_sources",
        lambda registry: {"boom": _BoomSource(), "globalfx": _globalfx.GlobalFx()},
    )

    recs = run("2026-10-13", d, REGISTRY, _good, "x")
    boom = next(r for r in recs if r.source_id == "boom")
    assert boom.status == "error"
    assert "no url" in (boom.error or "")
    assert boom.source_url == ""
    assert boom.verify_url == ""
    assert any(r.source_id == "globalfx" and r.status == "ok" for r in recs)

