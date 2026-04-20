"""
Cold-start profile builder for players with data_coverage_score < 0.5.

Algorithm:
1. K-NN cohort selection: nearest K players by role + nationality + age bracket
2. Cohort mean as baseline feature vector
3. Role-median overrides for role-specific metrics
4. Imputation confidence = 1 - normalised_cohort_variance
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

from .models import ColdStartProfile, ImputedMetrics, ProvenanceEntry

_LAMBDA_BY_PERSONALITY: dict[str, float] = {
    "AGGRESSIVE": 0.05,
    "BALANCED": 0.15,
    "CONSERVATIVE": 0.30,
}

_BID_CAP_BY_PERSONALITY: dict[str, float] = {
    "AGGRESSIVE": 1.5,
    "BALANCED": 1.0,
    "CONSERVATIVE": 1.0,
}


def _age_bracket(age: int) -> int:
    """Bucket age into 5-year bands for KNN distance."""
    return (age // 5) * 5


def _role_distance(r1: str, r2: str) -> int:
    """0 if same role, 1 if closely related (e.g. all-rounder↔batter), 2 otherwise."""
    if r1 == r2:
        return 0
    close_pairs = {frozenset({"all-rounder", "batter"}), frozenset({"all-rounder", "bowler"})}
    if frozenset({r1, r2}) in close_pairs:
        return 1
    return 2


def _player_distance(
    target: dict[str, Any],
    candidate: dict[str, Any],
) -> float:
    """Composite KNN distance metric."""
    role_dist = _role_distance(
        target.get("role", "batter"),
        candidate.get("role", "batter"),
    )
    nat_dist = 0 if target.get("nationality") == candidate.get("nationality") else 1
    age_diff = abs(
        _age_bracket(target.get("age", 25)) - _age_bracket(candidate.get("age", 25))
    )
    return role_dist * 2 + nat_dist * 1 + (age_diff / 5)


def build_cold_start_profile(
    player_id: str,
    player_meta: dict[str, Any],
    full_coverage_players: list[dict[str, Any]],
    k: int = 5,
) -> ColdStartProfile:
    """
    Build a cold-start profile for a player.

    Args:
        player_id: Canonical player identifier.
        player_meta: Dict with at least role, nationality, age, data_coverage_score.
        full_coverage_players: List of player dicts with career_stats and role.
        k: Number of neighbours to use (minimum 5, expand to 10 if available).
    """
    k = min(max(k, 5), 10, len(full_coverage_players))

    # Sort candidates by distance
    ranked = sorted(
        full_coverage_players,
        key=lambda p: _player_distance(player_meta, p),
    )
    cohort = ranked[:k]
    cohort_ids = [p["player_id"] for p in cohort]

    # Extract numeric metric sets from cohort
    srs: list[float] = []
    economies: list[float] = []
    role_fits: list[float] = []

    for p in cohort:
        stats = p.get("career_stats", {})
        sr = stats.get("strike_rate", 0.0)
        eco = stats.get("economy", 0.0)
        # role_fit: 1 if exact role match, 0.5 if adjacent, 0 otherwise
        role_dist = _role_distance(player_meta.get("role", "batter"), p.get("role", "batter"))
        role_fit = max(0.0, 1.0 - role_dist * 0.5)
        if sr > 0:
            srs.append(sr)
        if eco > 0:
            economies.append(eco)
        role_fits.append(role_fit)

    def _mean(vals: list[float]) -> float:
        return sum(vals) / len(vals) if vals else 0.0

    def _variance(vals: list[float]) -> float:
        if len(vals) < 2:
            return 0.0
        m = _mean(vals)
        return sum((v - m) ** 2 for v in vals) / len(vals)

    mean_sr = _mean(srs)
    mean_eco = _mean(economies)
    mean_role_fit = _mean(role_fits)

    # Imputation confidence: 1 - normalised_variance (higher cohort agreement → higher confidence)
    sr_var = _variance(srs)
    eco_var = _variance(economies)
    max_sr = max(srs, default=200.0)
    max_eco = max(economies, default=15.0)
    normalised_var = (
        (sr_var / (max_sr**2 + 1e-9)) * 0.5 + (eco_var / (max_eco**2 + 1e-9)) * 0.5
    )
    imputation_confidence = round(max(0.0, min(1.0, 1.0 - math.sqrt(normalised_var) * 5)), 3)

    imputed = ImputedMetrics(
        strike_rate=round(mean_sr, 2),
        economy=round(mean_eco, 2),
        role_fit=round(mean_role_fit, 3),
    )

    provenance = [
        ProvenanceEntry(
            source="cohort_knn",
            fetched_at=datetime.now(UTC).isoformat(),
            type="cold_start",
            stale=False,
        )
    ]

    return ColdStartProfile(
        player_id=player_id,
        cohort_ids=cohort_ids,
        cohort_size=len(cohort),
        imputed_metrics=imputed,
        source_signals=["declared_role"],
        data_coverage_score=player_meta.get("data_coverage_score", 0.0),
        imputation_confidence=imputation_confidence,
        confidence=imputation_confidence * 0.8,  # overall confidence slightly lower
        provenance=provenance,
    )


def apply_uncertainty_penalty(
    base_score: float,
    data_coverage_score: float,
    imputation_confidence: float,
    personality: str,
) -> float:
    """
    Compute final score with cold-start uncertainty penalty.

    score_final = base × (0.5 + 0.5 × data_confidence) − λ × (1 − data_confidence)
    """
    data_confidence = min(data_coverage_score, imputation_confidence)
    lambda_unc = _LAMBDA_BY_PERSONALITY.get(personality.upper(), 0.15)
    score_final = base_score * (0.5 + 0.5 * data_confidence) - lambda_unc * (1 - data_confidence)
    return round(max(0.0, score_final), 4)


def get_bid_cap_multiplier(personality: str) -> float:
    return _BID_CAP_BY_PERSONALITY.get(personality.upper(), 1.0)
