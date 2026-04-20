# IPL 2026 Auction — Comprehensive Test Design

> Covers all 11 testing disciplines: Unit, Integration, System, White-Box, Black-Box, Validation, Data Flow, Mutation, Smoke, Sanity, and Regression.  
> Every test references a specific module path and ties directly to an MVP invariant or spec section.

---

## Table of Contents

1. [Unit Testing](#1-unit-testing)
2. [Integration Testing](#2-integration-testing)
3. [System Testing](#3-system-testing)
4. [White-Box Testing](#4-white-box-testing)
5. [Black-Box Testing](#5-black-box-testing)
6. [Validation Testing](#6-validation-testing)
7. [Data Flow Testing](#7-data-flow-testing)
8. [Mutation Testing](#8-mutation-testing)
9. [Smoke Testing](#9-smoke-testing)
10. [Sanity Testing](#10-sanity-testing)
11. [Regression Testing](#11-regression-testing)
12. [Test Matrix — CI Gates](#12-test-matrix--ci-gates)
13. [Tool Stack](#13-tool-stack)

---

## 1. Unit Testing

**Definition:** Verify the smallest independently testable logic unit in isolation. All I/O is mocked or stubbed.

**Framework:** `vitest` (TypeScript), `pytest` (Python)

**Location:** `tests/unit/`, service `__tests__/` directories, and `compliance.test.ts` inside the service.

---

### 1.1 Rules Engine — `services/auction-manager/src/rules/index.ts`

| Test ID | Function Under Test | Input | Expected Output | Invariant |
|---------|--------------------|---------------------------------|----------------------------|-------------|
| UT-R-01 | `requiredIncrement(50)` | current bid = 50 L | 5 L | Band ≤ 100 L → 5 L increment |
| UT-R-02 | `requiredIncrement(100)` | current bid = 100 L | 10 L | Band boundary (exclusive upper) |
| UT-R-03 | `requiredIncrement(200)` | current bid = 200 L | 20 L | Band 101–200 boundary |
| UT-R-04 | `requiredIncrement(999)` | current bid = 999 L | 25 L | Band > 500 → 25 L |
| UT-R-05 | `checkBudgetRule` | bid 150 L, budget 100 L | `RuleViolation { ruleId: "BudgetRule" }` | Bid exceeds budget |
| UT-R-06 | `checkBudgetRule` | bid 100 L, budget 100 L | `null` | Exact budget — valid |
| UT-R-07 | `checkOverseasRule` | 8 overseas already, Indian player | `null` | Indian players never blocked |
| UT-R-08 | `checkOverseasRule` | 8 overseas already, overseas player | `RuleViolation { ruleId: "OverseasRule" }` | Overseas cap = 8 |
| UT-R-09 | `checkOverseasRule` | 7 overseas, overseas player | `null` | Under cap — valid |
| UT-R-10 | `checkRoleMinimumRule` | squad has 0 keepers, bidding on non-keeper, squad size 23 | `RuleViolation { ruleId: "RoleMinimumRule" }` | Must reserve slot for required role |
| UT-R-11 | `checkRoleMinimumRule` | 1 keeper, 2 spinners, 3 pacers in squad | `null` | All minimums satisfied |
| UT-R-12 | `checkSquadSizeRule` | squad already 25 | `RuleViolation { ruleId: "SquadSizeRule" }` | Max squad = 25 |
| UT-R-13 | `checkSquadSizeRule` | squad 24 | `null` | Under cap — valid |
| UT-R-14 | `checkBidIncrementRule` | current 100 L, new bid 108 L | `RuleViolation { ruleId: "BidIncrementRule" }` | 108 not a valid step from 100 |
| UT-R-15 | `checkBidIncrementRule` | current 100 L, new bid 110 L | `null` | Exact increment |
| UT-R-16 | `checkWithdrawalRule` | agent has 2 consecutive drops on same player | `RuleViolation { ruleId: "WithdrawalRule" }` | 2 drops = locked out for this player |
| UT-R-17 | `validateBid` | OverseasRule violated | First rule in priority order returned | `validateBid` returns first failing rule |

```typescript
// Example: tests/unit/rules.test.ts
import { describe, it, expect } from "vitest";
import {
  requiredIncrement,
  checkBudgetRule,
  checkOverseasRule,
  validateBid,
} from "../../services/auction-manager/src/rules/index.js";

describe("requiredIncrement", () => {
  it("returns 5 for bids under 100L", () => {
    expect(requiredIncrement(50)).toBe(5);
  });
  it("returns 25 for bids over 500L", () => {
    expect(requiredIncrement(600)).toBe(25);
  });
});
```

---

### 1.2 Scoring Function — `services/agent-orchestrator/src/scoring.py`

| Test ID | Scenario | Key Assertion |
|---------|----------|---------------|
| UT-S-01 | AGGRESSIVE weights sum to 1.0 | `sum(WEIGHTS["AGGRESSIVE"].values()) == 1.0` |
| UT-S-02 | BALANCED weights sum to 1.0 | `sum(WEIGHTS["BALANCED"].values()) == 1.0` |
| UT-S-03 | CONSERVATIVE weights sum to 1.0 | `sum(WEIGHTS["CONSERVATIVE"].values()) == 1.0` |
| UT-S-04 | Score ∈ [0, 1] for all personalities | `0 <= compute_score(player, team, personality) <= 1` |
| UT-S-05 | AGGRESSIVE scores higher than CONSERVATIVE on same high-form player | `score_agg > score_cons` when form_score = 0.9 |
| UT-S-06 | Cold-start uncertainty penalty reduces final score | Score with `data_confidence=0.3` < score with `data_confidence=1.0` |
| UT-S-07 | `ScoreBreakdown` fields sum to `total_score` | Arithmetic consistency check |
| UT-S-08 | Zero budget → score has meaningful `squad_need` component | `squad_need` weight still computed when budget is tiny |
| UT-S-09 | Role fit: keeper bid from team needing keeper → high `role_fit` | `score.role_fit >= 0.8` |
| UT-S-10 | Role fit: keeper bid from team with 2 keepers → low `role_fit` | `score.role_fit <= 0.2` |

```python
# Example: tests/unit/test_scoring.py
import pytest
from services.agent_orchestrator.src.scoring import compute_score
from services.agent_orchestrator.src.models import NominatedPlayer, TeamState

def test_score_in_unit_range():
    player = NominatedPlayer(player_id="p001", role="batsman",
                             base_price_lakhs=100.0, data_confidence=0.8,
                             form_score=0.7, fair_value_lakhs=150.0)
    team = TeamState(agent_id="MI", budget_remaining_cr=30.0,
                     squad=[], overseas_count=2)
    score = compute_score(player, team, "AGGRESSIVE")
    assert 0.0 <= score.total_score <= 1.0
```

---

### 1.3 Cold-Start K-NN — `services/sag/src/cold_start.py`

| Test ID | Scenario | Expected |
|---------|----------|----------|
| UT-CS-01 | Player with coverage=0.4 gets imputed profile | `cold_start_profile` returned, `is_cold_start=True` |
| UT-CS-02 | K=5 cohort of batsmen → mean strike rate used as baseline | Mean within ±1% of manual computation |
| UT-CS-03 | Cohort variance = 0 → `imputation_confidence = 1.0` | Full confidence on uniform cohort |
| UT-CS-04 | Cohort variance = max → `imputation_confidence < 0.5` | Low confidence on spread cohort |
| UT-CS-05 | Role-median override: death-bowler economy uses role median | Not global median |
| UT-CS-06 | Player with coverage=0.9 gets NO imputed profile | Normal feature vector returned |

---

### 1.4 Cricsheet ETL Metrics — `services/ingestion/cricsheet/metrics.py`

| Test ID | Function | Fixture | Expected |
|---------|----------|---------|----------|
| UT-ETL-01 | `compute_career_batting` | 10-innings fixture, 500 runs | avg=50.0, SR=130.5 |
| UT-ETL-02 | `compute_phase_metrics` | PP deliveries isolated | PP SR different from global SR |
| UT-ETL-03 | `compute_form_window(n=5)` | 20-innings set | Only last 5 used |
| UT-ETL-04 | `classify_role` | >50% deliveries as opener | role=`opener` |
| UT-ETL-05 | `data_coverage_score` | Player with only 3 matches | score < 0.5 |
| UT-ETL-06 | `compute_venue_splits` | Matches at 3 different grounds | 3 venue entries |

---

### 1.5 WebSocket Reconnect Hook — `apps/web/src/hooks/useAuctionSocket.ts`

| Test ID | Scenario | Expected |
|---------|----------|----------|
| UT-WS-01 | `seenEventIds` deduplication | Duplicate `event_id` not applied to store twice |
| UT-WS-02 | Backoff capped at `MAX_BACKOFF_MS=30000` | `min(2^n * 500, 30000)` |
| UT-WS-03 | Snapshot triggers `setSnapshot` on store | Zustand `setSnapshot` called once |
| UT-WS-04 | Delta event triggers `applyEvent` | Called with typed payload |

---

## 2. Integration Testing

**Definition:** Test two or more real components interacting through their actual interfaces (HTTP, Redis, Postgres). No mocks at service boundaries except for external third-party APIs.

**Framework:** `pytest` + `httpx.AsyncClient`, `supertest` for TypeScript services

**Location:** `tests/integration/`

---

### 2.1 SAG Service — `tests/integration/test_sag_integration.py`

| Test ID | Scenario | Components | Expected |
|---------|----------|------------|---------|
| IT-SAG-01 | `GET /sag/lookup` for covered player | SAG + Redis (fakeredis) | 200, `sag_output.schema.json` valid, all provenance fields present |
| IT-SAG-02 | Cache hit on second call | SAG + Redis | `x-cache: HIT` header, response time < 50 ms |
| IT-SAG-03 | Source adapter throws → stale fallback | SAG + broken adapter mock | 200, `confidence` < 1.0, provenance `source: "stale"` |
| IT-SAG-04 | No cache, no adapter data → `confidence: 0` | SAG + empty Redis | 200, `confidence: 0`, `missing_fields` list populated |
| IT-SAG-05 | `query_type: cold_start` for low-coverage player | SAG + cold-start path | 200, `is_cold_start: true` in response |
| IT-SAG-06 | Rate limiter: 11th request in burst window | SAG + Redis (token bucket) | 429 Too Many Requests |
| IT-SAG-07 | Provenance missing on one field → rejected | SAG provenance middleware | 500 or internal error; never leaks unprovenance data |

---

### 2.2 Auction Manager — Command → Event Store

| Test ID | Scenario | Components | Expected |
|---------|----------|------------|---------|
| IT-AM-01 | `POST /auctions` → `POST /auctions/:id/start` | Auction Manager + Postgres | Phase transitions `prep → nominating`; event `auction.started` written |
| IT-AM-02 | Valid `PlaceBid` command | Auction Manager + Postgres | `bid.placed` event appended; seq incremented |
| IT-AM-03 | Duplicate command (same `client_id`+`seq`) | Auction Manager + Postgres | Second call returns 200 with same result; event NOT duplicated |
| IT-AM-04 | Invalid bid (budget exceeded) | Auction Manager | 422 with `ruleId: "BudgetRule"`; no event written |
| IT-AM-05 | Snapshot triggered at 20 events | Auction Manager + Postgres | Row in `auction_snapshots` after 20 events |
| IT-AM-06 | Leader election via Redis | 2 Auction Manager instances + Redis | Only one writes events; second is standby |

---

### 2.3 Agent Orchestrator → LLM Gateway

| Test ID | Scenario | Components | Expected |
|---------|----------|------------|---------|
| IT-AO-01 | `POST /orchestrator/evaluate` with valid public state | Orchestrator + Gateway mock | 10 agent actions returned, all typed |
| IT-AO-02 | Timeout: one agent's LLM takes > 8 s | Orchestrator + slow gateway mock | `agent.timeout` emitted for that agent; other 9 complete normally |
| IT-AO-03 | Schema-invalid LLM response → repair attempt | Orchestrator + gateway returning bad JSON | Repair prompt sent; on 2nd failure → `agent.timeout` |
| IT-AO-04 | Agent A's observation contains no field from Agent B's team | Orchestrator | `IsolationLeakError` not raised; Agent B fields absent from Agent A context |

---

### 2.4 Broadcaster — Redis Streams to WebSocket

| Test ID | Scenario | Components | Expected |
|---------|----------|------------|---------|
| IT-BC-01 | Client connects and receives snapshot | Broadcaster + Redis + Postgres | Snapshot JSON sent within 200 ms of connect |
| IT-BC-02 | Client reconnects with `?event_offset=X` | Broadcaster + Redis Streams | All events after offset X delivered in order |
| IT-BC-03 | Heartbeat sent every 15 s | Broadcaster | Ping frame received at ≤ 15 s intervals |
| IT-BC-04 | Slow consumer (queue fills to 500) | Broadcaster | Client evicted with notification message |

---

## 3. System Testing

**Definition:** End-to-end test of the fully integrated system against functional requirements. Real services, real database, seeded data.

**Framework:** `pytest` + `playwright` for UI flows; k6 for load; custom harness for auction simulation

**Location:** `tests/e2e/`, `tests/load/`

---

### 3.1 Full Auction Session

| Test ID | Scenario | Expected |
|---------|----------|----------|
| ST-01 | Operator creates session → starts → 50 nominations complete | All 10 rosters valid; no budget overruns; audit log continuous |
| ST-02 | Spectator UI connects mid-auction | Snapshot received; subsequent bids render < 1 s from emission |
| ST-03 | Admin pauses auction → resumes after 30 s | No events during pause; FSM resumes from correct phase |
| ST-04 | All 10 team agents bid on one nomination | `agent_output.schema.json` valid for all 10; scoring function used, not LLM arithmetic |
| ST-05 | Player unsold (no bids above base price) | `player.unsold` event emitted; player returned to pool; auction advances |
| ST-06 | Overseas rule enforced end-to-end | Team at 8 overseas cannot win an overseas player; `OverseasRule` rejection visible in event log |

---

### 3.2 UI Playwright E2E — `tests/e2e/auction-room.spec.ts`

| Test ID | Action | Assertion |
|---------|--------|-----------|
| E2E-01 | Load `http://localhost:3000/?auctionId=test-42` | Page loads within 3 s; `<PhaseIndicator>` visible |
| E2E-02 | Nomination event received via WebSocket | `<PlayerCard>` renders with player name; blurhash placeholder shown then replaced |
| E2E-03 | Bid event stream | `<BidTicker>` updates within 1 s; team name and amount correct |
| E2E-04 | `player.sold` event | `<RosterPanel>` for winning team gains new player row |
| E2E-05 | WebSocket disconnect → reconnect | No events skipped; UI state consistent after reconnect |
| E2E-06 | CDN image 404 → fallback to initials avatar | No broken image shown; `<img alt>` or avatar SVG present within 1 retry |
| E2E-07 | Admin login at `http://localhost:3001` | Redirected after bad credentials; dashboard shown after valid JWT |
| E2E-08 | Admin starts session | `SessionCard` shows `phase: nominating` after start button |

---

### 3.3 Load Testing — `tests/load/broadcaster.k6.js`

| Test ID | Load Profile | SLO |
|---------|-------------|-----|
| LT-01 | 1000 concurrent WebSocket clients, 50-nomination auction | p95 WSS message latency ≤ 500 ms |
| LT-02 | 100 concurrent `/sag/lookup` calls | p95 ≤ 5 s uncached, ≤ 1.5 s cached |
| LT-03 | 10 agents each evaluating 50 players sequentially | Decision latency p95 ≤ 4 s |
| LT-04 | 1000 clients reconnect simultaneously after broadcaster restart | All receive correct snapshot; no gap in events |

---

## 4. White-Box Testing

**Definition:** Test internal logic paths using knowledge of implementation. Focus on branch coverage, path coverage, and boundary conditions.

---

### 4.1 FSM Phase Transitions — `services/auction-manager/src/fsm.ts`

The FSM has 7 phases: `prep → nominating → opening_bid → open_bidding → closing → sold|unsold → next`

**Branch Map:**

```
prep
 ├─ StartAuction command → nominating
 └─ any other command → error (invalid phase)

nominating
 └─ NominatePlayer → opening_bid

opening_bid
 ├─ PlaceBid (first bid) → open_bidding
 └─ no bid within timeout → unsold

open_bidding
 ├─ PlaceBid → open_bidding (loop)
 ├─ DropBid (second consecutive drop by same agent) → closing
 └─ bid window expires → closing

closing
 ├─ confirm → sold
 └─ no valid bidder → unsold

sold | unsold
 └─ next → nominating (or auction.ended if pool empty)
```

| Test ID | Path Exercised | Input Sequence | Expected Terminal State |
|---------|---------------|----------------|------------------------|
| WB-FSM-01 | Happy path | Start → Nominate → Bid → Bid → Wait → Sold | `sold` event emitted |
| WB-FSM-02 | No bids branch | Start → Nominate → (timeout) | `unsold` event emitted |
| WB-FSM-03 | Two-drop closing | … → open_bidding → DropBid → DropBid → closing | `closing` phase entered |
| WB-FSM-04 | Invalid command in `prep` | Bid before Start | `InvalidPhaseError` returned |
| WB-FSM-05 | Pool exhausted | 50th nomination sells | `auction.ended` event follows `sold` |
| WB-FSM-06 | Pause/Resume across `open_bidding` | Pause mid-bid → Resume | Timers restart; no state corruption |

---

### 4.2 Two-Bidder Protocol — `services/auction-manager/src/two-bidder-protocol.ts`

| Test ID | Branch | Expected |
|---------|--------|----------|
| WB-TB-01 | Only 1 agent in auction (all others at squad cap) | Single agent can place bids unopposed |
| WB-TB-02 | Agent 3 raises hand during active bidding | Added to standby queue; notified on current player completion |
| WB-TB-03 | Active bidder drops → standby promoted | Standby agent becomes active within 10 s |
| WB-TB-04 | Both top-2 agents drop | `closing` triggered immediately |

---

### 4.3 LLM Gateway Circuit Breaker — `services/llm-gateway/src/circuit-breaker.ts`

| Test ID | Path | Transitions | Expected |
|---------|------|-------------|----------|
| WB-CB-01 | 3 consecutive failures | CLOSED → OPEN | OPEN state, fallback activated |
| WB-CB-02 | OPEN for 30 s | OPEN → HALF_OPEN | One probe call allowed |
| WB-CB-03 | Probe succeeds in HALF_OPEN | HALF_OPEN → CLOSED | Normal operation resumes |
| WB-CB-04 | Probe fails in HALF_OPEN | HALF_OPEN → OPEN | Reset 30 s timer |
| WB-CB-05 | Fallback same-personality tier | MI (AGGRESSIVE) primary down | RCB or PBKS selected; never CSK/BALANCED |

---

### 4.4 Scoring Weights Boundary Conditions

| Test ID | Condition | Expected |
|---------|-----------|----------|
| WB-SC-01 | `form_score = 0`, all other scores = 1 | AGGRESSIVE has higher penalty than CONSERVATIVE |
| WB-SC-02 | `data_confidence = 0` (no data) | `uncertainty_penalty` applied; score reduced by `λ(1-conf)` |
| WB-SC-03 | All input scores = 0.5 (neutral) | Final score ≈ 0.5 for all personalities |
| WB-SC-04 | Personality bonus (`pers_bonus=0.10`) for AGGRESSIVE | Score > weighted sum of other components |

---

## 5. Black-Box Testing

**Definition:** Test behavior purely through the public API. No knowledge of internals required.

---

### 5.1 Auction Manager REST API — Black-Box

| Test ID | Endpoint | Input | Expected HTTP | Expected Body |
|---------|----------|-------|---------------|---------------|
| BB-AM-01 | `POST /auctions` | Valid body with seed, player pool | 201 | `{ auction_id, phase: "prep" }` |
| BB-AM-02 | `POST /auctions` | Missing required field `seed` | 400 | Error schema |
| BB-AM-03 | `POST /auctions/:id/start` | Valid auction in `prep` | 200 | `{ phase: "nominating" }` |
| BB-AM-04 | `POST /auctions/:id/start` | Non-existent auction ID | 404 | Error message |
| BB-AM-05 | `POST /auctions/:id/commands` | Valid `PlaceBid` | 200 | `bid.placed` event reflected |
| BB-AM-06 | `POST /auctions/:id/commands` | Bid exceeding budget | 422 | `{ ruleId: "BudgetRule", message }` |
| BB-AM-07 | `POST /auctions/:id/commands` | Overseas player when cap reached | 422 | `{ ruleId: "OverseasRule" }` |
| BB-AM-08 | `POST /auctions/:id/pause` | Auction in `open_bidding` | 200 | `{ phase: "paused" }` |
| BB-AM-09 | `POST /auctions/:id/resume` | Paused auction | 200 | `{ phase: "open_bidding" }` |

---

### 5.2 SAG REST API — Black-Box

| Test ID | Endpoint | Input | Expected |
|---------|----------|-------|---------|
| BB-SAG-01 | `POST /sag/lookup` | `{ player_id: "kohli", query_type: "full" }` | 200, schema valid |
| BB-SAG-02 | `POST /sag/lookup` | Unknown `player_id` | 200, `confidence: 0`, `missing_fields` |
| BB-SAG-03 | `POST /sag/lookup` | `query_type: "cold_start"` | 200, `is_cold_start: true` |
| BB-SAG-04 | `POST /sag/lookup` | Missing `player_id` | 422 |
| BB-SAG-05 | `GET /health` | — | 200 `{ status: "ok" }` |
| BB-SAG-06 | `GET /metrics` | — | 200, Prometheus text format |

---

### 5.3 Admin Console — Black-Box UI

| Test ID | Action | Expected UI Behavior |
|---------|--------|---------------------|
| BB-ADM-01 | Submit wrong credentials | Error banner; no dashboard shown |
| BB-ADM-02 | Valid login | Dashboard rendered; session list visible |
| BB-ADM-03 | Create session without approvals | "Approve" gate shown; Start button disabled |
| BB-ADM-04 | Grant approvals → click Start | POST to Auction Manager; session phase updates |
| BB-ADM-05 | Click Replay on completed session | NDJSON events stream; event log display updates line-by-line |
| BB-ADM-06 | Navigate to `/` without token | Redirected to login form |

---

### 5.4 WebSocket Protocol — Black-Box

| Test ID | Action | Expected Wire Behavior |
|---------|--------|----------------------|
| BB-WS-01 | Connect with no offset | First message is snapshot JSON |
| BB-WS-02 | Connect with `?event_offset=5` | First 5 events skipped; events 6+ delivered |
| BB-WS-03 | Send no pong for 30 s (2 missed heartbeats) | Connection closed by server |
| BB-WS-04 | Receive 501st event | 500-event queue overflows; eviction message received |

---

## 6. Validation Testing

**Definition:** Verify the system meets the stated requirements and non-negotiable invariants. Acceptance-criteria-level tests.

---

### 6.1 Schema Conformance — Every Boundary

| Test ID | Output Validated | Schema | Tool |
|---------|-----------------|--------|------|
| VAL-01 | All 10 agent outputs per nomination | `agent_output.schema.json` | `jsonschema.Draft7Validator` |
| VAL-02 | Every SAG response | `sag_output.schema.json` | `jsonschema.Draft7Validator` |
| VAL-03 | Every auction event written to Postgres | `auction_event.schema.json` | AJV (TypeScript) |
| VAL-04 | Every auction state snapshot | `auction_state.schema.json` | AJV |
| VAL-05 | Every cold-start profile | `cold_start_profile.schema.json` | Pydantic v2 model_validate |
| VAL-06 | Every headshot metadata row | `headshot_metadata.schema.json` | Pydantic v2 model_validate |

```python
# tests/schema-conformance/test_schema_conformance.py (already exists)
def test_agent_output_valid():
    instance = load_fixture("agent_output_valid.json")
    _validate(instance, SCHEMAS["agent_output"])  # raises AssertionError on fail
```

---

### 6.2 Non-Negotiable Invariant Validation

| Test ID | Invariant | How Verified |
|---------|-----------|-------------|
| VAL-INV-01 | Zero cross-agent state leakage | 68 adversarial isolation probes in `tests/isolation/` all pass |
| VAL-INV-02 | LLM fallback preserves personality tier | Chaos test: AGGRESSIVE team falls back to AGGRESSIVE model only |
| VAL-INV-03 | Bid amounts from deterministic scoring, not LLM | LLM response with mutated `bid_lakhs` rejected; gateway re-computes |
| VAL-INV-04 | No render-blocking image failure | Playwright assertion: page never stalls > 2 s waiting on image |
| VAL-INV-05 | Per-auction cost budget enforced | Cost tracker test: 96th percentile call rejected with hard stop |
| VAL-INV-06 | All state is event-sourceable | Replay of event log produces identical final state byte-for-byte |
| VAL-INV-07 | No PII from social feeds | SAG adapter test: raw text field stripped; only aggregated metrics stored |
| VAL-INV-08 | Provenance on every SAG field | Provenance middleware test: field without `source` + `fetched_at` → internal error |

---

### 6.3 IPL Rule Compliance Validation

| Test ID | Rule | Fixture | Expected Rejection |
|---------|------|---------|-------------------|
| VAL-RC-01 | Budget cap | Bid of ₹901 L with ₹900 L remaining | `BudgetRule` violation |
| VAL-RC-02 | Overseas squad cap | 9th overseas player bid | `OverseasRule` violation |
| VAL-RC-03 | Role minimum (keeper) | Squad of 23 with 0 keepers bidding on non-keeper | `RoleMinimumRule` violation |
| VAL-RC-04 | Role minimum (spinners) | Squad of 23 with 1 spinner bidding on non-spinner | `RoleMinimumRule` violation |
| VAL-RC-05 | Squad size | 26th player bid | `SquadSizeRule` violation |
| VAL-RC-06 | Bid increment | ₹105 L bid when current is ₹100 L | `BidIncrementRule` violation |
| VAL-RC-07 | Withdrawal lock | 3rd consecutive drop on same player | `WithdrawalRule` violation |

---

## 7. Data Flow Testing

**Definition:** Trace data from its origin through all transformations to its final consumer. Verify correctness and integrity at each intermediate node.

---

### 7.1 Bid Data Flow — Complete Pipeline

```
Agent Scoring (scoring.py)
  → LLM Gateway (agent_output.schema.json)
    → Agent Orchestrator (evaluate endpoint)
      → Auction Manager (PlaceBid command)
        → Rules Engine (validate)
          → Event Store (auction_events Postgres)
            → Redis Streams (XADD)
              → Broadcaster (XREAD)
                → WebSocket (ws frame)
                  → Zustand Store (applyEvent)
                    → UI (BidTicker component)
```

| Test ID | Flow Segment | Data Verified |
|---------|-------------|---------------|
| DFT-01 | `scoring.py` → LLM Gateway | `bid_lakhs` is exact integer multiple of `requiredIncrement`; no LLM-mutated value |
| DFT-02 | LLM Gateway → Orchestrator | `agent_id` unchanged through gateway response |
| DFT-03 | Orchestrator → Auction Manager | `auction_id` + `seq` idempotency pair preserved |
| DFT-04 | Rules Engine → Event Store | `RuleViolation` on failure means NO event written to Postgres |
| DFT-05 | Event Store → Redis Streams | Event `seq` in Postgres equals Redis Streams entry order |
| DFT-06 | Redis Streams → WebSocket | `event_id` in wire frame matches Postgres `event_id` |
| DFT-07 | WebSocket → Zustand | `seenEventIds` prevents duplicate event applied to store |
| DFT-08 | Zustand → UI | `BidTicker` renders `bid_lakhs` exactly as received; no rounding |

---

### 7.2 Player Feature Data Flow — ETL to SAG

```
Cricsheet JSON (raw ball-by-ball)
  → parser.py (delivery events)
    → metrics.py (career/form/phase aggregates)
      → resolver.py (canonical player_id)
        → Postgres player_features table
          → Redis hot cache (sorted by form_score)
            → SAG aggregator (lookup)
              → cold_start.py (if coverage < 0.5)
                → SAG response (sag_output.schema.json)
```

| Test ID | Flow Segment | Verification |
|---------|-------------|-------------|
| DFT-ETL-01 | Raw JSON → parser | Each delivery parsed without error; match_id preserved |
| DFT-ETL-02 | Parser → metrics | `career_runs` = sum of all parsed delivery runs for player |
| DFT-ETL-03 | Metrics → resolver | Fuzzy name match maps "V Kohli" → canonical `virat-kohli-ind` |
| DFT-ETL-04 | Resolver → Postgres | `feature_v1` row written with correct `player_id`, `data_coverage_score` |
| DFT-ETL-05 | Postgres → Redis | Redis sorted set score = `form_score` for fast SAG lookup |
| DFT-ETL-06 | SAG → cold-start | Player with `coverage < 0.5` triggers K-NN path; profile stored in `cold_start_profiles` |
| DFT-ETL-07 | Cold-start → SAG response | `is_cold_start: true` in response; `imputation_confidence` matches stored profile |

---

### 7.3 Auction Event Sourcing Data Flow

```
Command (PlaceBid)
  → Idempotency check (client_id + seq) → if duplicate: return cached result
  → Rules Engine → if violation: return RuleViolation, stop
  → FSM transition
    → Event constructed (auction_event.schema.json)
      → Postgres append (auction_events, seq monotonic)
        → Snapshot every 20 events (auction_snapshots)
          → Redis Stream XADD
            → Broadcaster fan-out
```

| Test ID | Node | Invariant Tested |
|---------|------|-----------------|
| DFT-ES-01 | Idempotency check | Second identical command returns same result; event count unchanged |
| DFT-ES-02 | Postgres append | `seq` is monotonically increasing; no gaps under concurrent writes |
| DFT-ES-03 | Snapshot trigger | `auction_snapshots` row appears at events 20, 40, 60, … |
| DFT-ES-04 | Replay from event log | Applying all events to empty state produces same snapshot as stored |
| DFT-ES-05 | Redis → Broadcaster ordering | Events delivered in `seq` order; no out-of-order messages |

---

## 8. Mutation Testing

**Definition:** Introduce deliberate code mutations (bugs) and verify the test suite catches them. Measures test suite effectiveness.

**Tool:** `mutmut` (Python), `stryker` (TypeScript)

**Location:** Run against core logic modules; results in `tests/mutation-report/`

---

### 8.1 Target Modules and Expected Kill Rate

| Module | Target Kill Rate | Key Mutants to Kill |
|--------|-----------------|---------------------|
| `services/auction-manager/src/rules/index.ts` | ≥ 90% | Off-by-one in `requiredIncrement` bands; `>` vs `>=` in budget check; `>=` vs `>` in overseas cap |
| `services/agent-orchestrator/src/scoring.py` | ≥ 85% | Weight value changes; `+` → `-` in score formula; personality table lookup |
| `services/ingestion/cricsheet/metrics.py` | ≥ 85% | `sum()` → `len()` in run aggregation; form window `n=5` → `n=4` |
| `services/sag/src/provenance.py` | ≥ 90% | `if not field.provenance` → `if field.provenance` (inverted guard) |
| `services/agent-orchestrator/src/observation_builder.py` | ≥ 95% | Removal of `IsolationLeakError` raise; `accessor != victim` → `accessor == victim` |

---

### 8.2 Critical Mutants

These specific mutations MUST be killed (test must fail when mutation is active):

| Mutant ID | File | Line Change | Kills By |
|-----------|------|-------------|----------|
| MUT-01 | `rules/index.ts` | `bidLakhs > budgetLakhs` → `bidLakhs >= budgetLakhs` | UT-R-06 (exact budget valid) |
| MUT-02 | `rules/index.ts` | `overseasCount >= MAX_OVERSEAS_SQUAD` → `> MAX_OVERSEAS_SQUAD` | UT-R-08 (8th overseas blocked) |
| MUT-03 | `scoring.py` | AGGRESSIVE `form` weight `0.35` → `0.25` | UT-S-05 (AGGRESSIVE scores higher) |
| MUT-04 | `observation_builder.py` | Remove `if own_state.agent_id != this_agent_id: raise IsolationLeakError` | VAL-INV-01 + isolation probe tests |
| MUT-05 | `provenance.py` | `if not has_provenance(field)` → `if has_provenance(field)` | VAL-INV-08 |
| MUT-06 | `private_buffer.py` | `if requesting_agent_id != owner_agent_id: raise PermissionError` → inverted | Isolation probe tests |
| MUT-07 | `two-bidder-protocol.ts` | `consecutiveDrops >= 2` → `consecutiveDrops >= 3` | WB-TB-04 |
| MUT-08 | `circuit-breaker.ts` | `HALF_OPEN after 30s` → `HALF_OPEN after 60s` | WB-CB-02 |
| MUT-09 | `metrics.py` | `form_window[-5:]` → `form_window[-4:]` | UT-ETL-03 |
| MUT-10 | `cold_start.py` | `data_coverage_score < 0.5` → `data_coverage_score < 0.3` | UT-CS-06 (0.4 coverage player should get cold-start) |

---

### 8.3 Running Mutation Tests

```bash
# Python — mutmut
uv run mutmut run --paths-to-mutate services/agent-orchestrator/src/scoring.py
uv run mutmut results

# TypeScript — stryker
cd services/auction-manager
pnpm exec stryker run

# Report threshold (fail CI if kill rate < target)
uv run mutmut run --CI  # exits 1 if kill rate < 85%
```

**Add to Makefile:**
```makefile
test-mutation:
	uv run mutmut run --paths-to-mutate services/agent-orchestrator/src/scoring.py,services/sag/src/provenance.py
	cd services/auction-manager && pnpm exec stryker run
```

---

## 9. Smoke Testing

**Definition:** Minimal "does the system start and respond?" checks. Run on every deployment before deeper tests. Fast (< 2 min total).

**Framework:** `curl` / `httpx` one-liners + `playwright` page-load check

**Location:** `tests/smoke/`

---

### 9.1 Smoke Test Checklist

| Test ID | Command / Check | Pass Criteria | Service |
|---------|----------------|--------------|---------|
| SM-01 | `GET http://localhost:3004/health` | 200 `{"status":"ok"}` | Auction Manager |
| SM-02 | `GET http://localhost:3005/health` | 200 | SAG |
| SM-03 | `GET http://localhost:3006/health` | 200 | Agent Orchestrator |
| SM-04 | `GET http://localhost:3002/health` | 200 | LLM Gateway |
| SM-05 | `GET http://localhost:3003/health` | 200 or 101 (WS upgrade) | Broadcaster |
| SM-06 | `GET http://localhost:3000` | HTTP 200, HTML contains `<PhaseIndicator>` | Web frontend |
| SM-07 | `GET http://localhost:3001` | HTTP 200 or 302 to login | Admin console |
| SM-08 | `GET http://localhost:3005/metrics` | 200, `# HELP sag_lookup_duration` | Prometheus metrics mount |
| SM-09 | Redis PING | `PONG` | Infrastructure |
| SM-10 | Postgres `SELECT 1` | Row returned | Infrastructure |
| SM-11 | `POST /auctions` with minimal body | 201 with `auction_id` | Auction Manager |
| SM-12 | `POST /sag/lookup` with valid `player_id` | 200 with `player_id` echoed | SAG |

```bash
# tests/smoke/run_smoke.sh
#!/usr/bin/env bash
set -euo pipefail
BASE_AM=http://localhost:3004
BASE_SAG=http://localhost:3005

curl -sf "$BASE_AM/health" | jq -e '.status == "ok"'
curl -sf "$BASE_SAG/health" | jq -e '.status == "ok"'
curl -sf -X POST "$BASE_SAG/sag/lookup" \
  -H 'Content-Type: application/json' \
  -d '{"player_id":"smoke-test-player","query_type":"full"}' | jq -e '.player_id'
echo "All smoke tests passed."
```

**Add to Makefile:**
```makefile
test-smoke:
	bash tests/smoke/run_smoke.sh
```

---

## 10. Sanity Testing

**Definition:** Narrow, focused re-test of a specific feature after a patch. Subset of regression. Fast (< 5 min). Run before calling a fix "done."

**When to run:** After any patch; before opening a PR; after hotfix to production.

---

### 10.1 Sanity Test Sets by Feature Area

#### Sanity Set A — Rules Engine (run after any change to `rules/index.ts`)

```bash
pnpm --filter @ipl/auction-manager exec vitest run src/rules/compliance.test.ts
```

Covers all 37 compliance tests in under 10 s.

#### Sanity Set B — Agent Scoring (run after any change to `scoring.py`)

```bash
uv run pytest tests/unit/test_scoring.py -x -q
```

#### Sanity Set C — Isolation Guards (run after any change to `observation_builder.py` or `private_buffer.py`)

```bash
uv run pytest tests/isolation/test_isolation_adversarial.py -x -q
```

#### Sanity Set D — Schema Validity (run after any change to `packages/schemas/`)

```bash
make schemas
uv run pytest tests/schema-conformance/ -x -q
```

#### Sanity Set E — WebSocket Reconnect (run after any change to broadcaster or `useAuctionSocket.ts`)

```bash
pnpm --filter @ipl/web exec vitest run src/hooks/useAuctionSocket.test.ts
```

#### Sanity Set F — Admin Console Auth (run after any change to `apps/admin/`)

```bash
pnpm --filter @ipl/admin exec vitest run src/app/page.test.tsx
```

---

### 10.2 Sanity Test Decision Matrix

| Change Made | Run Sanity Sets |
|-------------|----------------|
| `rules/index.ts` | A |
| `scoring.py` | B |
| `observation_builder.py` or `private_buffer.py` | C |
| Any `packages/schemas/*.json` | D |
| `broadcaster/` or `useAuctionSocket.ts` | E |
| `apps/admin/` | F |
| `fsm.ts` | A + run `make test-golden` |
| `aggregator.py` or `provenance.py` | D + integration test for SAG |
| Any infra/docker config | SM-01 through SM-12 |

---

## 11. Regression Testing

**Definition:** Ensure previously working functionality is not broken by new changes. Automated and deterministic.

---

### 11.1 Golden Auction Regression — `tests/golden-auction/`

The canonical regression test for the entire system. Replays a fixed-seed auction and byte-compares the event sequence.

```python
# tests/golden-auction/test_golden_auction.py
def test_sold_winners_match_golden(self, golden_events, replayed_events):
    def sold_map(events):
        return [(e["payload"]["player_id"], e["payload"]["winner"])
                for e in events if e["type"] == "player.sold"]
    assert sold_map(replayed_events) == sold_map(golden_events)
```

| Test ID | What Regresses | Trigger |
|---------|---------------|---------|
| REG-GA-01 | Player sell order (nomination sequence) | Any change to nomination RNG or seeding |
| REG-GA-02 | Winning bids (auction outcome determinism) | Any change to scoring, rules, or FSM |
| REG-GA-03 | Event count (362 events for seed=42, 50 nominations) | Any change to event emission logic |
| REG-GA-04 | Snapshot timing (every 10 nominations) | Any change to snapshot trigger logic |
| REG-GA-05 | `auction.started` always first event | FSM startup changes |
| REG-GA-06 | `auction.ended` always last event | FSM termination changes |

**CI gate:** `make test-golden` — required to merge into `main`.

---

### 11.2 Schema Drift Regression

Catches cases where generated TypeScript or Pydantic types drift from JSON Schema source.

```yaml
# .github/workflows/ci.yml
- name: Schema drift check
  run: |
    make schemas
    git diff --exit-code packages/schemas/ts/ packages/schemas/py/
```

| Test ID | Drift Scenario | Expected |
|---------|---------------|---------|
| REG-SD-01 | Add field to `agent_output.schema.json` without regenerating | CI fails: generated types out of sync |
| REG-SD-02 | Change field type in `sag_output.schema.json` | Pydantic model regenerated; type mismatch caught at import |
| REG-SD-03 | Remove required field from `auction_event.schema.json` | Existing golden fixtures fail AJV validation |

---

### 11.3 Isolation Regression — `tests/isolation/`

68 adversarial probes re-run on every PR. Any new code that introduces a cross-agent information path must cause a probe failure — then be fixed — before merge.

| Test ID | Previously Regressed Bug | Probe |
|---------|-------------------------|-------|
| REG-ISO-01 | Agent B's budget accessible via shared dict | Probe: pass Agent B's TeamState into Agent A's ObservationBuilder |
| REG-ISO-02 | Private buffer readable by wrong agent | Probe: call `append_event(requesting_agent_id="MI")` on `KKR`'s buffer |
| REG-ISO-03 | LLM prompt containing opponent squad names | Probe: search LLM call log for opponent squad player IDs |
| REG-ISO-04 | Agent personality leaked via shared Redis key | Probe: read Redis key with wrong agent's auth |

---

### 11.4 Rule Compliance Regression

Each of the 6 rules has a golden invalid-bid fixture. Any code change that causes a previously rejected bid to be accepted is a regression.

```bash
# Run compliance regression
pnpm --filter @ipl/auction-manager exec vitest run src/rules/compliance.test.ts
```

**Fixtures pinned in:** `services/auction-manager/src/rules/__tests__/fixtures/`

---

### 11.5 Performance Regression

| Test ID | Baseline (seed=42 mock auction) | Regression Threshold |
|---------|--------------------------------|---------------------|
| REG-PERF-01 | SAG lookup p95 = 1.1 s uncached | Fail if > 5 s |
| REG-PERF-02 | Decision latency p95 = 2.8 s | Fail if > 4 s |
| REG-PERF-03 | WS broadcast p95 = 180 ms | Fail if > 500 ms |
| REG-PERF-04 | LCP on 4G (web) p95 = 0.7 s | Fail if > 1.0 s |

Performance baselines recorded by `k6` and committed to `tests/load/baselines.json`. Compared on each PR targeting `main`.

---

### 11.6 CI Regression Pipeline Order

```
1. make lint && make typecheck          [< 2 min]
2. make test-unit                       [< 3 min]
3. make schemas (drift check)           [< 1 min]
4. make test-integration                [< 5 min]  ← needs Postgres + Redis
5. make test-isolation                  [< 3 min]
6. make test-golden                     [< 2 min]
7. tests/e2e (Playwright)               [< 10 min] ← staging only
8. make test-chaos                      [< 15 min] ← staging only
```

All steps 1–6 required for merge. Steps 7–8 required for staging deploy.

---

## 12. Test Matrix — CI Gates

| Test Suite | Merge to main | Staging deploy | Tool |
|-----------|:---:|:---:|------|
| Unit (vitest + pytest) | ✅ | ✅ | vitest, pytest |
| Integration | ✅ | ✅ | httpx, supertest |
| Schema conformance | ✅ | ✅ | AJV, jsonschema |
| Isolation adversarial (68 probes) | ✅ | ✅ | pytest + fakeredis |
| Rule compliance (37 cases) | ✅ | ✅ | vitest |
| Golden auction regression | ✅ | ✅ | pytest |
| Schema drift check | ✅ | ✅ | git diff |
| Smoke | ❌ | ✅ | curl / bash |
| E2E Playwright | ❌ | ✅ | playwright |
| Load (k6) | ❌ | ✅ | k6 |
| Chaos (4 scenarios) | ❌ | ✅ | pytest |
| Mutation (kill rate check) | ❌ | Monthly | mutmut, stryker |

---

## 13. Tool Stack

| Language | Unit | Integration | E2E | Load | Mutation | Schema |
|----------|------|-------------|-----|------|----------|--------|
| TypeScript | `vitest` | `supertest` | `playwright` | `k6` | `stryker` | `ajv` |
| Python | `pytest` | `httpx` + `pytest-asyncio` | — | — | `mutmut` | `jsonschema` |
| Infrastructure | — | `fakeredis.aioredis`, `testcontainers` | — | `k6` | — | — |

**Install test dependencies:**

```bash
# Python test deps
uv add --dev pytest pytest-asyncio httpx fakeredis jsonschema mutmut

# TypeScript test deps
pnpm add -D vitest @vitest/coverage-v8 supertest playwright @stryker-mutator/core

# k6 (system install)
brew install k6
```

**Coverage targets:**

| Service | Line Coverage Target |
|---------|---------------------|
| `services/auction-manager/src/rules/` | ≥ 95% |
| `services/agent-orchestrator/src/scoring.py` | ≥ 90% |
| `services/sag/src/provenance.py` | ≥ 95% |
| `services/agent-orchestrator/src/observation_builder.py` | ≥ 95% |
| All other service logic | ≥ 80% |
