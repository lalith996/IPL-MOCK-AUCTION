"""
Deterministic scoring function with personality-weight presets.

The LLM selects strategy and provides rationale; it does NOT compute raw scores.
Scores are always computed deterministically here before the LLM call.
"""

from __future__ import annotations

import math

from .models import (
    NominatedPlayer,
    Personality,
    ScoreBreakdown,
    TeamState,
)

# ---------------------------------------------------------------------------
# Personality weight tables  (form, value, role_fit, squad_need, data_conf)
# ---------------------------------------------------------------------------

_WEIGHTS: dict[Personality, dict[str, float]] = {
    "AGGRESSIVE": {
        "form":        0.35,
        "value":       0.15,
        "role_fit":    0.20,
        "squad_need":  0.15,
        "data_conf":   0.05,
        "pers_bonus":  0.10,  # willingness-to-overpay bonus
    },
    "BALANCED": {
        "form":        0.25,
        "value":       0.25,
        "role_fit":    0.20,
        "squad_need":  0.15,
        "data_conf":   0.10,
        "pers_bonus":  0.05,
    },
    "CONSERVATIVE": {
        "form":        0.20,
        "value":       0.35,
        "role_fit":    0.15,
        "squad_need":  0.10,
        "data_conf":   0.15,
        "pers_bonus":  0.05,
    },
}

# Role compatibility matrix: player_role → squad_need boost roles
_ROLE_NEED: dict[str, set[str]] = {
    "batsman":    {"batsman", "opener", "anchor", "finisher"},
    "bowler":     {"bowler", "pacer", "spinner", "death-bowler", "pp-spinner"},
    "all-rounder": {"all-rounder"},
    "keeper":     {"keeper"},
    "opener":     {"batsman", "opener"},
    "finisher":   {"batsman", "finisher"},
    "pacer":      {"bowler", "pacer"},
    "spinner":    {"bowler", "spinner"},
}

# Minimum squad targets (for squad_need computation)
_SQUAD_MINIMUMS: dict[str, int] = {
    "keeper": 1,
    "spinner": 2,
    "pacer": 3,
}


def _sigmoid(x: float, steepness: float = 5.0) -> float:
    """Squash a real value into [0, 1] via sigmoid."""
    return 1.0 / (1.0 + math.exp(-steepness * x))


def _form_score(player: NominatedPlayer) -> float:
    """
    Batting: normalise strike_rate to [0,1] anchored at SR=120 (par) / SR=200 (max).
    Bowling: economy inverted, anchored at 7 (par) / 4 (best).
    Returns composite in [0, 1].
    """
    bat_component = 0.0
    bowl_component = 0.0
    has_bat = player.average > 0 or player.strike_rate > 0
    has_bowl = player.economy > 0 or player.wickets > 0

    if has_bat:
        sr_norm = min(1.0, max(0.0, (player.strike_rate - 60) / 140))  # 60→0, 200→1
        avg_norm = min(1.0, max(0.0, (player.average - 10) / 50))      # 10→0, 60→1
        bat_component = 0.6 * sr_norm + 0.4 * avg_norm

    if has_bowl:
        eco_norm = min(1.0, max(0.0, (10 - player.economy) / 6))       # 10→0, 4→1
        wkt_norm = min(1.0, player.wickets / 30)                         # 30 wkts = 1.0
        bowl_component = 0.5 * eco_norm + 0.5 * wkt_norm

    if has_bat and has_bowl:
        return 0.55 * bat_component + 0.45 * bowl_component
    if has_bat:
        return bat_component
    if has_bowl:
        return bowl_component
    return 0.0


def _value_score(player: NominatedPlayer, current_bid_lakhs: float) -> float:
    """
    Returns 1.0 when bid is at or below the player's fair-value proxy,
    decays as bid rises above it.  Fair value is approximated from form.
    """
    form = _form_score(player)
    # Fair value in lakhs: form × 200L (rough anchor; spec §7 sets base-price tiers)
    fair_value_lakhs = max(20.0, form * 200.0)
    if current_bid_lakhs <= 0:
        return 1.0
    ratio = current_bid_lakhs / fair_value_lakhs
    # sigmoid centred at ratio=1: value=0.5 at fair value, drops toward 0 above it
    return _sigmoid(1.0 - ratio, steepness=4.0)


def _role_fit(player: NominatedPlayer, squad: list) -> float:
    """1.0 if player role complements squad, 0.0 if squad already full at that role."""
    need_roles = _ROLE_NEED.get(player.role.lower(), {player.role.lower()})
    current_counts: dict[str, int] = {}
    for slot in squad:
        role = getattr(slot, "role", "").lower()
        current_counts[role] = current_counts.get(role, 0) + 1

    # Check if any needed role is below minimum target
    for target_role, minimum in _SQUAD_MINIMUMS.items():
        if target_role in need_roles and current_counts.get(target_role, 0) < minimum:
                return 1.0  # slot genuinely needed

    # Generic: how many of this role type already on squad?
    count_in_role = sum(current_counts.get(r, 0) for r in need_roles)
    # Diminishing returns: 0 → 1.0, 1 → 0.7, 2 → 0.4, 3+ → 0.1
    return max(0.1, 1.0 - count_in_role * 0.3)


def _squad_need(player: NominatedPlayer, team: TeamState) -> float:
    """How urgently does this team need this player (squad size & composition)?"""
    squad_size = len(team.squad)
    # Urgency increases as squad approaches 25-player cap or falls below 15
    if squad_size < 10:
        size_urgency = 1.0
    elif squad_size < 15:
        size_urgency = 0.7
    elif squad_size < 20:
        size_urgency = 0.4
    else:
        size_urgency = 0.1

    role_fit = _role_fit(player, team.squad)
    return 0.5 * size_urgency + 0.5 * role_fit


def _budget_pressure(team: TeamState) -> float:
    """
    How comfortable is the team's remaining budget?
    Full budget → 0.5 (neutral), very low → 0.1 (cautious).
    """
    budget = team.budget_remaining_cr
    if budget >= 50:
        return 0.9
    if budget >= 30:
        return 0.7
    if budget >= 15:
        return 0.5
    if budget >= 5:
        return 0.3
    return 0.1


def _cold_start_penalty(player: NominatedPlayer, personality: Personality) -> float:
    """
    Penalty [0, 0.3] applied to composite when player has limited data.
    AGGRESSIVE agents discount the penalty; CONSERVATIVE agents amplify it.
    """
    if not player.is_cold_start:
        return 0.0
    uncertainty = 1.0 - player.data_coverage_score
    multiplier = {"AGGRESSIVE": 0.5, "BALANCED": 1.0, "CONSERVATIVE": 1.5}[personality]
    return min(0.3, uncertainty * 0.2 * multiplier)


def compute_score(
    player: NominatedPlayer,
    team: TeamState,
    current_bid_lakhs: float,
    personality: Personality,
) -> ScoreBreakdown:
    """
    Compute the full deterministic score breakdown.
    All components are in [0, 1]; composite is weighted sum clamped to [0, 1].
    """
    w = _WEIGHTS[personality]

    form = _form_score(player)
    value = _value_score(player, current_bid_lakhs)
    role = _role_fit(player, team.squad)
    need = _squad_need(player, team)
    data_conf = player.data_coverage_score
    budget = _budget_pressure(team)
    pers_bonus = w["pers_bonus"]  # fixed personality-tier bonus
    cs_penalty = _cold_start_penalty(player, personality)

    composite = (
        w["form"] * form
        + w["value"] * value
        + w["role_fit"] * role
        + w["squad_need"] * need
        + w["data_conf"] * data_conf
        + pers_bonus * budget
        - cs_penalty
    )
    composite = min(1.0, max(0.0, composite))

    return ScoreBreakdown(
        form_score=round(form, 4),
        value_score=round(value, 4),
        role_fit=round(role, 4),
        squad_need=round(need, 4),
        data_confidence=round(data_conf, 4),
        budget_pressure=round(budget, 4),
        personality_bonus=round(pers_bonus, 4),
        cold_start_penalty=round(cs_penalty, 4),
        composite=round(composite, 4),
    )
