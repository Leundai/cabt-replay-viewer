function safeBudget(budgetMs: number): number {
  return Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 0;
}

export function motionDuration(budgetMs: number, fraction: number, minMs: number, maxMs: number): number {
  const budget = safeBudget(budgetMs);
  const upper = Math.max(minMs, Math.min(maxMs, budget));
  return Math.round(Math.min(upper, Math.max(minMs, budget * fraction)));
}

export function motionDelay(budgetMs: number, fraction: number, maxMs: number): number {
  const budget = safeBudget(budgetMs);
  return Math.round(Math.min(maxMs, Math.max(0, budget * fraction)));
}
