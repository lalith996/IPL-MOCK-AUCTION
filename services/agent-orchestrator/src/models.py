"""Pydantic models for the Agent Orchestrator."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AgentId = Literal["MI", "CSK", "RCB", "DC", "KKR", "RR", "PBKS", "SRH", "LSG", "GT"]
Personality = Literal["AGGRESSIVE", "BALANCED", "CONSERVATIVE"]
PlanLabel = Literal["A", "B", "C", "D"]
ActionType = Literal["bid", "drop", "pass"]

ALL_AGENT_IDS: tuple[AgentId, ...] = (
    "MI", "CSK", "RCB", "DC", "KKR", "RR", "PBKS", "SRH", "LSG", "GT",
)

PERSONALITY_BY_AGENT: dict[AgentId, Personality] = {
    "MI":   "AGGRESSIVE",
    "CSK":  "BALANCED",
    "RCB":  "AGGRESSIVE",
    "DC":   "BALANCED",
    "KKR":  "BALANCED",
    "RR":   "CONSERVATIVE",
    "PBKS": "AGGRESSIVE",
    "SRH":  "CONSERVATIVE",
    "LSG":  "BALANCED",
    "GT":   "CONSERVATIVE",
}


class SquadSlot(BaseModel):
    player_id: str
    role: str
    price_lakhs: float = Field(ge=0)


class NominatedPlayer(BaseModel):
    player_id: str
    canonical_name: str
    role: str
    player_summary: str
    confidence: float = Field(ge=0, le=1)
    is_cold_start: bool = False
    # SAG metrics (subset used for scoring)
    strike_rate: float = 0.0
    average: float = 0.0
    economy: float = 0.0
    wickets: float = 0.0
    data_coverage_score: float = 1.0


class TeamState(BaseModel):
    agent_id: AgentId
    budget_remaining_cr: float = Field(ge=0)
    squad: list[SquadSlot] = Field(default_factory=list)
    overseas_count: int = Field(ge=0, default=0)


class PublicState(BaseModel):
    auction_id: str
    nominated_player: NominatedPlayer
    current_bid_lakhs: float = 0.0
    current_bidder: AgentId | None = None
    bid_deadline_iso: str
    phase: Literal["opening_bid", "open_bidding"] = "opening_bid"


class ScoreBreakdown(BaseModel):
    form_score: float = 0.0
    value_score: float = 0.0
    role_fit: float = 0.0
    squad_need: float = 0.0
    data_confidence: float = 0.0
    budget_pressure: float = 0.0
    personality_bonus: float = 0.0
    cold_start_penalty: float = 0.0
    composite: float = 0.0


class AgentOutput(BaseModel):
    agent_id: AgentId
    action: ActionType
    bid_amount_lakhs: float | None = None
    confidence_score: float = Field(ge=0, le=1)
    chosen_plan: PlanLabel
    score_breakdown: ScoreBreakdown
    reasoning_summary: str
    is_cold_start: bool = False


class EvaluateRequest(BaseModel):
    auction_id: str
    nominated_player: NominatedPlayer
    public_state: PublicState
    team_states: dict[AgentId, TeamState]


class EvaluateResponse(BaseModel):
    auction_id: str
    player_id: str
    agent_outputs: list[AgentOutput]
