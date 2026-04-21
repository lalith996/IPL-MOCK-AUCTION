/**
 * Per-auction LLM cost tracker with hard-stop enforcement.
 *
 * Pricing is approximate (free-tier models have $0 cost but we track tokens
 * for observability). The budget is expressed in USD cents to stay as integers.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

// Approximate pricing in USD per 1M tokens (input / output).
// Free-tier models cost $0 but we record consumption for dashboards.
const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "meta-llama/llama-3.1-8b-instruct:free":          { input: 0, output: 0 },
  "meta-llama/llama-3.1-70b-instruct:free":         { input: 0, output: 0 },
  "google/gemini-flash-1.5-8b:free":                { input: 0, output: 0 },
  "mistralai/mistral-7b-instruct:free":             { input: 0, output: 0 },
  "microsoft/phi-3-mini-128k-instruct:free":        { input: 0, output: 0 },
  "qwen/qwen-2-7b-instruct:free":                   { input: 0, output: 0 },
  "google/gemma-2-9b-it:free":                      { input: 0, output: 0 },
  "openchat/openchat-7b:free":                      { input: 0, output: 0 },
  "huggingfaceh4/zephyr-7b-beta:free":              { input: 0, output: 0 },
  "meta-llama/llama-3-8b-instruct:free":            { input: 0, output: 0 },
};

const DEFAULT_BUDGET_CENTS = 500; // $5.00

interface AuctionBudget {
  limitCents: number;
  usedCents: number;
  callCount: number;
}

const _budgets = new Map<string, AuctionBudget>();

function _getBudget(auctionId: string): AuctionBudget {
  let b = _budgets.get(auctionId);
  if (!b) {
    b = { limitCents: DEFAULT_BUDGET_CENTS, usedCents: 0, callCount: 0 };
    _budgets.set(auctionId, b);
  }
  return b;
}

export function setBudget(auctionId: string, limitCents: number): void {
  const b = _getBudget(auctionId);
  b.limitCents = limitCents;
}

/**
 * Record usage and throw if the hard-stop budget is exceeded.
 * Returns cost in cents for this call.
 */
export function recordUsage(
  auctionId: string,
  model: string,
  usage: TokenUsage,
): number {
  const pricing = MODEL_PRICING_PER_1M[model] ?? { input: 0, output: 0 };
  const costCents =
    (usage.promptTokens * pricing.input) / 1_000_000 +
    (usage.completionTokens * pricing.output) / 1_000_000;

  const b = _getBudget(auctionId);
  b.usedCents += costCents;
  b.callCount += 1;

  if (b.usedCents >= b.limitCents) {
    throw new BudgetExceededError(auctionId, b.usedCents, b.limitCents);
  }

  return costCents;
}

export function getUsage(auctionId: string): AuctionBudget {
  return { ..._getBudget(auctionId) };
}

/** Emitted when the per-auction LLM cost budget is exceeded (hard stop). */
export class BudgetExceededError extends Error {
  constructor(
    public readonly auctionId: string,
    public readonly usedCents: number,
    public readonly limitCents: number,
  ) {
    super(
      `Budget exceeded for auction ${auctionId}: ` +
        `used ${usedCents.toFixed(4)}¢ of ${String(limitCents)}¢`,
    );
    this.name = "BudgetExceededError";
  }
}

/** For testing only. */
export function resetAll(): void {
  _budgets.clear();
}
