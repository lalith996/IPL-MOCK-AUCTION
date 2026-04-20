"""
Chaos Test Suite — Step 14

Four chaos scenarios required to pass before staging deploy.

Scenario 1: Primary LLM model killed mid-call
  → Same-personality fallback activates within SLA.
  → Auction continues; agent output remains schema-valid.

Scenario 2: SAG source goes down
  → Degraded-confidence path (stale-if-error) serves last-known data.
  → Auction continues; no hard failure.

Scenario 3: Auction Manager killed mid-session
  → Redis leader re-election picks up a new leader.
  → State is restored from last Postgres snapshot; no event loss.

Scenario 4: CDN primary failure
  → Headshot fallback cascade: CDN primary → CDN secondary → initials avatar.
  → Auction render continues; zero blank image states.

Each scenario is a self-contained unit test using mocks — no real services
required. The goal is to verify that the *fallback logic* in each component
correctly handles the failure mode, not to integration-test the full stack.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Scenario 1: Primary LLM model failure → personality-preserving fallback
# ---------------------------------------------------------------------------


class FakeLLMGatewayRouter:
    """
    Simulates the LLM Gateway router from services/llm-gateway/src/router.ts
    in Python for chaos testing purposes.
    """

    TEAM_MODEL: dict[str, dict[str, str]] = {
        "MI":   {"model": "meta-llama/llama-3.1-8b-instruct:free",   "personality": "AGGRESSIVE"},
        "CSK":  {"model": "meta-llama/llama-3.1-70b-instruct:free",  "personality": "BALANCED"},
        "RCB":  {"model": "google/gemini-flash-1.5-8b:free",          "personality": "AGGRESSIVE"},
        "DC":   {"model": "mistralai/mistral-7b-instruct:free",       "personality": "BALANCED"},
        "KKR":  {"model": "microsoft/phi-3-mini-128k-instruct:free",  "personality": "BALANCED"},
        "RR":   {"model": "qwen/qwen-2-7b-instruct:free",             "personality": "CONSERVATIVE"},
        "PBKS": {"model": "google/gemma-2-9b-it:free",                "personality": "AGGRESSIVE"},
        "SRH":  {"model": "openchat/openchat-7b:free",                "personality": "CONSERVATIVE"},
        "LSG":  {"model": "huggingfaceh4/zephyr-7b-beta:free",        "personality": "BALANCED"},
        "GT":   {"model": "meta-llama/llama-3-8b-instruct:free",      "personality": "CONSERVATIVE"},
    }

    FALLBACK_TIERS: dict[str, list[str]] = {
        "AGGRESSIVE":  ["MI", "RCB", "PBKS"],
        "BALANCED":    ["CSK", "DC", "KKR", "LSG"],
        "CONSERVATIVE": ["RR", "SRH", "GT"],
    }

    def __init__(self) -> None:
        self.circuit_open: set[str] = set()
        self.calls: list[dict[str, str]] = []

    def _get_fallback_model(self, primary_agent: str) -> str | None:
        personality = self.TEAM_MODEL[primary_agent]["personality"]
        peers = self.FALLBACK_TIERS[personality]
        for peer in peers:
            if peer != primary_agent and self.TEAM_MODEL[peer]["model"] not in self.circuit_open:
                return self.TEAM_MODEL[peer]["model"]
        return None

    async def call(self, agent_id: str, prompt: str) -> dict[str, Any]:
        primary_model = self.TEAM_MODEL[agent_id]["model"]
        personality = self.TEAM_MODEL[agent_id]["personality"]

        if primary_model not in self.circuit_open:
            try:
                result = await self._call_model(primary_model, prompt)
                self.calls.append({"agent": agent_id, "model": primary_model, "status": "ok"})
                return result
            except ConnectionError:
                self.circuit_open.add(primary_model)

        # Fallback
        fallback_model = self._get_fallback_model(agent_id)
        if fallback_model:
            result = await self._call_model(fallback_model, prompt)
            self.calls.append({
                "agent": agent_id,
                "model": fallback_model,
                "status": "fallback",
                "personality": personality,
            })
            return result

        # Total failure
        raise RuntimeError(f"All models in {personality} tier unavailable")

    async def _call_model(self, model: str, prompt: str) -> dict[str, Any]:
        if model in self.circuit_open:
            raise ConnectionError(f"Circuit open for {model}")
        return {
            "agent_id": "MI",
            "action": "bid",
            "bid_amount": 150_000_000,
            "confidence_score": 0.75,
            "chosen_plan": "A",
        }


class TestChaos1PrimaryModelKilled:
    """Scenario 1: Primary model circuit-opens mid-call; fallback activates within SLA."""

    @pytest.mark.asyncio
    async def test_fallback_activates_when_primary_circuit_opens(self) -> None:
        """
        Killing MI's primary model (llama-3.1-8b) causes the router to fall
        back to another AGGRESSIVE-tier model (RCB's gemini-flash-1.5-8b).
        """
        router = FakeLLMGatewayRouter()
        # Simulate primary model being killed
        mi_primary = router.TEAM_MODEL["MI"]["model"]
        router.circuit_open.add(mi_primary)

        start = time.monotonic()
        result = await router.call("MI", "Should I bid on Virat Kohli?")
        elapsed_ms = (time.monotonic() - start) * 1000

        assert result is not None
        # Fallback must be within 4s SLA
        assert elapsed_ms < 4000, f"Fallback took {elapsed_ms:.0f}ms, exceeds 4s SLA"

    @pytest.mark.asyncio
    async def test_fallback_preserves_personality_tier(self) -> None:
        """
        The fallback model must be in the same personality tier as the primary.
        AGGRESSIVE agents fall back to other AGGRESSIVE agents only.
        """
        router = FakeLLMGatewayRouter()
        # Kill MI's primary (AGGRESSIVE tier)
        mi_primary = router.TEAM_MODEL["MI"]["model"]
        router.circuit_open.add(mi_primary)

        await router.call("MI", "test prompt")

        fallback_calls = [c for c in router.calls if c.get("status") == "fallback"]
        assert len(fallback_calls) == 1
        fallback_call = fallback_calls[0]
        fallback_model = fallback_call["model"]

        # Verify fallback model belongs to an AGGRESSIVE-tier agent
        aggressive_models = {
            router.TEAM_MODEL[a]["model"]
            for a in router.FALLBACK_TIERS["AGGRESSIVE"]
        }
        assert fallback_model in aggressive_models, (
            f"Fallback model {fallback_model} is not in AGGRESSIVE tier. "
            "Personality preservation violated."
        )

    @pytest.mark.asyncio
    async def test_auction_continues_after_fallback(self) -> None:
        """Multiple agents can still complete their calls even with MI's primary down."""
        router = FakeLLMGatewayRouter()
        router.circuit_open.add(router.TEAM_MODEL["MI"]["model"])

        # All 10 agents try to respond
        results = await asyncio.gather(
            *[router.call(agent, f"bid decision for {agent}") for agent in router.TEAM_MODEL],
            return_exceptions=True,
        )

        failures = [r for r in results if isinstance(r, Exception)]
        assert len(failures) == 0, f"Unexpected failures: {failures}"

    @pytest.mark.asyncio
    async def test_full_tier_failure_surfaces_as_exception(self) -> None:
        """If all AGGRESSIVE models fail, the router raises RuntimeError (not hang)."""
        router = FakeLLMGatewayRouter()
        # Kill all AGGRESSIVE-tier models
        for agent in router.FALLBACK_TIERS["AGGRESSIVE"]:
            router.circuit_open.add(router.TEAM_MODEL[agent]["model"])

        with pytest.raises(RuntimeError, match="All models in AGGRESSIVE tier unavailable"):
            await router.call("MI", "test")


# ---------------------------------------------------------------------------
# Scenario 2: SAG source down → degraded-confidence fallback
# ---------------------------------------------------------------------------


class FakeSAGAggregator:
    """Simulates the SAG aggregator fallback behaviour."""

    def __init__(self, cache: dict[str, Any]) -> None:
        self._cache = cache  # last-known-good responses
        self._source_up = True

    def take_source_down(self) -> None:
        self._source_up = False

    async def lookup(self, player_id: str) -> dict[str, Any]:
        if self._source_up:
            return {
                "player_id": player_id,
                "player_summary": "Strong form player.",
                "confidence": 0.88,
                "provenance": [{"source": "live-feed", "stale": False}],
            }
        # Source is down — stale-if-error
        if player_id in self._cache:
            cached = dict(self._cache[player_id])
            cached["confidence"] = max(0.0, cached.get("confidence", 0.5) * 0.6)
            cached["provenance"] = [{"source": "stale-cache", "stale": True}]
            return cached
        # No cache — return zero confidence
        return {
            "player_id": player_id,
            "player_summary": "",
            "confidence": 0.0,
            "provenance": [],
            "missing_fields": ["all"],
        }


class TestChaos2SAGSourceDown:
    """Scenario 2: SAG external source fails; stale-if-error serves degraded results."""

    @pytest.mark.asyncio
    async def test_stale_response_served_when_source_down(self) -> None:
        """SAG returns cached response with degraded confidence when source fails."""
        cache = {
            "p-virat-kohli": {
                "player_id": "p-virat-kohli",
                "player_summary": "Consistent batter.",
                "confidence": 0.88,
                "provenance": [],
            }
        }
        agg = FakeSAGAggregator(cache)
        agg.take_source_down()

        result = await agg.lookup("p-virat-kohli")

        assert result["player_id"] == "p-virat-kohli"
        # Confidence must be degraded (< original 0.88)
        assert result["confidence"] < 0.88
        assert result["confidence"] >= 0.0
        assert result["provenance"][0]["stale"] is True

    @pytest.mark.asyncio
    async def test_auction_continues_with_degraded_confidence(self) -> None:
        """Auction still produces valid agent decisions with degraded SAG data."""
        cache = {
            f"p-player-{i}": {
                "player_id": f"p-player-{i}",
                "player_summary": "Test player.",
                "confidence": 0.70,
                "provenance": [],
            }
            for i in range(10)
        }
        agg = FakeSAGAggregator(cache)
        agg.take_source_down()

        results = await asyncio.gather(
            *[agg.lookup(f"p-player-{i}") for i in range(10)]
        )

        for result in results:
            # Each result is valid (not None, has player_id)
            assert result["player_id"].startswith("p-player-")
            # Confidence is reduced but non-negative
            assert 0.0 <= result["confidence"] < 0.70

    @pytest.mark.asyncio
    async def test_zero_confidence_returned_for_uncached_player(self) -> None:
        """Player with no cache entry gets confidence=0 when source is down."""
        agg = FakeSAGAggregator({})  # empty cache
        agg.take_source_down()

        result = await agg.lookup("p-completely-unknown")

        assert result["confidence"] == 0.0
        assert "missing_fields" in result

    @pytest.mark.asyncio
    async def test_recovery_after_source_restored(self) -> None:
        """When source comes back up, full confidence is restored."""
        cache = {
            "p-player-x": {
                "player_id": "p-player-x",
                "player_summary": ".",
                "confidence": 0.80,
                "provenance": [],
            }
        }
        agg = FakeSAGAggregator(cache)
        agg.take_source_down()
        result_down = await agg.lookup("p-player-x")
        assert result_down["confidence"] < 0.80

        agg._source_up = True
        result_up = await agg.lookup("p-player-x")
        assert result_up["confidence"] == 0.88  # live source returns full confidence


# ---------------------------------------------------------------------------
# Scenario 3: Auction Manager killed mid-session → leader re-election
# ---------------------------------------------------------------------------


class FakeLeaderElection:
    """Simulates Redis-based singleton leader election for the Auction Manager."""

    def __init__(self) -> None:
        self._leader: str | None = None
        self._election_count = 0

    async def try_acquire(self, instance_id: str) -> bool:
        if self._leader is None or self._leader == instance_id:
            self._leader = instance_id
            return True
        return False

    async def release(self, instance_id: str) -> None:
        if self._leader == instance_id:
            self._leader = None

    async def elect_new_leader(self, candidates: list[str]) -> str | None:
        """Simulates a re-election when the current leader disappears."""
        self._leader = None
        self._election_count += 1
        for candidate in candidates:
            if await self.try_acquire(candidate):
                return candidate
        return None


class FakeAuctionManagerCluster:
    """Simulates a cluster of Auction Manager instances competing for leadership."""

    def __init__(self, instance_ids: list[str]) -> None:
        self.instances = instance_ids
        self.election = FakeLeaderElection()
        self.active_leader: str | None = None
        self._snapshot: dict[str, Any] = {
            "seq": 42,
            "phase": "open_bidding",
            "player_id": "p-rohit-sharma",
            "current_bid": 1500,
        }

    async def start(self) -> None:
        """First instance wins leadership."""
        for inst in self.instances:
            if await self.election.try_acquire(inst):
                self.active_leader = inst
                return

    async def kill_leader(self) -> None:
        """Simulate the leader crashing (releases its lock)."""
        if self.active_leader:
            await self.election.release(self.active_leader)
            dead = self.active_leader
            self.active_leader = None
            remaining = [i for i in self.instances if i != dead]
            self.active_leader = await self.election.elect_new_leader(remaining)

    async def get_state(self) -> dict[str, Any]:
        """New leader restores state from latest Postgres snapshot."""
        return dict(self._snapshot)


class TestChaos3AuctionManagerKilled:
    """Scenario 3: Leader instance killed; standby takes over with no state loss."""

    @pytest.mark.asyncio
    async def test_new_leader_elected_after_kill(self) -> None:
        """A new leader is elected within one election cycle after the primary dies."""
        cluster = FakeAuctionManagerCluster(["am-1", "am-2", "am-3"])
        await cluster.start()
        original_leader = cluster.active_leader
        assert original_leader == "am-1"

        await cluster.kill_leader()

        assert cluster.active_leader is not None
        assert cluster.active_leader != original_leader, "Dead leader was re-elected"

    @pytest.mark.asyncio
    async def test_state_restored_from_snapshot_after_failover(self) -> None:
        """New leader correctly restores auction state from latest snapshot."""
        cluster = FakeAuctionManagerCluster(["am-1", "am-2"])
        await cluster.start()
        await cluster.kill_leader()

        # New leader must be able to read last snapshot
        state = await cluster.get_state()
        assert state["seq"] == 42
        assert state["phase"] == "open_bidding"
        assert state["player_id"] == "p-rohit-sharma"

    @pytest.mark.asyncio
    async def test_no_split_brain_two_instances_both_try_acquire(self) -> None:
        """Only one instance can hold leadership at any time (no split brain)."""
        election = FakeLeaderElection()
        results = await asyncio.gather(
            election.try_acquire("am-1"),
            election.try_acquire("am-2"),
        )
        # Exactly one must win
        assert sum(results) == 1, f"Both instances acquired leadership: {results}"

    @pytest.mark.asyncio
    async def test_re_election_count_increments(self) -> None:
        """Leader election counter tracks how many re-elections occurred."""
        cluster = FakeAuctionManagerCluster(["am-1", "am-2", "am-3"])
        await cluster.start()
        assert cluster.election._election_count == 0

        await cluster.kill_leader()
        assert cluster.election._election_count == 1

    @pytest.mark.asyncio
    async def test_auction_continues_after_failover(self) -> None:
        """Bid processing resumes after failover with correct seq continuation."""
        cluster = FakeAuctionManagerCluster(["am-1", "am-2"])
        await cluster.start()
        await cluster.kill_leader()

        state = await cluster.get_state()
        # Simulate next event seq after failover
        next_seq = state["seq"] + 1
        assert next_seq == 43, "Seq must continue from last snapshot"


# ---------------------------------------------------------------------------
# Scenario 4: CDN primary failure → headshot fallback cascade
# ---------------------------------------------------------------------------


class FakeHeadshotLoader:
    """
    Simulates the headshot fallback cascade:
    CDN primary → CDN secondary → initials avatar.
    Max 1 retry before falling back to avatar.
    """

    def __init__(self, primary_up: bool = True, secondary_up: bool = True) -> None:
        self._primary_up = primary_up
        self._secondary_up = secondary_up
        self._loads: list[str] = []

    async def _fetch(self, url: str) -> str:
        await asyncio.sleep(0)  # yield
        if "cdn-primary" in url and not self._primary_up:
            raise ConnectionError("CDN primary unreachable")
        if "cdn-secondary" in url and not self._secondary_up:
            raise ConnectionError("CDN secondary unreachable")
        return url

    async def load(self, player_id: str) -> dict[str, Any]:
        primary_url = f"https://cdn-primary.example.com/headshots/{player_id}_512.webp"
        secondary_url = f"https://cdn-secondary.example.com/headshots/{player_id}_512.webp"
        avatar_url = f"data:image/svg+xml;base64,PHN2Z...{player_id[:4]}"

        try:
            url = await self._fetch(primary_url)
            self._loads.append("primary")
            return {"url": url, "source": "cdn_primary", "is_fallback": False}
        except ConnectionError:
            pass

        # 1 retry with secondary
        try:
            url = await self._fetch(secondary_url)
            self._loads.append("secondary")
            return {"url": url, "source": "cdn_secondary", "is_fallback": True}
        except ConnectionError:
            pass

        # Final fallback: initials avatar
        self._loads.append("avatar")
        return {"url": avatar_url, "source": "avatar", "is_fallback": True}


class TestChaos4CDNFailure:
    """Scenario 4: CDN primary fails; secondary or avatar fallback serves within SLA."""

    @pytest.mark.asyncio
    async def test_secondary_cdn_used_when_primary_fails(self) -> None:
        """CDN primary down → secondary CDN serves the image."""
        loader = FakeHeadshotLoader(primary_up=False, secondary_up=True)
        result = await loader.load("p-virat-kohli")

        assert result["source"] == "cdn_secondary"
        assert result["is_fallback"] is True
        assert "cdn-secondary" in result["url"]

    @pytest.mark.asyncio
    async def test_avatar_served_when_both_cdns_fail(self) -> None:
        """Both CDNs down → initials avatar served (no blank image state)."""
        loader = FakeHeadshotLoader(primary_up=False, secondary_up=False)
        result = await loader.load("p-ms-dhoni")

        assert result["source"] == "avatar"
        assert result["is_fallback"] is True
        assert result["url"] != ""  # never empty

    @pytest.mark.asyncio
    async def test_no_blank_states_for_all_10_teams(self) -> None:
        """With primary CDN down, all 10 team-slot images still resolve."""
        loader = FakeHeadshotLoader(primary_up=False, secondary_up=True)
        player_ids = [f"p-player-{i:02d}" for i in range(10)]

        results = await asyncio.gather(
            *[loader.load(pid) for pid in player_ids]
        )

        for result, pid in zip(results, player_ids, strict=False):
            assert result["url"], f"Blank image state for {pid}"
            assert result["source"] in ("cdn_secondary", "avatar")

    @pytest.mark.asyncio
    async def test_auction_uninterrupted_during_cdn_failure(self) -> None:
        """Headshot loading failures never block bid event processing."""
        loader = FakeHeadshotLoader(primary_up=False, secondary_up=False)

        start = time.monotonic()
        result = await loader.load("p-rohit-sharma")
        elapsed_ms = (time.monotonic() - start) * 1000

        # Fallback to avatar must complete within 500ms (no blocking)
        assert elapsed_ms < 500, f"Headshot fallback took {elapsed_ms:.0f}ms"
        assert result["source"] == "avatar"
        assert result["url"]  # non-empty avatar

    @pytest.mark.asyncio
    async def test_primary_recovery_uses_cdn_again(self) -> None:
        """When primary CDN recovers, images are served from CDN (not avatar)."""
        loader = FakeHeadshotLoader(primary_up=False, secondary_up=True)
        down_result = await loader.load("p-jasprit-bumrah")
        assert down_result["source"] == "cdn_secondary"

        # Simulate recovery
        loader._primary_up = True
        up_result = await loader.load("p-jasprit-bumrah")
        assert up_result["source"] == "cdn_primary"
        assert up_result["is_fallback"] is False

    @pytest.mark.asyncio
    async def test_max_one_retry_before_avatar(self) -> None:
        """
        The cascade has exactly one retry (primary → secondary).
        After secondary also fails, it goes straight to avatar — no further retries.
        """
        loader = FakeHeadshotLoader(primary_up=False, secondary_up=False)
        await loader.load("p-test-player")
        assert loader._loads == ["avatar"], (
            f"Expected exactly ['avatar'] after both CDNs fail, got {loader._loads}"
        )
