import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = resolve(projectRoot, "site/data/markets.json");
const maxAgeHours = Number(process.env.MAX_SNAPSHOT_AGE_HOURS || 26);

function fail(message) {
  console.log(`::error::${message}`);
  console.error(`Health check failed: ${message}`);
  process.exitCode = 1;
}

let snapshot;
try {
  snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
} catch (error) {
  fail(`cannot read market snapshot: ${error.message}`);
}

if (!snapshot) process.exit(1);

const generatedAt = new Date(snapshot.generatedAt).getTime();
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (!Number.isFinite(generatedAt)) fail("snapshot generatedAt is invalid");
if (Number.isFinite(ageHours) && ageHours > maxAgeHours) fail(`snapshot is ${ageHours.toFixed(1)} hours old; max is ${maxAgeHours} hours`);
if (snapshot.network !== "solana") fail(`unexpected network ${snapshot.network}; Solana is required`);
if (!snapshot.universe || snapshot.universe.covered < 1) fail("no Solana markets are covered");
if (!Array.isArray(snapshot.markets)) fail("markets is not an array");

for (const market of snapshot.markets || []) {
  if (market.status !== "live") fail(`${market.ticker} is not marked live`);
  if (!Number.isFinite(market.onchainPrice) || !Number.isFinite(market.referencePrice)) fail(`${market.ticker} has invalid pricing`);
}

if (snapshot.status === "partial") console.log(`::warning::Partial coverage: ${snapshot.universe.covered}/${snapshot.universe.total} markets resolved.`);
if (snapshot.errors?.length) console.log(`::warning::${snapshot.errors.length} market lookups failed on the last refresh.`);

if (process.exitCode !== 1) {
  console.log(`Health check passed: ${snapshot.universe.covered}/${snapshot.universe.total} markets, ${ageHours.toFixed(1)} hours old.`);
}
