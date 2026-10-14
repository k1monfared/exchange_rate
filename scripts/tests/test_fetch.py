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


CASH_REGISTRY = {"version": 1, "sources": [
    {"source_id": "bonbast_archive", "label": "Bonbast", "kind": "exact",
     "pair_from": "USD", "pair_to": "IRR", "verify_url": "https://bonbast.com/"},
    {"source_id": "nerkhsanj", "label": "Nerkhsanj", "kind": "exact",
     "pair_from": "USD", "pair_to": "IRR", "verify_url": "https://nerkh.jahankhahan.shop/"},
    {"source_id": "globalfx", "label": "Global", "kind": "exact", "pair_from": "USD",
     "pair_to": "CAD", "verify_url": "https://open.er-api.com/v6/latest/USD"},
]}

BONBAST_PAYLOAD = {
    "2026/10/12": {"USD": {"sell": 260600, "buy": 260400},
                   "CAD": {"sell": 182500, "buy": 182400}},
}
NERKHSANJ_PAYLOAD = {"date": "1405/07/21", "rates": {"dollar": 257710, "cad": 181380}}


def _cash_fetch(url):
    if "archive" in url:
        return BONBAST_PAYLOAD
    if "nerkh" in url:
        return NERKHSANJ_PAYLOAD
    if "er-api" in url:
        return {"rates": {"CAD": 1.4221}, "time_last_update_utc": "x"}
    raise AssertionError(url)


def test_run_appends_cad_estimate(tmp_path):
    d = str(tmp_path)
    recs = run("2026-10-13", d, CASH_REGISTRY, _cash_fetch, "x")
    est = next((r for r in recs if r.source_id == "cad_estimate"), None)
    assert est is not None
    assert est.kind == "estimate"
    assert est.pair_from == "CAD" and est.pair_to == "IRR"
    assert est.inputs


def test_run_no_estimate_when_globalfx_absent(tmp_path):
    d = str(tmp_path)
    reg = {"version": 1, "sources": [
        s for s in CASH_REGISTRY["sources"] if s["source_id"] != "globalfx"
    ]}
    recs = run("2026-10-13", d, reg, _cash_fetch, "x")
    assert not any(r.source_id == "cad_estimate" for r in recs)
    assert any(r.source_id == "bonbast_archive" and r.status == "ok" for r in recs)


def test_run_no_estimate_when_globalfx_errors(tmp_path):
    d = str(tmp_path)

    def fx_error(url):
        if "er-api" in url:
            raise RuntimeError("fx down")
        return _cash_fetch(url)

    recs = run("2026-10-13", d, CASH_REGISTRY, fx_error, "x")
    assert not any(r.source_id == "cad_estimate" for r in recs)
    assert any(r.source_id == "globalfx" and r.status == "error" for r in recs)


def test_estimate_falls_back_to_nerkhsanj_when_bonbast_errors(tmp_path):
    d = str(tmp_path)

    def bonbast_boom(url):
        if "archive" in url:
            raise RuntimeError("bonbast down")
        return _cash_fetch(url)

    recs = run("2026-10-13", d, CASH_REGISTRY, bonbast_boom, "x")
    bon = next(r for r in recs if r.source_id == "bonbast_archive")
    assert bon.status == "error"
    est = next((r for r in recs if r.source_id == "cad_estimate"), None)
    assert est is not None
    assert est.sell_rial is not None and est.buy_rial is not None
    assert {i.source_id for i in est.inputs} == {"nerkhsanj", "globalfx"}

