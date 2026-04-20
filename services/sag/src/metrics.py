"""
Prometheus metrics for the SAG service.

Exposes /metrics endpoint via prometheus_client ASGI middleware.
All metrics are prefixed with `ipl_sag_`.

Imported by main.py and used throughout aggregator.py.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

# ---------------------------------------------------------------------------
# SAG lookup latency
# ---------------------------------------------------------------------------

SAG_LOOKUP_DURATION = Histogram(
    "ipl_sag_lookup_duration_seconds",
    "Time taken for a SAG lookup (end-to-end)",
    labelnames=["cache_status"],  # "hit" | "miss"
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 1.5, 2.5, 5.0, 10.0],
)

# ---------------------------------------------------------------------------
# Cache metrics
# ---------------------------------------------------------------------------

SAG_CACHE_HIT = Counter(
    "ipl_sag_cache_hit_total",
    "Number of SAG lookups served from Redis cache",
)

SAG_CACHE_MISS = Counter(
    "ipl_sag_cache_miss_total",
    "Number of SAG lookups that required a source fetch",
)

# ---------------------------------------------------------------------------
# Source freshness
# ---------------------------------------------------------------------------

SAG_SOURCE_LAST_SUCCESS = Gauge(
    "ipl_sag_source_last_success_timestamp",
    "Unix timestamp of the last successful fetch per source",
    labelnames=["source"],
)

SAG_SOURCE_TTL = Gauge(
    "ipl_sag_source_ttl_seconds",
    "Configured TTL for each source",
    labelnames=["source"],
)

SAG_SOURCE_STALE = Counter(
    "ipl_sag_source_stale_served_total",
    "Number of stale-if-error responses served per source",
    labelnames=["source"],
)

# ---------------------------------------------------------------------------
# Cold-start
# ---------------------------------------------------------------------------

SAG_COLD_START_PLAYERS = Gauge(
    "ipl_cold_start_players_total",
    "Number of auction-pool players with data_coverage_score < 0.5",
)

# ---------------------------------------------------------------------------
# Provenance violations
# ---------------------------------------------------------------------------

SAG_PROVENANCE_MISSING = Counter(
    "ipl_sag_provenance_missing_total",
    "Number of responses rejected for missing provenance on a field",
)
