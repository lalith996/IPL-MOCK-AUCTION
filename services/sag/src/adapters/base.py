"""Base adapter interface for external SAG connectors."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import InjuryStatus, SocialBuzz


class InjuryAdapter(ABC):
    @abstractmethod
    async def fetch_injury_status(self, player_id: str) -> InjuryStatus | None:
        """Fetch current injury status for the player."""
        ...

    @property
    @abstractmethod
    def source_name(self) -> str:
        ...


class BuzzAdapter(ABC):
    @abstractmethod
    async def fetch_buzz(self, player_id: str) -> SocialBuzz | None:
        """Fetch aggregated social buzz metrics."""
        ...

    @property
    @abstractmethod
    def source_name(self) -> str:
        ...
