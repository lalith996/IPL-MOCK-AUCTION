# IPL 2026 Multi-Agent Auction MVP

> Project-root context for Claude Code. Read this file at the start of every session. Companion documents: `docs/ipl_2026_auction_mvp_spec.md` (functional spec, 16 sections) and `docs/ipl_2026_auction_hld.md` (production HLD).

---

## Project Overview

Production-grade multi-agent auction web app that simulates an IPL-style mini-auction. Ten autonomous franchise agents — each powered by a distinct LLM — compete under IPL rules using Cricsheet-derived player features, SAG-sourced freshness signals, and per-agent Plan A/B/C/D strategies. Spectators watch in real time with full per-bid rationale visibility.

**Scope:** MVP only. One mini-auction session, 10 team agents, one SAG connector, two-bidder turn-taking, basic real-time UI, full rule enforcement.

**Out of scope for MVP:** mega auction pool, human participants, marketplace, persistent cross-auction learning, multi-season ingestion beyond what MVP needs.

---

## Non-Negotiable Invariants

These are the safety contract. Do not weaken them. Any change that touches these requires explicit review.

- Zero cross-agent state or prompt leakage. Enforced by typed prompt builders and stateless LLM calls.
- Every agent output validates against `agent_output.schema.json`.
- Every SAG output carries provenance for every external signal.
- All auction state is event-sourced. Any run is replayable deterministically from the event log.
- Each team agent runs on the exact model specified in the TeamModel table. Personality weights are per-personality, not per-model.
- Bid amounts derive from a deterministic scoring function. The LLM selects and strategizes; it does not compute raw scores.
- No render-blocking image failure may delay bid event rendering.
- The LLM fallback cascade preserves personality tier (AGGRESSIVE, BALANCED, CONSERVATIVE).
- No PII from social feeds. Aggregated metrics only.
- Per-auction LLM cost budget is enforced with a hard stop.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Web frontend | Next.js 14 (App Router), TypeScript strict, Tailwind | Edge-render capable, good WebSocket story, typed end-to-end |
| Client state | Zustand | Minimal, typed, fits event-driven UI |
| BFF / API gateway | Fastify + TypeScript | Fast, schema-first (JSON Schema native), small surface |
| Services | Python 3.11+, FastAPI, Pydantic v2 | Best-in-class for LLM orchestration and data work |
| Agent orchestration | LangGraph | Per-agent subgraphs with typed boundaries |
| LLM routing | OpenRouter-compatible proxy | Per-model endpoints, stateless, cost tracking |
| Event bus (MVP) | Redis Streams | Ordered per-partition, simple ops |
| Primary DB | Managed Postgres 15+ | Event log + projections |
| Cache | Redis 7+ | SAG cache, feature hot tier, locks |
| Object store | S3-compatible (R2 or S3) | Headshots, raw Cricsheet, snapshots |
| CDN | Cloudflare | India edge, immutable asset caching |
| Observability | OpenTelemetry + Prometheus + Grafana + Loki | One stack, OSS |
| CI/CD | GitHub Actions + ArgoCD | Canary deploys, golden-auction regression gate |
| Secrets | Vault or managed KMS | Rotation enforced |
| Package manager | pnpm (JS), uv or poetry (Python) | Workspace-aware |

---

## Repository Layout

```
.
├── apps/
│   ├── web/                  # Next.js spectator + auction room UI
│   └── admin/                # Operator console (session control, replay viewer)
├── services/
│   ├── auction-manager/      # Control-plane FSM, rules engine, event writer
│   ├── agent-orchestrator/   # LangGraph per-agent subgraphs, observation builder
│   ├── llm-gateway/          # Per-model routing, retries, circuit breaker, fallback
│   ├── sag/                  # Search-Analyze-Generate service + connectors
│   ├── ingestion/            # Cricsheet ETL, injury/social pollers, headshot pipeline
│   └── broadcaster/          # WebSocket fan-out from event bus
├── packages/
│   ├── schemas/              # JSON Schemas + generated TS/Python types
│   └── shared/               # Utilities, telemetry helpers, error types
├── infra/
│   ├── docker/               # Local dev stack
│   ├── k8s/                  # Manifests or Helm charts
│   └── terraform/            # Cloud resources
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── isolation/            # Adversarial suite for cross-agent leakage
│   ├── golden-auction/       # Deterministic replay regression
│   └── chaos/                # LLM provider failure simulation
├── docs/
│   ├── ipl_2026_auction_mvp_spec.md
│   ├── ipl_2026_auction_hld.md
│   └── runbooks/
└── CLAUDE.md                 # This file
```

---

## Key Commands

| Purpose | Command |
|---|---|
| Install all deps | `make install` |
| Start local dev stack | `make dev` |
| Build all services | `make build` |
| Run unit tests | `make test-unit` |
| Run integration tests | `make test-integration` |
| Run isolation adversarial suite | `make test-isolation` |
| Run golden auction regression | `make test-golden` |
| Run chaos tests | `make test-chaos` |
| Lint everything | `make lint` |
| Typecheck everything | `make typecheck` |
| Format everything | `make format` |
| Apply DB migrations | `make db-migrate` |
| Seed Cricsheet + fixtures | `make seed` |
| Start a mock auction session | `make mock-auction` |
| Regenerate types from schemas | `make schemas` |

---

## Architecture Summary

Three logical planes, following the HLD.

```
[Frontend + Admin]  ─ WSS / REST ─  [BFF]
                                      │
                                      ▼
                              [Auction Manager]
                               (event-sourced)
                                      │
                                      ▼
                           [Agent Orchestrator]
                                      │
                                      ▼
                             [LLM Gateway]
                                      │
                                      ▼
                       [10 LLM endpoints — TeamModel]

        [SAG] ←→ [Feature Store] ←→ [Ingestion Pipelines]
```

- **Control plane:** Auction Manager (singleton per session via Redis leader election), Rules Engine, Event Store.
- **Data plane:** SAG, Feature Store, Cold-Start Builder, Ingestion Pipelines, Headshot CDN.
- **Presentation plane:** Next.js web, admin console, WebSocket broadcaster.

For full component detail, see `docs/ipl_2026_auction_hld.md` §5.

---

## Coding Conventions

- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, no `any`, no non-null assertions without a comment justifying safety.
- **Python:** `mypy --strict`, `pydantic` v2 models at every boundary, no untyped dicts crossing service edges.
- **Error handling:** Return typed `Result` objects for recoverable errors; throw only for programmer errors. No bare `try` blocks. No swallowed exceptions.
- **Logging:** Structured JSON via OpenTelemetry. Every log carries `trace_id`, `auction_id`, and `agent_id` where applicable.
- **Schemas first:** Every service boundary defined in `packages/schemas` as JSON Schema. TS and Python types generated, never hand-written.
- **Idempotency:** All mutating APIs require `(client_id, seq)`; duplicate commands dropped.
- **Commits:** Conventional Commits. `type(scope): summary`.
- **Branches:** `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`.
- **PR checklist** (blocks merge): tests added, schemas regenerated if boundary changed, docs updated if behavior changed, no new invariants weakened, isolation suite passing, golden auction passing.

---

## Step-by-Step MVP Plan

Each step is independently reviewable and sized to complete in 1–5 working days. A step may only consume deliverables from earlier steps.

### Step 1 — Repo Bootstrap and Tooling

- **Goal:** Establish a working monorepo with build, lint, test, and typecheck green on an empty skeleton.
- **Inputs:** This document; companion spec; HLD.
- **Actions:**
  - Initialize pnpm + Python workspaces.
  - Add `Makefile` with commands from the Key Commands table.
  - Configure TypeScript strict, mypy strict, ESLint, Ruff, Prettier, Black.
  - Set up GitHub Actions with the CI pipeline skeleton.
  - Add ADR template under `docs/adr/`.
- **Deliverables:** Green CI on main, empty service skeletons in `services/*`, empty app skeletons in `apps/*`.
- **Acceptance:** `make lint && make typecheck && make test-unit` exits 0.
- **Next step:** Schema Definitions.

### Step 2 — Schema Definitions

- **Goal:** Define every cross-service contract as JSON Schema with generated types.
- **Inputs:** Step 1. Spec §4, §6, §16.1.
- **Actions:**
  - Author `agent_output.schema.json`, `sag_output.schema.json`, `auction_state.schema.json`, `auction_event.schema.json`, `cold_start_profile.schema.json`, `headshot_metadata.schema.json`.
  - Generate TypeScript types into `packages/schemas/ts`.
  - Generate Pydantic models into `packages/schemas/py`.
  - Add `make schemas` to regenerate; add schema-drift check to CI.
- **Deliverables:** Schemas checked in; generated types checked in; schema-drift CI job.
- **Acceptance:** Schema validation round-trips for every schema with a golden fixture per schema.
- **Next step:** Cricsheet ETL.

### Step 3 — Cricsheet ETL

- **Goal:** Produce versioned feature vectors for all auctionable players from Cricsheet ball-by-ball data.
- **Inputs:** Steps 1–2. Raw Cricsheet dataset.
- **Actions:**
  - Implement the ingestion pipeline in `services/ingestion/cricsheet`.
  - Canonical player ID resolution with override file.
  - Compute career, form window, phase-specific, and venue-split metrics.
  - Compute role classification and `data_coverage_score`.
  - Write to Postgres `player_features` (`feature_v1`) and hot-cache to Redis.
  - Emit `missing_players_report.json` for operator review.
- **Deliverables:** Populated `player_features` table, `missing_players_report.json`, unit tests for every metric.
- **Acceptance:** For a seeded sample of N players, computed metrics match hand-verified fixtures within tolerance.
- **Next step:** Cold-Start Profile Builder.

### Step 4 — Cold-Start Profile Builder

- **Goal:** Impute feature vectors for players absent or under-covered in Cricsheet.
- **Inputs:** Step 3.
- **Actions:**
  - Implement K-NN cohort builder over role + age + nationality.
  - Apply role-median overrides for role-specific metrics.
  - Hook into SAG as `query_type: cold_start`.
  - Compute `imputation_confidence` from cohort variance.
  - Write results to `cold_start_profiles` table.
- **Deliverables:** Cold-start path in SAG, `cold_start_profiles` populated for all flagged players, unit tests.
- **Acceptance:** Every player with `data_coverage_score < 0.5` has a valid profile; profiles round-trip against schema.
- **Next step:** Headshot Pipeline.

### Step 5 — Headshot Pipeline

- **Goal:** Pre-ingest, normalize, and CDN-host headshots for the full auction pool.
- **Inputs:** Step 2. Approved headshot source list.
- **Actions:**
  - Build ingestion worker in `services/ingestion/headshots`.
  - Normalize to square, strip EXIF, generate 64/256/512 px in WebP/AVIF/JPEG.
  - Compute blurhash.
  - Upload to object store with content-hashed filenames.
  - Write `headshot_metadata` rows.
  - Emit `headshot_ingestion_report.json`.
- **Deliverables:** CDN-hosted asset ladder, metadata table, report artifact.
- **Acceptance:** All players have assets or an approved fallback; LCP budget test passes on a synthetic 4G profile.
- **Next step:** SAG Service.

### Step 6 — SAG Service (One Connector)

- **Goal:** Serve structured player intelligence with provenance, on-demand and periodically.
- **Inputs:** Steps 2–4. Approved injury feed OR social API (operator-chosen).
- **Actions:**
  - Implement `services/sag` with FastAPI.
  - Implement adapter framework and one external connector.
  - Aggregate Cricsheet + cold-start + external signal into the SAG output schema.
  - Enforce provenance on every field.
  - Redis cache with TTLs per spec §3.
  - Fallback path when source fails — stale-if-error with degraded confidence.
- **Deliverables:** `/sag/lookup` endpoint, cache, provenance enforcement middleware.
- **Acceptance:** Schema-conformant responses for 100% of a seeded test matrix; fallback path produces valid output with degraded confidence.
- **Next step:** LLM Gateway.

### Step 7 — LLM Gateway

- **Goal:** Route per-agent calls to the correct model with retries, circuit breakers, schema validation, and a personality-preserving fallback cascade.
- **Inputs:** Steps 1–2.
- **Actions:**
  - Implement `services/llm-gateway` with OpenRouter-compatible transport.
  - Bind agents to models per the TeamModel table in spec §5.
  - Per-call ephemeral system prompt; no session state.
  - Retry with jitter, honor `Retry-After`; max 2 retries.
  - Per-model circuit breaker.
  - Pre-flight token-bucket rate limiter.
  - Strict validation against `agent_output.schema.json`; single repair attempt on schema failure.
  - Fallback cascade table configured and logged on activation.
  - Per-call cost tracking with per-auction budget enforcement.
- **Deliverables:** Gateway service, fallback cascade config, cost dashboard stub, integration tests against mock providers.
- **Acceptance:** Chaos test — killing primary model mid-call triggers fallback within SLA; schema-invalid LLM response is repaired or surfaces as `agent.timeout`.
- **Next step:** Agent Orchestrator.

### Step 8 — Agent Orchestrator

- **Goal:** Fan out per-nomination evaluation to all 10 agents with typed isolation.
- **Inputs:** Steps 6–7.
- **Actions:**
  - Implement `services/agent-orchestrator` using LangGraph.
  - One subgraph per agent; shared read-only public state node.
  - Typed observation builder per agent; compile-time prevention of cross-agent state access.
  - Enforce per-agent bid-window timeouts.
  - Emit `agent.timeout` events; auto-drop on timeout.
  - Private buffer per agent (last K = 20 events).
- **Deliverables:** Orchestrator service, typed prompt builders, isolation unit tests.
- **Acceptance:** Attempting to pass agent B's state into agent A's builder is a compile-time type error; runtime adversarial probes find zero leaks.
- **Next step:** Auction Manager and Rules Engine.

### Step 9 — Auction Manager and Rules Engine

- **Goal:** Event-sourced FSM that nominates, sequences bids, enforces rules, and produces a replayable event log.
- **Inputs:** Steps 2, 7, 8.
- **Actions:**
  - Implement `services/auction-manager`.
  - FSM: `prep → nominating → opening_bid → open_bidding → closing → sold|unsold → next`.
  - Redis-based leader election per `auction_id`.
  - Command handlers with `(client_id, seq)` idempotency.
  - Rules engine: budget, overseas cap, role minimums, bid increments, squad-size cap.
  - Two-bidder turn-taking protocol per spec §5.
  - Seeded RNG per session for reproducible replays.
  - Append-only event writes to Postgres `auction_events`; periodic snapshots.
- **Deliverables:** Auction Manager service, rules engine, event store schema and indexes.
- **Acceptance:** Golden-auction regression produces identical event sequence under fixed seed with replayed LLM fixtures.
- **Next step:** Event Bus and Broadcaster.

### Step 10 — Event Bus and Broadcaster

- **Goal:** Deliver ordered auction events to spectators in real time with reconnect support.
- **Inputs:** Step 9.
- **Actions:**
  - Configure Redis Streams as internal bus, partitioned by `auction_id`.
  - Implement `services/broadcaster` with WSS fan-out.
  - Snapshot + delta protocol: on connect or reconnect, send current snapshot, then live deltas from `event_offset`.
  - Heartbeat every 15 s.
  - Bounded per-client queue with slow-consumer eviction.
- **Deliverables:** Bus configuration, broadcaster service, client reconnect protocol implemented.
- **Acceptance:** 1000-client load test sustains p95 WSS latency ≤ 500 ms; reconnecting client receives missed events with no gaps.
- **Next step:** Frontend Auction Room.

### Step 11 — Frontend Auction Room

- **Goal:** Real-time spectator UI that renders current nomination, bids, rationale vectors, and rosters.
- **Inputs:** Steps 5, 10. `packages/schemas/ts`.
- **Actions:**
  - Scaffold Next.js app in `apps/web`.
  - Implement WSS client with reconnect + dedupe by `event_id`.
  - Render current player card with priority-hinted headshot, blurhash placeholder, initials-avatar fallback.
  - Render live bid ticker, team roster panels, budget bars.
  - Render `score_breakdown` rationale panel per bid.
  - Low-bandwidth mode via `navigator.connection` and `saveData`.
  - RUM instrumentation (LCP, CLS, FID, WSS round-trip).
- **Deliverables:** Working auction room, Playwright e2e tests, RUM wired to observability stack.
- **Acceptance:** Synthetic 50-nomination session renders without image errors; LCP p95 ≤ 1 s on simulated 4G.
- **Next step:** Admin Console.

### Step 12 — Admin Console

- **Goal:** Operator tools to create, start, pause, resume, and replay auction sessions.
- **Inputs:** Steps 9, 10, 11.
- **Actions:**
  - Scaffold `apps/admin`.
  - Implement session lifecycle controls calling BFF REST endpoints.
  - Implement replay viewer streaming from `/api/auctions/{id}/replay`.
  - Gate behind operator JWT.
- **Deliverables:** Working admin console, JWT auth, replay viewer.
- **Acceptance:** Operator can create a session, start it, pause and resume, and replay a completed session deterministically.
- **Next step:** Isolation and Compliance Test Suites.

### Step 13 — Isolation and Compliance Test Suites

- **Goal:** Lock down the non-negotiable invariants with automated tests.
- **Inputs:** Steps 7–9.
- **Actions:**
  - Author isolation adversarial suite under `tests/isolation` with 50+ probes attempting to elicit opponent state.
  - Author rule-compliance suite with invalid-bid fixtures mapped to rule IDs.
  - Author schema-conformance suite exercising all outputs.
  - Author audit-hash diff tool to detect unexpected cross-agent token overlap in prompts.
- **Deliverables:** Three test suites wired into CI as required gates.
- **Acceptance:** All suites green on main; any new code that breaks them blocks merge.
- **Next step:** Golden Auction and Chaos Tests.

### Step 14 — Golden Auction and Chaos Tests

- **Goal:** Guarantee determinism and resilience under known-bad conditions.
- **Inputs:** Steps 9, 10, 13.
- **Actions:**
  - Record a canonical auction with fixed seed and replayed LLM fixtures.
  - Commit the expected event sequence as golden fixture.
  - Build chaos suite: kill primary model mid-call, simulate SAG source down, kill Auction Manager mid-session, simulate CDN primary failure.
  - Wire both suites into CI.
- **Deliverables:** Golden fixture, chaos harness, CI integration.
- **Acceptance:** Golden auction byte-matches its recorded event log; all chaos scenarios recover within stated SLAs with zero rule violations.
- **Next step:** Observability.

### Step 15 — Observability

- **Goal:** Full visibility into auction health, LLM behavior, data freshness, and spectator experience.
- **Inputs:** All prior services.
- **Actions:**
  - OpenTelemetry traces across BFF → Auction Manager → Orchestrator → Gateway → LLM.
  - Prometheus metrics per HLD §5.12.
  - Loki structured logs with `trace_id` correlation.
  - Build five core Grafana dashboards: Auction Health, LLM Health, Agent Fairness, Data Freshness, Spectator Experience.
  - Configure five required alerts: isolation leak, model down > 2 min, SAG staleness > TTL × 3, Auction Manager leader flap, cost budget > 95%.
- **Deliverables:** Dashboards, alerts, runbooks under `docs/runbooks`.
- **Acceptance:** Every alert has been manually triggered and acknowledged in staging; every dashboard loads with live data.
- **Next step:** Staging Deploy and MVP Sign-Off.

### Step 16 — Staging Deploy and MVP Sign-Off

- **Goal:** Run the full MVP acceptance checklist in staging for 7 consecutive days.
- **Inputs:** All prior steps.
- **Actions:**
  - Provision staging via Terraform.
  - Deploy via ArgoCD with canary pattern.
  - Execute full Definition of Done checklist.
  - Produce sign-off report.
- **Deliverables:** Staging environment, sign-off report, on-call rotation established.
- **Acceptance:** Every item in Definition of Done is checked; 7 consecutive days of green SLOs.
- **Next step:** MVP complete. Begin Milestone 2 per spec §12.

---

## Testing Strategy

| Layer | Framework | Blocks merge | Blocks staging deploy |
|---|---|---|---|
| Unit | Vitest (TS), pytest (Py) | Yes | Yes |
| Integration | Supertest, pytest | Yes | Yes |
| Schema conformance | AJV, Pydantic | Yes | Yes |
| Isolation adversarial | Custom harness | Yes | Yes |
| Rule compliance | Custom harness | Yes | Yes |
| Golden auction regression | Custom harness | Yes | Yes |
| Chaos | Custom harness | No | Yes |
| E2E (Playwright) | Playwright | No | Yes |
| Load | k6 | No | Yes |

Any failing required test blocks merge to `main`. Staging deploy requires all suites green plus a successful chaos run.

---

## Observability and Operations

**Top 5 dashboards** (must exist before production traffic):

1. Auction Health — phases, nominations/minute, rule rejections, leader flaps.
2. LLM Health — per-model latency, error rate, retries, fallback activations, cost.
3. Agent Fairness — wins by team, spend by team, isolation probe results.
4. Data Freshness — SAG source staleness, Cricsheet ETL status, injury feed lag.
5. Spectator Experience — WSS clients, LCP, image error rate, reconnect rate.

**Top 5 alerts** (must exist before production traffic):

1. Isolation leak detected — page on-call immediately.
2. Any model down > 2 minutes — auto-activate fallback, notify on-call.
3. SAG source staleness exceeds TTL × 3 — degrade confidence, notify.
4. Auction Manager leader flap — auto re-elect, alert if re-election fails.
5. Per-auction LLM cost > 95% of budget — hard-stop future calls, alert.

Runbooks for each alert live under `docs/runbooks/`.

---

## Security and Compliance Checklist

- Secrets in Vault or managed KMS. Rotation enforced. Never in code or logs.
- mTLS between internal services.
- JSON Schema validation at every API boundary.
- Rate limiting at edge (per IP + per session).
- CSP and subresource integrity on frontend.
- No PII from social feeds. Aggregated metrics only; raw text discarded at ingestion.
- Audit log append-only with periodic Merkle root check.
- Per-service DB roles with least privilege.
- Short-lived operator JWTs; anonymous spectator session tokens.

---

## Definition of Done — MVP

- All 10 team agents live, each on the exact model from the TeamModel table.
- Every agent output validates against `agent_output.schema.json`.
- Every SAG output validates against `sag_output.schema.json` with provenance.
- Auction Manager enforces every rule per spec §7.
- Two-bidder turn-taking protocol operating with correct timeouts.
- Knowledge isolation: adversarial suite of 1000+ probes passes with zero leaks.
- LangGraph dispatches each agent call to the correct assigned model.
- Cricsheet features available at auction start with version tag.
- Real-time UI updates < 1 s client latency.
- End-to-end mock auction ≥ 50 nominations completes with valid rosters and a complete audit log.
- Decision latency p95 ≤ 4 s; SAG retrieval p95 ≤ 1.5 s cached, ≤ 5 s uncached.
- Zero cross-agent prompt or state leakage in logs or tests.
- External API calls cached and rate-limited per spec §6.
- Replay tool reproduces any past auction deterministically.
- Cold-start players handled with `is_cold_start` flag and uncertainty penalty applied.
- `missing_players_report.json` and `headshot_ingestion_report.json` operator-approved before auction start.
- Headshot LCP p95 ≤ 1 s on 4G; byte budget ≤ 150 KB per nomination; zero render-blocking failures in 50-nomination test.
- CDN failure simulation: fallback cascade to avatar within 1 retry; auction uninterrupted.
- Chaos test killing primary model mid-auction: fallback triggers within SLA.
- Staging SLOs green for 7 consecutive days.
- All five dashboards and five alerts in place and manually verified.

---

## Known Limitations and Open Questions

**Answered:**

- Cold-start problem: K-NN cohort imputation with uncertainty propagation per spec §16.1.
- Headshot latency: pre-ingested CDN ladder with blurhash and initials-avatar fallback per spec §16.2.
- LLM provider failures: personality-preserving fallback cascade per HLD §5.5.
- Cross-agent leakage: typed prompt builders + adversarial CI + production canaries.

**Deferred / requires operator decision:**

- Specific injury feed provider (spec §15 Q2).
- Specific social buzz API (spec §15 Q2).
- Confirmed IPL 2026 salary cap, base-price tiers, bid-increment bands (spec §15 Q4).
- Sealed-bid phases in scope? (spec §15 Q5).
- RTM / retention mechanics in MVP scope? (spec §15 Q6).
- Final fallback cascade table after beta telemetry (HLD §5.5, HLD §15).
- Event bus upgrade timing: Redis Streams → Kafka (HLD §15).

---

## How Claude Code Should Work in This Repo

- Read this file, `docs/ipl_2026_auction_mvp_spec.md`, and `docs/ipl_2026_auction_hld.md` before making non-trivial changes.
- Never weaken a non-negotiable invariant. If a task appears to require weakening one, stop and raise the conflict.
- Always add tests alongside code. No new public function without tests.
- Never introduce a new external dependency without updating the Tech Stack table in this file.
- When uncertain about scope, ask rather than expand. MVP is the hard scope line.
- Prefer minimal diffs. Do not refactor adjacent code unless the task requires it.
- When editing a schema, run `make schemas` and commit the regenerated types across all services in the same PR.
- When touching an agent-facing path, run `make test-isolation` locally before opening a PR.
- When touching the Auction Manager, Rules Engine, or event log, run `make test-golden` locally before opening a PR.
- Do not invent library names, API shapes, or version numbers. If a concrete choice is required and not specified, mark it `[DECISION PENDING]` with the tradeoff stated, and open an ADR under `docs/adr/`.
- Do not fabricate player names, match statistics, or record counts. Use placeholders like `<player_id>` and `<number>`.
- Commit messages follow Conventional Commits. PRs follow the PR checklist in Coding Conventions.
