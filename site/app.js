const state = {
  data: null,
  query: "",
  descending: true,
};

const elements = {
  rows: document.querySelector("#market-rows"),
  empty: document.querySelector("#empty-state"),
  search: document.querySelector("#search-input"),
  count: document.querySelector("#result-count"),
  sort: document.querySelector("#sort-button"),
  refresh: document.querySelector("#refresh-button"),
  refreshNote: document.querySelector("#refresh-note"),
  alerts: document.querySelector("#alert-stack"),
};

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${numberFormat.format(value)}`;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function formatGap(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatAge(value) {
  if (!value) return "—";
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 0) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function renderAlerts() {
  if (elements.alerts) elements.alerts.innerHTML = "";
}

function renderSummary(data, markets) {
  const tracked = data?.universe?.total ?? markets.length;
  const covered = data?.universe?.covered ?? markets.length;
  const pricedMarkets = markets.filter((market) => Number.isFinite(market.gapPct));
  const averageGap = pricedMarkets.length ? pricedMarkets.reduce((total, market) => total + market.gapPct, 0) / pricedMarkets.length : null;
  const liquidity = markets.reduce((total, market) => total + (market.liquidityUsd || 0), 0);
  const volume = markets.reduce((total, market) => total + (market.volume24hUsd || 0), 0);
  const gaps = markets.filter((market) => Math.abs(market.gapPct || 0) >= 1).length;
  setText("#hero-average-gap", formatGap(averageGap));
  setText("#hero-covered", `${covered}/${tracked}`);
  setText("#hero-liquidity", formatCompact(liquidity));
  setText("#hero-volume", formatCompact(volume));
  setText("#stat-covered", covered);
  setText("#stat-tracked", tracked);
  setText("#stat-gaps", gaps);
  setText("#stat-checked", markets.length);
  setText("#readout-date", formatDate(data?.generatedAt));
  setText("#last-updated", formatAge(data?.generatedAt));
  setText("#coverage-copy", `${covered} of ${tracked} configured Solana equity markets resolved with both on-chain and live stock prices. ${data?.universe?.missing ? `${data.universe.missing} remain uncovered.` : "Coverage is complete."}`);
}

function renderRows() {
  if (!elements.rows || !elements.empty || !elements.count || !elements.sort) return;
  const markets = state.data?.markets ?? [];
  const filtered = markets.filter((market) => `${market.ticker} ${market.company} ${market.tokenSymbol}`.toLowerCase().includes(state.query.toLowerCase())).sort((left, right) => {
    const leftGap = Number.isFinite(left.gapPct) ? left.gapPct : -Infinity;
    const rightGap = Number.isFinite(right.gapPct) ? right.gapPct : -Infinity;
    return state.descending ? rightGap - leftGap : leftGap - rightGap;
  });
  elements.count.textContent = `${filtered.length} of ${markets.length} shown`;
  elements.sort.innerHTML = `Gap <span aria-hidden="true">${state.descending ? "↓" : "↑"}</span>`;
  elements.sort.setAttribute("aria-label", `Sort by gap, currently ${state.descending ? "descending" : "ascending"}`);
  elements.empty.hidden = filtered.length !== 0;
  elements.rows.innerHTML = filtered.map((market) => {
    const gapClass = market.gapPct >= 0 ? "is-positive" : "is-negative";
    const sourceHref = market.pairUrl || "https://dexscreener.com/solana";
    return `<tr>
      <td><div class="asset-cell"><span class="asset-mark" aria-hidden="true">${escapeHtml(market.ticker.slice(0, 2))}</span><span class="asset-name"><strong>${escapeHtml(market.ticker)} <span class="token-pill">${escapeHtml(market.tokenSymbol)}</span></strong><span>${escapeHtml(market.company)}</span></span></div></td>
      <td><div class="gap-cell"><span class="gap-value ${gapClass}">${formatGap(market.gapPct)}</span><span class="sub-value">market spread</span></div></td>
      <td><div class="price-cell"><a class="source-link price-main" href="${escapeHtml(sourceHref)}" target="_blank" rel="noreferrer">${formatPrice(market.onchainPrice)} ↗</a><span class="sub-value">${escapeHtml(market.dexId || "Solana DEX")}</span></div></td>
      <td><div class="price-cell"><a class="source-link price-main" href="${escapeHtml(market.marketPriceUrl || `https://finance.yahoo.com/quote/${encodeURIComponent(market.marketSymbol || market.ticker)}`)}" target="_blank" rel="noreferrer">${formatPrice(market.marketPrice)} ↗</a><span class="sub-value">${escapeHtml(market.marketPriceSource || "Market feed")} · ${formatAge(market.marketPriceAsOf)}</span></div></td>
      <td class="mono">${formatCompact(market.liquidityUsd)}</td>
      <td><div class="price-cell"><span class="price-main mono">${formatCompact(market.volume24hUsd)}</span><span class="sub-value">${formatGap(market.priceChange24hPct)} 24h</span></div></td>
    </tr>`;
  }).join("");
}

function render(data) {
  state.data = data;
  renderAlerts();
  const markets = data?.markets ?? [];
  renderSummary(data, markets);
  renderRows();
}

async function loadData({ announce = false } = {}) {
  if (elements.refresh) elements.refresh.disabled = true;
  if (announce && elements.refreshNote) elements.refreshNote.textContent = "Fetching snapshot…";
  try {
    const response = await fetch(`./data/markets.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot returned ${response.status}`);
    const data = await response.json();
    render(data);
    if (elements.refreshNote) elements.refreshNote.textContent = `Updated ${formatAge(data.generatedAt)}`;
  } catch (error) {
    if (elements.refreshNote) elements.refreshNote.textContent = "Snapshot unavailable";
    if (elements.alerts) elements.alerts.innerHTML = `<div class="alert"><span class="alert-mark" aria-hidden="true">!</span><span>${escapeHtml(error.message)}. The monitor is showing no data rather than guessing.</span></div>`;
  } finally {
    if (elements.refresh) elements.refresh.disabled = false;
  }
}

elements.search?.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderRows();
});

elements.sort?.addEventListener("click", () => {
  state.descending = !state.descending;
  renderRows();
});

elements.refresh?.addEventListener("click", () => loadData({ announce: true }));
loadData();
