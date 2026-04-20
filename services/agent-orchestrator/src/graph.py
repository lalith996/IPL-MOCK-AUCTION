"""
LangGraph agent subgraph definitions.

Each of the 10 franchise agents runs in an isolated subgraph.
The shared read-only PublicState node is constructed once and
fanned out to all 10 subgraphs — no agent can modify it.

Architecture:
  evaluate_node (shared, read-only)
      │
      ├── agent_subgraph("MI")
      ├── agent_subgraph("CSK")
      │   ... × 10
      └── agent_subgraph("GT")

Each subgraph:
  observe → score → decide → emit_output
"""

from __future__ import annotations

import asyncio

# ---------------------------------------------------------------------------
# LLM Gateway client
# ---------------------------------------------------------------------------
import os
import random
from typing import Any

import httpx
from langgraph.graph import END, StateGraph

from .models import (
    ALL_AGENT_IDS,
    PERSONALITY_BY_AGENT,
    AgentId,
    AgentOutput,
    EvaluateRequest,
    NominatedPlayer,
    PlanLabel,
    ScoreBreakdown,
    TeamState,
)
from .observation_builder import AgentObservation, ObservationBuilder
from .plan_manager import PlanState, initialize_plan
from .scoring import compute_score

_GATEWAY_URL = os.getenv("LLM_GATEWAY_URL", "http://localhost:3002")
_BID_TIMEOUT_S = 8.0   # per spec §8


# ---------------------------------------------------------------------------
# Stochastic modifiers (spec §9)
# ---------------------------------------------------------------------------

def _apply_stochastic(
    base_bid: float,
    personality: str,
    rng: random.Random,
) -> float:
    """Add Gaussian noise to bid threshold ±2–5% depending on personality."""
    noise_pct = {"AGGRESSIVE": 0.05, "BALANCED": 0.03, "CONSERVATIVE": 0.02}[personality]
    noise = rng.gauss(0, base_bid * noise_pct)
    return max(1.0, base_bid + noise)


def _epsilon_greedy(composite: float, personality: str, rng: random.Random) -> bool:
    """
    ε-greedy: on marginal decisions (composite near 0.5) the agent
    randomly bids with probability ε rather than following deterministic logic.
    """
    epsilon = {"AGGRESSIVE": 0.15, "BALANCED": 0.08, "CONSERVATIVE": 0.04}[personality]
    if abs(composite - 0.5) < 0.1:  # marginal decision zone
        return rng.random() < epsilon
    return False


def _time_to_act_variance_ms(personality: str, rng: random.Random) -> float:
    """Random delay (ms) before responding — models human deliberation."""
    base = {"AGGRESSIVE": 200, "BALANCED": 500, "CONSERVATIVE": 900}[personality]
    return max(0.0, rng.gauss(base, base * 0.3))


# ---------------------------------------------------------------------------
# Per-agent subgraph state
# ---------------------------------------------------------------------------

class AgentSubgraphState(dict):  # type: ignore[type-arg]
    """Typed wrapper around LangGraph's state dict for one agent's subgraph."""

    @property
    def observation(self) -> AgentObservation:
        return self["observation"]  # type: ignore[return-value]

    @property
    def plan(self) -> PlanState:
        return self["plan"]  # type: ignore[return-value]

    @property
    def score_breakdown(self) -> ScoreBreakdown:
        return self["score_breakdown"]  # type: ignore[return-value]

    @property
    def output(self) -> AgentOutput | None:
        return self.get("output")  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Node functions
# ---------------------------------------------------------------------------

def _score_node(state: AgentSubgraphState) -> dict[str, Any]:
    """Deterministically compute score breakdown from observation."""
    obs = state.observation
    # Reconstruct TeamState from observation (lightweight)
    from .models import SquadSlot
    team = TeamState(
        agent_id=obs.agent_id,
        budget_remaining_cr=obs.budget_remaining_cr,
        squad=[
            SquadSlot(player_id=s.player_id, role=s.role, price_lakhs=s.price_lakhs)
            for s in obs.own_squad
        ],
        overseas_count=obs.overseas_count,
    )
    player = NominatedPlayer(
        player_id=obs.nominated_player_id,
        canonical_name=obs.nominated_player_name,
        role=obs.nominated_player_role,
        player_summary=obs.nominated_player_summary,
        confidence=obs.nominated_player_confidence,
        is_cold_start=obs.is_cold_start,
    )
    personality = PERSONALITY_BY_AGENT[obs.agent_id]
    breakdown = compute_score(player, team, obs.current_bid_lakhs, personality)
    plan = initialize_plan(
        agent_id=obs.agent_id,
        player=player,
        composite_score=breakdown.composite,
        budget_remaining_cr=obs.budget_remaining_cr,
        personality=personality,
    )
    return {"score_breakdown": breakdown, "plan": plan}


async def _decide_node(state: AgentSubgraphState) -> dict[str, Any]:
    """
    Call the LLM gateway (or fall back to a rule-based decision)
    and return the AgentOutput.
    """
    obs = state.observation
    plan = state.plan
    breakdown = state.score_breakdown
    personality = PERSONALITY_BY_AGENT[obs.agent_id]

    # Stochastic delay
    rng = random.Random()  # fresh RNG per call — seeded externally in golden tests
    delay_ms = _time_to_act_variance_ms(personality, rng)
    await asyncio.sleep(delay_ms / 1000)

    # Compute action deterministically first (LLM adds rationale only)
    max_bid = plan.current_max_bid
    current_bid = obs.current_bid_lakhs

    # ε-greedy override on marginal decisions
    epsilon_override = _epsilon_greedy(breakdown.composite, personality, rng)

    if max_bid is None or breakdown.composite < plan.drop_threshold_score:
        action: str = "drop"
        bid_amount: float | None = None
    elif epsilon_override:
        action = "bid"
        bid_amount = round(_apply_stochastic(current_bid + 5.0, personality, rng), 1)
    elif current_bid < max_bid:
        # Standard increment: next valid bid above current
        increment = _next_increment(current_bid)
        proposed = current_bid + increment
        if proposed <= max_bid:
            action = "bid"
            bid_amount = round(_apply_stochastic(proposed, personality, rng), 1)
        else:
            action = "drop"
            bid_amount = None
    else:
        action = "drop"
        bid_amount = None

    # Attempt LLM call for rationale (best-effort — rule-based fallback on timeout)
    reasoning = await _fetch_rationale(obs, plan, breakdown, action, bid_amount)

    chosen_plan: PlanLabel = plan.active_plan
    return {
        "output": AgentOutput(
            agent_id=obs.agent_id,
            action=action,  # type: ignore[arg-type]
            bid_amount_lakhs=bid_amount,
            confidence_score=min(1.0, breakdown.composite),
            chosen_plan=chosen_plan,
            score_breakdown=breakdown,
            reasoning_summary=reasoning,
            is_cold_start=obs.is_cold_start,
        )
    }


async def _fetch_rationale(
    obs: AgentObservation,
    plan: PlanState,
    breakdown: ScoreBreakdown,
    action: str,
    bid_amount: float | None,
) -> str:
    """
    Ask the LLM gateway for a reasoning_summary (≤3 sentences).
    Returns a rule-based summary on timeout or any error.
    """
    try:
        async with httpx.AsyncClient(timeout=_BID_TIMEOUT_S) as client:
            resp = await client.post(
                f"{_GATEWAY_URL}/gateway/call",
                json={
                    "auctionId": obs.auction_id,
                    "agentId": obs.agent_id,
                    "context": {
                        "auctionId": obs.auction_id,
                        "agentId": obs.agent_id,
                        "personality": PERSONALITY_BY_AGENT[obs.agent_id],
                        "budgetRemaining": obs.budget_remaining_cr,
                        "ownSquad": [
                            {"playerId": s.player_id, "role": s.role, "price": s.price_lakhs}
                            for s in obs.own_squad
                        ],
                        "nominatedPlayer": {
                            "playerId": obs.nominated_player_id,
                            "canonicalName": obs.nominated_player_name,
                            "role": obs.nominated_player_role,
                            "playerSummary": obs.nominated_player_summary,
                            "confidence": obs.nominated_player_confidence,
                            "isColdStart": obs.is_cold_start,
                        },
                        "currentBid": obs.current_bid_lakhs,
                        "currentBidder": obs.current_bidder,
                        "bidDeadlineIso": obs.bid_deadline_iso,
                    },
                },
            )
        if resp.status_code == 200:
            data = resp.json()
            gateway_output = data.get("agentOutput", {})
            rationale = gateway_output.get("rationale", {})
            summary = rationale.get("reasoning_summary", "")
            if summary:
                return str(summary)
    except Exception:  # noqa: BLE001
        pass

    # Rule-based fallback
    return _rule_based_summary(obs.agent_id, action, bid_amount, breakdown)


def _rule_based_summary(
    agent_id: AgentId,
    action: str,
    bid_amount: float | None,
    breakdown: ScoreBreakdown,
) -> str:
    if action == "bid" and bid_amount is not None:
        return (
            f"{agent_id} bids ₹{bid_amount}L. "
            f"Form: {breakdown.form_score:.2f}, Value: {breakdown.value_score:.2f}, "
            f"Composite: {breakdown.composite:.2f}."
        )
    return (
        f"{agent_id} drops out. "
        f"Composite score {breakdown.composite:.2f} is below threshold or bid exceeds ceiling."
    )


def _next_increment(current_bid: float) -> float:
    """IPL-style tiered bid increments (spec §7)."""
    if current_bid < 100:
        return 5.0
    if current_bid < 200:
        return 10.0
    if current_bid < 500:
        return 20.0
    return 25.0


# ---------------------------------------------------------------------------
# Build per-agent subgraph
# ---------------------------------------------------------------------------

def _build_agent_subgraph(agent_id: AgentId) -> StateGraph:
    g: StateGraph = StateGraph(AgentSubgraphState)
    g.add_node("score", _score_node)
    g.add_node("decide", _decide_node)
    g.add_edge("score", "decide")
    g.add_edge("decide", END)
    g.set_entry_point("score")
    return g


_COMPILED_GRAPHS = {
    agent_id: _build_agent_subgraph(agent_id).compile()
    for agent_id in ALL_AGENT_IDS
}


# ---------------------------------------------------------------------------
# Public evaluation entry point
# ---------------------------------------------------------------------------

async def evaluate_all_agents(req: EvaluateRequest) -> list[AgentOutput]:
    """
    Fan out evaluation to all 10 agents concurrently.
    Returns a list of AgentOutput (one per agent), preserving ALL_AGENT_IDS order.
    """
    tasks = []
    for agent_id in ALL_AGENT_IDS:
        team_state = req.team_states.get(agent_id)
        if team_state is None:
            continue
        builder = ObservationBuilder(agent_id, team_state)
        obs = builder.build(req.public_state)
        initial_state = AgentSubgraphState({"observation": obs})
        graph = _COMPILED_GRAPHS[agent_id]
        tasks.append(_run_graph(graph, initial_state, agent_id))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    outputs: list[AgentOutput] = []
    for agent_id, result in zip(ALL_AGENT_IDS, results, strict=False):
        if isinstance(result, Exception):
            # Emit a safe timeout output instead of crashing
            outputs.append(_timeout_output(agent_id))
        elif isinstance(result, AgentOutput):
            outputs.append(result)

    return outputs


async def _run_graph(
    graph: Any,
    state: AgentSubgraphState,
    agent_id: AgentId,
) -> AgentOutput:
    final_state = await graph.ainvoke(state)
    output = final_state.get("output")
    if output is None:
        raise RuntimeError(f"No output from agent {agent_id}")
    return output  # type: ignore[return-value]


def _timeout_output(agent_id: AgentId) -> AgentOutput:
    return AgentOutput(
        agent_id=agent_id,
        action="drop",
        bid_amount_lakhs=None,
        confidence_score=0.0,
        chosen_plan="D",
        score_breakdown=ScoreBreakdown(),
        reasoning_summary=f"{agent_id}: agent.timeout — dropping out.",
        is_cold_start=False,
    )
