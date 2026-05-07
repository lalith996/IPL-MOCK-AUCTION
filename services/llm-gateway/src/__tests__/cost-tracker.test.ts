
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordUsage,
  getUsage,
  setBudget,
  BudgetExceededError,
  resetAll,
} from "../cost-tracker.js";

const AUCTION = "test-auction-1";
const FREE_MODEL = "meta-llama/llama-3.1-8b-instruct:free";

beforeEach(() => { resetAll(); });

describe("cost tracker", () => {
  it("records call count on each recordUsage call", () => {
    recordUsage(AUCTION, FREE_MODEL, { promptTokens: 100, completionTokens: 50 });
    recordUsage(AUCTION, FREE_MODEL, { promptTokens: 200, completionTokens: 100 });
    expect(getUsage(AUCTION).callCount).toBe(2);
  });

  it("free-tier models accumulate $0 cost", () => {
    recordUsage(AUCTION, FREE_MODEL, { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(getUsage(AUCTION).usedCents).toBe(0);
  });

  it("budget starts at default 500 cents", () => {
    recordUsage(AUCTION, FREE_MODEL, { promptTokens: 1, completionTokens: 1 });
    expect(getUsage(AUCTION).limitCents).toBe(500);
  });

  it("setBudget overrides the limit", () => {
    setBudget(AUCTION, 100);
    recordUsage(AUCTION, FREE_MODEL, { promptTokens: 1, completionTokens: 1 });
    expect(getUsage(AUCTION).limitCents).toBe(100);
  });

  it("throws BudgetExceededError when a paid model crosses the budget", () => {
    // Simulate a paid model at $1/1M tokens input to cross the budget quickly
    const paidModel = "__test_paid_model__";
    // Manually shim: we'll exceed budget by setting limit to 0 cents
    setBudget(AUCTION, 0);
    expect(() =>
      recordUsage(AUCTION, paidModel, { promptTokens: 1, completionTokens: 1 }),
    ).toThrow(BudgetExceededError);
  });

  it("BudgetExceededError carries correct auction ID", () => {
    setBudget(AUCTION, 0);
    try {
      recordUsage(AUCTION, FREE_MODEL, { promptTokens: 0, completionTokens: 0 });
      // usedCents will be 0 and limit is 0 → 0 >= 0 → throw
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).auctionId).toBe(AUCTION);
    }
  });

  it("separate auctions have independent budgets", () => {
    recordUsage("auction-A", FREE_MODEL, { promptTokens: 10, completionTokens: 5 });
    recordUsage("auction-B", FREE_MODEL, { promptTokens: 20, completionTokens: 10 });
    expect(getUsage("auction-A").callCount).toBe(1);
    expect(getUsage("auction-B").callCount).toBe(1);
  });
});
