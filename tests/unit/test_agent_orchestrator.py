"""
Unit tests for the Agent Orchestrator:
  - Scoring function (form, value, role_fit, composite)
  - Plan manager (initialisation, demotion, bid ceilings)
  - ObservationBuilder (type isolation contract)
"""

from __future__ import annotations

import pytest

# These imports resolve via pythonpath = ["services/agent-orchestrator"] in pyproject.toml,
# which puts services/agent-orchestrator on sys.path so `src` is the top-level package.
from src.models import (  # type: ignore[import]
    PERSONALITY_BY_AGENT,
    NominatedPlayer,
    PublicState,
    SquadSlot,
    TeamState,
)
from src.observation_builder import (  # type: ignore[import]
    IsolationLeakError,
    ObservationBuilder,
)
from src.plan_manager import initialize_plan  # type: ignore[import]
from src.scoring import compute_score  # type: ignore[import]

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _player(
    role: str = "batsman",
    sr: float = 140.0,
    avg: float = 35.0,
    economy: float = 0.0,
    wickets: float = 0.0,
    coverage: float = 0.9,
    is_cold_start: bool = False,
) -> NominatedPlayer:
    return NominatedPlayer(
        player_id="p1",
        canonical_name="Test Player",
        role=role,
        player_summary="Test",
        confidence=0.8,
        strike_rate=sr,
        average=avg,
        economy=economy,
        wickets=wickets,
        data_coverage_score=coverage,
        is_cold_start=is_cold_start,
    )


def _team(
    agent_id: str = "MI",
    budget: float = 50.0,
    squad: list[SquadSlot] | None = None,
) -> TeamState:
    return TeamState(
        agent_id=agent_id,  # type: ignore[arg-type]
        budget_remaining_cr=budget,
        squad=squad or [],
    )


def _public_state(bid: float = 0.0) -> PublicState:
    return PublicState(
        auction_id="test-auction",
        nominated_player=_player(),
        current_bid_lakhs=bid,
        bid_deadline_iso="2026-04-19T10:00:00Z",
    )


# ---------------------------------------------------------------------------
# Scoring tests
# ---------------------------------------------------------------------------

class TestScoring:
    def test_composite_in_unit_interval(self) -> None:
        bd = compute_score(_player(), _team(), 0.0, "AGGRESSIVE")
        assert 0.0 <= bd.composite <= 1.0

    def test_form_score_improves_with_higher_sr(self) -> None:
        low_sr = compute_score(_player(sr=80.0), _team(), 0.0, "BALANCED")
        high_sr = compute_score(_player(sr=170.0), _team(), 0.0, "BALANCED")
        assert high_sr.form_score > low_sr.form_score

    def test_value_score_decreases_as_bid_rises(self) -> None:
        p = _player(sr=150.0, avg=40.0)
        v_low = compute_score(p, _team(), 50.0, "BALANCED")
        v_high = compute_score(p, _team(), 300.0, "BALANCED")
        assert v_high.value_score < v_low.value_score

    def test_cold_start_penalty_applied_for_conservative(self) -> None:
        normal = compute_score(_player(), _team(), 0.0, "CONSERVATIVE")
        cold = compute_score(_player(coverage=0.2, is_cold_start=True), _team(), 0.0, "CONSERVATIVE")
        assert normal.cold_start_penalty == 0.0
        assert cold.cold_start_penalty > 0.0

    def test_cold_start_penalty_smaller_for_aggressive(self) -> None:
        cold_agg = compute_score(_player(coverage=0.2, is_cold_start=True), _team(), 0.0, "AGGRESSIVE")
        cold_con = compute_score(_player(coverage=0.2, is_cold_start=True), _team(), 0.0, "CONSERVATIVE")
        assert cold_agg.cold_start_penalty < cold_con.cold_start_penalty

    def test_bowler_scoring_uses_economy(self) -> None:
        good_eco = compute_score(_player(role="bowler", economy=5.5, wickets=15), _team(), 0.0, "BALANCED")
        bad_eco = compute_score(_player(role="bowler", economy=9.5, wickets=5), _team(), 0.0, "BALANCED")
        assert good_eco.form_score > bad_eco.form_score

    def test_squad_need_higher_with_empty_squad(self) -> None:
        empty_team = _team(squad=[])
        full_team = _team(squad=[
            SquadSlot(player_id=f"p{i}", role="batsman", price_lakhs=50) for i in range(20)
        ])
        need_empty = compute_score(_player(), empty_team, 0.0, "BALANCED")
        need_full = compute_score(_player(), full_team, 0.0, "BALANCED")
        assert need_empty.squad_need > need_full.squad_need

    def test_all_components_non_negative(self) -> None:
        bd = compute_score(_player(), _team(), 100.0, "CONSERVATIVE")
        assert bd.form_score >= 0
        assert bd.value_score >= 0
        assert bd.role_fit >= 0
        assert bd.squad_need >= 0
        assert bd.data_confidence >= 0
        assert bd.composite >= 0


# ---------------------------------------------------------------------------
# Plan manager tests
# ---------------------------------------------------------------------------

class TestPlanManager:
    def test_initialises_to_plan_a(self) -> None:
        plan = initialize_plan("MI", _player(), 0.7, 50.0, "AGGRESSIVE")
        assert plan.active_plan == "A"

    def test_max_bid_a_gte_b_gte_c(self) -> None:
        plan = initialize_plan("CSK", _player(), 0.6, 40.0, "BALANCED")
        assert plan.max_bid_a >= plan.max_bid_b >= plan.max_bid_c

    def test_demotion_advances_plan(self) -> None:
        plan = initialize_plan("RR", _player(), 0.5, 30.0, "CONSERVATIVE")
        assert plan.active_plan == "A"
        plan.demote()
        assert plan.active_plan == "B"
        plan.demote()
        assert plan.active_plan == "C"
        plan.demote()
        assert plan.active_plan == "D"

    def test_plan_d_has_no_max_bid(self) -> None:
        plan = initialize_plan("GT", _player(), 0.3, 10.0, "CONSERVATIVE")
        plan.active_plan = "D"
        assert plan.current_max_bid is None

    def test_budget_cap_respected(self) -> None:
        plan = initialize_plan("MI", _player(), 1.0, 10.0, "AGGRESSIVE")
        assert plan.max_bid_a <= 800.0  # 80% of 10 Cr = 800 L

    def test_promote_resets_to_plan_a(self) -> None:
        plan = initialize_plan("RCB", _player(), 0.7, 50.0, "AGGRESSIVE")
        plan.demote()
        plan.demote()
        plan.promote()
        assert plan.active_plan == "A"
        assert plan.consecutive_drops == 0

    def test_conservative_has_lower_max_bid_than_aggressive(self) -> None:
        agg = initialize_plan("MI", _player(), 0.7, 50.0, "AGGRESSIVE")
        con = initialize_plan("RR", _player(), 0.7, 50.0, "CONSERVATIVE")
        assert agg.max_bid_a > con.max_bid_a


# ---------------------------------------------------------------------------
# ObservationBuilder isolation tests
# ---------------------------------------------------------------------------

class TestObservationBuilder:
    def test_builds_for_correct_agent(self) -> None:
        builder = ObservationBuilder("CSK", _team(agent_id="CSK", budget=45.0))
        obs = builder.build(_public_state())
        assert obs.agent_id == "CSK"
        assert obs.budget_remaining_cr == 45.0

    def test_observation_contains_no_other_agent_fields(self) -> None:
        builder = ObservationBuilder("MI", _team(agent_id="MI"))
        obs = builder.build(_public_state())
        obs_dict = obs.model_dump()
        other_agents = {"csk", "rcb", "dc", "kkr", "rr", "pbks", "srh", "lsg", "gt"}
        for key in obs_dict:
            assert key not in other_agents, f"Observation leaked cross-agent field: {key}"

    def test_mismatched_agent_raises_isolation_leak_error(self) -> None:
        csk_team = _team(agent_id="CSK")
        with pytest.raises(IsolationLeakError) as exc_info:
            ObservationBuilder("MI", csk_team)
        assert "MI" in str(exc_info.value)
        assert "CSK" in str(exc_info.value)

    def test_own_squad_included(self) -> None:
        squad = [SquadSlot(player_id="px", role="bowler", price_lakhs=100)]
        team = TeamState(agent_id="KKR", budget_remaining_cr=30.0, squad=squad)
        obs = ObservationBuilder("KKR", team).build(_public_state())
        assert len(obs.own_squad) == 1
        assert obs.own_squad[0].player_id == "px"

    def test_personality_matches_team_model_table(self) -> None:
        for agent_id in ("MI", "RR", "CSK", "RCB", "GT"):
            team = _team(agent_id=agent_id)
            obs = ObservationBuilder(agent_id, team).build(_public_state())  # type: ignore[arg-type]
            assert obs.personality == PERSONALITY_BY_AGENT[agent_id]  # type: ignore[index]

    def test_public_state_bid_propagated(self) -> None:
        obs = ObservationBuilder("DC", _team(agent_id="DC")).build(_public_state(bid=150.0))
        assert obs.current_bid_lakhs == 150.0
