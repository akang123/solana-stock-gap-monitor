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
  return `$${value.toFixed(4)}`;
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

function renderAlerts(data) {
  const warnings = [...(data?.warnings ?? []), ...(data?.errors ?? []).map((error) => error.message)];
  elements.alerts.innerHTML = warnings.map((warning) => `<div class="alert"><span class="alert-mark" aria-hidden="true">!</span><span>${escapeHtml(warning)}</span></div>`).join("");
}

function renderSummary(data, markets) {
  const tracked = data?.universe?.total ?? markets.length;
  const covered = data?.universe?.covered ?? markets.length;
  const averageGap = markets.length ? markets.reduce((total, market) => total + (market.gapPct || 0), 0) / markets.length : null;
  const liquidity = markets.reduce((total, market) => total + (market.liquidityUsd || 0), 0);
  const volume = markets.reduce((total, market) => total + (market.volume24hUsd || 0), 0);
  const gaps = markets.filter((market) => Math.abs(market.gapPct || 0) >= 1).length;
  document.querySelector("#hero-average-gap").textContent = formatGap(averageGap);
  document.querySelector("#hero-covered").textContent = `${covered}/${tracked}`;
  document.querySelector("#hero-liquidity").textContent = formatCompact(liquidity);
  document.querySelector("#hero-volume").textContent = formatCompact(volume);
  document.querySelector("#stat-covered").textContent = covered;
  document.querySelector("#stat-tracked").textContent = tracked;
  document.querySelector("#stat-gaps").textContent = gaps;
  document.querySelector("#stat-checked").textContent = markets.length;
  document.querySelector("#readout-date").textContent = formatDate(data?.generatedAt);
  document.querySelector("#last-updated").textContent = formatAge(data?.generatedAt);
  document.querySelector("#coverage-copy").textContent = `${covered} of ${tracked} configured Solana xStock markets resolved on the last pass. ${data?.universe?.missing ? `${data.universe.missing} remain uncovered.` : "Coverage is complete."}`;
}

function renderRows() {
  const markets = state.data?.markets ?? [];
  const filtered = markets.filter((market) => `${market.ticker} ${market.company} ${market.tokenSymbol}`.toLowerCase().includes(state.query.toLowerCase())).sort((left, right) => state.descending ? right.gapPct - left.gapPct : left.gapPct - right.gapPct);
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
      <td class="mono">${formatCompact(market.liquidityUsd)}</td>
      <td><div class="price-cell"><span class="price-main mono">${formatCompact(market.volume24hUsd)}</span><span class="sub-value">${formatGap(market.priceChange24hPct)} 24h</span></div></td>
    </tr>`;
  }).join("");
}

function render(data) {
  state.data = data;
  renderAlerts(data);
  const markets = data?.markets ?? [];
  renderSummary(data, markets);
  renderRows();
}

async function loadData({ announce = false } = {}) {
  elements.refresh.disabled = true;
  if (announce) elements.refreshNote.textContent = "Fetching snapshot…";
  try {
    const response = await fetch(`./data/markets.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot returned ${response.status}`);
    const data = await response.json();
    render(data);
    elements.refreshNote.textContent = `Updated ${formatAge(data.generatedAt)}`;
  } catch (error) {
    elements.refreshNote.textContent = "Snapshot unavailable";
    elements.alerts.innerHTML = `<div class="alert"><span class="alert-mark" aria-hidden="true">!</span><span>${escapeHtml(error.message)}. The monitor is showing no data rather than guessing.</span></div>`;
  } finally {
    elements.refresh.disabled = false;
  }
}

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderRows();
});

elements.sort.addEventListener("click", () => {
  state.descending = !state.descending;
  renderRows();
});

elements.refresh.addEventListener("click", () => loadData({ announce: true }));
loadData();
