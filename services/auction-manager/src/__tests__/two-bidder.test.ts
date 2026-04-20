import { describe, it, expect } from "vitest";
import {
  computeInitialPair,
  handleActiveDrop,
  handleRaiseHand,
  isActiveBidder,
} from "../two-bidder-protocol.js";
import { createInitialState } from "../fsm.js";
import type { AuctionState } from "../types.js";

function _state(overrides: Partial<AuctionState> = {}): AuctionState {
  return {
    ...createInitialState("test-auction", "seed-42"),
    ...overrides,
  };
}

describe("computeInitialPair", () => {
  it("selects top-2 by confidence score", () => {
    const scores = [
      { agentId: "MI" as const, confidenceScore: 0.9 },
      { agentId: "CSK" as const, confidenceScore: 0.7 },
      { agentId: "RCB" as const, confidenceScore: 0.5 },
    ];
    const { activePair, standby } = computeInitialPair(scores);
    expect(activePair).toEqual(["MI", "CSK"]);
    expect(standby).toEqual(["RCB"]);
  });

  it("returns empty active pair with fewer than 2 agents", () => {
    const { activePair } = computeInitialPair([{ agentId: "GT" as const, confidenceScore: 0.8 }]);
    expect(activePair).toEqual([]);
  });
});

describe("handleActiveDrop", () => {
  it("promotes first standby agent into active pair", () => {
    const s = _state({
      activeBidders: ["MI", "CSK"],
      standbyQueue: ["RCB", "DC"],
    });
    const update = handleActiveDrop(s, "MI");
    expect(update.activeBidders).toContain("CSK");
    expect(update.activeBidders).toContain("RCB");
    expect(update.standbyQueue).toEqual(["DC"]);
  });

  it("leaves one-item pair when standby is empty", () => {
    const s = _state({
      activeBidders: ["MI", "CSK"],
      standbyQueue: [],
    });
    const update = handleActiveDrop(s, "CSK");
    expect(update.activeBidders).toEqual(["MI"]);
    expect(update.standbyQueue).toEqual([]);
  });
});

describe("handleRaiseHand", () => {
  it("adds agent to standby queue", () => {
    const s = _state({
      activeBidders: ["MI", "CSK"],
      standbyQueue: ["DC"],
    });
    const update = handleRaiseHand(s, "RCB");
    expect(update.standbyQueue).toContain("RCB");
  });

  it("does not add active bidder to standby", () => {
    const s = _state({
      activeBidders: ["MI", "CSK"],
      standbyQueue: [],
    });
    const update = handleRaiseHand(s, "MI");
    expect(update.standbyQueue).not.toContain("MI");
  });

  it("deduplicates existing standby entries", () => {
    const s = _state({
      activeBidders: ["MI", "CSK"],
      standbyQueue: ["DC"],
    });
    const update = handleRaiseHand(s, "DC");
    expect(update.standbyQueue.filter((id) => id === "DC")).toHaveLength(1);
  });
});

describe("isActiveBidder", () => {
  it("returns true for active bidder", () => {
    const s = _state({ activeBidders: ["MI", "CSK"] });
    expect(isActiveBidder(s, "MI")).toBe(true);
  });

  it("returns false for standby bidder", () => {
    const s = _state({ activeBidders: ["MI", "CSK"], standbyQueue: ["RCB"] });
    expect(isActiveBidder(s, "RCB")).toBe(false);
  });
});
