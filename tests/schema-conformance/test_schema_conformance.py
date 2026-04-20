"""
Schema Conformance Suite — Step 13

Validates that every service output shape conforms to the canonical JSON Schemas
defined in packages/schemas/src/.

Coverage:
  1. Golden fixtures from packages/schemas/fixtures/ validate against their schemas.
  2. Synthetic agent_output fixtures (all actions, all plan labels).
  3. Synthetic auction_event fixtures (all event types in the schema).
  4. Synthetic sag_output fixtures (cold-start vs. normal).
  5. Negative fixtures — deliberately invalid documents must be REJECTED.

Required for merge. Any fixture that fails schema validation blocks CI.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parents[2]
SCHEMAS_DIR = REPO_ROOT / "packages" / "schemas" / "src"
FIXTURES_DIR = REPO_ROOT / "packages" / "schemas" / "fixtures"


def _load_schema(name: str) -> dict[str, Any]:
    """Load a JSON Schema by filename (without .schema.json suffix)."""
    path = SCHEMAS_DIR / f"{name}.schema.json"
    return json.loads(path.read_text())


def _load_fixture(name: str) -> dict[str, Any]:
    """Load a golden fixture by filename (without .fixture.json suffix)."""
    path = FIXTURES_DIR / f"{name}.fixture.json"
    return json.loads(path.read_text())


def _validate(instance: dict[str, Any], schema: dict[str, Any]) -> None:
    """Validate instance against schema; raises jsonschema.ValidationError on failure."""
    validator = jsonschema.Draft7Validator(schema)
    errors = list(validator.iter_errors(instance))
    if errors:
        messages = [f"  - {e.json_path}: {e.message}" for e in errors[:5]]
        raise AssertionError("Schema validation failed:\n" + "\n".join(messages))


# ---------------------------------------------------------------------------
# 1. Golden fixture round-trips
# ---------------------------------------------------------------------------

class TestGoldenFixtures:
    """
    The golden fixtures in packages/schemas/fixtures/ must validate
    against their respective schemas — the primary schema contract test.
    """

    def test_agent_output_fixture(self) -> None:
        """Golden agent_output fixture is schema-valid."""
        _validate(_load_fixture("agent_output"), _load_schema("agent_output"))

    def test_sag_output_fixture(self) -> None:
        """Golden sag_output fixture is schema-valid."""
        _validate(_load_fixture("sag_output"), _load_schema("sag_output"))

    def test_auction_event_fixture(self) -> None:
        """Golden auction_event fixture is schema-valid."""
        _validate(_load_fixture("auction_event"), _load_schema("auction_event"))


# ---------------------------------------------------------------------------
# 2. Synthetic agent_output fixtures — all action/plan combinations
# ---------------------------------------------------------------------------

_AGENT_OUTPUT_SCHEMA = _load_schema("agent_output")
_ALL_AGENTS = ["MI", "CSK", "RCB", "DC", "KKR", "RR", "PBKS", "SRH", "LSG", "GT"]
_ALL_ACTIONS = ["pass", "bid", "raise", "drop"]
_ALL_PLANS = ["A", "B", "C", "D"]

SCORE_BREAKDOWN = {
    "form_score": 0.7,
    "role_fit": 0.8,
    "home_ground_fit": 0.6,
    "career_score": 0.75,
    "phase_fit": 0.65,
    "injury_risk": 0.15,
    "social_buzz": 0.5,
    "price_elasticity": 0.4,
    "total": 0.68,
}


def _make_agent_output(
    agent_id: str = "MI",
    action: str = "bid",
    bid_amount: float | None = 15_000_000,
    plan: str = "A",
    is_cold_start: bool = False,
) -> dict[str, Any]:
    return {
        "agent_id": agent_id,
        "timestamp": "2026-04-19T12:00:00Z",
        "player_id": "p-player-001",
        "action": action,
        "bid_amount": bid_amount,
        "confidence_score": 0.75,
        "rationale": {
            "score_breakdown": SCORE_BREAKDOWN,
            "reasoning_summary": "Strong form and role fit at powerplay.",
            "is_cold_start": is_cold_start,
        },
        "chosen_plan": plan,
    }


class TestAgentOutputConformance:
    """All synthetic agent_output fixtures must validate against the schema."""

    @pytest.mark.parametrize("agent_id", _ALL_AGENTS)
    def test_all_agent_ids_valid(self, agent_id: str) -> None:
        """Each of the 10 franchise IDs produces a valid agent_output."""
        _validate(_make_agent_output(agent_id=agent_id), _AGENT_OUTPUT_SCHEMA)

    @pytest.mark.parametrize("action", _ALL_ACTIONS)
    def test_all_actions_valid(self, action: str) -> None:
        """Each action type produces a valid agent_output."""
        bid = 20_000_000 if action in ("bid", "raise") else None
        _validate(_make_agent_output(action=action, bid_amount=bid), _AGENT_OUTPUT_SCHEMA)

    @pytest.mark.parametrize("plan", _ALL_PLANS)
    def test_all_plan_labels_valid(self, plan: str) -> None:
        """Each plan label (A/B/C/D) produces a valid agent_output."""
        _validate(_make_agent_output(plan=plan), _AGENT_OUTPUT_SCHEMA)

    def test_cold_start_flag_valid(self) -> None:
        """agent_output with is_cold_start=True is schema-valid."""
        _validate(_make_agent_output(is_cold_start=True), _AGENT_OUTPUT_SCHEMA)

    def test_null_bid_on_pass_valid(self) -> None:
        """bid_amount=null with action=pass is schema-valid."""
        _validate(
            _make_agent_output(action="pass", bid_amount=None),
            _AGENT_OUTPUT_SCHEMA,
        )


# ---------------------------------------------------------------------------
# 3. Synthetic auction_event fixtures — all event types
# ---------------------------------------------------------------------------

_AUCTION_EVENT_SCHEMA = _load_schema("auction_event")
_ALL_EVENT_TYPES = [
    "auction.started",
    "auction.paused",
    "auction.resumed",
    "auction.ended",
    "player.nominated",
    "bid.placed",
    "bid.raised",
    "bid.dropped",
    "bid.rejected",
    "player.sold",
    "player.unsold",
    "agent.timeout",
    "agent.cooldown",
    "snapshot.taken",
]


def _make_auction_event(
    event_type: str,
    seq: int = 1,
    agent_id: str | None = None,
) -> dict[str, Any]:
    return {
        "event_id": "550e8400-e29b-41d4-a716-446655440000",
        "auction_id": "550e8400-e29b-41d4-a716-446655440001",
        "seq": seq,
        "type": event_type,
        "payload": {"note": f"synthetic fixture for {event_type}"},
        "timestamp": "2026-04-19T12:00:00Z",
        "agent_id": agent_id,
    }


class TestAuctionEventConformance:
    """All 14 auction event types produce schema-valid events."""

    @pytest.mark.parametrize("event_type", _ALL_EVENT_TYPES)
    def test_event_type_valid(self, event_type: str) -> None:
        """Each defined event type produces a valid auction_event."""
        agent = "MI" if "agent" in event_type or "bid" in event_type else None
        _validate(_make_auction_event(event_type, agent_id=agent), _AUCTION_EVENT_SCHEMA)

    def test_seq_monotonically_valid(self) -> None:
        """Sequential events with increasing seq numbers are individually valid."""
        for seq in [1, 2, 10, 100, 999]:
            _validate(
                _make_auction_event("bid.placed", seq=seq, agent_id="CSK"),
                _AUCTION_EVENT_SCHEMA,
            )

    def test_null_agent_id_on_system_events(self) -> None:
        """System events (auction.started, player.nominated) with null agent_id are valid."""
        for event_type in ("auction.started", "player.nominated", "snapshot.taken"):
            _validate(
                _make_auction_event(event_type, agent_id=None),
                _AUCTION_EVENT_SCHEMA,
            )


# ---------------------------------------------------------------------------
# 4. Synthetic sag_output fixtures
# ---------------------------------------------------------------------------

_SAG_OUTPUT_SCHEMA = _load_schema("sag_output")


def _make_sag_output(
    confidence: float = 0.90,
    include_cold_start: bool = False,
) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "player_id": "p-player-001",
        "player_summary": "Right-handed batter with strong T20 record.",
        "last_12_innings_metrics": {
            "runs": 350.0,
            "strike_rate": 138.5,
            "average": 29.2,
            "boundary_pct": 21.0,
            "dot_pct": 30.0,
            "wickets": 0.0,
            "economy": 0.0,
            "bowling_sr": 0.0,
        },
        "situational_metrics": {
            "powerplay": {"sr": 155.0, "economy": 0.0},
            "middle": {"sr": 128.0, "economy": 0.0},
            "death": {"sr": 142.0, "economy": 0.0},
        },
        "injury_status": {
            "source": "mock-feed",
            "timestamp": "2026-04-19T08:00:00Z",
            "severity": "none",
            "expected_return": None,
        },
        "social_buzz": {
            "volume": 8000.0,
            "sentiment": 0.55,
            "top_sources": ["cricbuzz"],
        },
        "confidence": confidence,
        "provenance": [
            {
                "source": "cricsheet",
                "fetched_at": "2026-04-19T00:00:00Z",
                "type": "cricsheet",
                "stale": False,
            }
        ],
    }
    if include_cold_start:
        doc["cold_start_profile"] = {
            "cohort_ids": ["p-peer-001", "p-peer-002"],
            "cohort_size": 5,
            # imputed_metrics must contain exactly {strike_rate, economy, role_fit}
            "imputed_metrics": {
                "strike_rate": 130.0,
                "economy": 8.5,
                "role_fit": 0.72,
            },
            "source_signals": ["role_median", "age_cohort"],
            "data_coverage_score": 0.35,
            "imputation_confidence": 0.60,
        }
    return doc


class TestSagOutputConformance:
    """Synthetic SAG outputs for normal and cold-start players are schema-valid."""

    def test_normal_player_sag_output(self) -> None:
        """SAG output for a player with full Cricsheet coverage is valid."""
        _validate(_make_sag_output(confidence=0.92), _SAG_OUTPUT_SCHEMA)

    def test_cold_start_player_sag_output(self) -> None:
        """SAG output for a cold-start player with imputed profile is valid."""
        _validate(
            _make_sag_output(confidence=0.45, include_cold_start=True),
            _SAG_OUTPUT_SCHEMA,
        )

    def test_minimal_confidence_zero_valid(self) -> None:
        """SAG output with confidence=0 (total miss) is schema-valid.
        Provenance must still have at least 1 entry (minItems:1 in schema).
        """
        doc = _make_sag_output(confidence=0.0)
        # Keep at least one provenance entry — empty array is rejected by schema
        doc["provenance"] = [
            {
                "source": "missing",
                "fetched_at": "2026-04-19T00:00:00Z",
                "type": "cricsheet",
                "stale": True,
            }
        ]
        _validate(doc, _SAG_OUTPUT_SCHEMA)

    def test_all_injury_severities_valid(self) -> None:
        """All four injury severity levels produce valid SAG outputs."""
        for severity in ("none", "minor", "moderate", "major"):
            doc = _make_sag_output()
            doc["injury_status"]["severity"] = severity  # type: ignore[index]
            _validate(doc, _SAG_OUTPUT_SCHEMA)


# ---------------------------------------------------------------------------
# 5. Negative fixtures — invalid documents must be REJECTED
# ---------------------------------------------------------------------------

class TestNegativeConformance:
    """Deliberately malformed documents must fail schema validation."""

    def test_agent_output_missing_required_field(self) -> None:
        """agent_output without 'action' must be rejected."""
        doc = _make_agent_output()
        del doc["action"]
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AGENT_OUTPUT_SCHEMA)

    def test_agent_output_invalid_agent_id(self) -> None:
        """agent_output with unknown agent_id must be rejected."""
        doc = _make_agent_output()
        doc["agent_id"] = "UNKNOWN_TEAM"
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AGENT_OUTPUT_SCHEMA)

    def test_agent_output_invalid_action(self) -> None:
        """agent_output with action='fold' (not in enum) must be rejected."""
        doc = _make_agent_output()
        doc["action"] = "fold"
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AGENT_OUTPUT_SCHEMA)

    def test_agent_output_confidence_out_of_range(self) -> None:
        """agent_output with confidence_score > 1 must be rejected."""
        doc = _make_agent_output()
        doc["confidence_score"] = 1.5
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AGENT_OUTPUT_SCHEMA)

    def test_agent_output_extra_property_rejected(self) -> None:
        """agent_output with an extra top-level field must be rejected (additionalProperties: false)."""
        doc = _make_agent_output()
        doc["opponent_budget"] = 9999  # type: ignore[assignment]
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AGENT_OUTPUT_SCHEMA)

    def test_auction_event_missing_event_id(self) -> None:
        """auction_event without 'event_id' must be rejected."""
        doc = _make_auction_event("bid.placed")
        del doc["event_id"]
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AUCTION_EVENT_SCHEMA)

    def test_auction_event_invalid_type(self) -> None:
        """auction_event with unknown type must be rejected."""
        doc = _make_auction_event("bid.placed")
        doc["type"] = "bid.folded"  # not in enum
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AUCTION_EVENT_SCHEMA)

    def test_auction_event_seq_below_minimum(self) -> None:
        """auction_event with seq=0 (minimum is 1) must be rejected."""
        doc = _make_auction_event("bid.placed", seq=0)
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _AUCTION_EVENT_SCHEMA)

    def test_sag_output_missing_provenance(self) -> None:
        """sag_output without 'provenance' field must be rejected."""
        doc = _make_sag_output()
        del doc["provenance"]
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _SAG_OUTPUT_SCHEMA)

    def test_sag_output_sentiment_out_of_range(self) -> None:
        """sag_output with social_buzz.sentiment > 1 must be rejected."""
        doc = _make_sag_output()
        doc["social_buzz"]["sentiment"] = 2.0  # type: ignore[index]
        with pytest.raises((jsonschema.ValidationError, AssertionError)):
            _validate(doc, _SAG_OUTPUT_SCHEMA)
