"""Pydantic models for the SAG service (internal, not auto-generated)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ImputedMetrics(BaseModel):
    strike_rate: float = Field(ge=0)
    economy: float = Field(ge=0)
    role_fit: float = Field(ge=0, le=1)


class ProvenanceEntry(BaseModel):
    source: str
    fetched_at: str
    type: Literal["cricsheet", "injury", "social", "api", "cold_start", "cache"]
    stale: bool = False


class ColdStartProfile(BaseModel):
    player_id: str
    cohort_ids: list[str] = Field(min_length=1)
    cohort_size: int = Field(ge=1)
    imputed_metrics: ImputedMetrics
    source_signals: list[str] = Field(min_length=1)
    data_coverage_score: float = Field(ge=0, le=1)
    imputation_confidence: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    provenance: list[ProvenanceEntry] = Field(min_length=1)


class SagLookupRequest(BaseModel):
    player_id: str
    query_type: Literal["full", "form", "injury", "buzz", "situational", "cold_start"]


class InjuryStatus(BaseModel):
    source: str
    timestamp: str
    severity: Literal["none", "minor", "moderate", "major"]
    expected_return: str | None = None


class SocialBuzz(BaseModel):
    volume: float = Field(ge=0)
    sentiment: float = Field(ge=-1, le=1)
    top_sources: list[str] = Field(max_length=5, default_factory=list)


class Last12InningsMetrics(BaseModel):
    runs: float = 0.0
    strike_rate: float = 0.0
    average: float = 0.0
    boundary_pct: float = 0.0
    dot_pct: float = 0.0
    wickets: float = 0.0
    economy: float = 0.0
    bowling_sr: float = 0.0


class SituationalPhase(BaseModel):
    sr: float = 0.0
    economy: float = 0.0


class SituationalMetrics(BaseModel):
    powerplay: SituationalPhase = Field(default_factory=SituationalPhase)
    middle: SituationalPhase = Field(default_factory=SituationalPhase)
    death: SituationalPhase = Field(default_factory=SituationalPhase)


class SagOutput(BaseModel):
    player_id: str
    player_summary: str
    last_12_innings_metrics: Last12InningsMetrics | None = None
    situational_metrics: SituationalMetrics | None = None
    injury_status: InjuryStatus | None = None
    social_buzz: SocialBuzz | None = None
    cold_start_profile: ColdStartProfile | None = None
    confidence: float = Field(ge=0, le=1)
    missing_fields: list[str] = Field(default_factory=list)
    provenance: list[ProvenanceEntry] = Field(min_length=1)
