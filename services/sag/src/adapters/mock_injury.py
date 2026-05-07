"""
Mock injury adapter for development and testing.
Returns a stub 'none' injury status for every player.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from ..cache import SagCache
from ..models import InjuryStatus
from .base import InjuryAdapter

logger = logging.getLogger(__name__)

class MockInjuryAdapter(InjuryAdapter):
    """Stub adapter that returns no injuries. Replace with real RSS/API adapter in production."""

    def __init__(self, cache: SagCache | None = None) -> None:
        self._cache = cache

    @property
    def source_name(self) -> str:
        return "mock-injury-feed"

    async def fetch_injury_status(self, player_id: str) -> InjuryStatus:
        if self._cache:
            cached_data = await self._cache.get(player_id, "injury")
            if cached_data:
                return InjuryStatus.model_validate(cached_data)

        # Simulate fetching data
        status = InjuryStatus(
            source=self.source_name,
            timestamp=datetime.now(UTC).isoformat(),
            severity="none",
            expected_return=None,
        )

        if self._cache:
            try:
                await self._cache.set(player_id, "injury", status.model_dump())
            except Exception as e:
                logger.warning("Failed to cache injury status: %s", e)

        return status
