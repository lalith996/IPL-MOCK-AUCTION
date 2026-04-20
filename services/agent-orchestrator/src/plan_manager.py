"""
Per-agent Plan A/B/C/D state.

Plan assignment algorithm (greedy initialization, spec §8):
  A — primary target: highest composite score within budget
  B — fallback: second-highest priority player, lower budget threshold
  C — budget-saver: cheapest player still above minimum score threshold
  D — abandon: drop out early to preserve budget for later rounds
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .models import AgentId, NominatedPlayer, Personality, PlanLabel


class PlanState(BaseModel):
    agent_id: AgentId
    active_plan: PlanLabel = "A"
    # Maximum price the agent is willing to pay (INR lakhs) under each plan
    max_bid_a: float = Field(ge=0)
    max_bid_b: float = Field(ge=0)
    max_bid_c: float = Field(ge=0)
    # D = always drop; no max_bid needed
    drop_threshold_score: float = Field(ge=0, le=1, default=0.3)
    # How many consecutive drops this nomination (triggers plan demotion)
    consecutive_drops: int = 0

    def demote(self) -> None:
        """Move to the next plan level on a drop event."""
        ladder: list[PlanLabel] = ["A", "B", "C", "D"]
        idx = ladder.index(self.active_plan)
        if idx < len(ladder) - 1:
            self.active_plan = ladder[idx + 1]
        self.consecutive_drops += 1

    def promote(self) -> None:
        """Reset to Plan A for the next nomination cycle."""
        self.active_plan = "A"
        self.consecutive_drops = 0

    @property
    def current_max_bid(self) -> float | None:
        """Maximum bid for the active plan (None = always drop)."""
        match self.active_plan:
            case "A": return self.max_bid_a
            case "B": return self.max_bid_b
            case "C": return self.max_bid_c
            case "D": return None


# Personality-based bid ceiling multipliers (applied to fair-value estimate)
_BID_MULTIPLIERS: dict[Personality, dict[PlanLabel, float]] = {
    "AGGRESSIVE":   {"A": 1.40, "B": 1.15, "C": 0.90, "D": 0.0},
    "BALANCED":     {"A": 1.20, "B": 1.05, "C": 0.85, "D": 0.0},
    "CONSERVATIVE": {"A": 1.00, "B": 0.90, "C": 0.75, "D": 0.0},
}


def initialize_plan(
    agent_id: AgentId,
    player: NominatedPlayer,
    composite_score: float,
    budget_remaining_cr: float,
    personality: Personality,
) -> PlanState:
    """
    Greedily initialise a PlanState for this nomination.

    Fair value (in lakhs) is estimated from composite_score × 200.
    Budget cap is applied: no plan should exceed the team's remaining budget.
    """
    budget_lakhs = budget_remaining_cr * 100  # 1 crore = 100 lakhs
    fair_value = max(20.0, composite_score * 200.0)
    mults = _BID_MULTIPLIERS[personality]

    def _cap(mult: float) -> float:
        return min(budget_lakhs * 0.8, fair_value * mult)  # never bet >80% of budget

    return PlanState(
        agent_id=agent_id,
        active_plan="A",
        max_bid_a=round(_cap(mults["A"]), 1),
        max_bid_b=round(_cap(mults["B"]), 1),
        max_bid_c=round(_cap(mults["C"]), 1),
        drop_threshold_score=0.2 if personality == "AGGRESSIVE" else (
            0.3 if personality == "BALANCED" else 0.4
        ),
    )
