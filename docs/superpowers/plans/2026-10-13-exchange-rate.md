# exchange_rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, serverless daily job and static website that records Iran free-market USD/IRR and CAD/IRR rates from nine keyless sources, keeps each source separate, stores daily history, and lets a visitor convert between USD, CAD, and IRR for any recorded date.

**Architecture:** A Python job runs on GitHub Actions once a day, fetches each source through a small adapter that parses an already-fetched JSON payload, normalizes everything to Rial, computes a small set of derived estimates with explicit provenance, and writes one JSON snapshot per day plus an index. The same workflow builds a static site from `site/` plus `data/` and deploys it to GitHub Pages. The browser reads the JSON and renders the calculator, per-source tables, and per-source Chart.js charts.

**Tech Stack:** Python 3.12 (`requests`, `pytest`), plain HTML/CSS/JS, Chart.js (vendored, MIT), GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-13-exchange-rate-design.md`

## Global Constraints

- Repo and site are both named **exchange_rate**.
- Canonical unit is **IRR (rial)**, stored as an integer. Display default is **toman** (rial / 10) with a toggle to rial.
- Every value has exactly one `kind`: **`exact`**, **`proxy`**, or **`estimate`**. Nothing is ever conflated or blended silently.
- Missing sides are never fabricated. A single-sided source stores `price_rial` and leaves `buy_rial`/`sell_rial` null.
- A single source failure is recorded as `status: "error"` for that source only and never aborts the run.
- Every stored value carries `source_url` (the exact call) and `verify_url` (a human page).
- A derived value is never written as if it were read. It carries `formula` and a non-empty `inputs` array, each input naming its source, value, kind, and verify link.
- Sources are keyed by `source_id` and remain separate in storage, tables, and charts. No summing or merging of sources.
- FOSS only. No API keys or secrets required in v1.
- Python 3.12, dependencies limited to `requests` and `pytest`.
- Run scripts as modules from the repo root (`python -m scripts.fetch`) so imports resolve.

## Review Focus

These are the input classes and failure modes the spec implies but whose behavior a user would notice if wrong. Each is pinned by a test in the task that owns the code.

1. A source changes shape, returns an empty payload, or is unreachable. Expected: that source records `status: "error"` (or `"missing"`), the run still completes, and no other source is affected. Pinned in Task 8.
2. A source returns a value in the wrong unit (Toman read as Rial or the reverse), producing a silent 10x error. Expected: normalization is unit-explicit and a value outside the sanity band is marked `status: "suspect"`, not trusted. Pinned in Tasks 1, 8.
3. A single-sided source is used in a context that wants both sides. Expected: the missing side renders blank, never 0 and never a fabricated number, and mid is not computed. Pinned in Tasks 6, 10.
4. A chosen date has no snapshot (job failed, holiday, gap). Expected: the UI shows "no data for this date", never silently substituting another date. Pinned in Task 9.
5. The CAD estimate is shown when its USD input is itself a proxy or the global input is stale. Expected: the estimate is labeled `estimate` and its popup lists the actual inputs used with their kinds. Pinned in Task 6.

---

### Task 1: Project scaffolding, data model, and unit normalization

**Files:**
- Create: `.gitignore`, `requirements.txt`, `scripts/__init__.py`, `scripts/model.py`, `scripts/normalize.py`, `scripts/tests/__init__.py`, `scripts/tests/conftest.py`, `scripts/tests/test_model.py`, `scripts/tests/test_normalize.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `scripts/model.py`: `Input(source_id: str, value: float, kind: str, verify_url: str, unit: str = "rial")` with `.to_dict()`; `Record` dataclass with fields `source_id, kind, pair_from, pair_to, buy_rial, sell_rial, price_rial, value, single_sided, as_of, native, source_url, verify_url, status, error, raw, formula, inputs` and `.to_dict()`.
  - `scripts/normalize.py`: `to_rial(value: float, unit: str) -> int`, `to_toman(value_rial: int) -> float`.

- [ ] **Step 1: Create scaffolding files**

`.gitignore`:
```
__pycache__/
*.pyc
.pytest_cache/
_site/
.venv/
```

`requirements.txt`:
```
requests==2.32.3
pytest==8.3.3
```

`scripts/__init__.py`, `scripts/tests/__init__.py`: empty files.

`scripts/tests/conftest.py`:
```python
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
```

- [ ] **Step 2: Write the failing tests for the model and normalize**

`scripts/tests/test_model.py`:
```python
from model import Input, Record


def test_record_dict_has_core_keys():
    r = Record(source_id="nobitex", kind="proxy", pair_from="USDT", pair_to="IRR",
               buy_rial=2600990, sell_rial=2601040)
    d = r.to_dict()
    assert d["source_id"] == "nobitex"
    assert d["kind"] == "proxy"
    assert d["buy_rial"] == 2600990
    assert d["sell_rial"] == 2601040
    assert d["price_rial"] is None
    assert "inputs" not in d  # omitted when empty


def test_derived_record_serializes_inputs():
    r = Record(source_id="derive", kind="estimate", pair_from="CAD", pair_to="IRR",
               price_rial=18290000, formula="irl = usd / usd_cad",
               inputs=[Input(source_id="bonbast_archive", value=2606000, kind="exact",
                             verify_url="https://bonbast.com/")])
    d = r.to_dict()
    assert d["formula"] == "irl = usd / usd_cad"
    assert d["inputs"][0]["source_id"] == "bonbast_archive"
    assert d["inputs"][0]["kind"] == "exact"
```

`scripts/tests/test_normalize.py`:
```python
import pytest
from normalize import to_rial, to_toman


def test_toman_to_rial_multiplies_by_ten():
    assert to_rial(260104, "toman") == 2601040


def test_rial_passthrough():
    assert to_rial(2601040, "rial") == 2601040


def test_rial_to_toman_divides_by_ten():
    assert to_toman(2601040) == 260104.0


def test_unknown_unit_raises():
    with pytest.raises(ValueError):
        to_rial(1, "usd")


def test_float_string_would_be_caught():
    # strings must be converted by the caller, not here
    with pytest.raises(TypeError):
        to_rial("260104", "toman")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest scripts/tests/test_model.py scripts/tests/test_normalize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'model'`.

- [ ] **Step 4: Implement `scripts/model.py`**

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Input:
    source_id: str
    value: float
    kind: str
    verify_url: str
    unit: str = "rial"

    def to_dict(self) -> dict:
        return {
            "source_id": self.source_id,
            "value": self.value,
            "kind": self.kind,
            "verify_url": self.verify_url,
            "unit": self.unit,
        }


@dataclass
class Record:
    source_id: str
    kind: str
    pair_from: str
    pair_to: str
    buy_rial: Optional[int] = None
    sell_rial: Optional[int] = None
    price_rial: Optional[int] = None
    value: Optional[float] = None
    single_sided: bool = False
    as_of: str = ""
    native: dict = field(default_factory=dict)
    source_url: str = ""
    verify_url: str = ""
    status: str = "ok"
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)
    formula: Optional[str] = None
    inputs: list = field(default_factory=list)

    def to_dict(self) -> dict:
        d = {
            "source_id": self.source_id,
            "kind": self.kind,
            "pair_from": self.pair_from,
            "pair_to": self.pair_to,
            "buy_rial": self.buy_rial,
            "sell_rial": self.sell_rial,
            "price_rial": self.price_rial,
            "value": self.value,
            "single_sided": self.single_sided,
            "as_of": self.as_of,
            "native": self.native,
            "source_url": self.source_url,
            "verify_url": self.verify_url,
            "status": self.status,
            "error": self.error,
            "raw": self.raw,
        }
        if self.formula is not None:
            d["formula"] = self.formula
        if self.inputs:
            d["inputs"] = [i.to_dict() if isinstance(i, Input) else i for i in self.inputs]
        return d
```

- [ ] **Step 5: Implement `scripts/normalize.py`**

```python
def to_rial(value: float, unit: str) -> int:
    if unit == "rial":
        return int(round(value))
    if unit == "toman":
        return int(round(value * 10))
    raise ValueError(f"unknown unit: {unit}")


def to_toman(value_rial: int) -> float:
    return value_rial / 10
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest scripts/tests/test_model.py scripts/tests/test_normalize.py -v`
Expected: PASS (7 passed).

- [ ] **Step 7: Commit**

```bash
git add .gitignore requirements.txt scripts/
git commit -m "feat: project scaffolding, record model, unit normalization"
```

---

### Task 2: Source interface, registry, and `meta.json`

**Files:**
- Create: `scripts/sources/__init__.py`, `scripts/sources/base.py`, `data/meta.json`, `scripts/registry.py`, `scripts/tests/test_registry.py`

**Interfaces:**
- Consumes: `model.Record` from Task 1.
- Produces:
  - `scripts/sources/base.py`: `Source` ABC with class attributes `source_id`, `kind`, `pair_from`, `pair_to`, methods `url(self) -> str` and `parse(self, payload) -> list[Record]`.
  - `scripts/registry.py`: `load_registry(path) -> dict`, `build_sources(registry) -> dict[str, Source]`.

- [ ] **Step 1: Write the failing test**

`scripts/tests/test_registry.py`:
```python
import json
import os

from registry import load_registry, build_sources

META = os.path.join(os.path.dirname(__file__), "..", "..", "data", "meta.json")


def test_registry_lists_all_nine_sources():
    reg = load_registry(META)
    ids = {s["source_id"] for s in reg["sources"]}
    assert ids == {
        "nerkhsanj", "bonbast_archive", "tetherland", "nobitex",
        "ramzinex", "wallex", "tabdeal", "bitpin", "globalfx",
    }


def test_every_source_has_verify_url_and_kind():
    reg = load_registry(META)
    for s in reg["sources"]:
        assert s["verify_url"].startswith("http")
        assert s["kind"] in {"exact", "proxy"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/tests/test_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'registry'`.

- [ ] **Step 3: Implement `scripts/sources/base.py`**

```python
from __future__ import annotations

from abc import ABC, abstractmethod

from model import Record


class Source(ABC):
    source_id: str = ""
    kind: str = "exact"
    pair_from: str = ""
    pair_to: str = "IRR"

    @abstractmethod
    def url(self) -> str:
        ...

    @abstractmethod
    def parse(self, payload) -> list[Record]:
        ...
```

- [ ] **Step 4: Author `data/meta.json`**

```json
{
  "version": 1,
  "sources": [
    {"source_id": "nerkhsanj", "label": "Nerkhsanj", "kind": "exact", "pair_from": "USD,CAD", "pair_to": "IRR", "provider": "nerkh.jahankhahan.shop", "verify_url": "https://nerkh.jahankhahan.shop/developers/en", "note": "single price per pair, toman"},
    {"source_id": "bonbast_archive", "label": "Bonbast (archive)", "kind": "exact", "pair_from": "USD,CAD", "pair_to": "IRR", "provider": "bonbast.com", "verify_url": "https://bonbast.com/graph/cad", "note": "daily, one-day lag, buy and sell"},
    {"source_id": "tetherland", "label": "Tetherland (USDT proxy)", "kind": "proxy", "pair_from": "USDT", "pair_to": "IRR", "provider": "tetherland.com", "verify_url": "https://tetherland.com/", "note": "USDT stands in for cash USD"},
    {"source_id": "nobitex", "label": "Nobitex (USDT proxy)", "kind": "proxy", "pair_from": "USDT", "pair_to": "IRR", "provider": "nobitex.ir", "verify_url": "https://nobitex.ir/markets/usdt-rls", "note": "rial"},
    {"source_id": "ramzinex", "label": "Ramzinex (USDT proxy)", "kind": "proxy", "pair_from": "USDT", "pair_to": "IRR", "provider": "ramzinex.com", "verify_url": "https://ramzinex.com/exchange/usdt-irr", "note": "rial, orderbook"},
    {"source_id": "wallex", "label": "Wallex (USDT proxy)", "kind": "proxy", "pair_from": "USDT", "pair_to": "IRR", "provider": "wallex.ir", "verify_url": "https://wallex.ir/", "note": "toman, bid/ask"},
    {"source_id": "tabdeal", "label": "Tabdeal (USDT proxy)", "kind": "proxy", "pair_from": "USDT", "pair_to": "IRR", "provider": "tabdeal.org", "verify_url": "https://tabdeal.org/", "note": "toman, orderbook"},
    {"source_id": "bitpin", "label": "Bitpin (USDT proxy)", "kind": "proxy", "pair_from": "USDT", "pair_to": "IRR", "provider": "bitpin.ir", "verify_url": "https://bitpin.ir/", "note": "toman, last price"},
    {"source_id": "globalfx", "label": "Global USD/CAD (open.er-api.com)", "kind": "exact", "pair_from": "USD", "pair_to": "CAD", "provider": "open.er-api.com", "verify_url": "https://open.er-api.com/v6/latest/USD", "note": "global reference, input to CAD estimate"}
  ]
}
```

- [ ] **Step 5: Implement `scripts/registry.py`**

```python
from __future__ import annotations

import json

from sources.base import Source
from sources import bitpin, bonbast_archive, globalfx, nerkhsanj, nobitex
from sources import ramzinex, tabdeal, tetherland, wallex

_ADAPTERS = {
    "nerkhsanj": nerkhsanj.Nerkhsanj,
    "bonbast_archive": bonbast_archive.BonbastArchive,
    "tetherland": tetherland.Tetherland,
    "nobitex": nobitex.Nobitex,
    "ramzinex": ramzinex.Ramzinex,
    "wallex": wallex.Wallex,
    "tabdeal": tabdeal.Tabdeal,
    "bitpin": bitpin.Bitpin,
    "globalfx": globalfx.GlobalFx,
}


def load_registry(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def build_sources(registry: dict) -> dict[str, Source]:
    out: dict[str, Source] = {}
    for entry in registry["sources"]:
        cls = _ADAPTERS[entry["source_id"]]
        out[entry["source_id"]] = cls()
    return out
```

Note: this imports adapter modules that arrive in Tasks 3 to 5. For this task's test to pass, create placeholder modules with empty class stubs first, then fill them in the later tasks. Create each `scripts/sources/<name>.py` with only the class header for now, for example `scripts/sources/nerkhsanj.py` containing `from sources.base import Source` and a minimal `class Nerkhsanj(Source):` with `url`/`parse` raising `NotImplementedError`. The Task 2 test only checks the registry JSON, so it passes with stubs.

- [ ] **Step 6: Run test to verify it passes**

Run: `python -m pytest scripts/tests/test_registry.py -v`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add scripts/sources/ scripts/registry.py scripts/tests/test_registry.py data/meta.json
git commit -m "feat: source interface, registry, and source metadata"
```

---

### Task 3: Cash sources (nerkhsanj, bonbast_archive)

**Files:**
- Modify: `scripts/sources/nerkhsanj.py`, `scripts/sources/bonbast_archive.py`
- Create: `scripts/tests/test_sources_cash.py`

**Interfaces:**
- Consumes: `Source` from Task 2, `normalize.to_rial` from Task 1.
- Produces: `Nerkhsanj` and `BonbastArchive` classes whose `parse(payload)` returns a list of `Record`, one per pair (`USD`, `CAD`), with `kind="exact"`.

- [ ] **Step 1: Write the failing tests**

`scripts/tests/test_sources_cash.py`:
```python
from sources.nerkhsanj import Nerkhsanj
from sources.bonbast_archive import BonbastArchive

NERKHSANJ_PAYLOAD = {
    "date": "1405/07/21",
    "rates": {"dollar": 257710, "cad": 181380, "euro": 288590},
}

BONBAST_PAYLOAD = {
    "2026/10/11": {"USD": {"sell": 264000, "buy": 263800}, "CAD": {"sell": 184900, "buy": 184800}},
    "2026/10/12": {"USD": {"sell": 260600, "buy": 260400}, "CAD": {"sell": 182500, "buy": 182400}},
}


def test_nerkhsanj_yields_usd_and_cad_single_sided_toman():
    recs = {r.pair_from: r for r in Nerkhsanj().parse(NERKHSANJ_PAYLOAD)}
    assert set(recs) == {"USD", "CAD"}
    assert recs["USD"].price_rial == 2577100
    assert recs["USD"].single_sided is True
    assert recs["USD"].buy_rial is None and recs["USD"].sell_rial is None
    assert recs["USD"].kind == "exact"
    assert recs["CAD"].price_rial == 1813800


def test_bonbast_uses_latest_date_and_both_sides():
    recs = {r.pair_from: r for r in BonbastArchive().parse(BONBAST_PAYLOAD)}
    assert recs["USD"].sell_rial == 2606000
    assert recs["USD"].buy_rial == 2604000
    assert recs["CAD"].sell_rial == 1825000
    assert recs["USD"].as_of.startswith("2026/10/12")
    assert recs["USD"].single_sided is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/tests/test_sources_cash.py -v`
Expected: FAIL with `NotImplementedError` or assertion errors.

- [ ] **Step 3: Implement `scripts/sources/nerkhsanj.py`**

```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Nerkhsanj(Source):
    source_id = "nerkhsanj"
    kind = "exact"

    def url(self) -> str:
        return "https://nerkh.jahankhahan.shop/data/live.json"

    def parse(self, payload) -> list[Record]:
        rates = payload["rates"]
        as_of = payload.get("date", "")
        out = []
        for pair, key in (("USD", "dollar"), ("CAD", "cad")):
            raw = rates[key]
            out.append(Record(
                source_id=self.source_id,
                kind=self.kind,
                pair_from=pair,
                pair_to="IRR",
                price_rial=to_rial(raw, "toman"),
                single_sided=True,
                as_of=as_of,
                native={"value": raw, "unit": "toman"},
                source_url=self.url(),
                verify_url="https://nerkh.jahankhahan.shop/developers/en",
                raw={"key": key, "value": raw},
            ))
        return out
```

- [ ] **Step 4: Implement `scripts/sources/bonbast_archive.py`**

```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class BonbastArchive(Source):
    source_id = "bonbast_archive"
    kind = "exact"

    def url(self) -> str:
        return ("https://raw.githubusercontent.com/SamadiPour/"
                "rial-exchange-rates-archive/data/gregorian_all.min.json")

    def parse(self, payload) -> list[Record]:
        latest = sorted(payload.keys())[-1]
        day = {k.upper(): v for k, v in payload[latest].items()}
        out = []
        for pair in ("USD", "CAD"):
            block = day.get(pair)
            if not block:
                continue
            out.append(Record(
                source_id=self.source_id,
                kind=self.kind,
                pair_from=pair,
                pair_to="IRR",
                buy_rial=to_rial(block["buy"], "toman") if "buy" in block else None,
                sell_rial=to_rial(block["sell"], "toman") if "sell" in block else None,
                single_sided="buy" not in block or "sell" not in block,
                as_of=latest,
                native={"buy": block.get("buy"), "sell": block.get("sell"), "unit": "toman"},
                source_url=self.url(),
                verify_url="https://bonbast.com/graph/" + pair.lower(),
                raw=block,
            ))
        return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest scripts/tests/test_sources_cash.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add scripts/sources/nerkhsanj.py scripts/sources/bonbast_archive.py scripts/tests/test_sources_cash.py
git commit -m "feat: cash USD/CAD sources (nerkhsanj, bonbast archive)"
```

---

### Task 4: Proxy sources (USDT exchanges)

**Files:**
- Modify: `scripts/sources/tetherland.py`, `nobitex.py`, `ramzinex.py`, `wallex.py`, `tabdeal.py`, `bitpin.py`
- Create: `scripts/tests/test_sources_proxy.py`

**Interfaces:**
- Consumes: `Source`, `normalize.to_rial`.
- Produces: six classes each returning one `Record` with `kind="proxy"`, `pair_from="USDT"`, `pair_to="IRR"`.

- [ ] **Step 1: Write the failing tests**

`scripts/tests/test_sources_proxy.py`:
```python
from sources.tetherland import Tetherland
from sources.nobitex import Nobitex
from sources.ramzinex import Ramzinex
from sources.wallex import Wallex
from sources.tabdeal import Tabdeal
from sources.bitpin import Bitpin


def test_tetherland_toman_two_sided():
    p = {"status": 200, "data": {"currencies": {"USDT": {"price": 258900, "sell_price": 259100, "buy_price": 258700}}}}
    r = Tetherland().parse(p)[0]
    assert r.kind == "proxy"
    assert r.buy_rial == 2587000 and r.sell_rial == 2591000


def test_nobitex_rial_two_sided():
    p = {"status": "ok", "stats": {"usdt-rls": {"bestBuy": "2600990", "bestSell": "2601040"}}}
    r = Nobitex().parse(p)[0]
    assert r.buy_rial == 2600990 and r.sell_rial == 2601040


def test_ramzinex_orderbook_rial():
    p = {"data": {"buys": [[2585000, 1], [2584350, 2]], "sells": [[2615000, 1]]}}
    r = Ramzinex().parse(p)[0]
    assert r.buy_rial == 2585000 and r.sell_rial == 2615000


def test_wallex_toman_bid_ask():
    p = {"result": {"symbols": {"USDTTMN": {"stats": {"bidPrice": "257046.0", "askPrice": "257620.0"}}}}}
    r = Wallex().parse(p)[0]
    assert r.buy_rial == 2570460 and r.sell_rial == 2576200


def test_tabdeal_toman_bids_asks():
    p = {"asks": [["260310.0", "5"], ["260340.0", "1"]], "bids": [["260200.0", "3"]]}
    r = Tabdeal().parse(p)[0]
    assert r.buy_rial == 2602000 and r.sell_rial == 2603100


def test_bitpin_single_sided_toman():
    p = {"results": [{"code": "USDT_IRT", "price": "257007", "order_book_info": {"price": "257007"}}]}
    r = Bitpin().parse(p)[0]
    assert r.price_rial == 2570070
    assert r.single_sided is True
    assert r.kind == "proxy"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/tests/test_sources_proxy.py -v`
Expected: FAIL with `NotImplementedError` or assertion errors.

- [ ] **Step 3: Implement the six adapters**

`scripts/sources/tetherland.py`:
```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Tetherland(Source):
    source_id = "tetherland"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.tetherland.com/currencies"

    def parse(self, payload) -> list[Record]:
        u = payload["data"]["currencies"]["USDT"]
        buy = u.get("buy_price", u["price"])
        sell = u.get("sell_price", u["price"])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(buy, "toman"), sell_rial=to_rial(sell, "toman"),
            as_of="", native={"buy": buy, "sell": sell, "unit": "toman"},
            source_url=self.url(), verify_url="https://tetherland.com/",
            raw=u,
        )]
```

`scripts/sources/nobitex.py`:
```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Nobitex(Source):
    source_id = "nobitex"
    kind = "proxy"

    def url(self) -> str:
        return "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls"

    def parse(self, payload) -> list[Record]:
        s = payload["stats"]["usdt-rls"]
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(float(s["bestBuy"]), "rial"),
            sell_rial=to_rial(float(s["bestSell"]), "rial"),
            as_of="", native={"buy": s["bestBuy"], "sell": s["bestSell"], "unit": "rial"},
            source_url=self.url(), verify_url="https://nobitex.ir/markets/usdt-rls",
            raw=s,
        )]
```

`scripts/sources/ramzinex.py`:
```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Ramzinex(Source):
    source_id = "ramzinex"
    kind = "proxy"

    def url(self) -> str:
        return ("https://publicapi.ramzinex.com/exchange/api/v1.0/"
                "exchange/orderbooks/11/buys_sells")

    def parse(self, payload) -> list[Record]:
        d = payload["data"]
        best_buy = d["buys"][0][0]
        best_sell = d["sells"][0][0]
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(best_buy, "rial"), sell_rial=to_rial(best_sell, "rial"),
            as_of="", native={"buy": best_buy, "sell": best_sell, "unit": "rial"},
            source_url=self.url(), verify_url="https://ramzinex.com/exchange/usdt-irr",
            raw={"best_buy": best_buy, "best_sell": best_sell},
        )]
```

`scripts/sources/wallex.py`:
```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Wallex(Source):
    source_id = "wallex"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.wallex.ir/v1/markets"

    def parse(self, payload) -> list[Record]:
        s = payload["result"]["symbols"]["USDTTMN"]["stats"]
        buy = float(s["bidPrice"])
        sell = float(s["askPrice"])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(buy, "toman"), sell_rial=to_rial(sell, "toman"),
            as_of="", native={"buy": s["bidPrice"], "sell": s["askPrice"], "unit": "toman"},
            source_url=self.url(), verify_url="https://wallex.ir/",
            raw=s,
        )]
```

`scripts/sources/tabdeal.py`:
```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Tabdeal(Source):
    source_id = "tabdeal"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.tabdeal.org/r/api/v1/depth/?symbol=USDTIRT"

    def parse(self, payload) -> list[Record]:
        buy = float(payload["bids"][0][0])
        sell = float(payload["asks"][0][0])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            buy_rial=to_rial(buy, "toman"), sell_rial=to_rial(sell, "toman"),
            as_of="", native={"buy": payload["bids"][0][0], "sell": payload["asks"][0][0], "unit": "toman"},
            source_url=self.url(), verify_url="https://tabdeal.org/",
            raw={"best_bid": payload["bids"][0], "best_ask": payload["asks"][0]},
        )]
```

`scripts/sources/bitpin.py`:
```python
from __future__ import annotations

from model import Record
from normalize import to_rial
from sources.base import Source


class Bitpin(Source):
    source_id = "bitpin"
    kind = "proxy"

    def url(self) -> str:
        return "https://api.bitpin.ir/v1/mkt/markets/"

    def parse(self, payload) -> list[Record]:
        row = next(m for m in payload["results"] if m.get("code") == "USDT_IRT")
        price = float(row["price"])
        return [Record(
            source_id=self.source_id, kind=self.kind, pair_from="USDT", pair_to="IRR",
            price_rial=to_rial(price, "toman"), single_sided=True,
            as_of=row.get("order_book_info", {}).get("time", ""),
            native={"value": row["price"], "unit": "toman"},
            source_url=self.url(), verify_url="https://bitpin.ir/",
            raw={"price": row["price"]},
        )]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/tests/test_sources_proxy.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/sources/tetherland.py scripts/sources/nobitex.py scripts/sources/ramzinex.py scripts/sources/wallex.py scripts/sources/tabdeal.py scripts/sources/bitpin.py scripts/tests/test_sources_proxy.py
git commit -m "feat: USDT proxy sources (tetherland, nobitex, ramzinex, wallex, tabdeal, bitpin)"
```

---

### Task 5: Global FX source (USD/CAD)

**Files:**
- Modify: `scripts/sources/globalfx.py`
- Create: `scripts/tests/test_sources_globalfx.py`

**Interfaces:**
- Consumes: `Source`.
- Produces: `GlobalFx.parse(payload)` returning one `Record` with `kind="exact"`, `pair_from="USD"`, `pair_to="CAD"`, and `value` set to USD-per-CAD (`1 / rates["CAD"]`).

- [ ] **Step 1: Write the failing test**

`scripts/tests/test_sources_globalfx.py`:
```python
from sources.globalfx import GlobalFx


def test_globalfx_stores_usd_per_cad():
    p = {"result": "success", "rates": {"CAD": 1.4221}, "time_last_update_utc": "Wed, 14 Oct 2026 00:02:32 +0000"}
    r = GlobalFx().parse(p)[0]
    assert r.pair_from == "USD" and r.pair_to == "CAD"
    assert abs(r.value - (1 / 1.4221)) < 1e-9
    assert r.kind == "exact"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/tests/test_sources_globalfx.py -v`
Expected: FAIL with `NotImplementedError` or assertion error.

- [ ] **Step 3: Implement `scripts/sources/globalfx.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/tests/test_sources_globalfx.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sources/globalfx.py scripts/tests/test_sources_globalfx.py
git commit -m "feat: global USD/CAD source"
```

---

### Task 6: Derived values (mid, CAD estimate, enabled average)

**Files:**
- Create: `scripts/derive.py`, `scripts/tests/test_derive.py`

**Interfaces:**
- Consumes: `Record`, `Input` from Task 1.
- Produces:
  - `mid(rec: Record) -> int | None`
  - `cad_estimate(usd_rec: Record, fx_rec: Record) -> Record`
  - `enabled_average(records: list[Record], side: str) -> Record | None`

- [ ] **Step 1: Write the failing tests**

`scripts/tests/test_derive.py`:
```python
from model import Record
from derive import mid, cad_estimate, enabled_average


def test_mid_only_when_both_sides():
    assert mid(Record(source_id="x", kind="proxy", pair_from="USDT", pair_to="IRR",
                      buy_rial=100, sell_rial=200)) == 150
    assert mid(Record(source_id="x", kind="exact", pair_from="USD", pair_to="IRR",
                      price_rial=100, single_sided=True)) is None


def test_cad_estimate_formula_and_inputs():
    usd = Record(source_id="bonbast_archive", kind="exact", pair_from="USD", pair_to="IRR",
                 buy_rial=2604000, sell_rial=2606000)
    fx = Record(source_id="globalfx", kind="exact", pair_from="USD", pair_to="CAD", value=1 / 1.4221)
    est = cad_estimate(usd, fx)
    assert est.kind == "estimate"
    assert est.pair_from == "CAD" and est.pair_to == "IRR"
    assert abs(est.sell_rial - round(2606000 / (1 / 1.4221))) <= 1
    assert {i.source_id for i in est.inputs} == {"bonbast_archive", "globalfx"}
    assert est.formula


def test_enabled_average_uses_only_requested_side_and_flags_estimate():
    recs = [
        Record(source_id="a", kind="proxy", pair_from="USDT", pair_to="IRR", sell_rial=100),
        Record(source_id="b", kind="proxy", pair_from="USDT", pair_to="IRR", sell_rial=200),
        Record(source_id="c", kind="exact", pair_from="USD", pair_to="IRR", price_rial=999),
    ]
    avg = enabled_average(recs, "sell")
    assert avg.kind == "estimate"
    assert avg.sell_rial == 150
    assert {i.source_id for i in avg.inputs} == {"a", "b"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/tests/test_derive.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'derive'`.

- [ ] **Step 3: Implement `scripts/derive.py`**

```python
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
    inputs = [
        Input(source_id=usd_rec.source_id,
              value=usd_rec.sell_rial or usd_rec.price_rial,
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
        buy_rial=round(usd_rec.buy_rial / cad_per_usd) if usd_rec.buy_rial else None,
        sell_rial=round(usd_rec.sell_rial / cad_per_usd) if usd_rec.sell_rial else None,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/tests/test_derive.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/derive.py scripts/tests/test_derive.py
git commit -m "feat: derived mid, CAD estimate, and enabled average"
```

---

### Task 7: Storage (snapshot and index)

**Files:**
- Create: `scripts/store.py`, `scripts/tests/test_store.py`

**Interfaces:**
- Consumes: `Record.to_dict`, `registry.load_registry`.
- Produces:
  - `write_snapshot(data_dir: str, date: str, records: list[Record], generated_at: str) -> str`
  - `rebuild_index(data_dir: str, registry: dict, generated_at: str) -> dict`

- [ ] **Step 1: Write the failing tests**

`scripts/tests/test_store.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'store'`.

- [ ] **Step 3: Implement `scripts/store.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/tests/test_store.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/store.py scripts/tests/test_store.py
git commit -m "feat: snapshot and index storage"
```

---

### Task 8: Fetch orchestrator and CLI

**Files:**
- Create: `scripts/fetch.py`, `scripts/tests/test_fetch.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `run(date: str, data_dir: str, registry: dict, fetch_json: Callable[[str], object], now: str) -> list[Record]`
  - `main(argv) -> int` with flags `--date`, `--dry-run`, `--backfill`, `--data-dir`.

- [ ] **Step 1: Write the failing tests**

`scripts/tests/test_fetch.py`:
```python
import json
import os

from fetch import run

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/tests/test_fetch.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'fetch'`.

- [ ] **Step 3: Implement `scripts/fetch.py`**

```python
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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
            meta = next(s for s in registry["sources"] if s["source_id"] == source_id)
            records.append(Record(
                source_id=source_id, kind=meta["kind"],
                pair_from=meta["pair_from"].split(",")[0], pair_to=meta["pair_to"],
                status="error", error=f"{type(exc).__name__}: {exc}",
                source_url=src.url(), verify_url=meta["verify_url"],
            ))
            continue
        for rec in recs:
            if _is_suspect(data_dir, rec):
                rec.status = "suspect"
            records.append(rec)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/tests/test_fetch.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the whole Python test suite**

Run: `python -m pytest scripts/tests -v`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch.py scripts/tests/test_fetch.py
git commit -m "feat: fetch orchestrator with per-source isolation and CLI"
```

---

### Task 9: Site skeleton, data loading, and calculator

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/app.js`

**Interfaces:**
- Consumes: `data/index.json` and `data/snapshots/<date>.json`.
- Produces: a page with a working date-aware calculator and a "no data for this date" path.

- [ ] **Step 1: Create `site/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>exchange_rate</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <header>
    <h1>exchange_rate</h1>
    <p class="sub">Iran free-market rates. Sources kept separate. Exact, proxy, and estimate are always labeled.</p>
  </header>

  <section id="calculator" class="card">
    <h2>Converter</h2>
    <div class="calc-grid">
      <label>Date <select id="calc-date"></select></label>
      <label>From
        <select id="calc-from"><option>USD</option><option>CAD</option><option>IRR</option></select>
      </label>
      <label>To
        <select id="calc-to"><option>IRR</option><option>USD</option><option>CAD</option></select>
      </label>
      <label>Rate source <select id="calc-source"></select></label>
      <label>Rate side
        <select id="calc-side"><option value="sell">sell</option><option value="buy">buy</option><option value="mid">mid</option></select>
      </label>
      <label>Amount <input id="calc-amount" type="number" value="1"></label>
    </div>
    <p id="calc-result" class="calc-result">-</p>
    <p id="calc-provenance" class="provenance"></p>
  </section>

  <section id="tables" class="card"><h2>Sources</h2><div id="tables-body"></div></section>

  <section id="charts" class="card">
    <h2>History</h2>
    <div class="controls">
      <label><input type="checkbox" id="toggle-mid" checked> mid (buy+sell)/2</label>
      <label><input type="checkbox" id="toggle-avg" checked> average of enabled</label>
      <label>unit
        <select id="unit"><option value="toman">toman</option><option value="rial">rial</option></select>
      </label>
    </div>
    <div id="source-toggles"></div>
    <canvas id="main-chart" height="120"></canvas>
    <div id="per-source-charts"></div>
  </section>

  <div id="modal" class="modal hidden"><div class="modal-body"><button id="modal-close">close</button><div id="modal-content"></div></div></div>

  <script src="./vendor/chart.umd.min.js"></script>
  <script src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `site/style.css`**

```css
:root { --fg:#1a1a1a; --muted:#666; --line:#ddd; --est:#8a5a00; --proxy:#00548a; --exact:#136f2f; }
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; color: var(--fg); margin: 0 auto; max-width: 1100px; padding: 1rem; }
h1 { margin: 0; }
.sub { color: var(--muted); }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 1rem; margin: 1rem 0; }
.calc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .75rem; }
label { display: flex; flex-direction: column; font-size: .85rem; color: var(--muted); gap: .25rem; }
select, input { padding: .35rem; font-size: 1rem; }
.calc-result { font-size: 1.6rem; font-weight: 600; }
.provenance { color: var(--muted); font-size: .85rem; }
table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
th, td { border: 1px solid var(--line); padding: .35rem .5rem; text-align: right; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { text-align: left; }
.badge { font-size: .7rem; padding: .05rem .35rem; border-radius: 4px; color: #fff; cursor: help; }
.badge.exact { background: var(--exact); }
.badge.proxy { background: var(--proxy); }
.badge.estimate { background: var(--est); }
.controls { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; margin-bottom: .5rem; }
.controls label { flex-direction: row; align-items: center; color: var(--fg); }
#source-toggles { display: flex; gap: .75rem; flex-wrap: wrap; font-size: .85rem; margin-bottom: .5rem; }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; }
.modal.hidden { display: none; }
.modal-body { background: #fff; padding: 1rem; border-radius: 8px; max-width: 520px; }
.no-data { color: var(--est); font-weight: 600; }
```

- [ ] **Step 3: Implement `site/app.js` with the calculator and a no-data path**

```javascript
const UNIT = { toman: 10, rial: 1 }

let INDEX = null
let SNAPSHOT = null
let SNAPSHOTS = {}   // date -> snapshot (loaded lazily for charts)
let UNIT_DIVISOR = UNIT.toman

async function getJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}

function fmt(rial) {
  if (rial === null || rial === undefined) return "-"
  const v = rial / UNIT_DIVISOR
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function records() { return SNAPSHOT ? SNAPSHOT.records : [] }

function bySource(id) { return records().filter(r => r.source_id === id) }

function rateFor(pairFrom, pairTo, sourceId, side) {
  const recs = records()
  let rec
  if (sourceId === "estimate") {
    rec = recs.find(r => r.kind === "estimate" && r.pair_from === pairFrom && r.pair_to === pairTo)
    if (!rec) rec = recs.find(r => r.source_id === "cad_estimate" && pairFrom === "CAD" && pairTo === "IRR")
  } else if (sourceId === "average") {
    rec = recs.find(r => r.source_id === `average_${side}`)
  } else {
    rec = recs.find(r => r.source_id === sourceId && r.pair_from === pairFrom && r.pair_to === pairTo)
  }
  if (!rec) return null
  return { rec, value: pickSide(rec, side) }
}

function pickSide(rec, side) {
  if (rec.pair_to !== "IRR") {
    // global ratio pair, e.g. USD/CAD value
    return rec.value
  }
  if (side === "mid") {
    if (rec.buy_rial != null && rec.sell_rial != null) return (rec.buy_rial + rec.sell_rial) / 2
    return null
  }
  return side === "buy" ? rec.buy_rial : rec.sell_rial
}

function convert() {
  const date = document.getElementById("calc-date").value
  const from = document.getElementById("calc-from").value
  const to = document.getElementById("calc-to").value
  const sourceId = document.getElementById("calc-source").value
  const side = document.getElementById("calc-side").value
  const amount = parseFloat(document.getElementById("calc-amount").value || "0")
  const out = document.getElementById("calc-result")
  const prov = document.getElementById("calc-provenance")
  prov.textContent = ""

  if (!SNAPSHOT) { out.textContent = `no data for this date (${date})`; out.className = "calc-result no-data"; return }
  out.className = "calc-result"
  if (from === to) { out.textContent = String(amount); return }

  // resolve in IRR where possible
  const toIrr = (cur, amt) => {
    if (cur === "IRR") return amt
    const rr = rateFor(cur, "IRR", sourceId, side)
    if (!rr || rr.value == null) return null
    return amt * rr.value
  }
  let result = null
  if (to === "IRR") {
    result = toIrr(from, amount)
  } else if (from === "IRR") {
    const rr = rateFor(to, "IRR", sourceId, side)
    if (rr && rr.value) result = amount / rr.value
  } else {
    const a = toIrr(from, amount)
    const rr = rateFor(to, "IRR", sourceId, side)
    if (a != null && rr && rr.value) result = a / rr.value
  }
  if (result == null) { out.textContent = "no rate for that direction from this source"; out.className = "calc-result no-data"; return }
  out.textContent = `${amount} ${from} = ${result.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}`
}

function fillSelectors() {
  const dateSel = document.getElementById("calc-date")
  dateSel.innerHTML = (INDEX.dates || []).map(d => `<option>${d}</option>`).join("")
  dateSel.value = INDEX.latest || ""
  const srcSel = document.getElementById("calc-source")
  const opts = ['<option value="estimate">estimate (derived)</option>', '<option value="average">average of enabled</option>']
  for (const s of INDEX.sources) opts.push(`<option value="${s.source_id}">${s.label}</option>`)
  srcSel.innerHTML = opts.join("")
}

async function loadDate(date) {
  if (!date) { SNAPSHOT = null; return }
  if (!SNAPSHOTS[date]) {
    SNAPSHOTS[date] = await getJson(`./data/snapshots/${date}.json`)
  }
  SNAPSHOT = SNAPSHOTS[date]
}

async function boot() {
  INDEX = await getJson("./data/index.json")
  fillSelectors()
  document.getElementById("calc-date").addEventListener("change", async e => {
    await loadDate(e.target.value)
    convert()
    renderTables()
  })
  for (const id of ["calc-from", "calc-to", "calc-source", "calc-side", "calc-amount"]) {
    document.getElementById(id).addEventListener("input", convert)
  }
  await loadDate(INDEX.latest)
  convert()
  renderTables()
}

function renderTables() {
  const body = document.getElementById("tables-body")
  if (!SNAPSHOT) { body.innerHTML = `<p class="no-data">no data for this date</p>`; return }
  const rows = records().map(r => `
    <tr>
      <td>${r.source_id} <span class="badge ${r.kind}">${r.kind}</span></td>
      <td>${r.pair_from}/${r.pair_to}</td>
      <td>${fmt(r.buy_rial)}</td>
      <td>${fmt(r.sell_rial)}</td>
      <td>${fmt(r.price_rial)}</td>
      <td><a href="${r.verify_url}" target="_blank" rel="noopener">verify</a></td>
    </tr>`).join("")
  body.innerHTML = `<table><thead><tr><th>source</th><th>pair</th><th>buy</th><th>sell</th><th>price</th><th>link</th></tr></thead><tbody>${rows}</tbody></table>`
}

boot().catch(err => {
  document.getElementById("calc-result").textContent = "failed to load data: " + err.message
})
```

- [ ] **Step 4: Vendor Chart.js and place a sample snapshot to smoke test**

```bash
mkdir -p site/vendor
curl -sL https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js -o site/vendor/chart.umd.min.js
wc -c site/vendor/chart.umd.min.js
```

Then create a minimal `data/index.json` and one snapshot by hand (or run `python -m scripts.fetch --date 2026-10-13 --now "$(date -Iseconds)"` if network is available), then serve locally:

```bash
python3 -m http.server 8787 --directory . 
```

Open `http://localhost:8787/site/` and confirm: the converter shows a result for the latest date, switching date to a missing one shows "no data for this date", and the table lists each source with a badge and a verify link.

Note: if the preferred port is taken, use the next free one and report it.

- [ ] **Step 5: Commit**

```bash
git add site/index.html site/style.css site/app.js site/vendor/chart.umd.min.js
git commit -m "feat: site skeleton, data loading, and converter with no-data handling"
```

---

### Task 10: Tables, badges, and estimate popups

**Files:**
- Modify: `site/app.js`, `site/style.css`

**Interfaces:**
- Consumes: snapshot records including `formula` and `inputs`.
- Produces: per-source tables, a combined table with one column per source, clickable badges, and a modal that lists inputs and formula for estimates.

- [ ] **Step 1: Add the modal and badge rendering to `site/app.js`**

Replace `renderTables()` with the version below and add `showProvenance`, `badge`, and `renderCombinedTable`.

```javascript
function badge(r) {
  if (r.kind === "estimate") {
    return `<span class="badge estimate" data-prov='${escapeAttr(JSON.stringify({ formula: r.formula || "", inputs: r.inputs || [] }))}'>estimate</span>`
  }
  if (r.kind === "proxy") {
    return `<span class="badge proxy" title="USDT is used as a proxy for the cash US dollar">proxy</span>`
  }
  return `<span class="badge exact" title="Source publishes this pair directly">exact</span>`
}

function escapeAttr(s) { return s.replace(/'/g, "&#39;") }

function showProvenance(data) {
  const c = document.getElementById("modal-content")
  const rows = (data.inputs || []).map(i =>
    `<li>${i.source_id} <span class="badge ${i.kind}">${i.kind}</span> = ${i.value} <a href="${i.verify_url}" target="_blank" rel="noopener">verify</a></li>`).join("")
  c.innerHTML = `<p>${data.formula || ""}</p><ul>${rows}</ul>`
  document.getElementById("modal").classList.remove("hidden")
}

function pairLabel(r) {
  return `${r.pair_from}/${r.pair_to}`
}

function perSourceTables() {
  const ids = [...new Set(records().map(r => r.source_id))]
  return ids.map(id => {
    const rs = bySource(id)
    const rows = rs.map(r => `
      <tr>
        <td>${pairLabel(r)} ${badge(r)}</td>
        <td>${fmt(r.buy_rial)}</td><td>${fmt(r.sell_rial)}</td>
        <td>${fmt(r.price_rial)}</td><td>${r.status}</td>
        <td><a href="${r.source_url}" target="_blank" rel="noopener">source</a>
            &middot; <a href="${r.verify_url}" target="_blank" rel="noopener">verify</a></td>
      </tr>`).join("")
    return `<h3>${id}</h3>
      <table><thead><tr><th>pair</th><th>buy</th><th>sell</th><th>price</th><th>status</th><th>links</th></tr></thead>
      <tbody>${rows}</tbody></table>`
  }).join("")
}

function combinedTable() {
  const irr = records().filter(r => r.pair_to === "IRR" && r.pair_from !== "IRR")
  const bySourceMap = {}
  for (const r of irr) {
    const key = r.source_id
    bySourceMap[key] = bySourceMap[key] || {}
    bySourceMap[key][r.pair_from] = r
  }
  const cols = Object.keys(bySourceMap)
  const header = cols.map(c => `<th>${c}</th>`).join("")
  const pairs = ["USD", "USDT", "CAD"]
  const body = pairs.map(p => `<tr><td>${p}</td>` + cols.map(c => {
    const r = bySourceMap[c][p]
    if (!r) return `<td>-</td>`
    return `<td>buy ${fmt(r.buy_rial)} / sell ${fmt(r.sell_rial)} ${r.price_rial != null ? "price " + fmt(r.price_rial) : ""}</td>`
  }).join("") + `</tr>`).join("")
  return `<h3>All sources, side by side (never merged)</h3>
    <table><thead><tr><th>pair</th>${header}</tr></thead><tbody>${body}</tbody></table>`
}

function renderTables() {
  const body = document.getElementById("tables-body")
  if (!SNAPSHOT) { body.innerHTML = `<p class="no-data">no data for this date</p>`; return }
  body.innerHTML = combinedTable() + perSourceTables()
  body.querySelectorAll(".badge.estimate").forEach(el => {
    el.addEventListener("click", () => showProvenance(JSON.parse(el.dataset.prov)))
  })
}

document.getElementById("modal-close").addEventListener("click", () => {
  document.getElementById("modal").classList.add("hidden")
})
```

- [ ] **Step 2: Smoke test**

Serve and open the page. Confirm: the combined table puts each source in its own column, each badge shows a tooltip, and clicking an `estimate` badge opens a modal listing inputs and formula. Confirm a missing-side cell shows `-`, not `0`.

- [ ] **Step 3: Commit**

```bash
git add site/app.js site/style.css
git commit -m "feat: per-source and combined tables, badges, estimate provenance modal"
```

---

### Task 11: Charts with toggles

**Files:**
- Modify: `site/app.js`, `site/index.html`

**Interfaces:**
- Consumes: all snapshots referenced by `INDEX.dates`, Chart.js global `Chart`.
- Produces: a main multi-series chart (one line per source, toggleable), a mid toggle, an average toggle, and a per-source chart below.

- [ ] **Step 1: Load all snapshots for the chart**

Add to `site/app.js`:

```javascript
async function loadAllSnapshots() {
  for (const d of INDEX.dates) {
    if (!SNAPSHOTS[d]) SNAPSHOTS[d] = await getJson(`./data/snapshots/${d}.json`)
  }
}

function seriesFor(metric) {
  // metric: {sourceId, pair, side}
  return INDEX.dates.map(d => {
    const rec = (SNAPSHOTS[d].records || []).find(r =>
      r.source_id === metric.sourceId && r.pair_from === metric.pair && r.pair_to === "IRR")
    if (!rec) return null
    let v = pickSide(rec, metric.side)
    if (v == null) return null
    return v / UNIT_DIVISOR
  })
}
```

- [ ] **Step 2: Build the charts**

Add to `site/app.js`:

```javascript
const PALETTE = ["#00548a", "#136f2f", "#8a5a00", "#8a0050", "#005f5f", "#5a008a", "#7a2e00", "#2e6f7a", "#6f136f"]
let mainChart = null
let perSourceCharts = []

function enabledSourceIds() {
  return [...document.querySelectorAll("#source-toggles input:checked")].map(i => i.value)
}

function buildMainChart() {
  const ids = [...new Set(records().map(r => r.source_id))]
  const datasets = []
  ids.forEach((id, i) => {
    const pair = id === "bonbast_archive" || id === "nerkhsanj" ? "USD" : "USDT"
    const data = seriesFor({ sourceId: id, pair, side: "sell" })
    if (data.every(x => x == null)) return
    datasets.push({ label: `${id} sell`, data, borderColor: PALETTE[i % PALETTE.length], spanGaps: true, tension: .2 })
  })
  const avg = INDEX.dates.map((d, idx) => {
    const vals = enabledSourceIds().map(id => {
      const pair = id === "bonbast_archive" || id === "nerkhsanj" ? "USD" : "USDT"
      return seriesFor({ sourceId: id, pair, side: "sell" })[idx]
    }).filter(x => x != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })
  if (document.getElementById("toggle-avg").checked && avg.some(x => x != null)) {
    datasets.push({ label: "average (estimate)", data: avg, borderColor: "#000", borderDash: [6, 4], spanGaps: true })
  }
  const ctx = document.getElementById("main-chart")
  if (mainChart) mainChart.destroy()
  mainChart = new Chart(ctx, {
    type: "line",
    data: { labels: INDEX.dates, datasets },
    options: { responsive: true, interaction: { mode: "index", intersect: false } },
  })
}

function buildPerSourceCharts() {
  const host = document.getElementById("per-source-charts")
  host.innerHTML = ""
  perSourceCharts.forEach(c => c.destroy())
  perSourceCharts = []
  const ids = enabledSourceIds()
  ids.forEach((id, i) => {
    const wrap = document.createElement("div")
    const canvas = document.createElement("canvas")
    wrap.appendChild(document.createElement("h4")).textContent = id
    wrap.appendChild(canvas)
    host.appendChild(wrap)
    const pair = id === "bonbast_archive" || id === "nerkhsanj" ? "USD" : "USDT"
    const ds = [
      { label: "sell", data: seriesFor({ sourceId: id, pair, side: "sell" }), borderColor: "#c00", spanGaps: true },
      { label: "buy", data: seriesFor({ sourceId: id, pair, side: "buy" }), borderColor: "#00c", spanGaps: true },
    ]
    if (document.getElementById("toggle-mid").checked) {
      ds.push({ label: "mid", data: seriesFor({ sourceId: id, pair, side: "mid" }), borderColor: "#0a0", borderDash: [4, 4], spanGaps: true })
    }
    perSourceCharts.push(new Chart(canvas, { type: "line", data: { labels: INDEX.dates, datasets: ds }, options: { responsive: true } }))
  })
}

function buildSourceToggles() {
  const host = document.getElementById("source-toggles")
  const ids = INDEX.sources.map(s => s.source_id).filter(id => id !== "globalfx")
  host.innerHTML = ids.map(id => `<label><input type="checkbox" value="${id}" checked> ${id}</label>`).join("")
  host.querySelectorAll("input").forEach(i => i.addEventListener("change", () => { buildMainChart(); buildPerSourceCharts() }))
}

function rebuildCharts() { buildMainChart(); buildPerSourceCharts() }
```

- [ ] **Step 3: Wire it up and add unit toggle behavior**

In `boot()`, after `renderTables()`, add:

```javascript
  await loadAllSnapshots()
  buildSourceToggles()
  rebuildCharts()
  document.getElementById("toggle-mid").addEventListener("change", rebuildCharts)
  document.getElementById("toggle-avg").addEventListener("change", rebuildCharts)
  document.getElementById("unit").addEventListener("change", e => {
    UNIT_DIVISOR = UNIT[e.target.value]
    convert(); renderTables(); rebuildCharts()
  })
```

- [ ] **Step 4: Smoke test**

Serve and confirm: the main chart shows one line per source, each toggling off/on independently, the mid and average toggles work, each source gets its own chart below, and switching unit between toman and rial rescales the numbers.

- [ ] **Step 5: Commit**

```bash
git add site/app.js site/index.html
git commit -m "feat: multi-series and per-source charts with toggles"
```

---

### Task 12: GitHub Actions daily job, Pages, and repo creation

**Files:**
- Create: `.github/workflows/daily.yml`

**Interfaces:**
- Consumes: `scripts.fetch`, `site/`, `data/`.
- Produces: a scheduled workflow that fetches, commits data, builds `_site/`, and deploys Pages.

- [ ] **Step 1: Write `.github/workflows/daily.yml`**

```yaml
name: daily

on:
  schedule:
    - cron: "30 14 * * *"   # 18:00 Tehran (UTC+3:30)
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: daily
  cancel-in-progress: false

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r requirements.txt
      - name: Run tests
        run: python -m pytest scripts/tests -q
      - name: Fetch rates
        run: python -m scripts.fetch --date "$(TZ=Asia/Tehran date +%F)" --now "$(TZ=Asia/Tehran date -Iseconds)"
      - name: Commit data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data
          git diff --quiet --cached || git commit -m "data: snapshot $(TZ=Asia/Tehran date +%F)"
          git push
      - name: Assemble site
        run: |
          mkdir -p _site
          cp -r site/* _site/
          mkdir -p _site/data
          cp -r data/* _site/data/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
  deploy:
    needs: collect
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Create the repository and push**

```bash
cd /home/k1/public/exchange_rate
gh repo create exchange_rate --public --source=. --remote=origin --push
```

- [ ] **Step 3: Enable Pages to deploy from Actions**

```bash
gh api -X POST repos/k1monfared/exchange_rate/pages -f build_type=workflow || \
gh api -X PUT repos/k1monfared/exchange_rate/pages -f build_type=workflow
gh api repos/k1monfared/exchange_rate/pages --jq '.html_url'
```

If the account to use is not `k1monfared`, substitute the correct owner.

- [ ] **Step 4: Trigger the workflow and verify**

```bash
gh workflow run daily -R k1monfared/exchange_rate
sleep 20
gh run watch -R k1monfared/exchange_rate
```

Confirm on the run page that tests pass, a snapshot commit lands, and the Pages URL serves the site. Then open the Pages URL and confirm the calculator, tables, and charts render with the freshly fetched data.

- [ ] **Step 5: Commit the workflow**

```bash
git add .github/workflows/daily.yml
git commit -m "ci: daily fetch and Pages deploy workflow"
git push
```

---

### Task 13: README and data provenance notes

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the finished system.
- Produces: user-facing documentation of sources, labels, and limitations.

- [ ] **Step 1: Write `README.md`**

````markdown
# exchange_rate

Daily Iran **free-market** exchange rates for **USD/IRR** and **CAD/IRR**, with the implied **USD/CAD**. Static site, no server, updated once a day by GitHub Actions.

Live site: https://k1monfared.github.io/exchange_rate/

## What the labels mean

- **exact**: the source publishes that specific pair (cash USD/CAD).
- **proxy**: the source quotes USDT, which stands in for the cash dollar. Not the same instrument.
- **estimate**: computed by this project from other numbers. Click the badge to see the inputs and formula.

## Sources

| source | pair | label | verify |
|---|---|---|---|
| nerkhsanj | USD, CAD | exact | nerkh.jahankhahan.shop |
| bonbast_archive | USD, CAD | exact | bonbast.com |
| tetherland | USDT | proxy | tetherland.com |
| nobitex | USDT | proxy | nobitex.ir |
| ramzinex | USDT | proxy | ramzinex.com |
| wallex | USDT | proxy | wallex.ir |
| tabdeal | USDT | proxy | tabdeal.org |
| bitpin | USDT | proxy | bitpin.ir |
| globalfx | USD/CAD | exact | open.er-api.com |

Sources are always shown separately. Nothing merges them.

## Data

One JSON snapshot per day in `data/snapshots/`, plus `data/index.json`. Canonical unit is rial, display defaults to toman.

## Local development

```bash
pip install -r requirements.txt
python -m pytest scripts/tests -q
python -m scripts.fetch --date 2026-10-13 --now "$(date -Iseconds)"
python3 -m http.server 8787   # then open http://localhost:8787/site/
```

## Limitations

USDT proxies are not cash USD. The Bonbast archive lags about a day. Direct CAD buy/sell is thin, so the CAD estimate fills the gap and is labeled as an estimate. One snapshot per day captures a single moment, not a daily range.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with sources, labels, and limitations"
git push
```

---

## Self-Review

**Spec coverage**

- Repo/page named exchange_rate: Task 12 (repo), Task 9 (title), Task 13.
- Free keyless sources, nine of them: Tasks 3, 4, 5, 2.
- Separate columns and chart series, never merged: Tasks 10 (combined + per-source tables), 11 (per-series chart, per-source charts).
- Buy and sell; single-sided never fabricated: Tasks 3, 4, 6, 10.
- Exact/proxy/estimate labels: Tasks 1 (model), 10 (badges).
- Estimates with inputs and formula popup: Tasks 6, 10.
- Calculator, three directions, source selector: Task 9.
- Daily storage that accumulates: Tasks 7, 8.
- Verified source link per number: Tasks 1 (fields), 2 (registry), 10 (links).
- Toggles for sources and mid, plus averaging: Task 11.
- Toman default, rial toggle: Task 9, Task 11.
- Daily GitHub job and Pages: Task 12.
- No fabrication, per-source isolation, suspect band: Task 8.

**Placeholder scan:** no TBD or TODO. Every code step contains runnable code.

**Type consistency:** `Record` and `Input` fields are identical across Tasks 1, 6. `pickSide`, `seriesFor`, `loadAllSnapshots`, and `UNIT_DIVISOR` are defined once and reused. `write_snapshot` and `rebuild_index` signatures match between Tasks 7 and 8. Adapter `parse` signatures match the `Source` ABC in Task 2.

**Review Focus pinned:** items 1 and 2 to Task 8, item 3 to Tasks 6 and 10, item 4 to Task 9, item 5 to Task 6 and Task 10.

## Notes and known risks

- The Nerkhsanj live file can appear static and Bitpin's market can be suspended, so those sources may show flat or missing values on some days. The status field and the as-of date make this visible.
- `globalfx` uses open.er-api.com, a global reference, only as an input to the CAD estimate.
- If a source's payload shape changes, its adapter test fixture is the first place to update, then the adapter.
