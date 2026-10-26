export function parseDailyPayoutCapUsdCents(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function utcPayoutDay(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function dailyBudgetAllowsPayout({ budget, reservation, claimUsdCents, capUsdCents }) {
  if (!budget || !Number.isSafeInteger(claimUsdCents) || claimUsdCents <= 0
    || !Number.isSafeInteger(capUsdCents) || capUsdCents <= 0) return false;
  if (!reservation || reservation.status !== "reserved" || reservation.usdCents !== claimUsdCents) return false;
  if (!Number.isSafeInteger(budget.capUsdCents) || budget.capUsdCents <= 0
    || budget.capUsdCents > capUsdCents) return false;
  if (!Number.isSafeInteger(budget.reservedUsdCents) || budget.reservedUsdCents < claimUsdCents
    || !Number.isSafeInteger(budget.paidUsdCents) || budget.paidUsdCents < 0) return false;
  return budget.reservedUsdCents + budget.paidUsdCents <= budget.capUsdCents;
}
