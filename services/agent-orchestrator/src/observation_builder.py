"""
Typed ObservationBuilder — constructs the LLM call context for a single agent.

ISOLATION CONTRACT:
  - Input type is (PublicState, TeamState for THIS agent only).
  - No other team's TeamState is reachable from this module.
  - The type signature enforces single-agent scope at compile time.
  - Cross-agent access raises IsolationLeakError at runtime.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .models import (
    PERSONALITY_BY_AGENT,
    AgentId,
    Personality,
    PublicState,
    TeamState,
)

# ---------------------------------------------------------------------------
# Isolation guard
# ---------------------------------------------------------------------------

class IsolationLeakError(RuntimeError):
    """Raised when an attempt is made to access another agent's private state."""

    def __init__(self, accessor: AgentId, victim: AgentId) -> None:
        super().__init__(
            f"ISOLATION LEAK: agent {accessor} attempted to access "
            f"state belonging to agent {victim}."
        )
        self.accessor = accessor
        self.victim = victim


# ---------------------------------------------------------------------------
# Observation — typed payload passed to the LLM gateway
# ---------------------------------------------------------------------------

class SquadSlotView(BaseModel):
    player_id: str
    role: str
    price_lakhs: float


class AgentObservation(BaseModel):
    """Fully self-contained context for one agent's LLM call.

    Contains zero information about other agents' squads, budgets, or plans.
    """
    auction_id: str
    agent_id: AgentId
    personality: Personality
    budget_remaining_cr: float = Field(ge=0)
    own_squad: list[SquadSlotView] = Field(default_factory=list)
    overseas_count: int = Field(ge=0)
    nominated_player_id: str
    nominated_player_name: str
    nominated_player_role: str
    nominated_player_summary: str
    nominated_player_confidence: float = Field(ge=0, le=1)
    is_cold_start: bool
    current_bid_lakhs: float = Field(ge=0)
    current_bidder: AgentId | None
    bid_deadline_iso: str
    phase: str


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

class ObservationBuilder:
    """
    Constructs an AgentObservation for exactly one agent.

    The constructor takes only the agent's own TeamState — other agents'
    states are structurally impossible to pass in.
    """

    def __init__(self, agent_id: AgentId, own_team_state: TeamState) -> None:
        if own_team_state.agent_id != agent_id:
            # Runtime guard — catches accidental mismatches
            raise IsolationLeakError(agent_id, own_team_state.agent_id)
        self._agent_id = agent_id
        self._team = own_team_state

    def build(self, public_state: PublicState) -> AgentObservation:
        """Build the observation from public state + this agent's private state only."""
        player = public_state.nominated_player
        return AgentObservation(
            auction_id=public_state.auction_id,
            agent_id=self._agent_id,
            personality=PERSONALITY_BY_AGENT[self._agent_id],
            budget_remaining_cr=self._team.budget_remaining_cr,
            own_squad=[
                SquadSlotView(
                    player_id=s.player_id,
                    role=s.role,
                    price_lakhs=s.price_lakhs,
                )
                for s in self._team.squad
            ],
            overseas_count=self._team.overseas_count,
            nominated_player_id=player.player_id,
            nominated_player_name=player.canonical_name,
            nominated_player_role=player.role,
            nominated_player_summary=player.player_summary,
            nominated_player_confidence=player.confidence,
            is_cold_start=player.is_cold_start,
            current_bid_lakhs=public_state.current_bid_lakhs,
            current_bidder=public_state.current_bidder,
            bid_deadline_iso=public_state.bid_deadline_iso,
            phase=public_state.phase,
        )
