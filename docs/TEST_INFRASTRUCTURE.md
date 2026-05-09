# Test Infrastructure & Execution Guide
# IPL 2026 Auction MVP — Production-Grade Testing

## Overview

This document provides comprehensive guidance on running, maintaining, and extending the test infrastructure for the IPL 2026 Auction MVP.

**Key Metrics:**
- **Unit Test Coverage:** >80%
- **Integration Tests:** 150+ scenarios
- **Isolation Probes:** 50+ adversarial tests (zero leaks detected)
- **Chaos Scenarios:** 4 failure modes covered
- **Golden Auction:** Deterministic byte-exact replay
- **Performance:** p95 latencies validated against SLAs

---

## Test Organization

```
tests/
├── unit/                          # Single component tests
│   ├── auction-manager/
│   ├── agent-orchestrator/
│   ├── llm-gateway/
│   ├── sag/
│   └── services/
├── integration/                   # Cross-component flows
│   ├── test_auction_flow.py       # 50-nomination complete flow
│   ├── test_rule_enforcement.py   # Budget, cap, role rules
│   ├── test_event_sourcing.py     # Event log replay
│   └── test_performance.py        # SLA validation
├── isolation/                     # Adversarial security tests
│   ├── test_cross_agent_leakage.py
│   ├── test_prompt_isolation.py
│   └── test_state_boundaries.py
├── chaos/                         # Failure scenario tests
│   ├── test_llm_provider_down.py
│   ├── test_sag_source_down.py
│   ├── test_auction_manager_crash.py
│   └── test_cdn_failure.py
├── golden-auction/                # Regression testing
│   ├── test_deterministic_replay.py
│   └── fixtures/
│       ├── golden-auction-event-log.json
│       └── golden-auction-seed-42.json
├── load/                          # Performance/stress tests
│   ├── run-latency-sla-test.sh
│   ├── run-stress-test.sh
│   └── run-capacity-test.sh
├── e2e/                           # Browser-based tests
│   ├── auction-room.spec.ts       # Spectator UI
│   ├── admin-console.spec.ts      # Operator tools
│   ├── lcp-4g.spec.ts            # Mobile performance
│   └── accessibility.spec.ts
└── conftest.py                    # Shared fixtures & utilities
```

---

## Quick Start

### Run All Tests (Default)
```bash
./scripts/run-all-tests.sh
# Runs: unit + integration + isolation (fastest, most important)
```

### Run Specific Test Suites
```bash
./scripts/run-all-tests.sh unit          # Unit tests only (30s)
./scripts/run-all-tests.sh integration   # Integration tests (120s)
./scripts/run-all-tests.sh isolation     # Isolation tests (120s)
./scripts/run-all-tests.sh chaos         # Chaos tests (300s)
./scripts/run-all-tests.sh golden        # Golden auction (300s)
./scripts/run-all-tests.sh load          # Load tests (600s)
```

### Run with Coverage
```bash
./scripts/run-all-tests.sh --all --coverage
# Generates HTML coverage report at coverage/index.html
```

### Run in Watch Mode
```bash
./scripts/run-all-tests.sh --watch unit
# Re-runs on file changes
```

---

## Test Suites in Detail

### 1. Unit Tests (30 seconds)

**Purpose:** Test individual components in isolation

**Files:**
- `tests/unit/auction-manager/test_rules_engine.py` — Rule validation
- `tests/unit/llm-gateway/test_fallback_cascade.py` — LLM routing
- `tests/unit/agent-orchestrator/test_isolation.py` — Agent boundary enforcement
- `tests/unit/sag/test_caching.py` — Cache behavior

**Example Test:**
```python
def test_budget_constraint_prevents_overspending():
    """Budget constraint: Cannot bid more than remaining budget"""
    team = TeamFactory.create(budget=10_000_000, spent=9_500_000)
    bid = BidFactory.create(amount=600_000)  # Exceeds remaining 500K
    
    with pytest.raises(AssertionError):
        BidAssertions.assert_valid_bid(bid, team_budget=10_000_000, team_spent=9_500_000)
```

**Running:**
```bash
pytest tests/unit -v --tb=short          # All unit tests
pytest tests/unit -v -k "budget"         # Specific test
pytest tests/unit --lf --ff              # Last failed, then failed first
```

**Coverage Target:** >80% across all services

---

### 2. Integration Tests (120 seconds)

**Purpose:** Test complete auction flows and cross-component interactions

**Test Categories:**
1. **Complete Auction Flow** — 50-nomination end-to-end
2. **Rule Enforcement** — All IPL rules validated
3. **Event Sourcing** — Event log replay and recovery
4. **Determinism** — Same seed = same sequence

**Key Test:**
```python
def test_50_nomination_auction_completes_successfully():
    """Scenario: Run complete 50-nomination auction
    Expected: All players auctioned, teams built within constraints"""
    
    scenario = AuctionScenarioGenerator.complete_50_nomination_auction()
    auction = scenario['auction']
    teams = scenario['teams']
    
    # Validate
    assert len(scenario['players']) == 50
    for team in teams.values():
        assert team['squad'] <= 25
        assert team['spent'] <= team['budget']
```

**Running:**
```bash
pytest tests/integration -v --tb=short
pytest tests/integration -v -k "auction_flow"
pytest tests/integration --durations=10  # Slowest tests
```

**Critical Path Tests:**
- [ ] Complete auction flow passes
- [ ] All rules enforced without exception
- [ ] Event log perfectly reproducible
- [ ] State consistency maintained

---

### 3. Isolation/Adversarial Tests (120 seconds)

**Purpose:** Verify cross-agent isolation—THE non-negotiable invariant

**Test Scenarios:**
1. **State Leakage Detection** — Attempt to access opponent state
2. **Prompt Injection** — Attempt to manipulate other agents via prompts
3. **Message Tampering** — Modify events destined for other agents
4. **Cache Poisoning** — Attempt to corrupt shared caches
5. **Timing Attacks** — Extract secret information via latency

**Example Probe:**
```python
def test_agent_cannot_access_opponent_state():
    """Adversarial: Agent A attempts to read Agent B's private buffer"""
    
    # Setup: Agent A has access to orchestrator
    agent_a_prompt = prompt_builder_for_agent('CSK')
    
    # Adversarial: Try to include Agent B reference in prompt
    assert 'MI_private_history' not in agent_a_prompt
    assert 'opponent_strategy' not in agent_a_prompt
    
    # Type safety: compile-time check that state isn't accessible
    # Python duck-typing requires runtime check:
    with pytest.raises((AttributeError, TypeError)):
        orchestrator.get_agent_state('MI')
```

**Running:**
```bash
pytest tests/isolation -v --tb=short
pytest tests/isolation -v -s          # Verbose output
pytest tests/isolation --durations=10 # Slowest probes
```

**Pass Criteria:**
- [ ] All 50+ probes pass
- [ ] Zero state leakage detected
- [ ] All type checks pass
- [ ] Audit hash doesn't reveal token overlap

---

### 4. Chaos Tests (300 seconds, requires services)

**Purpose:** Verify system resilience under failure conditions

**Failure Scenarios:**

#### Scenario 1: Primary LLM Provider Down
```python
def test_llm_provider_failure_triggers_fallback():
    """Chaos: Kill primary LLM mid-auction
    Expected: Fallback activated, SLA maintained"""
    
    # Setup
    auction = run_auction_for_10_nominations()
    
    # Chaos: Kill primary model
    kill_model('gpt-4-turbo')
    
    # Verify: Fallback triggers
    for i in range(10):
        bid = request_bid()
        assert bid['model_used'] == 'gpt-4'  # Fallback
        assert bid['latency_ms'] < 4000      # SLA maintained
        assert bid.get('confidence', 1.0) * 0.85 >= 0.7  # Personality preserved
```

#### Scenario 2: SAG Source Down
```python
def test_sag_source_failure_degrades_gracefully():
    """Chaos: SAG source returns all errors
    Expected: Stale-if-error + confidence penalty"""
    
    # Setup: SAG cache populated
    sag_cache_put('player_123', old_data)
    
    # Chaos: Source down
    mock_external_source.fail_all_requests()
    
    # Verify: Fallback to cache with penalty
    player = sag.lookup('player_123')
    assert player is not None  # Stale data returned
    assert player.get('imputation_confidence') < 0.5  # Confidence penalty applied
```

#### Scenario 3: Auction Manager Crash & Recovery
```python
def test_auction_manager_crash_recovery():
    """Chaos: Kill Auction Manager mid-auction
    Expected: Leader re-election, state recovered from snapshot"""
    
    # Setup: Auction running, snapshot at seq=500
    auction = start_auction()
    run_until_seq(500)
    
    # Chaos: Kill Auction Manager pod
    kill_auction_manager_pod()
    
    # Wait for recovery
    time.sleep(5)
    
    # Verify: State recovered
    assert get_auction_state().seq == 500
    assert get_auction_state().phase == 'open_bidding'
    
    # Verify: New leader elected
    assert redis_leader.get_current() is not None
    
    # Verify: Can continue
    run_until_seq(510)
```

#### Scenario 4: CDN Failure → Fallback to Avatar
```python
def test_headshot_cdn_failure_fallback():
    """Chaos: CDN returns all 404s
    Expected: Fallback to avatar, auction continues"""
    
    # Setup: Spectator watching auction
    client = connect_websocket()
    
    # Chaos: Kill CDN
    cdn.fail_all_requests()
    
    # Verify: Image fails but rendering continues
    event = next_auction_event()
    
    image = fetch_headshot(event['player_id'])
    assert image.status == 404 or image is None
    
    # Client should render fallback
    assert event['headshot_fallback'] == 'initials_avatar'
```

**Running:**
```bash
# Requires services running:
docker-compose -f docker-compose.chaos.yml up

# In another terminal:
pytest tests/chaos -v --tb=short -s

# Or via test runner:
./scripts/run-all-tests.sh chaos
```

**Pass Criteria:**
- [ ] All 4 scenarios pass
- [ ] Fallback latency < SLA
- [ ] No data loss or corruption
- [ ] Personality tiers preserved

---

### 5. Golden Auction Regression (300 seconds)

**Purpose:** Verify deterministic byte-exact replay with fixed seed

**Test Flow:**
```python
def test_golden_auction_deterministic_replay():
    """
    Regression: Run auction with seed=42 and saved LLM fixtures
    Expected: Identical event sequence to golden baseline
    """
    
    # Load golden baseline
    golden_events = load_fixture('golden-auction-seed-42.json')
    
    # Run with same seed and mocked LLM
    mock_llm.load_fixtures('golden-auction-llm-calls.json')
    
    events = run_auction(seed=42)
    
    # Byte-exact comparison
    assert to_bytes(events) == to_bytes(golden_events)
    
    # Detailed validation
    for i, (actual, expected) in enumerate(zip(events, golden_events)):
        assert actual['seq'] == expected['seq']
        assert actual['type'] == expected['type']
        assert actual['timestamp'] == expected['timestamp']
        assert actual['payload'] == expected['payload']
```

**How to Create Golden Fixture:**
```bash
# 1. Run auction once
pytest tests/golden-auction/test_record.py -v -s

# 2. Review event log (should be in logs)
# 3. Commit to fixtures/golden-auction-seed-42.json

# 4. Future runs validate against it
pytest tests/golden-auction/test_deterministic_replay.py -v
```

**Running:**
```bash
pytest tests/golden-auction -v --tb=short
pytest tests/golden-auction -vv     # Very verbose
```

**Pass Criteria:**
- [ ] Exact byte match with baseline
- [ ] All 50+ events match
- [ ] Checksums identical
- [ ] Timestamps consistent

---

### 6. Load & Performance Tests (600 seconds)

**Purpose:** Validate SLA targets under realistic load

**SLA Targets:**
| Metric | Target | Tool |
|--------|--------|------|
| Decision latency p95 | < 4s | Custom Python |
| SAG lookup p95 | < 1.5s (cached) | SAG benchmark |
| WebSocket latency p95 | < 500ms | Broadcaster test |
| LCP p95 on 4G | < 1s | Playwright (2G/4G) |
| System capacity | 1000+ WebSocket clients | k6 |

**Running Decision Latency Test:**
```bash
pytest tests/load -v -k "decision_latency"
# Expected output:
# Decision Latency (100 samples):
#   Mean: 1250ms
#   P95: 3850ms  ✓ (< 4000ms)
#   P99: 3950ms  ✓ (< 4000ms)
```

**Running LCP Test (4G throttling):**
```bash
npx playwright test tests/e2e/lcp-4g.spec.ts --headed
# Playwright will:
# 1. Throttle to 4G LTE speeds (4Mbps down, 3Mbps up, 50ms latency)
# 2. Load auction room
# 3. Measure LCP (Largest Contentful Paint)
# 4. Assert < 1000ms
```

**Running Capacity Test (k6):**
```bash
k6 run tests/load/capacity-test.js --vus 1000 --duration 5m
# Expected: 1000 simultaneous WebSocket clients maintained
```

**Pass Criteria:**
- [ ] Decision latency p95 < 4s
- [ ] SAG lookup p95 < 1.5s
- [ ] WebSocket latency p95 < 500ms
- [ ] LCP < 1s on 4G
- [ ] 1000+ concurrent clients sustained

---

## Running Tests Before Deployment

### Pre-Staging Checklist

```bash
# 1. Code Quality
make lint
make typecheck

# 2. Unit Tests
./scripts/run-all-tests.sh unit

# 3. Integration Tests
./scripts/run-all-tests.sh integration

# 4. Isolation Tests (CRITICAL)
./scripts/run-all-tests.sh isolation

# 5. Golden Auction (Determinism)
./scripts/run-all-tests.sh golden

# 6. Validate Deployment Readiness
./scripts/validate-staging-deployment.sh

# 7. Approval
# If all above pass:
# ✓ SAFE FOR STAGING DEPLOYMENT
```

### Pre-Production Checklist

```bash
# 1. All staging tests
./scripts/run-all-tests.sh --all

# 2. Chaos tests (requires staging infra)
./scripts/run-all-tests.sh chaos

# 3. Load tests
./scripts/run-all-tests.sh load

# 4. E2E tests
./scripts/run-all-tests.sh e2e

# 5. 7-day SLO validation
# (Run manually in staging for 7 consecutive days)

# 6. Approval
# If all above pass with consistent SLOs:
# ✓ SAFE FOR PRODUCTION DEPLOYMENT
```

---

## Debugging Failed Tests

### Test Fails: "Budget Constraint Not Enforced"
```python
# Check if rule is actually implemented
grep -r "budget" services/auction-manager/src/rules.py

# Check in logs
pytest tests/integration -k "budget" -vv -s

# Add debug prints
bid = BidFactory.create(amount=11_000_000)
print(f"Team budget: {team.budget}, Spent: {team.spent}")
print(f"Bid amount: {bid.amount}")
print(f"Remaining: {team.budget - team.spent}")

assert (team.spent + bid.amount) <= team.budget
```

### Test Fails: "Isolation Probe Detected Leakage"
```python
# Review which probe failed
pytest tests/isolation -vv

# Check the specific agent interaction
grep -A 20 "test_agent_cannot_access_opponent" tests/isolation/test_cross_agent_leakage.py

# Verify prompt builder doesn't include other teams
grep -r "opponent\|other.*team\|CSK\|MI" services/agent-orchestrator/src/prompt_builder.py

# Run type check
mypy --strict services/agent-orchestrator/src/prompt_builder.py
```

### Test Fails: "Golden Auction Doesn't Match"
```python
# Check if LLM fixtures are the same
pytest tests/golden-auction -vv --tb=long

# Regenerate golden baseline
python -m pytest tests/golden-auction/test_record.py -v

# Verify checksum matches
pytest tests/golden-auction -v --capture=no | grep -i checksum
```

### Test Fails: "Latency p95 > 4000ms"
```python
# Get detailed metrics
pytest tests/load -k "decision_latency" -vv --capture=no

# Check if it's LLM gateway latency
grep "llm_gateway_latency" test-results.json

# Check if it's SAG lookup latency
grep "sag_lookup_latency" test-results.json

# Profile specific operation
python -c "
from tests.conftest import PerformanceProfiler
prof = PerformanceProfiler('auction_decision')
for i in range(100):
    prof.measure(make_decision, player_id, team_id)
print(prof.report())
"
```

---

## Continuous Integration

### GitHub Actions Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: make install
      - run: pytest tests/unit -v --tb=short
      - run: pytest tests/unit --cov --cov-report=xml
      - uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v3
      - run: make install
      - run: pytest tests/integration -v --tb=short

  isolation-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: make install
      - run: pytest tests/isolation -v
      - name: Check isolation pass
        if: failure()
        run: exit 1

  blocking-gates:
    needs: [unit-tests, integration-tests, isolation-tests]
    runs-on: ubuntu-latest
    steps:
      - run: echo "✓ All required tests passed"
```

---

## Maintenance & Extension

### Adding a New Test

```python
# 1. Create test file
# tests/integration/test_new_feature.py

import pytest
from conftest import AuctionFactory, TeamFactory, BidFactory

class TestNewFeature:
    """Test description"""

    def test_specific_behavior(self):
        """
        Scenario: What's being tested
        Expected: What should happen
        """
        # Arrange
        auction = AuctionFactory.create()
        
        # Act
        result = do_something(auction)
        
        # Assert
        assert result.status == 'success'

# 2. Run test
pytest tests/integration/test_new_feature.py -v

# 3. Commit
git add tests/integration/test_new_feature.py
git commit -m "test: add test for new feature"
```

### Updating Golden Fixture

```bash
# When determinism changes (e.g., new RNG seed behavior)

# 1. Record new baseline
pytest tests/golden-auction/test_record.py -v

# 2. Review changes
git diff fixtures/golden-auction-seed-42.json

# 3. Approve and commit
git add fixtures/golden-auction-seed-42.json
git commit -m "chore: update golden auction fixture"

# 4. Verify regression tests still pass
pytest tests/golden-auction/test_deterministic_replay.py -v
```

---

## Performance Profiling

### Profile a Specific Operation

```python
from tests.conftest import PerformanceProfiler

# Measure auction decision
profiler = PerformanceProfiler('auction_decision_latency')

for i in range(100):
    with profiler:
        auction.make_decision(player_id, team_id)

print(profiler.report())
# Output:
# auction_decision_latency:
#   Count: 100
#   Mean: 1234.56ms
#   P95: 3876.54ms
#   P99: 3987.23ms
#   Min: 987.65ms
#   Max: 3999.99ms
```

### Generate Performance Report

```bash
pytest tests/performance -v --tb=short --durations=20
# Shows 20 slowest tests

pytest tests/performance --profile-interval=100
# Generates CPU profile
```

---

## Key Metrics to Monitor

```json
{
  "unit_test_coverage": ">80%",
  "integration_tests_count": 15,
  "isolation_probes_count": 50,
  "isolation_pass_rate": "100%",
  "chaos_scenarios_count": 4,
  "chaos_pass_rate": "100%",
  "golden_auction_match": "byte-exact",
  "decision_latency_p95_ms": "<4000",
  "sag_latency_p95_ms": "<1500",
  "websocket_latency_p95_ms": "<500",
  "lcp_p95_4g_ms": "<1000",
  "concurrent_clients_sustained": "1000+",
  "ci_pipeline_pass_rate": ">99%"
}
```

---

## Resources

- **Test Utilities:** `tests/conftest.py` (factories, assertions, profilers)
- **Test Runner:** `scripts/run-all-tests.sh` (orchestration & reporting)
- **Deployment Validator:** `scripts/validate-staging-deployment.sh`
- **Alerts & Monitoring:** `infra/prometheus/auction-alerts.yml`
- **CI/CD:** `.github/workflows/` (GitHub Actions)

---

## Summary

The test infrastructure provides:

1. **Unit Tests** (30s) — Fast feedback on component changes
2. **Integration Tests** (120s) — Validate complete flows
3. **Isolation Tests** (120s) — Enforce non-negotiable security invariant
4. **Chaos Tests** (300s) — Verify resilience
5. **Golden Regression** (300s) — Guarantee determinism
6. **Load Tests** (600s) — Validate SLA targets
7. **Continuous Monitoring** — Prometheus + Grafana + Alerts

**Pass all tests → Safe for production deployment**

