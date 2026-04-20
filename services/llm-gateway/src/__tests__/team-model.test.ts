import { describe, it, expect } from "vitest";
import {
  TEAM_MODELS,
  getTeamModel,
  getFallbackModels,
  type AgentId,
} from "../team-model.js";

describe("TEAM_MODELS", () => {
  it("has exactly 10 entries", () => {
    expect(TEAM_MODELS).toHaveLength(10);
  });

  it("contains all 10 franchise IDs", () => {
    const ids = TEAM_MODELS.map((e) => e.agentId);
    const expected: AgentId[] = ["MI", "CSK", "RCB", "DC", "KKR", "RR", "PBKS", "SRH", "LSG", "GT"];
    expect(ids).toEqual(expect.arrayContaining(expected));
  });

  it("every entry has a non-empty model string", () => {
    for (const entry of TEAM_MODELS) {
      expect(entry.model.length).toBeGreaterThan(0);
    }
  });

  it("personality values are only AGGRESSIVE | BALANCED | CONSERVATIVE", () => {
    const valid = new Set(["AGGRESSIVE", "BALANCED", "CONSERVATIVE"]);
    for (const entry of TEAM_MODELS) {
      expect(valid.has(entry.personality)).toBe(true);
    }
  });
});

describe("getTeamModel", () => {
  it("returns the correct entry for MI", () => {
    const entry = getTeamModel("MI");
    expect(entry.agentId).toBe("MI");
    expect(entry.personality).toBe("AGGRESSIVE");
    expect(entry.model).toContain("llama-3.1-8b");
  });

  it("returns the correct entry for CSK", () => {
    const entry = getTeamModel("CSK");
    expect(entry.agentId).toBe("CSK");
    expect(entry.personality).toBe("BALANCED");
  });

  it("throws for an unknown agent ID", () => {
    // @ts-expect-error — intentional invalid input
    expect(() => getTeamModel("INVALID")).toThrow("Unknown agentId");
  });
});

describe("getFallbackModels", () => {
  it("returns only same-personality entries", () => {
    const primary = getTeamModel("MI"); // AGGRESSIVE
    const fallbacks = getFallbackModels(primary);
    for (const fb of fallbacks) {
      expect(fb.personality).toBe("AGGRESSIVE");
    }
  });

  it("does not include the primary model itself", () => {
    const primary = getTeamModel("MI");
    const fallbacks = getFallbackModels(primary);
    expect(fallbacks.map((f) => f.model)).not.toContain(primary.model);
  });

  it("CONSERVATIVE tier returns at least one fallback (SRH and GT)", () => {
    const primary = getTeamModel("RR"); // CONSERVATIVE
    const fallbacks = getFallbackModels(primary);
    expect(fallbacks.length).toBeGreaterThanOrEqual(1);
  });
});
