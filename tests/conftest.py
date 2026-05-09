"""
Production-grade test utilities for IPL 2026 Auction MVP

Provides:
- Database fixtures and factories
- Mock service providers
- Assertion helpers
- Performance profiling
- Test data generators
"""

import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, TypeVar
from dataclasses import dataclass, asdict
import time


# ============================================================================
# Types
# ============================================================================

T = TypeVar('T')


@dataclass
class TestAuction:
    """Test fixture for auction"""
    id: str
    phase: str = 'prep'
    status: str = 'prep'
    seed: int = 42
    created_at: str = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.utcnow().isoformat()


@dataclass
class TestTeam:
    """Test fixture for team"""
    id: str
    name: str
    budget: int = 10_000_000
    spent: int = 0
    squad: List[str] = None

    def __post_init__(self):
        if self.squad is None:
            self.squad = []


@dataclass
class TestPlayer:
    """Test fixture for player"""
    id: str
    name: str
    role: str = 'batsman'
    nationality: str = 'indian'
    estimated_value: int = 1_000_000
    data_coverage_score: float = 0.8
    is_cold_start: bool = False


@dataclass
class TestBid:
    """Test fixture for bid"""
    id: str
    auction_id: str
    player_id: str
    team_id: str
    amount: int
    seq: int = 0
    timestamp: str = None
    agent_id: str = 'unknown'

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow().isoformat()


# ============================================================================
# Factories
# ============================================================================

class AuctionFactory:
    """Factory for creating test auction fixtures"""

    @staticmethod
    def create(
        id: Optional[str] = None,
        phase: str = 'prep',
        seed: int = 42,
        **kwargs,
    ) -> TestAuction:
        """Create a test auction"""
        return TestAuction(
            id=id or f'auction_{uuid.uuid4().hex[:8]}',
            phase=phase,
            seed=seed,
            **kwargs,
        )

    @staticmethod
    def in_phase(phase: str) -> TestAuction:
        """Create auction in specific phase"""
        phases_timeline = {
            'prep': {'started_at': None, 'completed_at': None},
            'nominating': {'started_at': datetime.utcnow().isoformat(), 'completed_at': None},
            'open_bidding': {'started_at': datetime.utcnow().isoformat(), 'completed_at': None},
            'closing': {'started_at': datetime.utcnow().isoformat(), 'completed_at': None},
            'completed': {'started_at': datetime.utcnow().isoformat(), 'completed_at': datetime.utcnow().isoformat()},
        }
        return AuctionFactory.create(phase=phase, **phases_timeline.get(phase, {}))


class TeamFactory:
    """Factory for creating test team fixtures"""

    IATA_CODES = ['CSK', 'MI', 'RCB', 'DC', 'RR', 'KKR', 'SRH', 'PBKS', 'GT', 'LSG']

    @staticmethod
    def create(
        id: Optional[str] = None,
        budget: int = 10_000_000,
        spent: int = 0,
        **kwargs,
    ) -> TestTeam:
        """Create a test team"""
        team_id = id or TeamFactory.IATA_CODES[hash(uuid.uuid4()) % len(TeamFactory.IATA_CODES)]
        return TestTeam(
            id=team_id,
            name=f'Team {team_id}',
            budget=budget,
            spent=spent,
            **kwargs,
        )

    @staticmethod
    def create_all() -> Dict[str, TestTeam]:
        """Create all 10 IPL teams"""
        return {code: TeamFactory.create(id=code) for code in TeamFactory.IATA_CODES}


class PlayerFactory:
    """Factory for creating test player fixtures"""

    ROLES = ['batsman', 'bowler', 'all-rounder', 'wicket-keeper']

    @staticmethod
    def create(
        id: Optional[str] = None,
        role: str = 'batsman',
        is_cold_start: bool = False,
        **kwargs,
    ) -> TestPlayer:
        """Create a test player"""
        player_id = id or f'player_{uuid.uuid4().hex[:6]}'
        return TestPlayer(
            id=player_id,
            name=f'Test Player {player_id}',
            role=role,
            is_cold_start=is_cold_start,
            **kwargs,
        )

    @staticmethod
    def create_squad(count: int = 25, roles: Optional[List[str]] = None) -> List[TestPlayer]:
        """Create a squad of players with balanced roles"""
        if roles is None:
            roles = ['batsman'] * 8 + ['bowler'] * 5 + ['all-rounder'] * 8 + ['wicket-keeper'] * 4

        return [
            PlayerFactory.create(id=f'player_{i:03d}', role=roles[i % len(roles)])
            for i in range(count)
        ]


class BidFactory:
    """Factory for creating test bid fixtures"""

    @staticmethod
    def create(
        auction_id: Optional[str] = None,
        player_id: Optional[str] = None,
        team_id: Optional[str] = None,
        amount: Optional[int] = None,
        **kwargs,
    ) -> TestBid:
        """Create a test bid"""
        return TestBid(
            id=f'bid_{uuid.uuid4().hex[:8]}',
            auction_id=auction_id or f'auction_{uuid.uuid4().hex[:8]}',
            player_id=player_id or f'player_{uuid.uuid4().hex[:6]}',
            team_id=team_id or 'CSK',
            amount=amount or 5_000_000,
            **kwargs,
        )


# ============================================================================
# Assertions & Matchers
# ============================================================================

class AuctionAssertions:
    """Custom assertions for auction tests"""

    @staticmethod
    def assert_valid_auction(auction: TestAuction) -> None:
        """Validate auction object"""
        assert auction.id, 'Auction must have ID'
        assert auction.phase in ['prep', 'nominating', 'open_bidding', 'closing', 'completed'], f'Invalid phase: {auction.phase}'
        assert auction.seed >= 0, 'Seed must be non-negative'
        assert auction.created_at, 'Auction must have creation timestamp'

    @staticmethod
    def assert_phase_transition(
        current: str,
        target: str,
        valid_transitions: Dict[str, List[str]],
    ) -> None:
        """Assert that phase transition is valid"""
        allowed = valid_transitions.get(current, [])
        assert target in allowed, f'Cannot transition from {current} to {target}'


class TeamAssertions:
    """Custom assertions for team tests"""

    @staticmethod
    def assert_valid_team(team: TestTeam) -> None:
        """Validate team object"""
        assert team.id, 'Team must have ID'
        assert team.budget > 0, 'Budget must be positive'
        assert team.spent >= 0, 'Spent cannot be negative'
        assert team.spent <= team.budget, 'Spent cannot exceed budget'
        assert len(team.squad) <= 25, 'Squad size cannot exceed 25'

    @staticmethod
    def assert_squad_composition(team: TestTeam, min_bowlers: int = 4, max_overseas: int = 8) -> None:
        """Assert squad meets composition rules"""
        assert len(team.squad) <= 25, 'Squad size cannot exceed 25'

        overseas_count = sum(1 for player_id in team.squad if str(player_id).startswith('overseas_'))
        assert overseas_count <= max_overseas, f'Maximum {max_overseas} overseas players allowed'

        bowler_count = sum(
            1
            for player_id in team.squad
            if str(player_id).startswith('bowler_') or 'bowler' in str(player_id).lower()
        )
        assert bowler_count >= min_bowlers, f'Minimum {min_bowlers} bowlers required'


class BidAssertions:
    """Custom assertions for bid tests"""

    @staticmethod
    def assert_valid_bid(bid: TestBid, team_budget: int, team_spent: int) -> None:
        """Validate bid object and business rules"""
        assert bid.id, 'Bid must have ID'
        assert bid.amount > 0, 'Bid amount must be positive'
        assert bid.amount % 100_000 == 0, 'Bid must be in increments of 100K'
        assert (team_spent + bid.amount) <= team_budget, 'Bid exceeds team budget'

    @staticmethod
    def assert_bid_order(bids: List[TestBid]) -> None:
        """Assert bids are in correct sequence order"""
        for i, bid in enumerate(bids[:-1]):
            next_bid = bids[i + 1]
            assert bid.seq < next_bid.seq, 'Bids not in sequence order'


# ============================================================================
# Performance Profiling
# ============================================================================

@dataclass
class PerformanceMetrics:
    """Performance measurement results"""
    duration_ms: float
    ops_per_sec: float
    memory_mb: float
    p95_latency_ms: float
    p99_latency_ms: float


class PerformanceProfiler:
    """Profile function/method performance"""

    def __init__(self, name: str = 'operation'):
        self.name = name
        self.latencies: List[float] = []
        self.start_time: Optional[float] = None

    def __enter__(self):
        self.start_time = time.perf_counter()
        return self

    def __exit__(self, *args):
        if self.start_time is not None:
            latency = (time.perf_counter() - self.start_time) * 1000
            self.latencies.append(latency)

    def measure(self, func: Callable[..., T], *args, **kwargs) -> T:
        """Measure function execution time"""
        with self:
            return func(*args, **kwargs)

    def get_metrics(self) -> Dict[str, Any]:
        """Get performance statistics"""
        if not self.latencies:
            return {}

        sorted_latencies = sorted(self.latencies)
        count = len(sorted_latencies)

        return {
            'count': count,
            'mean_ms': sum(sorted_latencies) / count,
            'min_ms': sorted_latencies[0],
            'max_ms': sorted_latencies[-1],
            'p50_ms': sorted_latencies[count // 2],
            'p95_ms': sorted_latencies[int(count * 0.95)],
            'p99_ms': sorted_latencies[int(count * 0.99)],
        }

    def report(self) -> str:
        """Generate performance report"""
        metrics = self.get_metrics()
        if not metrics:
            return f'{self.name}: No measurements'

        return (
            f'{self.name}:\n'
            f'  Count: {metrics["count"]}\n'
            f'  Mean: {metrics["mean_ms"]:.2f}ms\n'
            f'  P95: {metrics["p95_ms"]:.2f}ms\n'
            f'  P99: {metrics["p99_ms"]:.2f}ms\n'
            f'  Min: {metrics["min_ms"]:.2f}ms\n'
            f'  Max: {metrics["max_ms"]:.2f}ms'
        )


# ============================================================================
# Test Data Generators
# ============================================================================

class AuctionScenarioGenerator:
    """Generate realistic auction scenarios for testing"""

    @staticmethod
    def complete_50_nomination_auction() -> Dict[str, Any]:
        """Generate a realistic 50-nomination auction"""
        auction = AuctionFactory.create()
        teams = {
            team_id: TeamFactory.create(id=team_id, budget=250_000_000)
            for team_id in TeamFactory.IATA_CODES
        }
        for team in teams.values():
            team.squad.extend(
                [
                    f'bowler_seed_{i}'
                    for i in range(4)
                ]
            )
        players = PlayerFactory.create_squad(count=50)

        bids: List[TestBid] = []
        seq = 1

        for i, player in enumerate(players):
            # Alternate teams bidding
            team_ids = list(teams.keys())
            primary_team = team_ids[i % len(team_ids)]
            secondary_team = team_ids[(i + 1) % len(team_ids)]

            # Simulate bidding
            winning_team_id = secondary_team
            for _ in range(3):  # Average 3 bids per nomination
                bidder = primary_team if len(bids) % 2 == 0 else secondary_team
                amount = 5_000_000 + (i * 100_000)

                bids.append(
                    BidFactory.create(
                        auction_id=auction.id,
                        player_id=player.id,
                        team_id=bidder,
                        amount=amount,
                        seq=seq,
                    )
                )
                seq += 1

                winning_team_id = bidder

            teams[winning_team_id].squad.append(player.id)
            teams[winning_team_id].spent += amount

        return {
            'auction': asdict(auction),
            'teams': {team_id: asdict(team) for team_id, team in teams.items()},
            'players': [asdict(p) for p in players],
            'bids': [asdict(b) for b in bids],
        }

    @staticmethod
    def stress_test_scenario(num_nominations: int = 100) -> Dict[str, Any]:
        """Generate stress test scenario with many nominations"""
        auction = AuctionFactory.in_phase('open_bidding')
        teams = TeamFactory.create_all()
        players = PlayerFactory.create_squad(count=num_nominations)

        return {
            'auction': asdict(auction),
            'teams': {team_id: asdict(team) for team_id, team in teams.items()},
            'players': [asdict(p) for p in players],
            'config': {
                'num_nominations': num_nominations,
                'num_teams': 10,
                'avg_bids_per_nomination': 3,
            },
        }


# ============================================================================
# Mock Services
# ============================================================================

class MockSAG:
    """Mock SAG service for testing"""

    def __init__(self, players: Optional[Dict[str, TestPlayer]] = None):
        self.players = players or {}
        self.call_count = 0
        self.latencies = []

    def lookup(self, player_id: str) -> Optional[TestPlayer]:
        """Simulate player lookup"""
        self.call_count += 1

        if player_id not in self.players:
            return None

        return self.players[player_id]

    def lookup_batch(self, player_ids: List[str]) -> Dict[str, TestPlayer]:
        """Batch lookup"""
        return {pid: player for pid in player_ids if (player := self.lookup(pid))}


class MockLLMGateway:
    """Mock LLM gateway for testing"""

    def __init__(self, model: str = 'gpt-4'):
        self.model = model
        self.call_count = 0
        self.latencies = []
        self.fail_after_n_calls: Optional[int] = None

    def call_model(self, prompt: str) -> Dict[str, Any]:
        """Simulate LLM call"""
        self.call_count += 1

        if self.fail_after_n_calls and self.call_count > self.fail_after_n_calls:
            raise RuntimeError(f'{self.model} simulated failure')

        return {
            'recommendation': 'bid' if len(prompt) % 2 == 0 else 'pass',
            'amount': 5_000_000,
            'confidence': 0.85,
            'rationale': 'test bid',
        }
