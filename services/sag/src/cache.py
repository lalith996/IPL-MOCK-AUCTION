"""
Redis-backed SAG cache.

TTLs per spec §3:
- Cricsheet data:   24h
- Injury feed:      30 min
- Social buzz:      10 min
- Player meta:      7d
"""

from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis

_TTL_SECONDS: dict[str, int] = {
    "full":        3600,       # 1h composite
    "form":        86400,      # 24h (cricsheet)
    "injury":      1800,       # 30 min
    "buzz":        600,        # 10 min
    "situational": 86400,      # 24h
    "cold_start":  86400 * 7,  # 7d
}

_STALE_IF_ERROR_MULTIPLIER = 3


class SagCache:
    def __init__(self, client: redis.Redis) -> None:  # type: ignore[type-arg]
        self._redis = client

    def _key(self, player_id: str, query_type: str) -> str:
        return f"sag:{player_id}:{query_type}"

    async def get(self, player_id: str, query_type: str) -> dict[str, Any] | None:
        raw = await self._redis.get(self._key(player_id, query_type))
        if raw is None:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]

    async def set(self, player_id: str, query_type: str, value: dict[str, Any]) -> None:
        ttl = _TTL_SECONDS.get(query_type, 3600)
        await self._redis.setex(
            self._key(player_id, query_type),
            ttl,
            json.dumps(value),
        )

    async def ttl_remaining(self, player_id: str, query_type: str) -> int:
        """Return remaining TTL in seconds, or -2 if key not found."""
        return await self._redis.ttl(self._key(player_id, query_type))  # type: ignore[no-any-return]

    def staleness_factor(self, query_type: str, remaining_ttl: int) -> float:
        """
        0.0 = fresh; 1.0 = as stale as max allowed (TTL × 3).
        Used for confidence degradation.
        """
        if remaining_ttl < 0:
            return 1.0
        original_ttl = _TTL_SECONDS.get(query_type, 3600)
        max_allowed = original_ttl * _STALE_IF_ERROR_MULTIPLIER
        elapsed = original_ttl - remaining_ttl
        return min(1.0, elapsed / max_allowed)
