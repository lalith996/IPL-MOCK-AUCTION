/**
 * Typed ephemeral system-prompt builder.
 *
 * Constructs a stateless, per-call system prompt from structured context.
 * No session state is stored — the full context is injected on every call.
 */

import type { AgentId, Personality } from "./team-model.js";

export interface SquadSlot {
  playerId: string;
  role: string;
  price: number; // INR lakhs
}

export interface PublicPlayer {
  playerId: string;
  canonicalName: string;
  role: string;
  playerSummary: string;
  confidence: number;
  isColdStart: boolean;
}

export interface CallContext {
  auctionId: string;
  agentId: AgentId;
  personality: Personality;
  /** Own franchise budget remaining in INR crore. */
  budgetRemaining: number;
  /** Own squad (player IDs + roles + prices). */
  ownSquad: readonly SquadSlot[];
  /** Nominated player's SAG payload. */
  nominatedPlayer: PublicPlayer;
  /** Current highest bid in INR lakhs (0 = opening). */
  currentBid: number;
  /** Team that currently holds the bid (null if opening round). */
  currentBidder: AgentId | null;
  /** ISO timestamp for the bid window deadline. */
  bidDeadlineIso: string;
}

const _PERSONALITY_INSTRUCTIONS: Record<Personality, string> = {
  AGGRESSIVE:
    "You bid assertively. You accept higher valuations and prioritize securing " +
    "priority targets even at elevated prices. When uncertain, lean toward bidding.",
  BALANCED:
    "You balance value and squad need. You bid when the price is fair relative " +
    "to the player's projected contribution. Avoid overpaying by more than 20%.",
  CONSERVATIVE:
    "You are disciplined and avoid overpaying. You drop out early when bids exceed " +
    "your valuation threshold. Preserving budget for later rounds is a priority.",
};

/**
 * Builds the ephemeral system prompt for a single LLM call.
 * The returned string is injected as the `system` message and never persisted.
 */
export function buildSystemPrompt(ctx: CallContext): string {
  const squadLines = ctx.ownSquad
    .map((s) => `  - ${s.playerId} (${s.role}) @ ₹${String(s.price)}L`)
    .join("\n");

  return `You are the ${ctx.agentId} franchise agent in an IPL mini-auction.

PERSONALITY: ${ctx.personality}
${_PERSONALITY_INSTRUCTIONS[ctx.personality]}

YOUR BUDGET: ₹${ctx.budgetRemaining.toFixed(2)} Cr remaining

YOUR CURRENT SQUAD:
${squadLines || "  (empty)"}

NOMINATED PLAYER:
  ID:       ${ctx.nominatedPlayer.playerId}
  Name:     ${ctx.nominatedPlayer.canonicalName}
  Role:     ${ctx.nominatedPlayer.role}
  Summary:  ${ctx.nominatedPlayer.playerSummary}
  Confidence: ${(ctx.nominatedPlayer.confidence * 100).toFixed(0)}%${
    ctx.nominatedPlayer.isColdStart ? " [LIMITED DATA — cold-start estimate]" : ""
  }

CURRENT BID: ₹${String(ctx.currentBid)}L${
    ctx.currentBidder ? ` (held by ${ctx.currentBidder})` : " (opening)"
  }
BID DEADLINE: ${ctx.bidDeadlineIso}

RULES:
- You must not reference any other team's budget, squad composition, or strategy.
- You must not fabricate player statistics.
- Your output MUST be valid JSON matching the agent_output schema exactly.
- The "reasoning_summary" field must be ≤ 3 sentences.
- "chosen_plan" must be one of: A, B, C, D.

Respond with a single JSON object. No markdown, no explanation outside the JSON.`;
}

/**
 * Builds the repair prompt used when the first response fails schema validation.
 * Instructs the model to fix specific validation errors.
 */
export function buildRepairPrompt(
  previousResponse: string,
  validationErrors: readonly string[],
): string {
  return (
    "Your previous response failed JSON schema validation. " +
    "Fix ONLY the listed errors and return the corrected JSON object.\n\n" +
    "ERRORS:\n" +
    validationErrors.map((e) => `  - ${e}`).join("\n") +
    "\n\nPREVIOUS RESPONSE:\n" +
    previousResponse
  );
}
