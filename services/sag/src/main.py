"""SAG Service — FastAPI entrypoint."""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import redis.asyncio as redis
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from prometheus_client import make_asgi_app

from .adapters.mock_injury import MockInjuryAdapter
from .aggregator import SagAggregator
from .cache import SagCache
from .models import SagLookupRequest, SagOutput
from .provenance import ProvenanceMissingError

# ---------------------------------------------------------------------------
# Application state
# ---------------------------------------------------------------------------

class _AppState:
    redis_client: redis.Redis  # type: ignore[type-arg]
    aggregator: SagAggregator
    # In production this would be fetched from Postgres or an in-memory mirror.
    # For MVP we expose a mutable dict that the seed command populates.
    feature_store: dict[str, Any]


_state = _AppState()


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    _state.redis_client = redis.from_url(redis_url, decode_responses=True)
    _state.feature_store = {}  # populated by /internal/load-features in tests
    cache = SagCache(_state.redis_client)
    _state.aggregator = SagAggregator(
        cache=cache,
        injury_adapter=MockInjuryAdapter(),
    )
    yield
    await _state.redis_client.aclose()


app = FastAPI(title="SAG Service", version="0.1.0", lifespan=_lifespan)

# Expose Prometheus /metrics endpoint
_metrics_app = make_asgi_app()
app.mount("/metrics", _metrics_app)


# ---------------------------------------------------------------------------
# Rate limiting (token bucket — per remote IP, 10 req/s burst cap)
# ---------------------------------------------------------------------------

_RATE_LIMIT_RPS = int(os.getenv("SAG_RATE_LIMIT_RPS", "10"))


async def _check_rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = f"sag:rl:{client_ip}"
    pipe = _state.redis_client.pipeline()
    pipe.incr(key)
    pipe.expire(key, 1)
    results = await pipe.execute()
    count: int = results[0]
    if count > _RATE_LIMIT_RPS:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/sag/lookup",
    response_model=SagOutput,
    dependencies=[Depends(_check_rate_limit)],
)
async def lookup(body: SagLookupRequest) -> SagOutput:
    """Return structured player intelligence with full provenance."""
    try:
        return await _state.aggregator.lookup(body, _state.feature_store)
    except ProvenanceMissingError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Internal endpoints (test/seed use only — blocked in prod by network policy)
# ---------------------------------------------------------------------------

@app.post("/internal/load-features", include_in_schema=False)
async def load_features(payload: dict[str, Any]) -> dict[str, str]:
    """Replace the in-memory feature store. Only reachable from localhost in prod."""
    _state.feature_store = payload
    return {"loaded": str(len(payload))}


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
