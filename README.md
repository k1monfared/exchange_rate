# exchange_rate

Daily Iran **free-market** exchange rates for **USD/IRR** and **CAD/IRR**, with the implied **USD/CAD**. Static site, no server, updated once a day by GitHub Actions.

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

Sources are always shown separately. Nothing merges them.

## Data

One JSON snapshot per day in `data/snapshots/`, plus `data/index.json`. Canonical unit is rial, display defaults to toman.

`data/history.json` is a consolidated daily series for the chart, covering the sources that publish history:

- `bonbast_archive` (USD and CAD buy/sell), 2012 onward
- `cad_estimate` (CAD/IRR, derived from bonbast USD and the global USD/CAD), 2012 onward
- `wallex` USDT (price), for the window its API retains

## Backfill and archive

```bash
# write per-day snapshots for the last 7 days the archive covers, and refresh history.json
python -m scripts.fetch --backfill 7 --now "$(TZ=Asia/Tehran date -Iseconds)"

# build the full history.json from the bonbast and frankfurter archives
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
