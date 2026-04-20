"""
Integration tests for the SAG Service FastAPI app.

Uses httpx.AsyncClient with ASGITransport — no real Redis needed.
Redis calls are intercepted via fakeredis.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import fakeredis.aioredis as fakeredis
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
def _patch_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Swap redis.asyncio.from_url with fakeredis before the lifespan runs."""
    import redis.asyncio as real_redis

    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(real_redis, "from_url", lambda *_a, **_kw: fake)


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    from services.sag.src.main import app

    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

_FULL_PLAYER: dict[str, Any] = {
    "virat_kohli": {
        "canonical_name": "Virat Kohli",
        "role": "batsman",
        "data_coverage_score": 0.9,
        "career_stats": {
            "runs": 720,
            "strike_rate": 138.5,
            "average": 48.0,
            "boundary_pct": 0.42,
            "dot_pct": 0.28,
            "wickets": 0,
            "economy": 0.0,
            "bowling_sr": 0.0,
        },
        "form_5": {
            "runs": 280,
            "strike_rate": 145.0,
            "average": 56.0,
            "boundary_pct": 0.44,
            "dot_pct": 0.25,
            "wickets": 0,
            "economy": 0.0,
            "bowling_sr": 0.0,
        },
        "phase_metrics": {
            "powerplay": {"sr": 130.0, "economy": 0.0},
            "middle": {"sr": 140.0, "economy": 0.0},
            "death": {"sr": 160.0, "economy": 0.0},
        },
    }
}

_LOW_COVERAGE_PLAYER: dict[str, Any] = {
    "unknown_player": {
        "canonical_name": "Unknown Player",
        "role": "bowler",
        "data_coverage_score": 0.3,
        "career_stats": {},
        "form_5": {},
        "phase_metrics": {},
    }
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_healthz(client: AsyncClient) -> None:
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_lookup_missing_player_returns_zero_confidence(
    client: AsyncClient,
) -> None:
    await client.post("/internal/load-features", json={})
    resp = await client.post(
        "/sag/lookup", json={"player_id": "ghost_player", "query_type": "full"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["confidence"] == 0.0
    assert "all" in data["missing_fields"]
    assert data["provenance"][0]["stale"] is True


@pytest.mark.asyncio
async def test_lookup_full_coverage_player(client: AsyncClient) -> None:
    await client.post("/internal/load-features", json=_FULL_PLAYER)
    resp = await client.post(
        "/sag/lookup", json={"player_id": "virat_kohli", "query_type": "full"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["player_id"] == "virat_kohli"
    assert data["confidence"] > 0.0
    assert data["last_12_innings_metrics"] is not None
    assert data["situational_metrics"] is not None
    # Provenance must include cricsheet + injury entries
    types = {p["type"] for p in data["provenance"]}
    assert "cricsheet" in types
    assert "injury" in types


@pytest.mark.asyncio
async def test_lookup_low_coverage_player_triggers_cold_start_provenance(
    client: AsyncClient,
) -> None:
    await client.post("/internal/load-features", json=_LOW_COVERAGE_PLAYER)
    resp = await client.post(
        "/sag/lookup", json={"player_id": "unknown_player", "query_type": "full"}
    )
    assert resp.status_code == 200
    data = resp.json()
    types = {p["type"] for p in data["provenance"]}
    assert "cold_start" in types


@pytest.mark.asyncio
async def test_lookup_cached_response_returned_on_second_call(
    client: AsyncClient,
) -> None:
    await client.post("/internal/load-features", json=_FULL_PLAYER)
    r1 = await client.post(
        "/sag/lookup", json={"player_id": "virat_kohli", "query_type": "full"}
    )
    r2 = await client.post(
        "/sag/lookup", json={"player_id": "virat_kohli", "query_type": "full"}
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["player_summary"] == r2.json()["player_summary"]


@pytest.mark.asyncio
async def test_rate_limit_not_triggered_under_threshold(
    client: AsyncClient,
) -> None:
    await client.post("/internal/load-features", json={})
    for _ in range(5):
        resp = await client.post(
            "/sag/lookup", json={"player_id": "x", "query_type": "full"}
        )
        assert resp.status_code != 429
