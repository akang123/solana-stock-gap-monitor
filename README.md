# Merkle Research — Solana Stock Gap Monitor

A public, static monitor for tokenized public-equity markets on Solana. The UI keeps the quiet grayscale language of the Merkle Research projects while making source coverage, freshness, and failure states explicit.

## What it does

- Resolves configured Solana xStock pairs through the public DexScreener API.
- Calculates the current market spread against a live USD stock-market quote from Yahoo Finance.
- Shows liquidity, 24-hour volume, 24-hour price change, coverage, and lookup errors.
- Refreshes hourly through GitHub Actions and supports manual workflow dispatch.
- Fails the workflow when the snapshot is empty, malformed, or older than the configured freshness window.
- Publishes the built `dist/` directory to GitHub Pages.

This project intentionally uses API lookup surfaces rather than scraping DexScreener HTML. The APIs can still return partial coverage or rate-limit responses; those states are preserved in `site/data/markets.json` and surfaced in the monitor UI. The tracked universe is a curated snapshot of currently active Solana xStock equities, excluding ETFs, symbols without a USD quote, and catalog entries without a live Solana pool.

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
| `FETCH_TIMEOUT_MS` | No | Per-request timeout; defaults to `12000`. |
| `FETCH_MAX_ATTEMPTS` | No | Maximum attempts per lookup; defaults to `3`. |
| `DEX_TOKEN_BATCH_SIZE` | No | Solana token addresses per DexScreener request; defaults to `25`. |
| `MARKET_PRICE_BATCH_SIZE` | No | Stock symbols per market-price request; defaults to `10`. |
| `MAX_SNAPSHOT_AGE_HOURS` | No | Health-check freshness window; defaults to `26`. |

## Data flow

1. `data/stock-universe.json` defines the monitored ticker, xStock symbol, Solana token address, and stock-market symbol.
2. `scripts/refresh-data.mjs` queries DexScreener's token endpoint in batches, filters to `chainId: solana`, and selects the highest-liquidity preferred xStock/Backpack/Backed match.
3. The same refresh requests live USD quotes from Yahoo Finance's public chart endpoint in batches; there is no local reference-price fallback.
4. The normalized snapshot is written to `site/data/markets.json`.
5. `scripts/build.mjs` copies the static site to `dist/`.
6. `scripts/health-check.mjs` verifies freshness, network, coverage, live market prices, and numeric price fields before deployment.

## Monitoring behavior

- A single missing asset produces a warning and a partial snapshot, so the monitor can remain useful.
- A fully failed refresh leaves the previous snapshot in place and fails the workflow.
- A snapshot with zero covered markets, invalid fields, or age beyond the freshness window fails the health check.
- GitHub Actions annotations mark partial coverage and individual lookup failures in the workflow UI.

## Extending the sources

To add another asset, append a verified Solana xStock entry to `data/stock-universe.json` with its token address and market symbol. Keep the normalized market shape (`onchainPrice`, `marketPrice`, `marketPriceAsOf`, `gapPct`, `liquidityUsd`, `volume24hUsd`, `pairUrl`) and do not mix provider-specific fields into the UI.
