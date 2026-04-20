"""
Compute derived player metrics and data_coverage_score from PlayerAccumulator.

The coverage scoring formula:
- 1.0  → ≥20 innings in relevant T20/IPL format
- 0.5  → ≥5 innings or cross-format coverage only
- 0.0  → no Cricsheet records at all
"""

from __future__ import annotations

from typing import Any

from .models import PlayerAccumulator, PlayerRole, PlayerRoleSubtype

_KEEPER_MARKERS = frozenset({"dhoni", "pant", "karthik", "saha", "rahul", "samson", "jaiswal"})


def compute_coverage_score(acc: PlayerAccumulator, ipl_format: bool = False) -> float:
    """Return data_coverage_score in [0, 1]."""
    innings = acc.career.innings
    if innings >= 20:
        return 1.0
    if innings >= 5:
        return 0.5
    if innings > 0:
        return round(innings / 20, 3)
    return 0.0


def classify_role(acc: PlayerAccumulator) -> tuple[PlayerRole, PlayerRoleSubtype]:
    """Infer role and subtype from career stats."""
    career = acc.career
    has_batting = career.balls_faced > 50 or career.runs > 100
    has_bowling = career.wickets > 5 or career.balls_bowled > 100

    # Keeper override
    if acc.is_keeper or any(k in acc.raw_name.lower() for k in _KEEPER_MARKERS):
        return PlayerRole.KEEPER, PlayerRoleSubtype.KEEPER

    if has_batting and has_bowling:
        return PlayerRole.ALL_ROUNDER, PlayerRoleSubtype.ALL_ROUNDER

    if has_bowling and career.wickets > career.runs / 20:
        # Determine subtype
        death = acc.phase.get("death")
        if death and death.balls_bowled > 30 and death.economy < 10:
            return PlayerRole.BOWLER, PlayerRoleSubtype.DEATH_BOWLER
        return PlayerRole.BOWLER, PlayerRoleSubtype.DEATH_BOWLER

    # Batting role
    if career.innings > 0:
        if acc.phase.get("powerplay") and acc.phase["powerplay"].sr > 130:
            return PlayerRole.BATTER, PlayerRoleSubtype.OPENER
        if career.strike_rate > 140:
            return PlayerRole.BATTER, PlayerRoleSubtype.FINISHER
    return PlayerRole.BATTER, PlayerRoleSubtype.ANCHOR


def compute_form_windows(
    acc: PlayerAccumulator,
) -> dict[str, dict[str, float | int]]:
    """Compute rolling form windows from innings_log (last 5, 10, 20 innings)."""
    log = sorted(acc.innings_log, key=lambda e: e.match_date, reverse=True)
    result: dict[str, dict[str, float | int]] = {}
    for window in [5, 10, 20]:
        sample = log[:window]
        if not sample:
            result[f"form_{window}"] = {}
            continue
        total_runs = sum(e.runs for e in sample)
        total_balls = sum(e.balls for e in sample)
        dismissals = sum(1 for e in sample if not e.not_out)
        fours = sum(e.fours for e in sample)
        sixes = sum(e.sixes for e in sample)
        boundaries = fours + sixes
        avg = round(total_runs / dismissals, 2) if dismissals > 0 else float(total_runs)
        sr = round(total_runs / total_balls * 100, 2) if total_balls > 0 else 0.0
        boundary_pct = round(boundaries / total_balls * 100, 2) if total_balls > 0 else 0.0
        result[f"form_{window}"] = {
            "innings": len(sample),
            "runs": total_runs,
            "balls_faced": total_balls,
            "average": avg,
            "strike_rate": sr,
            "fours": fours,
            "sixes": sixes,
            "boundary_pct": boundary_pct,
        }
    return result


def compute_specialist_ratings(
    acc: PlayerAccumulator,
    role: PlayerRole,
) -> dict[str, float]:
    """Produce [0,1] specialist ratings for role-specific slots."""
    career = acc.career
    phase = acc.phase
    ratings: dict[str, float] = {
        "death_bowler": 0.0,
        "powerplay_batter": 0.0,
        "powerplay_bowler": 0.0,
        "anchor": 0.0,
        "finisher": 0.0,
    }
    # Death bowler rating
    death = phase.get("death")
    if death and death.balls_bowled > 0:
        # Normalise: economy ≤8 → 1.0, economy ≥12 → 0.0
        eco_score = max(0, min(1, (12 - death.economy) / 4))
        wicket_rate = death.wickets / (death.balls_bowled / 6 + 1e-9)
        ratings["death_bowler"] = round(min(1, 0.6 * eco_score + 0.4 * min(wicket_rate / 2, 1)), 3)

    # Powerplay batter rating
    pp = phase.get("powerplay")
    if pp and pp.balls_faced > 0:
        sr_score = min(1, pp.sr / 180)
        ratings["powerplay_batter"] = round(sr_score, 3)

    # Powerplay bowler rating
    if pp and pp.balls_bowled > 0:
        pp_eco_score = max(0, min(1, (10 - pp.economy) / 4))
        ratings["powerplay_bowler"] = round(pp_eco_score, 3)

    # Anchor rating (consistent average, SR between 120-140)
    if career.innings >= 5 and career.average > 0:
        avg_score = min(1, career.average / 40)
        sr_anchor = max(0, 1 - abs(career.strike_rate - 130) / 50)
        ratings["anchor"] = round(0.5 * avg_score + 0.5 * sr_anchor, 3)

    # Finisher rating (high SR, not dependent on big average)
    if career.innings >= 5 and career.balls_faced > 0:
        ratings["finisher"] = round(min(1, career.strike_rate / 160), 3)

    return ratings


def compute_form_score(acc: PlayerAccumulator) -> float:
    """Overall form score in [0, 100] — mirrors existing scoring service."""
    score = 50.0
    career = acc.career

    if career.balls_faced > 0:
        avg_factor = min(career.average / 50, 1) * 20
        sr_factor = min(career.strike_rate / 150, 1) * 20
        score += avg_factor + sr_factor

    if career.wickets > 0:
        wkt_factor = min(career.wickets / 20, 1) * 20
        eco_factor = max(0, (10 - career.economy)) * 2
        score += wkt_factor + eco_factor

    return round(min(100, score), 2)


def compute_value_score(acc: PlayerAccumulator, role: PlayerRole) -> float:
    """Market value score in [0, 100]."""
    career = acc.career
    value = 40.0
    if role in (PlayerRole.BATTER, PlayerRole.KEEPER):
        value += career.average * 0.5 + career.strike_rate * 0.2
    elif role == PlayerRole.BOWLER:
        value += career.wickets * 1.5 + (10 - career.economy) * 5
    elif role == PlayerRole.ALL_ROUNDER:
        value += career.average * 0.3 + career.wickets * 1.0 + career.strike_rate * 0.1
    return round(min(100, value), 2)


_BASE_PRICE_TIERS = [
    (85, 20_000_000),
    (75, 15_000_000),
    (65, 10_000_000),
    (50, 5_000_000),
    (30, 3_000_000),
    (0,  2_000_000),
]


def compute_base_price(value_score: float) -> int:
    for threshold, price in _BASE_PRICE_TIERS:
        if value_score > threshold:
            return price
    return 2_000_000


def build_feature_record(
    acc: PlayerAccumulator,
    is_overseas: bool,
    nationality: str,
) -> dict[str, Any]:
    """Assemble the complete feature record for Postgres insertion."""
    # Finalise all stats blocks
    acc.career.finalize()
    for ps in acc.phase.values():
        ps.finalize()
    for vb in acc.venue_stats.values():
        vb.finalize()

    coverage = compute_coverage_score(acc)
    role, subtype = classify_role(acc)
    form_windows = compute_form_windows(acc)
    specialist = compute_specialist_ratings(acc, role)
    form_score = compute_form_score(acc)
    value_score = compute_value_score(acc, role)
    base_price = compute_base_price(value_score)

    return {
        "player_id": acc.canonical_id,
        "canonical_name": acc.raw_name,
        "feature_version": "feature_v1",
        "role": role.value,
        "role_subtype": subtype.value,
        "nationality": nationality,
        "is_overseas": is_overseas,
        "data_coverage_score": coverage,
        "base_price_tier": base_price,
        "form_score": form_score,
        "value_score": value_score,
        "career_stats": acc.career.to_dict(),
        "form_5": form_windows.get("form_5", {}),
        "form_10": form_windows.get("form_10", {}),
        "form_20": form_windows.get("form_20", {}),
        "phase_metrics": {
            k: v.to_dict() for k, v in acc.phase.items()
        },
        "specialist_ratings": specialist,
        "venue_splits": {
            venue: stats.to_dict() for venue, stats in acc.venue_stats.items()
        },
    }
