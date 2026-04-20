"""
Cricsheet JSON match file parser.

Processes one match JSON at a time, updating PlayerAccumulator state.
Each delivery is categorised into the correct phase (powerplay/middle/death)
based on over number and match format.
"""

from __future__ import annotations

from typing import Any

from .models import (
    InningsEntry,
    Phase,
    PhaseStats,
    PlayerAccumulator,
    StatsBlock,
)

_POWERPLAY_OVERS = range(0, 6)   # overs 1–6
_MIDDLE_OVERS = range(6, 16)     # overs 7–16
_DEATH_OVERS = range(16, 20)     # overs 17–20


def _classify_phase(over: int) -> Phase:
    if over in _POWERPLAY_OVERS:
        return Phase.POWERPLAY
    if over in _MIDDLE_OVERS:
        return Phase.MIDDLE
    return Phase.DEATH


class MatchParser:
    """Parses a single Cricsheet match JSON and updates player accumulators."""

    def __init__(self, accumulators: dict[str, PlayerAccumulator]) -> None:
        self._accumulators = accumulators

    def _get_or_create(self, player_id: str, raw_name: str) -> PlayerAccumulator:
        if player_id not in self._accumulators:
            self._accumulators[player_id] = PlayerAccumulator(
                canonical_id=player_id,
                raw_name=raw_name,
            )
        return self._accumulators[player_id]

    def process(self, match: dict[str, Any], resolver: Any) -> None:
        """Process one match dict and merge stats into accumulators."""
        info = match.get("info", {})
        match_date: str = (info.get("dates") or ["1970-01-01"])[0]
        match_format: str = info.get("match_type", "T20").lower()
        venue: str = info.get("venue", "unknown")

        innings_list: list[dict[str, Any]] = match.get("innings", [])

        # Per-innings batting accumulators for this match (to compute innings stats)
        # key = player_id, value = per-innings accumulator dict
        per_innings_bat: dict[str, dict[str, Any]] = {}

        for inning in innings_list:
            batting_team: str = inning.get("team", "")
            overs: list[dict[str, Any]] = inning.get("overs", [])

            for over_dict in overs:
                over_num: int = over_dict.get("over", 0)
                phase = _classify_phase(over_num)

                for delivery in over_dict.get("deliveries", []):
                    self._process_delivery(
                        delivery,
                        over_num,
                        phase,
                        venue,
                        match_date,
                        match_format,
                        batting_team,
                        per_innings_bat,
                        resolver,
                    )

        # Finalise innings log entries for all batters seen this match
        for player_id, batting in per_innings_bat.items():
            acc = self._accumulators.get(player_id)
            if acc is None:
                continue
            runs = batting["runs"]
            balls = batting["balls"]
            not_out = batting.get("not_out", True)
            acc.innings_log.append(InningsEntry(
                runs=runs,
                balls=balls,
                fours=batting.get("fours", 0),
                sixes=batting.get("sixes", 0),
                not_out=not_out,
                match_date=match_date,
                format=match_format,
            ))
            acc.career.innings += 1
            if runs >= 100:
                acc.career.hundreds += 1
            elif runs >= 50:
                acc.career.fifties += 1

    def _process_delivery(
        self,
        delivery: dict[str, Any],
        over_num: int,
        phase: Phase,
        venue: str,
        match_date: str,
        match_format: str,
        batting_team: str,
        per_innings_bat: dict[str, dict[str, Any]],
        resolver: Any,
    ) -> None:
        batter_raw: str = delivery.get("batter", "")
        bowler_raw: str = delivery.get("bowler", "")
        runs_info: dict[str, Any] = delivery.get("runs", {})
        batter_runs: int = runs_info.get("batter", 0)
        total_runs: int = runs_info.get("total", 0)
        wickets: list[dict[str, Any]] = delivery.get("wickets", [])

        batter_id = resolver.resolve(batter_raw) or resolver.generate_id(batter_raw)
        bowler_id = resolver.resolve(bowler_raw) or resolver.generate_id(bowler_raw)

        batter_acc = self._get_or_create(batter_id, batter_raw)
        bowler_acc = self._get_or_create(bowler_id, bowler_raw)

        # ── Batting ──────────────────────────────────────────────────────────
        career_b = batter_acc.career
        career_b.runs += batter_runs
        career_b.balls_faced += 1
        is_four = batter_runs == 4
        is_six = batter_runs == 6
        if is_four:
            career_b.fours += 1
            career_b.boundaries += 1
        if is_six:
            career_b.sixes += 1
            career_b.boundaries += 1
        if batter_runs == 0:
            career_b.dots += 1

        # Per-innings accumulation
        pib = per_innings_bat.setdefault(batter_id, {
            "runs": 0, "balls": 0, "fours": 0, "sixes": 0, "not_out": True,
        })
        pib["runs"] += batter_runs
        pib["balls"] += 1
        if is_four:
            pib["fours"] += 1
        if is_six:
            pib["sixes"] += 1

        # Phase batting
        phase_bat: PhaseStats = batter_acc.phase[phase.value]
        phase_bat.runs += batter_runs
        phase_bat.balls_faced += 1

        # Venue batting
        if venue not in batter_acc.venue_stats:
            batter_acc.venue_stats[venue] = StatsBlock()
        vb = batter_acc.venue_stats[venue]
        vb.runs += batter_runs
        vb.balls_faced += 1

        # ── Wickets ───────────────────────────────────────────────────────────
        for wicket in wickets:
            kind: str = wicket.get("kind", "")
            player_out: str = wicket.get("player_out", "")
            if kind != "run out":
                bowler_acc.career.wickets += 1
                bowler_acc.phase[phase.value].wickets += 1
            # Mark batter as dismissed
            if player_out and player_out == batter_raw:
                per_innings_bat.setdefault(batter_id, {"runs": 0, "balls": 0, "fours": 0, "sixes": 0, "not_out": True})
                per_innings_bat[batter_id]["not_out"] = False

        # ── Bowling ──────────────────────────────────────────────────────────
        # Only legal deliveries count as balls bowled (extras other than wides count)
        is_wide = "wides" in delivery.get("extras", {}) if isinstance(delivery.get("extras"), dict) else False
        if not is_wide:
            bowler_acc.career.balls_bowled += 1
            bowler_acc.career.runs_conceded += total_runs
            bowler_acc.phase[phase.value].balls_bowled += 1
            bowler_acc.phase[phase.value].runs_conceded += total_runs
