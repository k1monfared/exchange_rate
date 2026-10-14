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

## Local development

The page fetches `./data/...`, which is a sibling of `site/` in the deploy layout, so serve the assembled layout rather than the repo root.

```bash
pip install -r requirements.txt
python -m pytest scripts/tests -q
python -m scripts.fetch --date "$(TZ=Asia/Tehran date +%F)" --now "$(TZ=Asia/Tehran date -Iseconds)"
# assemble the deploy layout (site/ and data/ as siblings under _site/), then serve it
rm -rf _site && mkdir -p _site/site _site/data
cp -r site/* _site/site/
cp -r data/* _site/data/
python3 -m http.server 8787 --directory _site   # open http://localhost:8787/site/
```

If port 8787 is busy, scan upward for a free port.

## Deployment

The workflow deploys Pages from GitHub Actions. On a brand-new repo the first run's `actions/configure-pages` step cannot create the Pages site with the default `GITHUB_TOKEN`, so Pages may need to be enabled once manually in the repo settings (Settings -> Pages -> Source: GitHub Actions) before the deploy job succeeds. After that it is unattended.

## Limitations

USDT proxies are not cash USD. The Bonbast archive lags about a day. Direct CAD buy/sell is thin, so the CAD estimate fills the gap and is labeled as an estimate. One snapshot per day captures a single moment, not a daily range.
