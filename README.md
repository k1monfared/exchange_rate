# exchange_rate

Daily Iran **free-market** exchange rates for **USD/IRR** and **CAD/IRR**, plus **USD/CAD** from Canadian banks (Bank of Canada, TD, Tangerine). Static site, no server, updated once a day by GitHub Actions.

Live site: https://k1monfared.com/exchange_rate/

The site is served at the account's custom GitHub Pages domain. The `k1monfared.github.io/exchange_rate/` URL redirects to `https://k1monfared.com/exchange_rate/`.

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
| boc | USD/CAD | exact | bankofcanada.ca (official daily average) |
| td | USD/CAD | exact | td.com currency converter (non-cash, smallest tier) |
| tangerine | USD/CAD | exact | tangerine.ca/en/rates/exchange-rates |

Sources are always shown separately. Nothing merges them.

### USD/CAD from Canadian banks

All three are stored as CAD per 1 USD in each record's `native` (`cad_buy`, `cad_sell`, `cad_mid`), and `value` is USD per CAD, the same convention as `globalfx`. Sides follow the rest of the project: **buy** is what the bank pays you for 1 USD, **sell** is what it charges you.

- **boc**: [Bank of Canada Valet API](https://www.bankofcanada.ca/valet/docs), series `FXUSDCAD`. One official rate per business day, published the next day, so it lags about a day. This is the reference the converter uses for USD/CAD in "estimate" mode, falling back to `globalfx`.
- **td**: the JSON behind TD's public currency converter (`ix0.apps.td.com/api/fxcal/non-cash-gfx-rates/en`). Non-cash rates (transfers between accounts), smallest amount tier (under US$1,000). Larger amounts get slightly better rates.
- **tangerine**: the JSON Tangerine's rates page loads (`currentRates.json`). Tangerine labels sides from the customer's view, so they are swapped on ingest.

The TD and Tangerine feeds are undocumented endpoints behind public pages, so they can change without notice. A parse that fails or returns an implausible rate (outside 0.8 to 2.5 CAD per USD, or buy above sell) is stored as an error for that day and never as a value. RBC was considered and left out: its calculator needs a session token behind bot protection, too fragile for an unattended job.

## Data

One JSON snapshot per day in `data/snapshots/`, plus `data/index.json`. Canonical unit is rial, display defaults to toman.

`data/history.json` is a consolidated daily series for the chart, covering the sources that publish history:

- `bonbast_archive` (USD and CAD buy/sell), 2012 onward
- `cad_estimate` (CAD/IRR, derived from bonbast USD and the global USD/CAD), 2012 onward
- `wallex` USDT (price), for the window its API retains
- `boc` USD/CAD (CAD per USD, single rate), 2017 onward
- `td`, `tangerine` USD/CAD buy/sell, from the day they were added (these banks publish no history)

USD/CAD series have `pair_to: "CAD"` and points `[buy, sell, mid]` in CAD per USD. The chart only plots rial series.

## Backfill and archive

```bash
# write per-day snapshots for the last 7 days the archive covers, and refresh history.json
python -m scripts.fetch --backfill 7 --now "$(TZ=Asia/Tehran date -Iseconds)"

# build the full history.json from the bonbast, frankfurter and Bank of Canada archives
python -m scripts.fetch --archive --now "$(TZ=Asia/Tehran date -Iseconds)"
```

Backfilled snapshots contain only the history-capable sources (bonbast USD/CAD, the CAD estimate, and Wallex where available); the other sources have no per-day history and are simply absent for those days, never fabricated. The daily job also merges each day's records into `history.json`.

## Local development

The page fetches `./data/...`, relative to the document root, so serve the assembled deploy layout (`site/` copied to the root of `_site/` and `data/` under `_site/data/`) rather than the repo root.

```bash
pip install -r requirements.txt
python -m pytest scripts/tests -q
python -m scripts.fetch --date "$(TZ=Asia/Tehran date +%F)" --now "$(TZ=Asia/Tehran date -Iseconds)"
# assemble the deploy layout: site/* at the root and data/* under data/, then serve _site
rm -rf _site && mkdir -p _site/data
cp -r site/* _site/
cp -r data/* _site/data/
python3 -m http.server 8787 --directory _site   # open http://localhost:8787/  (scan upward if 8787 is busy)
```

If port 8787 is busy, scan upward for a free port. Smoke check that the data is reachable:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/data/index.json   # prints 200
```

## Deployment

The workflow deploys Pages from GitHub Actions. On a brand-new repo the first run's `actions/configure-pages` step cannot create the Pages site with the default `GITHUB_TOKEN`, so Pages may need to be enabled once manually in the repo settings (Settings -> Pages -> Source: GitHub Actions) before the deploy job succeeds. After that it is unattended.

## Limitations

USDT proxies are not cash USD. The Bonbast archive lags about a day. Direct CAD buy/sell is thin, so the CAD estimate fills the gap and is labeled as an estimate. One snapshot per day captures a single moment, not a daily range.
