"""
Provenance enforcement middleware.

Every field in a SAG response must have an associated provenance entry.
The middleware rejects responses missing provenance.
"""

from __future__ import annotations

from .models import SagOutput


class ProvenanceMissingError(Exception):
    def __init__(self, missing: list[str]) -> None:
        super().__init__(f"Provenance missing for fields: {missing}")
        self.missing = missing


def assert_provenance(output: SagOutput) -> None:
    """
    Raise ProvenanceMissingError if any populated field lacks a provenance entry.
    """
    sources = {p.source for p in output.provenance}
    missing: list[str] = []

    if output.last_12_innings_metrics and "cricsheet" not in " ".join(sources).lower():
        missing.append("last_12_innings_metrics (no cricsheet provenance)")

    if output.injury_status and not any("injury" in p.source.lower() or p.type == "injury" for p in output.provenance):
        missing.append("injury_status (no injury source in provenance)")

    if output.social_buzz and not any(p.type == "social" for p in output.provenance):
        missing.append("social_buzz (no social source in provenance)")

    if not output.provenance:
        missing.append("provenance (empty)")

    if missing:
        raise ProvenanceMissingError(missing)


def degrade_confidence(
    output: SagOutput,
    staleness_factor: float,
) -> SagOutput:
    """
    Return a copy of output with confidence degraded proportionally to staleness_factor [0,1].
    staleness_factor = 0 → no degradation; 1 → confidence = 0.
    """
    degraded = output.confidence * (1 - staleness_factor)
    return output.model_copy(update={"confidence": max(0.0, round(degraded, 4))})
