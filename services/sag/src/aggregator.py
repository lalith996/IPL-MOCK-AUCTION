"""
SAG aggregation pipeline.

Combines Cricsheet feature store + cold-start profiles + external connector signals
into a validated SagOutput with full provenance.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .adapters.base import BuzzAdapter, InjuryAdapter
from .cache import SagCache
from .models import (
    Last12InningsMetrics,
    ProvenanceEntry,
    SagLookupRequest,
    SagOutput,
    SituationalMetrics,
    SituationalPhase,
)
from .provenance import assert_provenance, degrade_confidence

_FALLBACK_CONFIDENCE_FLOOR = 0.2


class SagAggregator:
    def __init__(
        self,
        cache: SagCache,
        injury_adapter: InjuryAdapter,
        buzz_adapter: BuzzAdapter | None = None,
    ) -> None:
        self._cache = cache
        self._injury = injury_adapter
        self._buzz = buzz_adapter

    async def lookup(
        self,
        request: SagLookupRequest,
        feature_store: dict[str, Any],
    ) -> SagOutput:
        """
        Main lookup entry point.

        1. Check Redis cache
        2. Fetch from feature store + adapters
        3. Build SagOutput with provenance
        4. Validate provenance
        5. Cache and return
        """
        # 1. Cache check
        cached = await self._cache.get(request.player_id, request.query_type)
        if cached:
            ttl = await self._cache.ttl_remaining(request.player_id, request.query_type)
            staleness = self._cache.staleness_factor(request.query_type, ttl)
            output = SagOutput.model_validate(cached)
            if staleness > 0:
                output = degrade_confidence(output, staleness * 0.3)
            return output

        # 2. Feature store lookup
        player_data = feature_store.get(request.player_id)
        provenance: list[ProvenanceEntry] = []
        now_iso = datetime.now(UTC).isoformat()

        if player_data is None:
            # Hard fail — no data at all
            return SagOutput(
                player_id=request.player_id,
                player_summary="No data available.",
                confidence=0.0,
                missing_fields=["all"],
                provenance=[ProvenanceEntry(
                    source="cricsheet",
                    fetched_at=now_iso,
                    type="cricsheet",
                    stale=True,
                )],
            )

        provenance.append(ProvenanceEntry(
            source="cricsheet",
            fetched_at=now_iso,
            type="cricsheet",
            stale=False,
        ))

        # 3. Build metrics from feature store
        career = player_data.get("career_stats", {})
        form_5 = player_data.get("form_5", {})
        phase = player_data.get("phase_metrics", {})

        metrics_source = form_5 if form_5 else career
        last_12 = Last12InningsMetrics(
            runs=metrics_source.get("runs", 0),
            strike_rate=metrics_source.get("strike_rate", 0),
            average=metrics_source.get("average", 0),
            boundary_pct=metrics_source.get("boundary_pct", 0),
            dot_pct=metrics_source.get("dot_pct", 0),
            wickets=metrics_source.get("wickets", 0),
            economy=metrics_source.get("economy", 0),
            bowling_sr=metrics_source.get("bowling_sr", 0),
        )

        def _phase(key: str) -> SituationalPhase:
            p = phase.get(key, {})
            return SituationalPhase(sr=p.get("sr", 0), economy=p.get("economy", 0))

        situational = SituationalMetrics(
            powerplay=_phase("powerplay"),
            middle=_phase("middle"),
            death=_phase("death"),
        )

        # Cold-start profile
        cold_start_profile = None
        if player_data.get("data_coverage_score", 1.0) < 0.5:
            cs_cached = await self._cache.get(request.player_id, "cold_start")
            if cs_cached:
                from .models import ColdStartProfile
                cold_start_profile = ColdStartProfile.model_validate(cs_cached)
            provenance.append(ProvenanceEntry(
                source="cold_start_knn",
                fetched_at=now_iso,
                type="cold_start",
                stale=False,
            ))

        # 4. External adapters
        injury_status = None
        try:
            injury_status = await self._injury.fetch_injury_status(request.player_id)
            provenance.append(ProvenanceEntry(
                source=self._injury.source_name,
                fetched_at=now_iso,
                type="injury",
                stale=False,
            ))
        except Exception:
            # Stale-if-error: serve without injury data, degrade confidence
            provenance.append(ProvenanceEntry(
                source=self._injury.source_name,
                fetched_at=now_iso,
                type="injury",
                stale=True,
            ))

        social_buzz = None
        if self._buzz:
            try:
                social_buzz = await self._buzz.fetch_buzz(request.player_id)
                if social_buzz:
                    provenance.append(ProvenanceEntry(
                        source=self._buzz.source_name,
                        fetched_at=now_iso,
                        type="social",
                        stale=False,
                    ))
            except Exception:
                pass  # Omit buzz, no provenance entry needed

        # 5. Compute overall confidence
        data_coverage = player_data.get("data_coverage_score", 0.5)
        injury_ok = injury_status is not None
        confidence = round(0.6 * data_coverage + 0.3 * (1.0 if injury_ok else 0.5) + 0.1, 4)
        confidence = min(1.0, max(_FALLBACK_CONFIDENCE_FLOOR, confidence))

        name = player_data.get("canonical_name", request.player_id)
        role = player_data.get("role", "player")
        summary = f"{name} — {role}, data coverage: {data_coverage:.0%}"

        output = SagOutput(
            player_id=request.player_id,
            player_summary=summary,
            last_12_innings_metrics=last_12,
            situational_metrics=situational,
            injury_status=injury_status,
            social_buzz=social_buzz,
            cold_start_profile=cold_start_profile,
            confidence=confidence,
            provenance=provenance,
        )

        assert_provenance(output)

        # 6. Cache
        await self._cache.set(request.player_id, request.query_type, output.model_dump())

        return output
