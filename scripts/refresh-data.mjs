import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const universePath = resolve(projectRoot, "data/stock-universe.json");
const referencePath = resolve(projectRoot, "data/reference-prices.json");
const outputPath = resolve(projectRoot, "site/data/markets.json");
const apiBase = (process.env.DEXSCREENER_API_BASE || "https://api.dexscreener.com").replace(/\/$/, "");
const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 12_000);
const maxAttempts = Number(process.env.FETCH_MAX_ATTEMPTS || 3);

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
        lastError = new Error(`rate limited (HTTP 429)`);
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

async function loadReferencePrices() {
  const local = await readJson(referencePath);
  if (!process.env.REFERENCE_PRICE_URL) {
    return { ...local, source: local.source || "Local reference snapshot", remote: false, warning: "Reference prices are using the checked-in local snapshot; set REFERENCE_PRICE_URL for a live reference feed." };
  }

  try {
    const remote = await fetchJson(process.env.REFERENCE_PRICE_URL);
    const prices = remote.prices || remote.data?.prices || remote.data || remote;
    if (!prices || typeof prices !== "object") throw new Error("response did not contain a prices object");
    return {
      asOf: remote.asOf || remote.updatedAt || new Date().toISOString(),
      source: remote.source || "Configured reference feed",
      prices,
      remote: true,
    };
  } catch (error) {
    return { ...local, source: local.source || "Local reference snapshot", remote: false, warning: `Reference feed unavailable: ${error.message}; local snapshot retained.` };
  }
}

async function resolveAsset(asset, reference) {
  const query = encodeURIComponent(asset.discoveryQuery || asset.tokenSymbol);
  const payload = await fetchJson(`${apiBase}/latest/dex/search?q=${query}`);
  const pair = choosePair(Array.isArray(payload.pairs) ? payload.pairs : [], asset);
  if (!pair) throw new Error(`no preferred Solana xStock pair found for ${asset.tokenSymbol}`);

  const onchainPrice = asNumber(pair.priceUsd);
  const referencePrice = asNumber(reference.prices?.[asset.ticker]);
  if (onchainPrice === null) throw new Error(`pair for ${asset.tokenSymbol} has no USD price`);
  if (referencePrice === null || referencePrice <= 0) throw new Error(`no positive reference price configured for ${asset.ticker}`);

  return {
    ticker: asset.ticker,
    tokenSymbol: asset.tokenSymbol,
    company: asset.company,
    onchainPrice,
    referencePrice,
    gapPct: ((onchainPrice - referencePrice) / referencePrice) * 100,
    liquidityUsd: asNumber(pair.liquidity?.usd) || 0,
    volume24hUsd: asNumber(pair.volume?.h24) || 0,
    priceChange24hPct: asNumber(pair.priceChange?.h24) || 0,
    pairAddress: pair.pairAddress || null,
    pairUrl: pair.url || `https://dexscreener.com/solana/${pair.pairAddress}`,
    dexId: pair.dexId || "Solana DEX",
    quoteTokenSymbol: pair.quoteToken?.symbol || null,
    baseTokenName: pair.baseToken?.name || asset.company,
    status: "live",
  };
}

const universe = await readJson(universePath);
const reference = await loadReferencePrices();
const markets = [];
const errors = [];

for (const asset of universe) {
  try {
    markets.push(await resolveAsset(asset, reference));
    console.log(`resolved ${asset.ticker} on Solana`);
  } catch (error) {
    const message = `${asset.ticker}: ${error.message}`;
    errors.push({ ticker: asset.ticker, message });
    annotation("warning", message);
  }
  await sleep(150);
}

const generatedAt = new Date().toISOString();
const warnings = [];
if (reference.warning) warnings.push(reference.warning);
if (markets.length < universe.length) warnings.push(`Only ${markets.length} of ${universe.length} configured Solana markets resolved; coverage is partial.`);

const snapshot = {
  schemaVersion: 1,
  generatedAt,
  network: "solana",
  source: {
    name: "DexScreener public API",
    endpoint: `${apiBase}/latest/dex/search?q={tokenSymbol}`,
    policy: "API lookup only; no HTML scraping",
  },
  reference: {
    source: reference.source,
    asOf: reference.asOf,
    mode: reference.remote ? "remote" : "local",
  },
  universe: {
    total: universe.length,
    covered: markets.length,
    missing: universe.length - markets.length,
  },
  status: markets.length === 0 ? "failed" : markets.length < universe.length ? "partial" : "ok",
  warnings,
  errors,
  markets: markets.sort((left, right) => right.gapPct - left.gapPct),
};

if (markets.length === 0) {
  annotation("error", "No markets resolved; keeping the previous snapshot and failing refresh.");
  process.exitCode = 1;
} else {
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`wrote ${markets.length}/${universe.length} markets to ${outputPath}`);
}
