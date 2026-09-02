import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const universePath = resolve(projectRoot, "data/stock-universe.json");
const outputPath = resolve(projectRoot, "site/data/markets.json");
const apiBase = (process.env.DEXSCREENER_API_BASE || "https://api.dexscreener.com").replace(/\/$/, "");
const marketApiBase = (process.env.MARKET_PRICE_API_BASE || "https://query1.finance.yahoo.com").replace(/\/$/, "");
const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 12_000);
const maxAttempts = Number(process.env.FETCH_MAX_ATTEMPTS || 3);
const tokenBatchSize = Number(process.env.DEX_TOKEN_BATCH_SIZE || 25);
const marketPriceBatchSize = Number(process.env.MARKET_PRICE_BATCH_SIZE || 10);

const sleep = (duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration));

function annotation(level, message) {
  const command = level === "error" ? "error" : "warning";
  console.log(`::${command}::${message}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "merkle-research-solana-stock-gap-monitor/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 429) {
        const retryAfter = Math.min(Number(response.headers.get("retry-after") || 1), 5);
        lastError = new Error("rate limited (HTTP 429)");
        if (attempt < maxAttempts) await sleep(retryAfter * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      lastError = error.name === "AbortError" ? new Error(`timeout after ${timeoutMs}ms`) : error;
      if (attempt < maxAttempts) await sleep(350 * attempt);
    }
  }
  throw lastError || new Error("request failed");
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPreferredPair(pair, asset) {
  if (pair?.chainId !== "solana") return false;
  if (asset.tokenAddress && String(pair?.baseToken?.address || "").toLowerCase() !== asset.tokenAddress.toLowerCase()) return false;
  const symbol = String(pair?.baseToken?.symbol || "").toUpperCase();
  if (symbol !== asset.tokenSymbol.toUpperCase()) return false;
  const name = String(pair?.baseToken?.name || "").toLowerCase();
  const company = asset.company.toLowerCase();
  const stockMarker = /xstock|backpack securities|backed|tokenized/.test(name);
  const identityMarker = name.includes(company) || (asset.ticker === "MSTR" && name.includes("strategy"));
  return stockMarker && identityMarker;
}

function choosePair(pairs, asset) {
  const candidates = pairs.filter((pair) => isPreferredPair(pair, asset));
  candidates.sort((left, right) => (asNumber(right?.liquidity?.usd) || 0) - (asNumber(left?.liquidity?.usd) || 0));
  return candidates[0] || null;
}

async function loadMarketPrices(universe) {
  const prices = new Map();
  const errors = [];
  const assets = [...new Map(universe.map((asset) => [asset.marketSymbol, asset])).values()];

  for (let index = 0; index < assets.length; index += marketPriceBatchSize) {
    const batch = assets.slice(index, index + marketPriceBatchSize);
    const params = new URLSearchParams({
      symbols: batch.map((asset) => asset.marketSymbol).join(","),
      range: "1d",
      interval: "1d",
    });

    try {
      const payload = await fetchJson(`${marketApiBase}/v7/finance/spark?${params.toString()}`);
      for (const result of payload?.spark?.result || []) {
        const response = result?.response?.[0];
        const meta = response?.meta || {};
        const price = asNumber(meta.regularMarketPrice) ?? asNumber(response?.indicators?.quote?.[0]?.close?.at(-1));
        if (price === null || price <= 0) continue;
        const timestamp = asNumber(meta.regularMarketTime) ?? asNumber(response?.timestamp?.at(-1));
        prices.set(result.symbol, {
          price,
          asOf: timestamp ? new Date(timestamp * 1000).toISOString() : null,
          currency: meta.currency || "USD",
          exchange: meta.fullExchangeName || meta.exchangeName || null,
        });
      }
    } catch (error) {
      errors.push(`Market price batch ${index + 1}-${index + batch.length}: ${error.message}`);
    }
    await sleep(100);
  }

  return { prices, errors };
}

async function loadOnchainPairs(universe) {
  const pairsByAddress = new Map();
  const errors = [];

  for (let index = 0; index < universe.length; index += tokenBatchSize) {
    const batch = universe.slice(index, index + tokenBatchSize);
    const addresses = batch.map((asset) => asset.tokenAddress).filter(Boolean);
    if (!addresses.length) continue;

    try {
      const payload = await fetchJson(`${apiBase}/latest/dex/tokens/${addresses.join(",")}`);
      for (const pair of payload?.pairs || []) {
        if (pair?.chainId !== "solana") continue;
        const address = String(pair?.baseToken?.address || "").toLowerCase();
        if (!address) continue;
        const pairs = pairsByAddress.get(address) || [];
        pairs.push(pair);
        pairsByAddress.set(address, pairs);
      }
    } catch (error) {
      errors.push(`Onchain batch ${index + 1}-${index + batch.length}: ${error.message}`);
    }
    await sleep(100);
  }

  return { pairsByAddress, errors };
}

function resolveAsset(asset, pair, marketPrices) {
  if (!pair) throw new Error(`no preferred Solana xStock pair found for ${asset.tokenSymbol}`);
  const quote = marketPrices.get(asset.marketSymbol);
  if (!quote) throw new Error(`no live market price found for ${asset.marketSymbol}`);
  if (quote.currency !== "USD") throw new Error(`market price for ${asset.marketSymbol} is quoted in ${quote.currency}, not USD`);

  const onchainPrice = asNumber(pair.priceUsd);
  const marketPrice = quote.price;
  if (onchainPrice === null) throw new Error(`pair for ${asset.tokenSymbol} has no USD price`);

  return {
    ticker: asset.ticker,
    marketSymbol: asset.marketSymbol,
    tokenSymbol: asset.tokenSymbol,
    tokenAddress: asset.tokenAddress,
    company: asset.company,
    onchainPrice,
    marketPrice,
    marketPriceAsOf: quote.asOf,
    marketPriceCurrency: quote.currency,
    marketPriceSource: "Yahoo Finance",
    marketPriceExchange: quote.exchange,
    gapPct: ((onchainPrice - marketPrice) / marketPrice) * 100,
    liquidityUsd: asNumber(pair.liquidity?.usd) || 0,
    volume24hUsd: asNumber(pair.volume?.h24) || 0,
    priceChange24hPct: asNumber(pair.priceChange?.h24) || 0,
    pairAddress: pair.pairAddress || null,
    pairUrl: pair.url || `https://dexscreener.com/solana/${pair.pairAddress}`,
    marketPriceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(asset.marketSymbol)}`,
    dexId: pair.dexId || "Solana DEX",
    quoteTokenSymbol: pair.quoteToken?.symbol || null,
    baseTokenName: pair.baseToken?.name || asset.company,
    status: "live",
  };
}

const universe = await readJson(universePath);
const marketQuoteResult = await loadMarketPrices(universe);
const onchainResult = await loadOnchainPairs(universe);
const markets = [];
const errors = [...marketQuoteResult.errors, ...onchainResult.errors];

for (const asset of universe) {
  try {
    const address = asset.tokenAddress.toLowerCase();
    const pair = choosePair(onchainResult.pairsByAddress.get(address) || [], asset);
    markets.push(resolveAsset(asset, pair, marketQuoteResult.prices));
    console.log(`resolved ${asset.ticker} on Solana with live market price`);
  } catch (error) {
    const message = `${asset.ticker}: ${error.message}`;
    errors.push({ ticker: asset.ticker, message });
    annotation("warning", message);
  }
}

const generatedAt = new Date().toISOString();
const warnings = [];
if (markets.length < universe.length) warnings.push(`Only ${markets.length} of ${universe.length} configured Solana equity markets resolved; coverage is partial.`);
if (marketQuoteResult.errors.length) warnings.push(`${marketQuoteResult.errors.length} live market-price request batches failed.`);
if (onchainResult.errors.length) warnings.push(`${onchainResult.errors.length} on-chain request batches failed.`);

const snapshot = {
  schemaVersion: 2,
  generatedAt,
  network: "solana",
  source: {
    onchain: {
      name: "DexScreener public API",
      endpoint: `${apiBase}/latest/dex/tokens/{tokenAddresses}`,
      policy: "API lookup only; no HTML scraping",
    },
    market: {
      name: "Yahoo Finance public chart endpoint",
      endpoint: `${marketApiBase}/v7/finance/spark?symbols={marketSymbols}`,
      policy: "Public quote snapshot; no API key or local fallback",
    },
  },
  universe: {
    total: universe.length,
    covered: markets.length,
    missing: universe.length - markets.length,
    marketPriceCovered: markets.length,
  },
  status: markets.length === 0 ? "failed" : markets.length < universe.length ? "partial" : "ok",
  warnings,
  errors: errors.length > 50 ? [...errors.slice(0, 50), { ticker: "SYSTEM", message: `${errors.length - 50} additional refresh errors omitted from the public snapshot.` }] : errors,
  markets: markets.sort((left, right) => right.gapPct - left.gapPct),
};

if (markets.length === 0) {
  annotation("error", "No markets resolved; keeping the previous snapshot and failing refresh.");
  process.exitCode = 1;
} else {
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`wrote ${markets.length}/${universe.length} markets to ${outputPath}`);
}
