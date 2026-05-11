import { describe, it, expect, vi } from "vitest";
import { AuctionFSM, createInitialState } from "../fsm.js";
import type { EventStore } from "../event-store.js";

function makeStore(): EventStore {
  return {
    appendEvent: vi.fn().mockResolvedValue(undefined),
    saveSnapshot: vi.fn().mockResolvedValue(undefined),
  } as unknown as EventStore;
}

function makeFSM(): AuctionFSM {
  return new AuctionFSM(makeStore(), createInitialState("test-auction", "seed-42"));
}

describe("AuctionFSM.state — shallow copy isolation", () => {
  it("mutating the returned state does not affect internal FSM state", () => {
    const fsm = makeFSM();

    const snapshot = fsm.state;
    // Direct mutation of the returned snapshot
    (snapshot as { phase: string }).phase = "complete";

    // Internal state must remain unchanged
    expect(fsm.state.phase).toBe("prep");
  });

  it("mutating a team object in the returned state does not affect internal FSM state", () => {
    const fsm = makeFSM();

    const snapshot = fsm.state;
    const mi = snapshot.teams["MI"];
    if (mi) {
      (mi as { budgetRemainingCr: number }).budgetRemainingCr = 0;
    }

    expect(fsm.state.teams["MI"]?.budgetRemainingCr).toBe(100);
  });

  it("mutating the squad array in the returned state does not affect internal FSM state", () => {
    const fsm = makeFSM();

    const snapshot = fsm.state;
    snapshot.teams["CSK"]?.squad.push({
      playerId: "injected",
      role: "batter",
      nationality: "indian",
      priceLakhs: 1,
    });

    expect(fsm.state.teams["CSK"]?.squad).toHaveLength(0);
  });

  it("mutating activeBidders in the returned state does not affect internal FSM state", () => {
    const fsm = makeFSM();

    const snapshot = fsm.state;
    (snapshot.activeBidders as string[]).push("MI");

    expect(fsm.state.activeBidders).toHaveLength(0);
  });

  it("mutating standbyQueue in the returned state does not affect internal FSM state", () => {
    const fsm = makeFSM();

    const snapshot = fsm.state;
    snapshot.standbyQueue.push("MI");

    expect(fsm.state.standbyQueue).toHaveLength(0);
  });
});
