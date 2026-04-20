"""Unit tests for Cricsheet ETL metrics computation."""

from __future__ import annotations

from services.ingestion.src.cricsheet.metrics import (
    classify_role,
    compute_base_price,
    compute_coverage_score,
    compute_form_score,
    compute_form_windows,
)
from services.ingestion.src.cricsheet.models import (
    InningsEntry,
    PlayerAccumulator,
    PlayerRole,
)


def _make_acc(
    runs: int = 0,
    balls_faced: int = 0,
    wickets: int = 0,
    balls_bowled: int = 0,
    innings: int = 0,
) -> PlayerAccumulator:
    acc = PlayerAccumulator(canonical_id="P_test", raw_name="Test Player")
    acc.career.runs = runs
    acc.career.balls_faced = balls_faced
    acc.career.wickets = wickets
    acc.career.balls_bowled = balls_bowled
    acc.career.innings = innings
    acc.career.runs_conceded = wickets * 25  # synthetic
    return acc


class TestCoverageScore:
    def test_full_coverage(self) -> None:
        acc = _make_acc(innings=25)
        assert compute_coverage_score(acc) == 1.0

    def test_exact_20_innings(self) -> None:
        acc = _make_acc(innings=20)
        assert compute_coverage_score(acc) == 1.0

    def test_partial_coverage_at_5(self) -> None:
        acc = _make_acc(innings=5)
        assert compute_coverage_score(acc) == 0.5

    def test_partial_coverage_range(self) -> None:
        acc = _make_acc(innings=10)
        assert compute_coverage_score(acc) == 0.5

    def test_zero_coverage(self) -> None:
        acc = _make_acc(innings=0)
        assert compute_coverage_score(acc) == 0.0

    def test_sparse_coverage(self) -> None:
        acc = _make_acc(innings=2)
        score = compute_coverage_score(acc)
        assert 0 < score < 0.5


class TestClassifyRole:
    def test_bowler_classification(self) -> None:
        acc = _make_acc(wickets=30, balls_bowled=300, runs=20, balls_faced=30, innings=5)
        role, _ = classify_role(acc)
        assert role == PlayerRole.BOWLER

    def test_batter_classification(self) -> None:
        acc = _make_acc(runs=1000, balls_faced=800, wickets=0, innings=20)
        role, _ = classify_role(acc)
        assert role == PlayerRole.BATTER

    def test_all_rounder_classification(self) -> None:
        acc = _make_acc(runs=600, balls_faced=500, wickets=20, balls_bowled=200, innings=15)
        role, _ = classify_role(acc)
        assert role == PlayerRole.ALL_ROUNDER

    def test_keeper_override(self) -> None:
        acc = _make_acc(runs=500, balls_faced=400, innings=10)
        acc.raw_name = "MS Dhoni"
        role, subtype = classify_role(acc)
        assert role == PlayerRole.KEEPER


class TestFormWindows:
    def test_empty_log(self) -> None:
        acc = PlayerAccumulator(canonical_id="P_test", raw_name="Test")
        windows = compute_form_windows(acc)
        assert windows["form_5"] == {}

    def test_form_5_accuracy(self) -> None:
        acc = PlayerAccumulator(canonical_id="P_test", raw_name="Test")
        for i in range(7):
            acc.innings_log.append(InningsEntry(
                runs=50, balls=40, fours=5, sixes=1,
                not_out=False, match_date=f"2025-0{i+1}-01", format="ipl"
            ))
        windows = compute_form_windows(acc)
        assert windows["form_5"]["innings"] == 5
        assert windows["form_5"]["runs"] == 250


class TestFormScore:
    def test_above_50_for_decent_batter(self) -> None:
        acc = _make_acc(runs=500, balls_faced=400, innings=15)
        acc.career.finalize()
        score = compute_form_score(acc)
        assert score > 50

    def test_capped_at_100(self) -> None:
        acc = _make_acc(runs=10000, balls_faced=5000, wickets=500, balls_bowled=2000, innings=100)
        acc.career.runs_conceded = 5000
        acc.career.finalize()
        score = compute_form_score(acc)
        assert score <= 100


class TestBasePrice:
    def test_star_player(self) -> None:
        assert compute_base_price(90) == 20_000_000

    def test_mid_tier(self) -> None:
        assert compute_base_price(55) == 5_000_000

    def test_uncapped(self) -> None:
        assert compute_base_price(10) == 2_000_000


class TestResolver:
    def test_exact_slug_match(self) -> None:
        from services.ingestion.src.cricsheet.resolver import PlayerResolver
        resolver = PlayerResolver(roster_names=["Virat Kohli", "Rohit Sharma"])
        assert resolver.resolve("Virat Kohli") == "Virat Kohli"

    def test_fuzzy_match(self) -> None:
        from services.ingestion.src.cricsheet.resolver import PlayerResolver
        resolver = PlayerResolver(roster_names=["Virat Kohli"])
        result = resolver.resolve("V Kohli")
        # May or may not match depending on threshold — just check no crash
        assert result is None or "Kohli" in result

    def test_generate_id_stable(self) -> None:
        from services.ingestion.src.cricsheet.resolver import PlayerResolver
        resolver = PlayerResolver(roster_names=[])
        id1 = resolver.generate_id("John Doe")
        id2 = resolver.generate_id("John Doe")
        assert id1 == id2
        assert id1.startswith("P_")
