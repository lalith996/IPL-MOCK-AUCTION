/**
 * Rules engine — 6 rules per spec §7.
 * Each rule returns RuleViolation | null.
 */

import type { AgentId, AuctionState, RuleViolation } from "../types.js";

// ---------------------------------------------------------------------------
// Spec §7: Bid-increment bands (INR lakhs)
// ---------------------------------------------------------------------------
const INCREMENT_BANDS: Array<{ upTo: number; increment: number }> = [
  { upTo: 100,  increment: 5  },
  { upTo: 200,  increment: 10 },
  { upTo: 500,  increment: 20 },
  { upTo: Infinity, increment: 25 },
];

export function requiredIncrement(currentBidLakhs: number): number {
  for (const band of INCREMENT_BANDS) {
    if (currentBidLakhs < band.upTo) return band.increment;
  }
  return 25;
}

// ---------------------------------------------------------------------------
// 1. BudgetRule
// ---------------------------------------------------------------------------

export function checkBudgetRule(
  state: AuctionState,
  agentId: AgentId,
  bidLakhs: number,
): RuleViolation | null {

  const team = state.teams[agentId] ?? null;
  if (!team) return { ruleId: "BudgetRule", message: `Unknown agent: ${agentId}` };

  const budgetLakhs = team.budgetRemainingCr * 100;
  if (bidLakhs > budgetLakhs) {
    return {
      ruleId: "BudgetRule",
      message: `Bid ₹${String(bidLakhs)}L exceeds remaining budget ₹${String(budgetLakhs)}L`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. OverseasRule
// ---------------------------------------------------------------------------

const MAX_OVERSEAS_SQUAD = 8;

export function checkOverseasRule(
  state: AuctionState,
  agentId: AgentId,
  playerNationality: "indian" | "overseas",
): RuleViolation | null {
  if (playerNationality !== "overseas") return null;
  const team = state.teams[agentId];
  if (team.overseasCount >= MAX_OVERSEAS_SQUAD) {
    return {
      ruleId: "OverseasRule",
      message: `Squad already has ${String(MAX_OVERSEAS_SQUAD)} overseas players (cap reached)`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. RoleMinimumRule
// ---------------------------------------------------------------------------

// IPL-style minimums (approximate; hard minimums enforced here)
const ROLE_MINIMUMS: Record<string, { needed: number; matchRoles: string[] }> = {
  keeper:  { needed: 1, matchRoles: ["keeper", "wicketkeeper"] },
  spinner: { needed: 2, matchRoles: ["spinner", "pp-spinner", "off-spinner", "leg-spinner"] },
  pacer:   { needed: 3, matchRoles: ["pacer", "fast-bowler", "medium-pacer", "death-bowler"] },
};

export function checkRoleMinimumRule(
  state: AuctionState,
  agentId: AgentId,
): RuleViolation | null {
  const team = state.teams[agentId];
  const squadSize = team.squad.length;
  // Only enforce if squad is within 3 of its 25-player cap — must hold spots
  if (squadSize < 22) return null;

  for (const [roleName, { needed, matchRoles }] of Object.entries(ROLE_MINIMUMS)) {
    const count = team.squad.filter((p) =>
      matchRoles.some((r) => p.role.toLowerCase().includes(r)),
    ).length;
    if (count < needed) {
      return {
        ruleId: "RoleMinimumRule",
        message: `Squad needs at least ${String(needed)} ${roleName}(s); currently has ${String(count)}`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. SquadSizeRule
// ---------------------------------------------------------------------------

const MAX_SQUAD = 25;

export function checkSquadSizeRule(
  state: AuctionState,
  agentId: AgentId,
): RuleViolation | null {
  const team = state.teams[agentId];
  if (team.squad.length >= MAX_SQUAD) {
    return {
      ruleId: "SquadSizeRule",
      message: `Squad is full (${String(MAX_SQUAD)} players)`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. BidIncrementRule
// ---------------------------------------------------------------------------

export function checkBidIncrementRule(
  state: AuctionState,
  bidLakhs: number,
): RuleViolation | null {
  const current = state.currentBidLakhs;
  const required = requiredIncrement(current);
  const minBid = current + required;
  if (bidLakhs < minBid) {
    return {
      ruleId: "BidIncrementRule",
      message: `Bid ₹${String(bidLakhs)}L is below minimum ₹${String(minBid)}L (increment ₹${String(required)}L)`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. WithdrawalRule
// ---------------------------------------------------------------------------

const MAX_CONSECUTIVE_DROPS = 2;

export function checkWithdrawalRule(
  state: AuctionState,
  agentId: AgentId,
): RuleViolation | null {
  const team = state.teams[agentId];
  if (team.lockedOut) {
    return {
      ruleId: "WithdrawalRule",
      message: `${agentId} is locked out for this player (${String(MAX_CONSECUTIVE_DROPS)} consecutive drops)`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Composite — validate a PlaceBid command against all applicable rules
// ---------------------------------------------------------------------------

export function validateBid(
  state: AuctionState,
  agentId: AgentId,
  bidLakhs: number,
  playerNationality: "indian" | "overseas",
): RuleViolation | null {
  return (
    checkWithdrawalRule(state, agentId) ??
    checkSquadSizeRule(state, agentId) ??
    checkBudgetRule(state, agentId, bidLakhs) ??
    checkOverseasRule(state, agentId, playerNationality) ??
    checkBidIncrementRule(state, bidLakhs) ??
    checkRoleMinimumRule(state, agentId) ??
    null
  );
}
