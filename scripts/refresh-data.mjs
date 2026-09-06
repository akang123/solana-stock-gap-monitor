import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const universePath = resolve(projectRoot, "data/stock-universe.json");
const outputPath = resolve(projectRoot, "site/data/markets.json");
const apiBase = (process.env.DEXSCREENER_API_BASE || "https://api.dexscreener.com").replace(/\/$/, "");
const marketApiBase = (process.env.MARKET_PRICE_API_BASE || "https://query1.finance.yahoo.com").replace(/\/$/, "");
const xstocksProductsUrl = process.env.XSTOCKS_PRODUCTS_URL || "https://xstocks.fi/products";
const solscanApiBase = (process.env.SOLSCAN_API_BASE || "https://pro-api.solscan.io/v2.0").replace(/\/$/, "");
const solscanApiKey = String(process.env.SOLSCAN_API_KEY || "").trim();
const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 12_000);
const maxAttempts = Number(process.env.FETCH_MAX_ATTEMPTS || 3);
const tokenBatchSize = Number(process.env.DEX_TOKEN_BATCH_SIZE || 25);
const marketPriceBatchSize = Number(process.env.MARKET_PRICE_BATCH_SIZE || 10);
const solscanBatchSize = Math.min(Math.max(Number(process.env.SOLSCAN_BATCH_SIZE || 50), 1), 50);

const sleep = (duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration));

function annotation(level, message) {
  const command = level === "error" ? "error" : "warning";
  console.log(`::${command}::${message}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fetchJson(url, requestOptions = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...requestOptions,
        headers: {
          accept: "application/json",
          "user-agent": "merkle-research-solana-stock-gap-monitor/1.0",
          ...(requestOptions.headers || {}),
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

async function fetchText(url, requestOptions = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...requestOptions,
        headers: {
          accept: "text/html",
          "user-agent": "merkle-research-solana-stock-gap-monitor/1.0",
          ...(requestOptions.headers || {}),
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
      return await response.text();
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

function parseSolscanDate(value) {
  const digits = String(value ?? "");
  if (!/^\d{8}$/.test(digits)) return null;
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

async function loadXstocksMetadata(universe) {
  try {
    const html = await fetchText(xstocksProductsUrl);
    const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error("xStocks products page did not include __NEXT_DATA__");
    const nextData = JSON.parse(match[1]);
    const products = nextData?.props?.pageProps?.products;
    if (!Array.isArray(products)) throw new Error("xStocks products page returned no product list");

    const productsBySymbol = new Map(products.map((product) => [String(product?.symbol || "").toUpperCase(), product]));
    const errors = [];
    const assets = universe.map((asset) => {
      const product = productsBySymbol.get(asset.tokenSymbol.toUpperCase());
      const tokenAddress = product?.addresses?.solana || asset.tokenAddress;
      if (!tokenAddress) {
        errors.push(`${asset.ticker}: xStocks has no Solana token address`);
        return asset;
      }
      if (!product) errors.push(`${asset.ticker}: ${asset.tokenSymbol} was not found on xStocks products`);
      if (product?.addresses?.solana && product.addresses.solana !== asset.tokenAddress) {
        console.log(`::warning::${asset.ticker}: refreshed Solana address from xStocks products`);
      }
      return {
        ...asset,
        tokenAddress,
        solscanUrl: `https://solscan.io/token/${tokenAddress}`,
      };
    });

    return { universe: assets, errors };
  } catch (error) {
    const message = `xStocks products lookup failed: ${error.message}`;
    annotation("warning", message);
    return {
      universe: universe.map((asset) => ({
        ...asset,
        solscanUrl: `https://solscan.io/token/${asset.tokenAddress}`,
      })),
      errors: [message],
    };
  }
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

async function loadSolscanPrices(universe) {
  const prices = new Map();
  const errors = [];
  if (!solscanApiKey) return { prices, errors, configured: false };

  for (let index = 0; index < universe.length; index += solscanBatchSize) {
    const batch = universe.slice(index, index + solscanBatchSize);
    const params = new URLSearchParams({ address: batch.map((asset) => asset.tokenAddress).join(",") });
    try {
      const payload = await fetchJson(`${solscanApiBase}/token/price/multi?${params.toString()}`, {
        headers: { token: solscanApiKey },
      });
      if (payload?.success === false) throw new Error(payload?.errors?.message || "Solscan API rejected the request");
      for (const result of payload?.data || []) {
        const tokenAddress = String(result?.token_address || "").toLowerCase();
        const latest = [...(result?.prices || [])].reverse().find((entry) => asNumber(entry?.price) > 0);
        if (!tokenAddress || !latest) continue;
        prices.set(tokenAddress, {
          price: asNumber(latest.price),
          asOf: parseSolscanDate(latest.date),
        });
      }
    } catch (error) {
      errors.push(`Solscan price batch ${index + 1}-${index + batch.length}: ${error.message}`);
    }
    await sleep(100);
  }

  return { prices, errors, configured: true };
}

async function loadOnchainPairs(universe) {
  const pairsByAddress = new Map();
  const errors = [];

  function addPairs(pairs) {
    for (const pair of pairs || []) {
      if (pair?.chainId !== "solana") continue;
      const address = String(pair?.baseToken?.address || "").toLowerCase();
      if (!address) continue;
      const existingPairs = pairsByAddress.get(address) || [];
      existingPairs.push(pair);
      pairsByAddress.set(address, existingPairs);
    }
  }

  for (let index = 0; index < universe.length; index += tokenBatchSize) {
    const batch = universe.slice(index, index + tokenBatchSize);
    const addresses = batch.map((asset) => asset.tokenAddress).filter(Boolean);
    if (!addresses.length) continue;

    try {
      const payload = await fetchJson(`${apiBase}/latest/dex/tokens/${addresses.join(",")}`);
      addPairs(payload?.pairs);
    } catch (error) {
      errors.push(`Onchain batch ${index + 1}-${index + batch.length}: ${error.message}`);
    }
    await sleep(100);
  }

  const unresolvedAssets = universe.filter((asset) => {
    const address = asset.tokenAddress.toLowerCase();
    return !choosePair(pairsByAddress.get(address) || [], asset);
  });

  for (const asset of unresolvedAssets) {
    try {
      const payload = await fetchJson(`${apiBase}/latest/dex/tokens/${encodeURIComponent(asset.tokenAddress)}`);
      addPairs(payload?.pairs);
      if (choosePair(pairsByAddress.get(asset.tokenAddress.toLowerCase()) || [], asset)) {
        console.log(`resolved ${asset.ticker} with individual Solana token lookup`);
      }
    } catch (error) {
      errors.push(`Onchain fallback ${asset.ticker}: ${error.message}`);
    }
    await sleep(100);
  }

  return { pairsByAddress, errors };
}

function resolveAsset(asset, pair, marketPrices, solscanPrices) {
  if (!pair) throw new Error(`no preferred Solana xStock pair found for ${asset.tokenSymbol}`);
  const quote = marketPrices.get(asset.marketSymbol);
  if (!quote) throw new Error(`no live market price found for ${asset.marketSymbol}`);
  if (quote.currency !== "USD") throw new Error(`market price for ${asset.marketSymbol} is quoted in ${quote.currency}, not USD`);

  const solscanQuote = solscanPrices.get(asset.tokenAddress.toLowerCase());
  const onchainPrice = solscanQuote?.price ?? asNumber(pair.priceUsd);
  const marketPrice = quote.price;
  if (onchainPrice === null) throw new Error(`pair for ${asset.tokenSymbol} has no USD price`);

  return {
    ticker: asset.ticker,
    marketSymbol: asset.marketSymbol,
    tokenSymbol: asset.tokenSymbol,
    tokenAddress: asset.tokenAddress,
    solscanUrl: asset.solscanUrl || `https://solscan.io/token/${asset.tokenAddress}`,
    company: asset.company,
    onchainPrice,
    onchainPriceAsOf: solscanQuote?.asOf || null,
    onchainSource: solscanQuote ? "Solscan Pro API" : "DexScreener fallback",
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

const configuredUniverse = await readJson(universePath);
const xstocksResult = await loadXstocksMetadata(configuredUniverse);
const universe = xstocksResult.universe;
const marketQuoteResult = await loadMarketPrices(universe);
const solscanResult = await loadSolscanPrices(universe);
const onchainResult = await loadOnchainPairs(universe);
const markets = [];
const errors = [...xstocksResult.errors, ...marketQuoteResult.errors, ...solscanResult.errors, ...onchainResult.errors];

for (const asset of universe) {
  try {
    const address = asset.tokenAddress.toLowerCase();
    const pair = choosePair(onchainResult.pairsByAddress.get(address) || [], asset);
    markets.push(resolveAsset(asset, pair, marketQuoteResult.prices, solscanResult.prices));
    console.log(`resolved ${asset.ticker} on Solana with ${solscanResult.prices.has(asset.tokenAddress.toLowerCase()) ? "Solscan" : "DexScreener fallback"} price`);
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
if (!solscanResult.configured) warnings.push("SOLSCAN_API_KEY is not configured; DexScreener fallback prices are active until the key is added.");
if (solscanResult.errors.length) warnings.push(`${solscanResult.errors.length} Solscan price request batches failed; affected markets used the DexScreener fallback.`);
if (onchainResult.errors.length) warnings.push(`${onchainResult.errors.length} on-chain request batches failed.`);
const solscanCovered = markets.filter((market) => market.onchainSource === "Solscan Pro API").length;

const snapshot = {
  schemaVersion: 2,
  generatedAt,
  network: "solana",
  source: {
    onchain: {
      name: solscanResult.configured ? "Solscan Pro API via xStocks Solana mints" : "Solscan Pro API pending API key",
      endpoint: `${solscanApiBase}/token/price/multi?address={tokenAddresses}`,
      publicPage: "https://solscan.io/token/{tokenAddress}",
      catalog: xstocksProductsUrl,
      policy: solscanResult.configured ? "Official API lookup using token addresses from xStocks products" : "DexScreener fallback until SOLSCAN_API_KEY is configured",
      fallback: `${apiBase}/latest/dex/tokens/{tokenAddresses}`,
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
    solscanPriceCovered: solscanCovered,
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
