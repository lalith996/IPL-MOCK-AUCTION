/* eslint-disable @typescript-eslint/no-confusing-void-expression, @typescript-eslint/restrict-template-expressions */
import { describe, it, expect } from "vitest";
import {
  checkBudgetRule,
  checkOverseasRule,
  checkBidIncrementRule,
  checkSquadSizeRule,
  checkWithdrawalRule,
  checkRoleMinimumRule,
  requiredIncrement,
  validateBid,
} from "../rules/index.js";
import type { AuctionState } from "../types.js";
import { createInitialState } from "../fsm.js";

function _state(overrides: Partial<AuctionState> = {}): AuctionState {
  const base = createInitialState("test-auction", "seed-42");
  return { ...base, currentBidLakhs: 0, ...overrides };
}

// ---------------------------------------------------------------------------
// BidIncrementRule
// ---------------------------------------------------------------------------
describe("requiredIncrement", () => {
  it("returns 5 below 100L", () => expect(requiredIncrement(0)).toBe(5));
  it("returns 5 at 99L", () => expect(requiredIncrement(99)).toBe(5));
  it("returns 10 at 100L", () => expect(requiredIncrement(100)).toBe(10));
  it("returns 20 at 200L", () => expect(requiredIncrement(200)).toBe(20));
  it("returns 25 at 500L", () => expect(requiredIncrement(500)).toBe(25));
});

describe("BidIncrementRule", () => {
  it("passes when bid meets minimum", () => {
    const s = _state({ currentBidLakhs: 50 });
    expect(checkBidIncrementRule(s, 55)).toBeNull(); // 50+5=55 ✓
  });
  it("fails when bid is below minimum increment", () => {
    const s = _state({ currentBidLakhs: 50 });
    const v = checkBidIncrementRule(s, 53); // needs 55
    expect(v?.ruleId).toBe("BidIncrementRule");
  });
});

// ---------------------------------------------------------------------------
// BudgetRule
// ---------------------------------------------------------------------------
describe("BudgetRule", () => {
  it("passes when bid is within budget", () => {
    const s = _state(); // 100 Cr = 10000 L
    expect(checkBudgetRule(s, "MI", 5000)).toBeNull();
  });
  it("fails when bid exceeds remaining budget", () => {
    const s = _state();
    s.teams["MI"].budgetRemainingCr = 5; // only 500 L
    const v = checkBudgetRule(s, "MI", 600);
    expect(v?.ruleId).toBe("BudgetRule");
  });
});

// ---------------------------------------------------------------------------
// OverseasRule
// ---------------------------------------------------------------------------
describe("OverseasRule", () => {
  it("passes for indian player regardless of overseas count", () => {
    const s = _state();
    s.teams["CSK"].overseasCount = 8;
    expect(checkOverseasRule(s, "CSK", "indian")).toBeNull();
  });
  it("passes when overseas count is below cap", () => {
    const s = _state();
    s.teams["CSK"].overseasCount = 7;
    expect(checkOverseasRule(s, "CSK", "overseas")).toBeNull();
  });
  it("fails when overseas count would exceed 8", () => {
    const s = _state();
    s.teams["CSK"].overseasCount = 8;
    const v = checkOverseasRule(s, "CSK", "overseas");
    expect(v?.ruleId).toBe("OverseasRule");
  });
});

// ---------------------------------------------------------------------------
// SquadSizeRule
// ---------------------------------------------------------------------------
describe("SquadSizeRule", () => {
  it("passes when squad is below 25", () => {
    const s = _state();
    expect(checkSquadSizeRule(s, "RCB")).toBeNull();
  });
  it("fails when squad has 25 players", () => {
    const s = _state();
    s.teams["RCB"].squad = Array.from({ length: 25 }, (_, i) => ({
      playerId: `p${i}`,
      role: "batsman",
      nationality: "indian" as const,
      priceLakhs: 20,
    }));
    const v = checkSquadSizeRule(s, "RCB");
    expect(v?.ruleId).toBe("SquadSizeRule");
  });
});

// ---------------------------------------------------------------------------
// WithdrawalRule
// ---------------------------------------------------------------------------
describe("WithdrawalRule", () => {
  it("passes when agent is not locked out", () => {
    const s = _state();
    expect(checkWithdrawalRule(s, "DC")).toBeNull();
  });
  it("fails when agent is locked out", () => {
    const s = _state();
    s.teams["DC"].lockedOut = true;
    const v = checkWithdrawalRule(s, "DC");
    expect(v?.ruleId).toBe("WithdrawalRule");
  });
});

// ---------------------------------------------------------------------------
// RoleMinimumRule
// ---------------------------------------------------------------------------
describe("RoleMinimumRule", () => {
  it("passes when squad has fewer than 22 players (not near cap)", () => {
    const s = _state();
    // Only 3 players — too small to enforce minimums
    s.teams["KKR"].squad = [
      { playerId: "p1", role: "batsman", nationality: "indian", priceLakhs: 50 },
    ];
    expect(checkRoleMinimumRule(s, "KKR")).toBeNull();
  });
  it("fails near cap if keeper is missing", () => {
    const s = _state();
    s.teams["KKR"].squad = Array.from({ length: 22 }, (_, i) => ({
      playerId: `p${i}`,
      role: "batsman", // all batsmen, no keeper
      nationality: "indian" as const,
      priceLakhs: 50,
    }));
    const v = checkRoleMinimumRule(s, "KKR");
    expect(v?.ruleId).toBe("RoleMinimumRule");
    expect(v?.message).toMatch(/keeper/i);
  });
});

// ---------------------------------------------------------------------------
// validateBid (composite)
// ---------------------------------------------------------------------------
describe("validateBid", () => {
  it("returns null for a valid bid", () => {
    const s = _state({ currentBidLakhs: 50 });
    expect(validateBid(s, "MI", 55, "indian")).toBeNull();
  });
  it("returns BidIncrementRule for bad increment", () => {
    const s = _state({ currentBidLakhs: 50 });
    const v = validateBid(s, "MI", 53, "indian");
    expect(v?.ruleId).toBe("BidIncrementRule");
  });
  it("returns BudgetRule when bid exceeds budget", () => {
    const s = _state({ currentBidLakhs: 50 });
    s.teams["MI"].budgetRemainingCr = 0.5; // 50L
    const v = validateBid(s, "MI", 55, "indian");
    expect(v?.ruleId).toBe("BudgetRule");
  });
  it("withdrawal rule checked first (takes precedence)", () => {
    const s = _state({ currentBidLakhs: 50 });
    s.teams["MI"].lockedOut = true;
    const v = validateBid(s, "MI", 55, "indian");
    expect(v?.ruleId).toBe("WithdrawalRule");
  });
});
