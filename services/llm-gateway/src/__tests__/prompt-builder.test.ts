import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildRepairPrompt, type CallContext } from "../prompt-builder.js";

const BASE_CTX: CallContext = {
  auctionId: "auction-test",
  agentId: "MI",
  personality: "AGGRESSIVE",
  budgetRemaining: 45.5,
  ownSquad: [
    { playerId: "player_a", role: "batsman", price: 200 },
    { playerId: "player_b", role: "bowler", price: 150 },
  ],
  nominatedPlayer: {
    playerId: "player_c",
    canonicalName: "Test Player",
    role: "all-rounder",
    playerSummary: "Solid performer with high strike rate.",
    confidence: 0.85,
    isColdStart: false,
  },
  currentBid: 100,
  currentBidder: "CSK",
  bidDeadlineIso: "2026-04-19T10:00:00Z",
};

describe("buildSystemPrompt", () => {
  it("includes the agent ID", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain("MI");
  });

  it("includes personality tier", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain("AGGRESSIVE");
  });

  it("includes budget remaining", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain("45.50");
  });

  it("includes own squad slots", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain("player_a");
    expect(prompt).toContain("player_b");
  });

  it("includes nominated player name", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain("Test Player");
  });

  it("includes current bid and bidder", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain("₹100L");
    expect(prompt).toContain("CSK");
  });

  it("shows [LIMITED DATA] badge for cold-start players", () => {
    const ctx: CallContext = {
      ...BASE_CTX,
      nominatedPlayer: { ...BASE_CTX.nominatedPlayer, isColdStart: true },
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("LIMITED DATA");
  });

  it("does not show LIMITED DATA for well-covered players", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).not.toContain("LIMITED DATA");
  });

  it("instructs no cross-agent state access", () => {
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/not reference any other team/i);
  });
});

describe("buildRepairPrompt", () => {
  it("includes the previous response text", () => {
    const prompt = buildRepairPrompt("{bad json", ["root — must have required property 'action'"]);
    expect(prompt).toContain("{bad json");
  });

  it("includes each validation error", () => {
    const errors = ["root — must have required property 'action'", "confidence_score — must be number"];
    const prompt = buildRepairPrompt("{}", errors);
    for (const e of errors) {
      expect(prompt).toContain(e);
    }
  });
});
