"""
Per-agent private event buffer backed by Redis.

Each agent maintains a rolling window of its last K=20 events
(own bids, wins/losses, SAG results) keyed by (auction_id, agent_id).
Strict ACL: buffer writes/reads are gated on agent_id match —
no agent can read another's buffer.
"""

from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis

_BUFFER_SIZE = 20
_TTL_SECONDS = 3600 * 8  # 8h — spans a full auction session


def _buffer_key(auction_id: str, agent_id: str) -> str:
    return f"agent_buffer:{auction_id}:{agent_id}"


async def append_event(
    client: redis.Redis,  # type: ignore[type-arg]
    auction_id: str,
    agent_id: str,
    requesting_agent_id: str,
    event: dict[str, Any],
) -> None:
    """
    Append an event to the agent's private buffer.

    Raises PermissionError if requesting_agent_id ≠ agent_id.
    This is the runtime ACL guard against cross-agent buffer access.
    """
    if requesting_agent_id != agent_id:
        raise PermissionError(
            f"Agent {requesting_agent_id} attempted to write to "
            f"buffer of agent {agent_id}. Cross-agent access is forbidden."
        )
    key = _buffer_key(auction_id, agent_id)
    pipe = client.pipeline()
    pipe.rpush(key, json.dumps(event))          # type: ignore[attr-defined]
    pipe.ltrim(key, -_BUFFER_SIZE, -1)          # type: ignore[attr-defined]
    pipe.expire(key, _TTL_SECONDS)              # type: ignore[attr-defined]
    await pipe.execute()


async def get_events(
    client: redis.Redis,  # type: ignore[type-arg]
    auction_id: str,
    agent_id: str,
    requesting_agent_id: str,
) -> list[dict[str, Any]]:
    """
    Retrieve the agent's private event buffer.

    Raises PermissionError if requesting_agent_id ≠ agent_id.
    """
    if requesting_agent_id != agent_id:
        raise PermissionError(
            f"Agent {requesting_agent_id} attempted to read buffer of "
            f"agent {agent_id}. Cross-agent access is forbidden."
        )
    key = _buffer_key(auction_id, agent_id)
    raw_events = await client.lrange(key, 0, -1)  # type: ignore[attr-defined]
    return [json.loads(e) for e in raw_events]


async def clear_buffer(
    client: redis.Redis,  # type: ignore[type-arg]
    auction_id: str,
    agent_id: str,
    requesting_agent_id: str,
) -> None:
    """Delete the buffer for an agent (e.g. on auction end). ACL enforced."""
    if requesting_agent_id != agent_id:
        raise PermissionError(
            f"Agent {requesting_agent_id} attempted to clear buffer of "
            f"agent {agent_id}. Cross-agent access is forbidden."
        )
    await client.delete(_buffer_key(auction_id, agent_id))  # type: ignore[attr-defined]
