# Merkle Research — Solana Stock Gap Monitor

A public, static monitor for tokenized public-equity markets on Solana. The UI keeps the quiet grayscale language of the Merkle Research projects while making source coverage, freshness, and failure states explicit.

## What it does

- Resolves configured Solana xStock pairs through the public DexScreener API.
- Calculates the current market spread against an internal benchmark feed without exposing benchmark prices in the public site data.
- Shows liquidity, 24-hour volume, 24-hour price change, coverage, and lookup errors.
- Refreshes hourly through GitHub Actions and supports manual workflow dispatch.
- Fails the workflow when the snapshot is empty, malformed, or older than the configured freshness window.
- Publishes the built `dist/` directory to GitHub Pages.

This project intentionally uses the API lookup surface rather than scraping DexScreener HTML. The API can still return partial coverage or rate-limit responses; those states are preserved in `site/data/markets.json` and surfaced in the monitor UI. Benchmark values are used internally for spread calculation but are intentionally omitted from the public JSON and UI.

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
| `REFERENCE_PRICE_URL` | No | JSON endpoint for live reference prices. Without it, the checked-in local snapshot is used. |
| `DEXSCREENER_API_BASE` | No | Override the API base URL for testing or a compatible proxy. |
| `FETCH_TIMEOUT_MS` | No | Per-request timeout; defaults to `12000`. |
| `FETCH_MAX_ATTEMPTS` | No | Maximum attempts per lookup; defaults to `3`. |
| `MAX_SNAPSHOT_AGE_HOURS` | No | Health-check freshness window; defaults to `26`. |

The reference endpoint should return either:

```json
{
  "asOf": "2026-09-01T12:00:00Z",
  "source": "Your reference provider",
  "prices": {
    "AAPL": 326.35,
    "TSLA": 355.74
  }
}
```

It may also return a plain ticker-to-price object. Add the endpoint as the repository secret `REFERENCE_PRICE_URL`; do not commit keys or private URLs.

## Data flow

1. `data/stock-universe.json` defines the monitored ticker, expected token symbol, and identity marker.
2. `scripts/refresh-data.mjs` queries `latest/dex/search` once per asset, filters to `chainId: solana`, and selects the highest-liquidity preferred xStock/Backpack/Backed match.
3. Reference prices come from `REFERENCE_PRICE_URL` when configured, otherwise `data/reference-prices.json`.
4. The normalized snapshot is written to `site/data/markets.json`.
5. `scripts/build.mjs` copies the static site to `dist/`.
6. `scripts/health-check.mjs` verifies freshness, network, coverage, and numeric price fields before deployment.

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

To add another asset, append an entry to `data/stock-universe.json` and add its reference ticker to the reference provider. To add a second onchain source, keep the normalized market shape (`onchainPrice`, `referencePrice`, `gapPct`, `liquidityUsd`, `volume24hUsd`, `pairUrl`) and include a new source adapter in `scripts/refresh-data.mjs`; do not mix provider-specific fields into the UI.
