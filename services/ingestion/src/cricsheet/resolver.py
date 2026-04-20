"""
Canonical player_id resolver.

Resolution order:
1. Exact match in override file (player_id_overrides.json)
2. Cricsheet people.json registry (name → people key)
3. Fuzzy match against roster CSV names
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from rapidfuzz import fuzz, process

_SLUGIFY_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    return _SLUGIFY_RE.sub("_", name.lower().strip()).strip("_")


class PlayerResolver:
    def __init__(
        self,
        roster_names: list[str],
        override_file: Path | None = None,
        fuzzy_threshold: float = 85.0,
    ) -> None:
        self._overrides: dict[str, str] = {}
        if override_file and override_file.exists():
            self._overrides = json.loads(override_file.read_text())

        # Build slug→canonical_id mapping from roster (name is the id for now)
        self._roster: dict[str, str] = {}
        self._roster_names: list[str] = roster_names
        for name in roster_names:
            self._roster[_slugify(name)] = name

        self._fuzzy_threshold = fuzzy_threshold
        self._cache: dict[str, str | None] = {}

    def resolve(self, raw_name: str) -> str | None:
        """Return the canonical player_id for raw_name, or None if unresolvable."""
        if raw_name in self._cache:
            return self._cache[raw_name]

        # 1. Manual override
        if raw_name in self._overrides:
            result = self._overrides[raw_name]
            self._cache[raw_name] = result
            return result

        # 2. Exact slug match
        slug = _slugify(raw_name)
        if slug in self._roster:
            result = self._roster[slug]
            self._cache[raw_name] = result
            return result

        # 3. Fuzzy match against roster
        if self._roster_names:
            match = process.extractOne(
                raw_name,
                self._roster_names,
                scorer=fuzz.WRatio,
                score_cutoff=self._fuzzy_threshold,
            )
            if match:
                result = match[0]
                self._cache[raw_name] = result
                return result

        self._cache[raw_name] = None
        return None

    def generate_id(self, raw_name: str) -> str:
        """Generate a stable synthetic player_id when no roster match exists."""
        return f"P_{_slugify(raw_name)}"
