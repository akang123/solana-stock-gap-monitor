# Merkle Research — Solana Stock Gap Monitor

A public, static monitor for tokenized public-equity markets on Solana. The UI keeps the quiet grayscale language of the Merkle Research projects while making source coverage, freshness, and failure states explicit.

## What it does

- Resolves xStocks addresses from the xStocks products catalog and tracks additional Sunrise-listed Backpack Securities markets by verified Solana mint.
- Uses Solscan Pro API prices when `SOLSCAN_API_KEY` is configured, with an explicit DexScreener fallback until then.
- Calculates the current market spread against a live USD stock-market quote from Yahoo Finance.
- Shows liquidity, 24-hour volume, 24-hour price change, coverage, and lookup errors.
- Refreshes hourly through GitHub Actions and supports manual workflow dispatch.
- Fails the workflow when the snapshot is empty, malformed, or older than the configured freshness window.
- Publishes the built `dist/` directory to GitHub Pages.

This project intentionally uses API lookup surfaces rather than scraping DexScreener HTML. The APIs can still return partial coverage or rate-limit responses; those states are preserved in `site/data/markets.json` and surfaced in the monitor UI. The tracked universe combines active Solana tokenized equities and equity ETFs from xStocks and Sunrise, with USD quotes and a matching live Solana pool.

## Local setup

Requires Node.js 20 or newer.

```bash
npm run refresh
npm run build
npm run check
python3 -m http.server 4173 --directory dist
```

Open `http://127.0.0.1:4173` after the build. The browser refresh button re-reads the latest static JSON snapshot; it does not bypass the scheduled pipeline.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DEXSCREENER_API_BASE` | No | Override the API base URL for testing or a compatible proxy. |
| `MARKET_PRICE_API_BASE` | No | Override the Yahoo Finance-compatible market-price API base URL. |
| `XSTOCKS_PRODUCTS_URL` | No | xStocks products catalog used to resolve current Solana mint addresses. |
| `SOLSCAN_API_KEY` | No | Solscan Pro API key; enables the official onchain price feed. |
| `SOLSCAN_API_BASE` | No | Override the Solscan Pro API base URL. |
| `SOLSCAN_BATCH_SIZE` | No | Solscan token addresses per request; capped at `50`. |
| `FETCH_TIMEOUT_MS` | No | Per-request timeout; defaults to `12000`. |
| `FETCH_MAX_ATTEMPTS` | No | Maximum attempts per lookup; defaults to `3`. |
| `DEX_TOKEN_BATCH_SIZE` | No | Solana token addresses per DexScreener request; defaults to `25`. |
| `MARKET_PRICE_BATCH_SIZE` | No | Stock symbols per market-price request; defaults to `10`. |
| `MAX_SNAPSHOT_AGE_HOURS` | No | Health-check freshness window; defaults to `26`. |

## Data flow

1. `data/stock-universe.json` defines xStocks tickers, symbols, Solana token addresses, and stock-market symbols; `data/sunrise-universe.json` holds the Sunrise-listed additions.
2. `scripts/refresh-data.mjs` refreshes xStocks addresses from `xstocks.fi/products`, preserves the independently verified Sunrise mints, and links both groups to Solscan.
3. When `SOLSCAN_API_KEY` exists, the refresh requests current token prices from Solscan's multi-token endpoint; otherwise it uses the explicit DexScreener fallback.
4. The same refresh requests live USD quotes from Yahoo Finance's public chart endpoint in batches; there is no local reference-price fallback.
5. The normalized snapshot is written to `site/data/markets.json`.
6. `scripts/build.mjs` copies the static site to `dist/`.
7. `scripts/health-check.mjs` verifies freshness, network, coverage, live market prices, and numeric price fields before deployment.

## Monitoring behavior

- A single missing asset produces a warning and a partial snapshot, so the monitor can remain useful.
- A fully failed refresh leaves the previous snapshot in place and fails the workflow.
- A snapshot with zero covered markets, invalid fields, or age beyond the freshness window fails the health check.
- GitHub Actions annotations mark partial coverage and individual lookup failures in the workflow UI.

## GitHub Pages

After the repository is created, enable GitHub Pages with **GitHub Actions** as the source. The workflow handles the build and deployment. The public URL will be available in the workflow's `github-pages` environment after the first successful run.

## Custom domain

The site is configured for `solanastockgapmonitor.site`.

1. At the domain registrar, remove the parking records for the apex (`@`) host.
2. Add these four A records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`.
3. Optionally add a CNAME for `www` pointing to `akang123.github.io`.
4. In the repository's **Settings → Pages**, set `solanastockgapmonitor.site` as the custom domain and keep **Enforce HTTPS** enabled once the certificate becomes available.
5. Allow DNS propagation, then re-run the refresh-and-deploy workflow if the custom hostname does not update automatically.

The repository includes `docs/custom-domain.md` as a copyable checklist. Do not add a CNAME at `@`; apex domains use the four A records above.

## Extending the sources

To add another asset, append a verified xStocks entry to `data/stock-universe.json` or a verified Sunrise-listed entry to `data/sunrise-universe.json`, with its Solana mint, token symbol, company identity, and Yahoo Finance market symbol. Keep the normalized market shape (`onchainPrice`, `marketPrice`, `marketPriceAsOf`, `gapPct`, `liquidityUsd`, `volume24hUsd`, `pairUrl`) and do not mix provider-specific fields into the UI.
