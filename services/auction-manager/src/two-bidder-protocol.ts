/**
 * Two-bidder turn-taking protocol (spec §5).
 *
 * - Top-2 agents by confidence_score are the active pair.
 * - Other agents join the standby queue.
 * - A standby agent can raise their hand every 10s to re-enter.
 * - If an active bidder drops, the next in standby takes their slot.
 */

import type { AgentId, AuctionState } from "./types.js";

/** Standby agents may re-enter every 10 s (enforced by orchestrator timer). */
export const RAISE_HAND_INTERVAL_MS = 10_000;

export interface AgentConfidence {
  agentId: AgentId;
  confidenceScore: number;
}

/**
 * Given all agent confidence scores, compute the two-bidder pair and standby queue.
 * Returns them in descending confidence order.
 */
export function computeInitialPair(
  scores: AgentConfidence[],
): { activePair: [AgentId, AgentId] | []; standby: AgentId[] } {
  const sorted = [...scores].sort((a, b) => b.confidenceScore - a.confidenceScore);
  if (sorted.length < 2) {
    return { activePair: [], standby: sorted.map((s) => s.agentId) };
  }
  const first = sorted[0];
  const second = sorted[1];
  const rest = sorted.slice(2);
  if (!first || !second) {
    return { activePair: [], standby: sorted.map((s) => s.agentId) };
  }
  return {
    activePair: [first.agentId, second.agentId],
    standby: rest.map((s) => s.agentId),
  };
}

/**
 * Handle a drop from an active bidder.
 * Promotes the first standby agent into the active pair.
 */
export function handleActiveDrop(
  state: AuctionState,
  droppedAgent: AgentId,
): Pick<AuctionState, "activeBidders" | "standbyQueue"> {
  const [first, second] = state.activeBidders as [AgentId, AgentId];
  const standby = [...state.standbyQueue];

  // Remove the dropped agent from the active pair
  const remaining = ([first, second] as AgentId[]).filter((id) => id !== droppedAgent);

  if (standby.length > 0) {
    const promoted = standby[0];
    const newStandby = standby.slice(1);
    if (promoted) remaining.push(promoted);
    return {
      activeBidders: remaining as [AgentId, AgentId],
      standbyQueue: newStandby,
    };
  }

  // No standby — only one bidder left (or none)
  return {
    activeBidders: remaining as [AgentId, AgentId],
    standbyQueue: [],
  };
}

/**
 * Handle a raise-hand request from a standby agent.
 * Agent is moved to the end of the standby queue if not already in it.
 */
export function handleRaiseHand(
  state: AuctionState,
  agentId: AgentId,
): Pick<AuctionState, "standbyQueue"> {
  // Can't raise hand if already active
  if ((state.activeBidders as AgentId[]).includes(agentId)) {
    return { standbyQueue: state.standbyQueue };
  }
  // Move to end of standby if not already there
  const queue = state.standbyQueue.filter((id) => id !== agentId);
  return { standbyQueue: [...queue, agentId] };
}

/** Returns whether the given agent is currently an active bidder. */
export function isActiveBidder(state: AuctionState, agentId: AgentId): boolean {
  return (state.activeBidders as AgentId[]).includes(agentId);
}
