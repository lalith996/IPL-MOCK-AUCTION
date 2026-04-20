"""
Mock injury adapter for development and testing.
Returns a stub 'none' injury status for every player.
"""

from __future__ import annotations

from datetime import UTC, datetime

from ..models import InjuryStatus
from .base import InjuryAdapter


class MockInjuryAdapter(InjuryAdapter):
    """Stub adapter that returns no injuries. Replace with real RSS/API adapter in production."""

    @property
    def source_name(self) -> str:
        return "mock-injury-feed"

    async def fetch_injury_status(self, player_id: str) -> InjuryStatus:
        return InjuryStatus(
            source=self.source_name,
            timestamp=datetime.now(UTC).isoformat(),
            severity="none",
            expected_return=None,
        )
