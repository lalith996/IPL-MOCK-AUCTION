/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/restrict-template-expressions */
/**
 * Rule Compliance Suite — Step 13
 *
 * Golden invalid-bid fixtures mapped to each of the 6 rule IDs.
 * Every fixture must be rejected with exactly the expected ruleId.
 *
 * Required for merge. Any regression in rule enforcement blocks CI.
 */

import { describe, it, expect } from "vitest";
import type { AgentId, AuctionState, SquadPlayer } from "../types.js";
import {
  checkBudgetRule,
  checkOverseasRule,
  checkRoleMinimumRule,
  checkSquadSizeRule,
  checkBidIncrementRule,
  checkWithdrawalRule,
  validateBid,
  requiredIncrement,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSquadPlayer(overrides?: Partial<SquadPlayer>): SquadPlayer {
  return {
    playerId: "p-default",
    role: "batsman",
    nationality: "indian",
    priceLakhs: 100,
    ...overrides,
  };
}

function makeBaseState(
  agentId: AgentId = "MI",
  overrides: {
    budgetCr?: number;
    squadPlayers?: SquadPlayer[];
    overseasCount?: number;
    consecutiveDrops?: number;
    lockedOut?: boolean;
    currentBidLakhs?: number;
  } = {},
): AuctionState {
  const {
    budgetCr = 100,
    squadPlayers = [],
    overseasCount = 0,
    consecutiveDrops = 0,
    lockedOut = false,
    currentBidLakhs = 100,
  } = overrides;

  return {
    auctionId: "test-auction",
    phase: "open_bidding",
    seq: 1,
    nominatedPlayerId: "p-player-001",
    nominatedPlayerRole: "batsman",
    currentBidLakhs,
    currentBidder: null,
    activeBidders: [],
    standbyQueue: [],
    seed: "42",
    teams: {
      MI:   { agentId: "MI",   budgetRemainingCr: agentId === "MI"   ? budgetCr : 100, squad: agentId === "MI"   ? squadPlayers : [], overseasCount: agentId === "MI"   ? overseasCount : 0, consecutiveDrops: agentId === "MI"   ? consecutiveDrops : 0, lockedOut: agentId === "MI"   ? lockedOut : false },
      CSK:  { agentId: "CSK",  budgetRemainingCr: agentId === "CSK"  ? budgetCr : 100, squad: agentId === "CSK"  ? squadPlayers : [], overseasCount: agentId === "CSK"  ? overseasCount : 0, consecutiveDrops: agentId === "CSK"  ? consecutiveDrops : 0, lockedOut: agentId === "CSK"  ? lockedOut : false },
      RCB:  { agentId: "RCB",  budgetRemainingCr: agentId === "RCB"  ? budgetCr : 100, squad: agentId === "RCB"  ? squadPlayers : [], overseasCount: agentId === "RCB"  ? overseasCount : 0, consecutiveDrops: agentId === "RCB"  ? consecutiveDrops : 0, lockedOut: agentId === "RCB"  ? lockedOut : false },
      DC:   { agentId: "DC",   budgetRemainingCr: agentId === "DC"   ? budgetCr : 100, squad: agentId === "DC"   ? squadPlayers : [], overseasCount: agentId === "DC"   ? overseasCount : 0, consecutiveDrops: agentId === "DC"   ? consecutiveDrops : 0, lockedOut: agentId === "DC"   ? lockedOut : false },
      KKR:  { agentId: "KKR",  budgetRemainingCr: agentId === "KKR"  ? budgetCr : 100, squad: agentId === "KKR"  ? squadPlayers : [], overseasCount: agentId === "KKR"  ? overseasCount : 0, consecutiveDrops: agentId === "KKR"  ? consecutiveDrops : 0, lockedOut: agentId === "KKR"  ? lockedOut : false },
      RR:   { agentId: "RR",   budgetRemainingCr: agentId === "RR"   ? budgetCr : 100, squad: agentId === "RR"   ? squadPlayers : [], overseasCount: agentId === "RR"   ? overseasCount : 0, consecutiveDrops: agentId === "RR"   ? consecutiveDrops : 0, lockedOut: agentId === "RR"   ? lockedOut : false },
      PBKS: { agentId: "PBKS", budgetRemainingCr: agentId === "PBKS" ? budgetCr : 100, squad: agentId === "PBKS" ? squadPlayers : [], overseasCount: agentId === "PBKS" ? overseasCount : 0, consecutiveDrops: agentId === "PBKS" ? consecutiveDrops : 0, lockedOut: agentId === "PBKS" ? lockedOut : false },
      SRH:  { agentId: "SRH",  budgetRemainingCr: agentId === "SRH"  ? budgetCr : 100, squad: agentId === "SRH"  ? squadPlayers : [], overseasCount: agentId === "SRH"  ? overseasCount : 0, consecutiveDrops: agentId === "SRH"  ? consecutiveDrops : 0, lockedOut: agentId === "SRH"  ? lockedOut : false },
      LSG:  { agentId: "LSG",  budgetRemainingCr: agentId === "LSG"  ? budgetCr : 100, squad: agentId === "LSG"  ? squadPlayers : [], overseasCount: agentId === "LSG"  ? overseasCount : 0, consecutiveDrops: agentId === "LSG"  ? consecutiveDrops : 0, lockedOut: agentId === "LSG"  ? lockedOut : false },
      GT:   { agentId: "GT",   budgetRemainingCr: agentId === "GT"   ? budgetCr : 100, squad: agentId === "GT"   ? squadPlayers : [], overseasCount: agentId === "GT"   ? overseasCount : 0, consecutiveDrops: agentId === "GT"   ? consecutiveDrops : 0, lockedOut: agentId === "GT"   ? lockedOut : false },
    },
  };
}

// ---------------------------------------------------------------------------
// Rule 1 — BudgetRule
// ---------------------------------------------------------------------------

describe("BudgetRule", () => {
  it("rejects when bid exceeds remaining budget", () => {
    const state = makeBaseState("MI", { budgetCr: 10 }); // 10 Cr = 1000 lakhs
    const violation = checkBudgetRule(state, "MI", 1100); // bid 1100 lakhs
    expect(violation).not.toBeNull();
    expect(violation!.ruleId).toBe("BudgetRule");
  });

  it("rejects bid exactly 1 lakh over budget", () => {
    const state = makeBaseState("CSK", { budgetCr: 5 }); // 500 lakhs
    const violation = checkBudgetRule(state, "CSK", 501);
    expect(violation!.ruleId).toBe("BudgetRule");
  });

  it("allows bid exactly equal to remaining budget", () => {
    const state = makeBaseState("RCB", { budgetCr: 10 }); // 1000 lakhs
    expect(checkBudgetRule(state, "RCB", 1000)).toBeNull();
  });

  it("allows bid below budget", () => {
    const state = makeBaseState("DC", { budgetCr: 50 }); // 5000 lakhs
    expect(checkBudgetRule(state, "DC", 100)).toBeNull();
  });

  it("returns BudgetRule violation for unknown agent ID", () => {
    const state = makeBaseState("MI");
    // Cast to satisfy TS — simulates rogue agent_id in runtime
    const violation = checkBudgetRule(state, "UNKNOWN" as AgentId, 100);
    expect(violation!.ruleId).toBe("BudgetRule");
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — OverseasRule
// ---------------------------------------------------------------------------

describe("OverseasRule", () => {
  it("rejects when overseas count is already at cap (8)", () => {
    const state = makeBaseState("KKR", { overseasCount: 8 });
    const violation = checkOverseasRule(state, "KKR", "overseas");
    expect(violation).not.toBeNull();
    expect(violation!.ruleId).toBe("OverseasRule");
  });

  it("allows overseas player when count is 7 (one slot remaining)", () => {
    const state = makeBaseState("RR", { overseasCount: 7 });
    expect(checkOverseasRule(state, "RR", "overseas")).toBeNull();
  });

  it("ignores indian player regardless of overseas count", () => {
    const state = makeBaseState("PBKS", { overseasCount: 8 });
    expect(checkOverseasRule(state, "PBKS", "indian")).toBeNull();
  });

  it("allows first overseas player (count 0)", () => {
    const state = makeBaseState("SRH", { overseasCount: 0 });
    expect(checkOverseasRule(state, "SRH", "overseas")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — RoleMinimumRule
// ---------------------------------------------------------------------------

describe("RoleMinimumRule", () => {
  it("rejects when squad of 22+ has zero keepers", () => {
    const batters: SquadPlayer[] = Array.from({ length: 22 }, (_, i) =>
      makeSquadPlayer({ playerId: `p-bat-${i}`, role: "batsman" }),
    );
    const state = makeBaseState("LSG", { squadPlayers: batters });
    const violation = checkRoleMinimumRule(state, "LSG");
    expect(violation).not.toBeNull();
    expect(violation!.ruleId).toBe("RoleMinimumRule");
  });

  it("rejects when 22-player squad has only 1 spinner (need 2)", () => {
    const squad: SquadPlayer[] = [
      makeSquadPlayer({ playerId: "p-keeper-1", role: "keeper" }),
      makeSquadPlayer({ playerId: "p-spinner-1", role: "spinner" }),
      ...Array.from({ length: 3 }, (_, i) =>
        makeSquadPlayer({ playerId: `p-pacer-${i}`, role: "pacer" }),
      ),
      ...Array.from({ length: 17 }, (_, i) =>
        makeSquadPlayer({ playerId: `p-bat-${i}` }),
      ),
    ];
    const state = makeBaseState("GT", { squadPlayers: squad });
    const violation = checkRoleMinimumRule(state, "GT");
    expect(violation).not.toBeNull();
    expect(violation!.ruleId).toBe("RoleMinimumRule");
  });

  it("allows squad below 22 players even with role gaps", () => {
    const squad = Array.from({ length: 15 }, (_, i) =>
      makeSquadPlayer({ playerId: `p-${i}`, role: "batsman" }),
    );
    const state = makeBaseState("MI", { squadPlayers: squad });
    expect(checkRoleMinimumRule(state, "MI")).toBeNull();
  });

  it("passes when 22-player squad has required keeper, 2 spinners, 3 pacers", () => {
    const squad: SquadPlayer[] = [
      makeSquadPlayer({ playerId: "p-keeper-1", role: "keeper" }),
      makeSquadPlayer({ playerId: "p-spinner-1", role: "spinner" }),
      makeSquadPlayer({ playerId: "p-spinner-2", role: "pp-spinner" }),
      ...Array.from({ length: 3 }, (_, i) =>
        makeSquadPlayer({ playerId: `p-pacer-${i}`, role: "death-bowler" }),
      ),
      ...Array.from({ length: 16 }, (_, i) =>
        makeSquadPlayer({ playerId: `p-bat-${i}` }),
      ),
    ];
    const state = makeBaseState("CSK", { squadPlayers: squad });
    expect(checkRoleMinimumRule(state, "CSK")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — SquadSizeRule
// ---------------------------------------------------------------------------

describe("SquadSizeRule", () => {
  it("rejects when squad already has 25 players", () => {
    const full = Array.from({ length: 25 }, (_, i) =>
      makeSquadPlayer({ playerId: `p-${i}` }),
    );
    const state = makeBaseState("RCB", { squadPlayers: full });
    const violation = checkSquadSizeRule(state, "RCB");
    expect(violation).not.toBeNull();
    expect(violation!.ruleId).toBe("SquadSizeRule");
  });

  it("allows squad of 24 (one slot remaining)", () => {
    const squad = Array.from({ length: 24 }, (_, i) =>
      makeSquadPlayer({ playerId: `p-${i}` }),
    );
    const state = makeBaseState("DC", { squadPlayers: squad });
    expect(checkSquadSizeRule(state, "DC")).toBeNull();
  });

  it("allows empty squad", () => {
    const state = makeBaseState("KKR", { squadPlayers: [] });
    expect(checkSquadSizeRule(state, "KKR")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — BidIncrementRule
// ---------------------------------------------------------------------------

describe("BidIncrementRule", () => {
  it("rejects bid below minimum increment in the <100L band (need +5)", () => {
    const state = makeBaseState("RR", { currentBidLakhs: 80 });
    // Current 80, required increment 5, minimum 85. Bid 82 = reject.
    const violation = checkBidIncrementRule(state, 82);
    expect(violation).not.toBeNull();
    expect(violation!.ruleId).toBe("BidIncrementRule");
  });

  it("rejects bid below minimum in 100–200L band (need +10)", () => {
    const state = makeBaseState("PBKS", { currentBidLakhs: 150 });
    // Minimum 160. Bid 155 = reject.
    const violation = checkBidIncrementRule(state, 155);
    expect(violation!.ruleId).toBe("BidIncrementRule");
  });

  it("rejects bid below minimum in 200–500L band (need +20)", () => {
    const state = makeBaseState("SRH", { currentBidLakhs: 300 });
    // Minimum 320. Bid 315 = reject.
    const violation = checkBidIncrementRule(state, 315);
    expect(violation!.ruleId).toBe("BidIncrementRule");
  });

  it("rejects bid below minimum above 500L (need +25)", () => {
    const state = makeBaseState("LSG", { currentBidLakhs: 600 });
    // Minimum 625. Bid 615 = reject.
    const violation = checkBidIncrementRule(state, 615);
    expect(violation!.ruleId).toBe("BidIncrementRule");
  });

  it("allows bid exactly at minimum increment", () => {
    const state = makeBaseState("GT", { currentBidLakhs: 80 });
    expect(checkBidIncrementRule(state, 85)).toBeNull(); // 80+5=85 ✓
  });

  it("allows bid above minimum increment", () => {
    const state = makeBaseState("MI", { currentBidLakhs: 100 });
    expect(checkBidIncrementRule(state, 130)).toBeNull(); // 100+10=110; 130>110 ✓
  });
});

// ---------------------------------------------------------------------------
// Rule 5a — requiredIncrement band boundaries
// ---------------------------------------------------------------------------

describe("requiredIncrement", () => {
  it.each([
    [0,   5],   // Band 1 starts at 0
    [50,  5],   // Mid band 1
    [99,  5],   // Top of band 1 (exclusive <100)
    [100, 10],  // Band 2 starts at 100
    [199, 10],  // Top of band 2 (exclusive <200)
    [200, 20],  // Band 3 starts at 200
    [499, 20],  // Top of band 3
    [500, 25],  // Band 4 (≥500)
    [2000, 25], // High bids
  ])("requiredIncrement(%i) === %i", (current, expected) => {
    expect(requiredIncrement(current)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — WithdrawalRule
// ---------------------------------------------------------------------------

describe("WithdrawalRule", () => {
  it("rejects bid when agent is locked out (2 consecutive drops)", () => {
    const state = makeBaseState("CSK", { lockedOut: true });
    const violation = checkWithdrawalRule(state, "CSK");
    expect(violation).not.toBeNull();
    expect(violation!.ruleId).toBe("WithdrawalRule");
  });

  it("allows bid when agent has NOT been locked out", () => {
    const state = makeBaseState("RCB", { lockedOut: false });
    expect(checkWithdrawalRule(state, "RCB")).toBeNull();
  });

  it("allows bid when consecutiveDrops is 1 (not yet at limit)", () => {
    const state = makeBaseState("DC", { consecutiveDrops: 1, lockedOut: false });
    expect(checkWithdrawalRule(state, "DC")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Composite validateBid — checks priority ordering
// ---------------------------------------------------------------------------

describe("validateBid priority ordering", () => {
  it("WithdrawalRule fires before BudgetRule when both violated", () => {
    const state = makeBaseState("KKR", {
      lockedOut: true,
      budgetCr: 0, // 0 Cr — BudgetRule would also fire
      currentBidLakhs: 100,
    });
    // Override budget for KKR explicitly
    state.teams["KKR"]!.budgetRemainingCr = 0;
    const violation = validateBid(state, "KKR", 200, "indian");
    expect(violation!.ruleId).toBe("WithdrawalRule");
  });

  it("SquadSizeRule fires before BudgetRule when both violated", () => {
    const full = Array.from({ length: 25 }, (_, i) =>
      makeSquadPlayer({ playerId: `p-${i}` }),
    );
    const state = makeBaseState("RR", {
      squadPlayers: full,
      budgetCr: 0,
      currentBidLakhs: 100,
    });
    state.teams["RR"]!.budgetRemainingCr = 0;
    const violation = validateBid(state, "RR", 200, "indian");
    expect(violation!.ruleId).toBe("SquadSizeRule");
  });

  it("returns null when all rules pass", () => {
    const state = makeBaseState("PBKS", { budgetCr: 100, currentBidLakhs: 100 });
    const violation = validateBid(state, "PBKS", 110, "indian");
    expect(violation).toBeNull();
  });
});
