"""Domain models for the Cricsheet ETL pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class PlayerRole(StrEnum):
    BATTER = "batter"
    BOWLER = "bowler"
    ALL_ROUNDER = "all-rounder"
    KEEPER = "keeper"


class PlayerRoleSubtype(StrEnum):
    OPENER = "opener"
    ANCHOR = "anchor"
    FINISHER = "finisher"
    PP_SPINNER = "pp-spinner"
    DEATH_BOWLER = "death-bowler"
    ALL_ROUNDER = "all-rounder"
    KEEPER = "keeper"


class Phase(StrEnum):
    POWERPLAY = "powerplay"
    MIDDLE = "middle"
    DEATH = "death"


@dataclass
class StatsBlock:
    matches: int = 0
    innings: int = 0
    runs: int = 0
    balls_faced: int = 0
    average: float = 0.0
    strike_rate: float = 0.0
    hundreds: int = 0
    fifties: int = 0
    fours: int = 0
    sixes: int = 0
    boundary_pct: float = 0.0
    dot_pct: float = 0.0
    wickets: int = 0
    economy: float = 0.0
    bowling_avg: float = 0.0
    bowling_sr: float = 0.0
    # Intermediate accumulators (not written to schema)
    balls_bowled: int = 0
    runs_conceded: int = 0
    dots: int = 0
    boundaries: int = 0
    innings_boundaries: list[int] = field(default_factory=list)
    innings_runs: list[int] = field(default_factory=list)

    def finalize(self) -> None:
        """Compute derived stats from raw accumulators."""
        if self.balls_faced > 0:
            self.strike_rate = round(self.runs / self.balls_faced * 100, 2)
            boundary_balls = self.boundaries
            self.boundary_pct = round(boundary_balls / self.balls_faced * 100, 2)
            self.dot_pct = round(self.dots / self.balls_faced * 100, 2)
        if self.innings > 0:
            self.average = round(self.runs / self.innings, 2)
        if self.balls_bowled > 0:
            overs = self.balls_bowled / 6
            self.economy = round(self.runs_conceded / overs, 2)
        if self.wickets > 0:
            self.bowling_sr = round(self.balls_bowled / self.wickets, 2)
            self.bowling_avg = round(self.runs_conceded / self.wickets, 2)

    def to_dict(self) -> dict[str, float | int]:
        return {
            "matches": self.matches,
            "innings": self.innings,
            "runs": self.runs,
            "balls_faced": self.balls_faced,
            "average": self.average,
            "strike_rate": self.strike_rate,
            "hundreds": self.hundreds,
            "fifties": self.fifties,
            "fours": self.fours,
            "sixes": self.sixes,
            "boundary_pct": self.boundary_pct,
            "dot_pct": self.dot_pct,
            "wickets": self.wickets,
            "economy": self.economy,
            "bowling_avg": self.bowling_avg,
            "bowling_sr": self.bowling_sr,
        }


@dataclass
class PhaseStats:
    sr: float = 0.0
    economy: float = 0.0
    wickets: int = 0
    balls_faced: int = 0
    runs: int = 0
    balls_bowled: int = 0
    runs_conceded: int = 0

    def finalize(self) -> None:
        if self.balls_faced > 0:
            self.sr = round(self.runs / self.balls_faced * 100, 2)
        if self.balls_bowled > 0:
            self.economy = round(self.runs_conceded / (self.balls_bowled / 6), 2)

    def to_dict(self) -> dict[str, float | int]:
        return {"sr": self.sr, "economy": self.economy, "wickets": self.wickets}


@dataclass
class InningsEntry:
    """One innings scored by a batter — for form window computation."""
    runs: int
    balls: int
    fours: int
    sixes: int
    not_out: bool
    match_date: str  # ISO-8601 date string
    format: str      # e.g. "t20", "ipl", "odi"


@dataclass
class BowlingEntry:
    """One bowling performance — for form window computation."""
    wickets: int
    runs_conceded: int
    balls: int
    match_date: str
    format: str


@dataclass
class PlayerAccumulator:
    """Accumulated raw stats for a single player across all matches."""
    canonical_id: str  # resolved from resolver
    raw_name: str
    career: StatsBlock = field(default_factory=StatsBlock)
    phase: dict[str, PhaseStats] = field(default_factory=lambda: {
        "powerplay": PhaseStats(),
        "middle": PhaseStats(),
        "death": PhaseStats(),
    })
    venue_stats: dict[str, StatsBlock] = field(default_factory=dict)
    innings_log: list[InningsEntry] = field(default_factory=list)
    bowling_log: list[BowlingEntry] = field(default_factory=list)
    match_ids_seen: set[str] = field(default_factory=set)
    is_keeper: bool = False
