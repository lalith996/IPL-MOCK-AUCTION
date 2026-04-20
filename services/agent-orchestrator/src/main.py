"""Agent Orchestrator — FastAPI entrypoint."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .graph import evaluate_all_agents
from .models import EvaluateRequest, EvaluateResponse


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Warm up compiled graphs (LangGraph compiles on import; this is a no-op)
    yield


app = FastAPI(
    title="Agent Orchestrator",
    version="0.1.0",
    lifespan=_lifespan,
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/orchestrator/evaluate", response_model=EvaluateResponse)
async def evaluate(body: EvaluateRequest) -> EvaluateResponse:
    """
    Fan out the nominated player to all 10 agents.
    Returns all agent decisions in ALL_AGENT_IDS order.
    """
    try:
        outputs = await evaluate_all_agents(body)
        return EvaluateResponse(
            auction_id=body.auction_id,
            player_id=body.nominated_player.player_id,
            agent_outputs=outputs,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.exception_handler(Exception)
async def _unhandled(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
