"""Unit tests for cold-start profile builder."""

from __future__ import annotations

from services.sag.src.cold_start import (
    apply_uncertainty_penalty,
    build_cold_start_profile,
    get_bid_cap_multiplier,
)


def _make_player(
    player_id: str,
    role: str = "batter",
    nationality: str = "India",
    sr: float = 130.0,
    economy: float = 8.0,
) -> dict[str, object]:
    return {
        "player_id": player_id,
        "role": role,
        "nationality": nationality,
        "age": 26,
        "career_stats": {"strike_rate": sr, "economy": economy},
    }


COHORT = [_make_player(f"P_{i:04d}", sr=120 + i * 2) for i in range(10)]


class TestBuildColdStartProfile:
    def test_produces_valid_profile(self) -> None:
        target = {"role": "batter", "nationality": "India", "age": 24, "data_coverage_score": 0.2}
        profile = build_cold_start_profile("P_unknown", target, COHORT)
        assert profile.player_id == "P_unknown"
        assert len(profile.cohort_ids) >= 5
        assert 0 <= profile.imputation_confidence <= 1
        assert 0 <= profile.confidence <= 1

    def test_min_cohort_5(self) -> None:
        short_cohort = COHORT[:3]
        target = {"role": "batter", "nationality": "India", "age": 24, "data_coverage_score": 0.2}
        profile = build_cold_start_profile("P_unknown", target, short_cohort, k=5)
        assert profile.cohort_size == 3  # capped at available

    def test_same_role_preferred(self) -> None:
        mixed = [
            _make_player("P_bowler1", role="bowler"),
            _make_player("P_batter1", role="batter", sr=145),
            _make_player("P_batter2", role="batter", sr=138),
            _make_player("P_batter3", role="batter", sr=142),
            _make_player("P_batter4", role="batter", sr=150),
            _make_player("P_ar1", role="all-rounder"),
        ]
        target = {"role": "batter", "nationality": "India", "age": 24, "data_coverage_score": 0.3}
        profile = build_cold_start_profile("P_unknown", target, mixed)
        # Batters should dominate cohort
        batter_count = sum(1 for cid in profile.cohort_ids if "batter" in cid)
        assert batter_count >= 3

    def test_imputed_metrics_within_bounds(self) -> None:
        target = {"role": "batter", "nationality": "India", "age": 24, "data_coverage_score": 0.1}
        profile = build_cold_start_profile("P_unknown", target, COHORT)
        assert profile.imputed_metrics.strike_rate >= 0
        assert 0 <= profile.imputed_metrics.role_fit <= 1


class TestApplyUncertaintyPenalty:
    def test_aggressive_lower_penalty(self) -> None:
        score_agg = apply_uncertainty_penalty(0.8, 0.3, 0.4, "AGGRESSIVE")
        score_con = apply_uncertainty_penalty(0.8, 0.3, 0.4, "CONSERVATIVE")
        assert score_agg > score_con

    def test_full_coverage_no_penalty(self) -> None:
        score = apply_uncertainty_penalty(0.8, 1.0, 1.0, "BALANCED")
        assert abs(score - 0.8) < 0.001

    def test_zero_coverage_max_penalty(self) -> None:
        score_low = apply_uncertainty_penalty(0.8, 0.0, 0.0, "CONSERVATIVE")
        assert score_low < 0.4

    def test_non_negative(self) -> None:
        score = apply_uncertainty_penalty(0.1, 0.0, 0.0, "CONSERVATIVE")
        assert score >= 0.0


class TestBidCapMultiplier:
    def test_aggressive_higher_cap(self) -> None:
        assert get_bid_cap_multiplier("AGGRESSIVE") == 1.5

    def test_balanced_cap(self) -> None:
        assert get_bid_cap_multiplier("BALANCED") == 1.0

    def test_conservative_cap(self) -> None:
        assert get_bid_cap_multiplier("CONSERVATIVE") == 1.0
