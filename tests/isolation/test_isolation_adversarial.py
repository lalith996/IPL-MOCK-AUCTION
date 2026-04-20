"""
Isolation Adversarial Suite — Step 13

Goal: 50+ probes that attempt to elicit cross-agent information leakage.
Every probe must fail to access opponent data or raise an error on attempt.

Coverage areas:
  A. ObservationBuilder construction-time enforcement   (probes 1-20)
  B. PrivateBuffer ACL enforcement (async)              (probes 21-30)
  C. Observation content — no opponent fields present   (probes 31-45)
  D. Serialised observation audit — no foreign tokens   (probes 46-55)

Required for merge. Any failure is a CI blocker.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

import fakeredis.aioredis as fakeredis
import pytest
import src.private_buffer as private_buffer_mod
from src.models import (
    ALL_AGENT_IDS,
    AgentId,
    NominatedPlayer,
    PublicState,
    SquadSlot,
    TeamState,
)
from src.observation_builder import IsolationLeakError, ObservationBuilder

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

ALL_AGENTS: list[AgentId] = list(ALL_AGENT_IDS)

_ISO_NOW = datetime(2026, 4, 19, 12, 0, 0, tzinfo=UTC).isoformat()

_BASE_PLAYER = NominatedPlayer(
    player_id="p-virat-kohli",
    canonical_name="Virat Kohli",
    role="batsman",
    player_summary="Consistent run-scorer with strong IPL record.",
    confidence=0.92,
    is_cold_start=False,
    data_coverage_score=0.95,
    strike_rate=142.0,
    average=48.5,
)

_BASE_PUBLIC = PublicState(
    auction_id="auction-test-001",
    nominated_player=_BASE_PLAYER,
    current_bid_lakhs=400.0,
    current_bidder="MI",
    bid_deadline_iso=_ISO_NOW,
    phase="open_bidding",
)


def _make_team_state(agent_id: AgentId, budget_cr: float = 50.0) -> TeamState:
    return TeamState(
        agent_id=agent_id,
        budget_remaining_cr=budget_cr,
        squad=[
            SquadSlot(
                player_id=f"p-{agent_id.lower()}-star-player",
                role="batsman",
                price_lakhs=100.0,
            )
        ],
        overseas_count=1,
    )


@pytest.fixture
async def fake_redis():
    """In-process async Redis substitute for PrivateBuffer tests."""
    client = fakeredis.FakeRedis(decode_responses=False)
    yield client
    await client.aclose()


# ---------------------------------------------------------------------------
# A. ObservationBuilder construction-time enforcement (probes 1–20)
# ---------------------------------------------------------------------------


class TestObservationBuilderConstruction:
    """
    Probes 1–20: Constructing an ObservationBuilder with a mis-matched
    TeamState must always raise IsolationLeakError immediately — before any
    observation is built or any LLM prompt is generated.
    """

    @pytest.mark.parametrize("attacker", ALL_AGENTS)
    def test_wrong_single_mismatch_raises(self, attacker: AgentId) -> None:
        """Probe 1–10: Each of the 10 agents — wrong TeamState raises at ctor."""
        victim = [a for a in ALL_AGENTS if a != attacker][0]
        victim_state = _make_team_state(victim)
        with pytest.raises(IsolationLeakError):
            ObservationBuilder(agent_id=attacker, own_team_state=victim_state)

    @pytest.mark.parametrize(
        "attacker, victim",
        [
            ("MI", "CSK"),
            ("CSK", "RCB"),
            ("RCB", "DC"),
            ("DC", "KKR"),
            ("KKR", "RR"),
            ("RR", "PBKS"),
            ("PBKS", "SRH"),
            ("SRH", "LSG"),
            ("LSG", "GT"),
            ("GT", "MI"),
        ],
    )
    def test_cross_pair_mismatch_raises(
        self, attacker: AgentId, victim: AgentId
    ) -> None:
        """Probes 11–20: Specific adversarial cross-team pairs all raise."""
        victim_state = _make_team_state(victim)
        with pytest.raises(IsolationLeakError):
            ObservationBuilder(agent_id=attacker, own_team_state=victim_state)


# ---------------------------------------------------------------------------
# B. PrivateBuffer ACL enforcement (probes 21–30)
# ---------------------------------------------------------------------------


class TestPrivateBufferACL:
    """
    Probes 21–30: Cross-agent buffer access is blocked with PermissionError.
    Uses in-process fakeredis — no real Redis required.
    """

    @pytest.mark.parametrize(
        "owner, intruder",
        [
            ("MI", "CSK"),
            ("CSK", "RCB"),
            ("RCB", "DC"),
            ("KKR", "RR"),
            ("PBKS", "SRH"),
        ],
    )
    async def test_get_events_cross_agent_blocked(
        self, owner: AgentId, intruder: AgentId, fake_redis: Any
    ) -> None:
        """Probes 21–25: Reading another agent's buffer raises PermissionError."""
        # Owner legitimately writes one event
        await private_buffer_mod.append_event(
            client=fake_redis,
            auction_id="auction-x",
            agent_id=owner,
            requesting_agent_id=owner,
            event={"type": "bid.placed", "amount": 100},
        )
        # Intruder attempts to read
        with pytest.raises(PermissionError):
            await private_buffer_mod.get_events(
                client=fake_redis,
                auction_id="auction-x",
                agent_id=owner,
                requesting_agent_id=intruder,
            )

    @pytest.mark.parametrize(
        "owner, intruder",
        [
            ("MI", "GT"),
            ("LSG", "MI"),
            ("GT", "KKR"),
            ("SRH", "LSG"),
            ("DC", "PBKS"),
        ],
    )
    async def test_append_cross_agent_blocked(
        self, owner: AgentId, intruder: AgentId, fake_redis: Any
    ) -> None:
        """Probes 26–30: Appending to another agent's buffer raises PermissionError."""
        with pytest.raises(PermissionError):
            await private_buffer_mod.append_event(
                client=fake_redis,
                auction_id="auction-x",
                agent_id=owner,
                requesting_agent_id=intruder,
                event={"type": "malicious", "stolen_budget": 999},
            )


# ---------------------------------------------------------------------------
# C. Observation content — no opponent fields present (probes 31–45)
# ---------------------------------------------------------------------------


class TestObservationContent:
    """
    Probes 31–45: The AgentObservation built for agent X must contain only
    X's own squad/budget and the shared public state. Opponent squad members,
    opponent budgets, and opponent agent IDs must not appear in the output.
    """

    def _build_obs_dict(self, agent_id: AgentId) -> dict[str, Any]:
        """Build an observation and return it as a plain dict."""
        own_state = _make_team_state(agent_id)
        builder = ObservationBuilder(agent_id=agent_id, own_team_state=own_state)
        obs = builder.build(_BASE_PUBLIC)
        return obs.model_dump()

    @pytest.mark.parametrize("agent_id", ALL_AGENTS)
    def test_own_budget_present(self, agent_id: AgentId) -> None:
        """Probes 31–40: Own budget always included in observation."""
        obs = self._build_obs_dict(agent_id)
        assert obs["budget_remaining_cr"] > 0

    @pytest.mark.parametrize("agent_id", ALL_AGENTS)
    def test_own_squad_present_and_correct(self, agent_id: AgentId) -> None:
        """Probes 31–40: Own squad player is present with the correct player_id."""
        obs = self._build_obs_dict(agent_id)
        squad = obs["own_squad"]
        assert len(squad) >= 1
        # All squad player IDs should contain this agent's token
        for slot in squad:
            assert agent_id.lower() in slot["player_id"].lower(), (
                f"Squad slot player_id '{slot['player_id']}' doesn't belong to {agent_id}"
            )

    def test_observation_has_no_all_teams_field(self) -> None:
        """Probe 41: 'all_teams' or 'teams' field must not be present in observation."""
        obs = self._build_obs_dict("MI")
        assert "all_teams" not in obs
        assert "teams" not in obs

    def test_observation_has_no_opponent_budget_field(self) -> None:
        """Probe 42: Raw serialised observation must not contain 'opponent_budget'."""
        obs = self._build_obs_dict("CSK")
        serialised = json.dumps(obs)
        assert "opponent_budget" not in serialised

    def test_observation_nominated_player_present(self) -> None:
        """Probe 43: Nominated player (shared public info) is visible."""
        obs = self._build_obs_dict("RCB")
        assert obs["nominated_player_id"] == "p-virat-kohli"

    def test_observation_current_bid_present(self) -> None:
        """Probe 44: Current bid (shared public info) is visible."""
        obs = self._build_obs_dict("DC")
        assert obs["current_bid_lakhs"] == 400.0

    def test_observation_own_agent_id_correct(self) -> None:
        """Probe 45: agent_id in observation matches the builder's agent."""
        obs = self._build_obs_dict("KKR")
        assert obs["agent_id"] == "KKR"


# ---------------------------------------------------------------------------
# D. Serialised observation audit — no foreign tokens (probes 46–55)
# ---------------------------------------------------------------------------


class TestSerialisedAudit:
    """
    Probes 46–55: Audit the JSON-serialised observation for token patterns
    that should never appear for a given agent. Simulates the audit-hash diff
    tool that detects unexpected cross-agent token overlap in CI.

    Invariant: the serialised observation for agent X must not contain any
    squad player IDs that belong to a different agent Y.
    """

    def _get_serialised(self, agent_id: AgentId) -> str:
        own_state = _make_team_state(agent_id)
        builder = ObservationBuilder(agent_id=agent_id, own_team_state=own_state)
        obs = builder.build(_BASE_PUBLIC)
        return json.dumps(obs.model_dump())

    @pytest.mark.parametrize(
        "owner_agent, foreign_agent",
        [
            ("MI", "CSK"),
            ("MI", "RCB"),
            ("CSK", "DC"),
            ("RCB", "KKR"),
            ("DC", "RR"),
            ("KKR", "PBKS"),
            ("RR", "SRH"),
            ("PBKS", "LSG"),
            ("SRH", "GT"),
            ("LSG", "MI"),
        ],
    )
    def test_no_foreign_squad_player_ids(
        self, owner_agent: AgentId, foreign_agent: AgentId
    ) -> None:
        """
        Probes 46–55: The serialised observation for owner_agent must not
        contain the squad player ID that belongs to foreign_agent.
        """
        foreign_state = _make_team_state(foreign_agent)
        foreign_player_id = foreign_state.squad[0].player_id

        serialised = self._get_serialised(owner_agent)

        assert foreign_player_id not in serialised, (
            f"ISOLATION LEAK DETECTED: Agent {owner_agent}'s observation "
            f"contains player ID '{foreign_player_id}' belonging to "
            f"{foreign_agent}. Serialised length: {len(serialised)} chars."
        )


# ---------------------------------------------------------------------------
# Audit hash diff utility (standalone, tested here)
# ---------------------------------------------------------------------------


def compute_token_overlap(prompt_a: str, prompt_b: str) -> float:
    """
    Returns the Jaccard similarity of the word-token sets in two strings.
    A high score between prompts from different agents signals possible leakage.
    Threshold >0.4 on sensitive tokens warrants investigation.
    """
    stop_words = {"the", "a", "an", "is", "in", "of", "and", "to", "for", "with"}
    tokens_a = {t.lower() for t in re.split(r"\W+", prompt_a) if len(t) > 3} - stop_words
    tokens_b = {t.lower() for t in re.split(r"\W+", prompt_b) if len(t) > 3} - stop_words
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


class TestAuditHashDiff:
    """Verify the audit-hash utility and cross-agent observation independence."""

    def test_identical_prompts_have_overlap_one(self) -> None:
        """Utility: identical prompts → overlap == 1.0."""
        p = "Virat Kohli budget squad remaining overseas role"
        assert compute_token_overlap(p, p) == 1.0

    def test_disjoint_prompts_have_overlap_zero(self) -> None:
        """Utility: completely disjoint prompts → overlap == 0.0."""
        a = "alpha beta gamma delta epsilon"
        b = "omega sigma theta kappa lambda"
        assert compute_token_overlap(a, b) == 0.0

    def test_cross_agent_observations_no_private_token_leak(self) -> None:
        """
        Build observations for two agents; verify their private squad player IDs
        do not appear in the other agent's serialised observation.
        """
        agents: list[AgentId] = ["MI", "CSK"]
        serialisations: dict[str, str] = {}
        private_ids: dict[str, str] = {}

        for agent_id in agents:
            own_state = _make_team_state(agent_id)
            private_ids[agent_id] = own_state.squad[0].player_id
            builder = ObservationBuilder(agent_id=agent_id, own_team_state=own_state)
            obs = builder.build(_BASE_PUBLIC)
            serialisations[agent_id] = json.dumps(obs.model_dump())

        # MI's private player ID must not appear in CSK's observation
        assert private_ids["MI"] not in serialisations["CSK"], (
            "AUDIT LEAK: MI's private squad token found in CSK's observation."
        )
        # CSK's private player ID must not appear in MI's observation
        assert private_ids["CSK"] not in serialisations["MI"], (
            "AUDIT LEAK: CSK's private squad token found in MI's observation."
        )
