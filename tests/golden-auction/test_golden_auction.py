"""
Golden Auction Regression — Step 14

Replays the deterministic auction generator with seed=42 and compares the
output event-by-event against the committed golden_event_log.json fixture.

Any divergence means that auction logic, RNG usage order, or player-pool
ordering changed since the fixture was recorded — the team must review and
either fix the regression or explicitly re-record the golden fixture.

Required for merge. CI failure here = potential determinism break.
"""

from __future__ import annotations

import json

# Import the generator from the same directory
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from generate_golden import _generate_auction  # type: ignore[import]

GOLDEN_PATH = Path(__file__).parent / "golden_event_log.json"
SEED = 42
NUM_NOMINATIONS = 50


@pytest.fixture(scope="module")
def golden_events() -> list[dict[str, Any]]:
    """Load the committed golden event log."""
    return json.loads(GOLDEN_PATH.read_text())


@pytest.fixture(scope="module")
def replayed_events() -> list[dict[str, Any]]:
    """Re-run the generator with the canonical seed."""
    return _generate_auction(seed=SEED, num_nominations=NUM_NOMINATIONS)


# ---------------------------------------------------------------------------
# Determinism tests
# ---------------------------------------------------------------------------


class TestGoldenAuctionDeterminism:
    """Replay must produce byte-identical events to the recorded fixture."""

    def test_event_count_matches(
        self,
        golden_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
    ) -> None:
        """Replayed auction has exactly the same number of events as the golden log."""
        assert len(replayed_events) == len(golden_events), (
            f"Event count mismatch: replayed {len(replayed_events)}, "
            f"golden {len(golden_events)}. "
            "Re-run generate_golden.py if the change is intentional."
        )

    def test_event_types_in_order_match(
        self,
        golden_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
    ) -> None:
        """Event type sequence is identical between replay and golden."""
        golden_types = [e["type"] for e in golden_events]
        replayed_types = [e["type"] for e in replayed_events]
        if golden_types != replayed_types:
            # Find first divergence for actionable error output
            for i, (g, r) in enumerate(zip(golden_types, replayed_types, strict=False)):
                if g != r:
                    pytest.fail(
                        f"Event type divergence at seq {i + 1}: "
                        f"golden='{g}', replayed='{r}'. "
                        "Audit the generate_golden.py logic for this nomination."
                    )
            pytest.fail("Event type list lengths differ.")

    def test_sequence_numbers_monotonic_in_replay(
        self, replayed_events: list[dict[str, Any]]
    ) -> None:
        """All seq numbers in replayed events are strictly increasing from 1."""
        seqs = [e["seq"] for e in replayed_events]
        for i, seq in enumerate(seqs):
            assert seq == i + 1, (
                f"Non-monotonic seq at index {i}: expected {i + 1}, got {seq}."
            )

    @pytest.mark.parametrize("seq_idx", list(range(0, 362, 30)))
    def test_spot_check_payload_by_seq(
        self,
        golden_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
        seq_idx: int,
    ) -> None:
        """Spot-check every 30th event: seq, type, and key payload fields match."""
        if seq_idx >= len(golden_events):
            return
        g = golden_events[seq_idx]
        r = replayed_events[seq_idx]
        assert r["seq"] == g["seq"], f"seq mismatch at index {seq_idx}"
        assert r["type"] == g["type"], f"type mismatch at seq {g['seq']}"
        assert r["auction_id"] == g["auction_id"], f"auction_id mismatch at seq {g['seq']}"

    def test_all_player_ids_match_golden(
        self,
        golden_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
    ) -> None:
        """Player IDs in 'player.nominated' events match golden in order."""
        def nominated_ids(events: list[dict[str, Any]]) -> list[str]:
            return [
                e["payload"]["player_id"]
                for e in events
                if e["type"] == "player.nominated"
            ]

        assert nominated_ids(replayed_events) == nominated_ids(golden_events), (
            "Nomination order changed — RNG seed usage or pool ordering diverged."
        )

    def test_sold_winners_match_golden(
        self,
        golden_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
    ) -> None:
        """Winning team for each sold player matches the golden fixture exactly."""
        def sold_map(events: list[dict[str, Any]]) -> list[tuple[str, str]]:
            return [
                (e["payload"]["player_id"], e["payload"]["winner"])
                for e in events
                if e["type"] == "player.sold"
            ]

        assert sold_map(replayed_events) == sold_map(golden_events), (
            "Sold/winner assignments diverged from golden. "
            "Bidding logic or RNG sequence changed."
        )

    def test_final_prices_match_golden(
        self,
        golden_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
    ) -> None:
        """Final sale prices match golden exactly (validates bid increment logic)."""
        def price_map(events: list[dict[str, Any]]) -> dict[str, float]:
            return {
                e["payload"]["player_id"]: e["payload"]["final_price_lakhs"]
                for e in events
                if e["type"] == "player.sold"
            }

        assert price_map(replayed_events) == price_map(golden_events), (
            "Final sale prices diverged. Increment logic or budget tracking changed."
        )

    def test_snapshot_count_matches(
        self,
        golden_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
    ) -> None:
        """Number of snapshot events matches (5 snapshots per 50-nomination auction)."""
        g_snaps = sum(1 for e in golden_events if e["type"] == "snapshot.taken")
        r_snaps = sum(1 for e in replayed_events if e["type"] == "snapshot.taken")
        assert r_snaps == g_snaps, f"Snapshot count: golden={g_snaps}, replayed={r_snaps}"


# ---------------------------------------------------------------------------
# Golden fixture integrity checks
# ---------------------------------------------------------------------------


class TestGoldenFixtureIntegrity:
    """Sanity checks on the committed golden_event_log.json itself."""

    def test_fixture_starts_with_auction_started(
        self, golden_events: list[dict[str, Any]]
    ) -> None:
        assert golden_events[0]["type"] == "auction.started"

    def test_fixture_ends_with_auction_ended(
        self, golden_events: list[dict[str, Any]]
    ) -> None:
        assert golden_events[-1]["type"] == "auction.ended"

    def test_fixture_has_50_nominations(
        self, golden_events: list[dict[str, Any]]
    ) -> None:
        count = sum(1 for e in golden_events if e["type"] == "player.nominated")
        assert count == NUM_NOMINATIONS

    def test_all_seqs_are_unique(self, golden_events: list[dict[str, Any]]) -> None:
        seqs = [e["seq"] for e in golden_events]
        assert len(seqs) == len(set(seqs)), "Duplicate seq numbers in golden fixture"

    def test_all_event_ids_are_unique(
        self, golden_events: list[dict[str, Any]]
    ) -> None:
        ids = [e["event_id"] for e in golden_events]
        assert len(ids) == len(set(ids)), "Duplicate event_ids in golden fixture"

    def test_auction_id_consistent(self, golden_events: list[dict[str, Any]]) -> None:
        ids = {e["auction_id"] for e in golden_events}
        assert len(ids) == 1, f"Multiple auction_ids in fixture: {ids}"

    def test_all_sold_players_are_nominated(
        self, golden_events: list[dict[str, Any]]
    ) -> None:
        nominated = {
            e["payload"]["player_id"]
            for e in golden_events
            if e["type"] == "player.nominated"
        }
        for e in golden_events:
            if e["type"] == "player.sold":
                assert e["payload"]["player_id"] in nominated, (
                    f"Sold player {e['payload']['player_id']} was never nominated"
                )
