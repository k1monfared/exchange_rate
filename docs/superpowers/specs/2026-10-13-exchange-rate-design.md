# exchange_rate: Iran FX free-market rate dashboard

Design spec. Date: 2026-10-13. Status: awaiting review.

## 1. Purpose

Publish a static website, **exchange_rate**, that tracks the Iran **free-market** (open market, "bazaar") exchange rates for **USD/IRR** and **CAD/IRR**, plus the implied **USD/CAD**. It exists so a person can look up what a dollar or a Canadian dollar is actually being bought and sold for in Iran on a given day, see where each number came from, and convert between USD, CAD, and IRR for a chosen date.

The central design rule, and the reason this project exists rather than a link list: **every number is tied to one named source, sources are never blended into a single opaque figure, and the reader can always tell whether a number was read directly, is a proxy, or is an estimate.**

### Success criteria

1. A visitor can pick any recorded date and convert between USD, CAD, and IRR in all three directions.
2. Every number displayed links to a source the visitor can open to verify it.
3. Sources appear as separate columns and separate chart series, never merged.
4. Values marked **proxy** or **estimate** are visibly distinguished from **exact** reads, and estimates show their inputs and formula on demand.
5. History accumulates daily, without a server, for free.
6. The daily job runs unattended on GitHub and never publishes a fabricated number.

## 2. Scope

### In scope

- Daily collection of the free, keyless Iran FX sources identified in research.
- Storage of one snapshot per day per source, accumulating history.
- A static dashboard with a conversion calculator, per-source tables, and per-source charts with toggles.
- GitHub Actions daily job and GitHub Pages deployment.

### Non-goals

- No user accounts, no server, no database service.
- No keyed or paid APIs in v1 (oanor, netarz, nerkh.io, EZRate, Bonbast paid API, IranMarketData).
- No trading, no order placement, no payment.
- No currencies beyond USD, CAD, IRR in v1. The model allows more later.
- No intraday history in v1. One value per source per day.

## 3. Sources and classification

Three classification values drive the labels on every number. This is the module that requires the most care, because conflating them defeats the purpose.

- **exact**: the source publishes the specific pair being shown (for example USD/IRR cash, or CAD/IRR). Shown with an `exact` badge.
- **proxy**: the source quotes something close but not identical, such as USDT/IRT standing in for the cash dollar. Shown with a `proxy (USDT)` badge.
- **estimate**: a value this project computes from other numbers. Shown with an `estimate` badge and an input-and-formula popup.

| source_id | provides | class | units | notes |
|---|---|---|---|---|
| `nerkhsanj` | USD price, CAD price | exact | toman | single-sided (one number per pair) |
| `bonbast_archive` | USD buy/sell, CAD buy/sell | exact | toman | daily granularity, one-day lag, from Bonbast |
| `tetherland` | USDT buy/sell | proxy | toman | USDT as USD proxy |
| `nobitex` | USDT bestBuy/bestSell | proxy | rial | USDT as USD proxy |
| `ramzinex` | USDT/IRR buy/sell | proxy | rial | USDT as USD proxy |
| `wallex` | USDT/TMN bid/ask | proxy | toman | USDT as USD proxy |
| `tabdeal` | USDT/IRT bid/ask | proxy | toman | USDT as USD proxy |
| `bitpin` | USDT/IRT buy/sell | proxy | toman | USDT as USD proxy |
| `globalfx` | USD to CAD | exact | ratio | global reference, not an Iran rate, input to the CAD estimate |

Two sources quote cash USD and CAD (Nerkhsanj, Bonbast archive). The crypto exchanges all quote USDT, which is a proxy for the cash dollar and is labeled as such everywhere it appears. `globalfx` is not an Iran rate, it is a global reference kept in its own source column and used only as an input to derived values.

### Per-source behavior rules

- **Two-sided source** (buy and sell both present): store and show buy and sell.
- **Single-sided source** (one number): store it as `price`, show it in a `price` column, and leave buy and sell blank. The missing side is never fabricated.
- **Failure**: a source that errors is recorded with `status: "error"` for that day. The run continues. No value is invented to fill the gap.
- **Sanity band**: a fetched value far outside the recent range (default: outside 0.3x to 2.5x of the last good value for that source) is stored with `status: "suspect"` and shown flagged, not silently trusted.

## 4. Data model

Canonical internal unit is **IRR (rial)**, stored as an integer number of rial. Display defaults to **toman** (rial divided by 10) with a toggle to rial.

A single fetched or derived value is one **Record**:

```
{
  "source_id": "nobitex",
  "class": "proxy",
  "pair_from": "USDT",
  "pair_to": "IRR",
  "buy_rial": 26009900,
  "sell_rial": 26010400,
  "price_rial": null,
  "single_sided": false,
  "as_of": "2026-10-13T14:30:00+03:30",
  "native": { "value": "2601040", "unit": "rial" },
  "source_url": "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls",
  "verify_url": "https://nobitex.ir/markets/usdt-rls",
  "status": "ok",
  "error": null,
  "raw": { }
}
```

A derived Record adds:

```
{
  "class": "estimate",
  "formula": "cad_per_irr = usd_per_irr / usd_per_cad",
  "inputs": [
    { "source_id": "bonbast_archive", "value": 2606000, "class": "exact", "verify_url": "..." },
    { "source_id": "globalfx", "value": 1.4221, "class": "exact", "verify_url": "..." }
  ]
}
```

A derived Record is never written as though it were read.

### Snapshot file

One file per day, `data/snapshots/YYYY-MM-DD.json`:

```
{
  "date": "2026-10-13",
  "generated_at": "2026-10-13T14:30:12+03:30",
  "records": [ Record, Record, ... ]
}
```

### Index file

`data/index.json`, regenerated after every run:

```
{
  "generated_at": "...",
  "dates": ["2026-10-11", "2026-10-12", "2026-10-13"],
  "latest": "2026-10-13",
  "sources": [ { "source_id": "...", "label": "...", "class": "...", "pair": "...", "verify_url": "..." } ]
}
```

### Registry file

`data/meta.json` holds the static source registry (id, human label, class, pair, provider name, and the human `verify_url`). This is authored by hand and is the single place labels and verification links are defined. The snapshot stores the exact `source_url` fetched and copies the registry `verify_url` so a stored number keeps its link even if the registry changes.

## 5. Estimates and provenance

v1 produces these derived values:

- **CAD/IRR estimate** = free-market USD/IRR divided by global USD/CAD. That is, $\text{IRR per CAD} = (\text{IRR per USD}) \div (\text{USD per CAD})$. Inputs: a chosen exact USD/IRR source and `globalfx`.
- **Mid** = $(\text{buy} + \text{sell}) / 2$, computed only where both sides exist, per source.
- **Enabled average** = the arithmetic mean of the chosen side across the sources the visitor has enabled. It is labeled an estimate and its popup lists exactly which sources fed it, with links.

Every derived value carries `class: "estimate"`, a `formula` string, and an `inputs` array where each input names its source, value, class, and verify link. The front end renders the badge and the popup from these fields, so provenance is data, not prose.

## 6. Front end

Static HTML, CSS, and JavaScript in `site/`, with a locally vendored copy of Chart.js (MIT). No build step beyond copying `site/` and `data/` together, no CDN dependency at runtime.

### Calculator (top of page)

- **Date picker**, populated from `index.json`.
- **From** and **To** each selectable among USD, CAD, IRR, giving all three directions.
- **Rate source selector**: any single source, or "estimate", or "average of enabled sources".
- **Buy / Sell / Mid** output for the chosen pair and direction, with the exact / proxy / estimate badge and the verify link inline.
- Conversions between IRR and USD/CAD use the same per-source buy and sell, so a conversion can be shown at the buy rate, the sell rate, or the mid.

### Tables

- **Per-source table**: one table per source, columns for pair, buy, sell, mid (when both sides exist), price (when single-sided), unit, as-of, and a verify link.
- **Combined table**: each source is its own column, so sources sit side by side and are never merged. Buy and sell are shown per source. This is the "separate columns" requirement made concrete.
- Any cell that is a proxy or an estimate is badged accordingly.

### Charts

- A main history chart with **one line per source series**, each independently toggleable.
- **Mid toggle**: overlays the $(sell+buy)/2$ per source where both sides exist.
- **Average toggle**: overlays the enabled-sources average, labeled estimate.
- A **separate chart per source** below the main one, so each source can be read in isolation.
- Series are keyed by `source_id`. No source is ever summed or merged into another series.

### Global controls

- Unit toggle: toman (default) or rial.
- Per-source on/off toggles.
- Buy and sell always distinct. Mid computed only when both exist.

### Badges and popups

Three badges: `exact`, `proxy (USDT)`, `estimate`. Clicking an `estimate` badge opens a modal listing each input (source, value, verify link) and the formula. Clicking a `proxy` badge explains briefly that USDT stands in for the cash dollar.

## 7. Daily job

`.github/workflows/daily.yml`:

- Trigger: `schedule` at `30 14 * * *` UTC, which is 18:00 Tehran (Iran is fixed at UTC+3:30, no daylight saving), plus `workflow_dispatch` for manual runs.
- Steps: checkout, set up Python 3.12, `pip install -r requirements.txt`, run `python scripts/fetch.py`, commit any changed `data/` files as `github-actions[bot]`, build `_site/` from `site/` plus `data/`, deploy with `actions/deploy-pages`.
- Idempotent: running twice on the same date overwrites that date's snapshot rather than duplicating it.
- `python scripts/fetch.py --backfill YYYY-MM-DD` fills a specific past date where a source supports history (for example the Bonbast archive).
- The job fails loudly (nonzero exit) only on structural failure. A single source erroring is recorded in the snapshot and does not fail the run.

## 8. Storage and history

- History is the sequence of `data/snapshots/*.json` files, one per date. Git history is the audit trail.
- `data/index.json` is the read model the browser loads first, small and fast.
- No binary database in v1. If query needs grow, a SQLite export can be added later without changing the site contract.

## 9. Verification links

Each source has a human-openable `verify_url` in `data/meta.json`, chosen so the visitor can see the number for themselves:

- `nerkhsanj`: the Nerkhsanj site.
- `bonbast_archive`: the Bonbast page for the relevant pair (USD, CAD graph).
- `tetherland`, `nobitex`, `ramzinex`, `wallex`, `tabdeal`, `bitpin`: the exchange's public market page for the USDT/IRT pair.
- `globalfx`: the open.er-api.com reference.

The snapshot also stores the exact `source_url` (the API call used), which the UI exposes in the number's detail, so a technical reader can reproduce the fetch.

## 10. Testing

- Adapter unit tests run against recorded JSON fixtures, no network in CI.
- Tests for `normalize` (unit conversion toman to rial and back, single-sided handling).
- Tests for `derive` (CAD estimate formula, mid computation, enabled average, and that provenance inputs are populated and correct).
- Tests for `store` (snapshot write, index rebuild, idempotent re-run for the same date).
- JSON schema validation on every snapshot before commit.
- `--dry-run` mode fetches live and writes to a temp directory, printing the would-be diff.

## 11. Failure handling and data integrity

- Per-source isolation: one failure never aborts the run and never blanks another source.
- No fabrication: missing sides, failed sources, and out-of-band values are recorded as such and shown as such.
- Provenance is mandatory: a derived value without complete `inputs` is a bug and fails validation.
- The site renders whatever is in `data/`, including gaps, so downtime is visible rather than hidden.

## 12. Repo layout

```
exchange_rate/
  .github/workflows/daily.yml
  scripts/
    fetch.py
    normalize.py
    derive.py
    store.py
    registry.py
    sources/
      base.py
      nerkhsanj.py  bonbast_archive.py  tetherland.py  nobitex.py
      ramzinex.py   wallex.py  tabdeal.py  bitpin.py  globalfx.py
    tests/
      fixtures/
      test_normalize.py  test_derive.py  test_store.py  test_sources.py
  data/
    meta.json
    index.json
    snapshots/YYYY-MM-DD.json
  site/
    index.html  app.js  style.css
    vendor/chart.umd.min.js
  requirements.txt
  README.md
  docs/superpowers/specs/2026-10-13-exchange-rate-design.md
```

## 13. Configuration and assumptions

- GitHub repo `exchange_rate` under the account that `gh` is authenticated as (`k1monfared` by default), **public** (Pages on the free plan requires public).
- Pages served from the `gh-pages` Actions deployment (source: GitHub Actions), so `main` keeps the source and `data/` stays browsable in the repo.
- Python 3.12, dependencies kept minimal (standard library plus an HTTP client, for example `requests` or `httpx`, and a test runner).
- Chart.js vendored locally.
- FOSS tooling only.

## 14. Known limitations

- Crypto exchange sources track USDT, not cash USD. They are proxies and are labeled as such.
- Bonbast archive is daily and lags by about one day. Nerkhsanj's live file can appear static. The dates and as-of timestamps are always shown so the reader is not misled about freshness.
- Direct live CAD buy/sell is thin. Only Nerkhsanj and the Bonbast archive publish it directly. The derived CAD estimate exists to cover the gap and is labeled an estimate.
- One snapshot per day captures a single intraday moment, not a daily range.
