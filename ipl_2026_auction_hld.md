# IPL 2026 Multi-Agent Auction Platform — High-Level Design (HLD)

**Document type:** Production system design
**Companion document:** `ipl_2026_auction_mvp_spec.md` (functional spec)
**Scope:** Full-stack, production-grade architecture; MVP → mega-auction
**Audience:** Engineering, SRE, platform security, evaluation team

---

## Table of Contents

1. Goals, Non-Goals, Success Metrics
2. Novelty & Key Differentiators
3. System Context
4. High-Level Architecture
5. Core Components Deep Dive
6. Data Model & Storage
7. API Surface
8. Real-Time Event Model
9. Cross-Cutting Concerns
10. Infrastructure & Deployment
11. Scaling Strategy
12. Evaluation Harness
13. Rollout & Migration
14. Risks & Mitigations
15. Open Design Decisions

---

## 1. Goals, Non-Goals, Success Metrics

### Goals
- Production-grade multi-agent LLM auction platform for IPL-style mini and mega auctions.
- 10 autonomous franchise agents, each on a distinct LLM, operating in strict knowledge isolation.
- Realistic, human-plausible auction dynamics with full auditability.
- Real-time spectator experience with sub-second UI updates and sub-second image loads.
- Deterministic replay of any auction from its event log.
- Graceful operation under LLM provider failures, rate limits, and partial data coverage.

### Non-Goals (MVP)
- Real-money betting or monetary settlement.
- Post-season team management, trades, or player movement.
- Persistent cross-auction agent fine-tuning (deferred to Mega phase with isolation guarantees).
- Live broadcast overlays or TV integration.

### Success Metrics (production SLOs)

| Metric | Target (MVP) | Target (Mega) |
|---|---|---|
| Availability during scheduled auction windows | 99.5% | 99.9% |
| Agent decision latency p95 | ≤ 4 s | ≤ 3 s |
| Nomination-to-sold end-to-end latency p95 | ≤ 90 s | ≤ 60 s |
| Headshot LCP p95 (4G) | ≤ 1 s | ≤ 800 ms |
| WebSocket delivery latency p95 | ≤ 500 ms | ≤ 300 ms |
| Cross-agent leakage incidents | 0 | 0 |
| Auction replay determinism (seeded runs) | 100 % | 100 % |
| LLM cost per full auction | within configured budget | within configured budget |

---

## 2. Novelty & Key Differentiators

The project's defensibility and research value rest on eight concrete architectural choices. Call these out explicitly — they are not incidental.

1. **Multi-model franchise identity.** 10 distinct LLMs (per the TeamModel table), not 10 instances of one model. Genuine decision diversity; each franchise has a cognitive fingerprint.
2. **Stateless, ephemeral isolation.** Each agent call is a clean room — per-agent system prompt assembled fresh, no session memory server-side, typed boundaries between agent handlers prevent cross-access at compile time.
3. **Quantitative-first, LLM-synthesized rationale.** Bid amounts derive from a deterministic scoring function; the LLM's job is to *evaluate*, *strategize*, and *select* from pre-scored options. This is what makes decisions both explainable and auditable.
4. **Cold-start cohort imputation.** K-NN over role + age + nationality cohorts to build feature vectors for players absent from Cricsheet — with uncertainty propagated end-to-end into the scoring function.
5. **Event-sourced auction with replayable state.** Every nomination, bid, rejection, and sale is an append-only event; any auction can be replayed deterministically for audit, evaluation, or A/B testing.
6. **SAG with mandatory provenance.** Every external signal carries `source`, `fetched_at`, and `confidence` metadata; no unsourced claim ever enters an agent's context.
7. **Personality-scaled stochasticity with plausibility caps.** Human-realistic bidding variance bounded by fair-value ceilings — agents can bluff, explore, and vary timing, but cannot behave implausibly.
8. **Cricsheet-driven season simulator.** Built rosters are evaluated by Monte Carlo simulation over Cricsheet ball-by-ball data — the same data source used for auction decisions is used for post-hoc roster evaluation, giving a closed feedback loop.

---

## 3. System Context

```
                    ┌──────────────────────┐
                    │     Spectators       │
                    │  (Web / Mobile PWA)  │
                    └──────────┬───────────┘
                               │ HTTPS + WSS
                               ▼
                    ┌──────────────────────┐
                    │   Auction Platform   │
                    │   (this system)      │
                    └──┬────────┬────────┬─┘
                       │        │        │
          ┌────────────┘        │        └──────────────┐
          ▼                     ▼                       ▼
 ┌────────────────┐   ┌───────────────────┐   ┌──────────────────┐
 │  LLM Providers │   │  Data Sources     │   │   Operators      │
 │  (OpenRouter,  │   │  • Cricsheet      │   │  (Admin console) │
 │   per-team     │   │  • Injury feeds   │   │                  │
 │   endpoints)   │   │  • Social APIs    │   │                  │
 │                │   │  • Headshot       │   │                  │
 │                │   │    sources        │   │                  │
 └────────────────┘   └───────────────────┘   └──────────────────┘
```

**External dependencies:**
- **LLM providers** — 10 model endpoints routed via OpenRouter-style proxy. Free-tier aware; rate-limited.
- **Cricsheet** — batch-ingested; single source of truth for on-field metrics.
- **Injury feed** — structured feed (RSS or API); provider TBD per Open Question §15 of the functional spec.
- **Social APIs** — aggregated-metric only; no PII.
- **Headshot sources** — licensed only; ingested at prep time.

---

## 4. High-Level Architecture

Three logical planes plus cross-cutting services.

```
╔═══════════════════════════════════════════════════════════════════════╗
║                         PRESENTATION PLANE                            ║
║                                                                       ║
║   [Web Frontend (Next.js)] ─ WSS ─ [Realtime Broadcaster]             ║
║   [Admin Console]          ─ REST ─ [BFF / API Gateway]               ║
╚═══════════════════════════════════════════════════════════════════════╝
                              │
                              ▼
╔═══════════════════════════════════════════════════════════════════════╗
║                          CONTROL PLANE                                ║
║                                                                       ║
║   [Auction Manager]  ─  [Rules Engine]  ─  [Event Store]              ║
║          │                                       ▲                    ║
║          ▼                                       │                    ║
║   [Agent Orchestrator (LangGraph)]  ────────── events                 ║
║          │                                                            ║
║          ▼                                                            ║
║   [LLM Gateway]  ── per-model routing ── [Isolation Proxy]            ║
║          │                                                            ║
║          ▼                                                            ║
║   [10 LLM Endpoints]                                                  ║
╚═══════════════════════════════════════════════════════════════════════╝
                              │
                              ▼
╔═══════════════════════════════════════════════════════════════════════╗
║                           DATA PLANE                                  ║
║                                                                       ║
║   [SAG Service]  ←→  [Feature Store]  ←→  [Cold-Start Builder]        ║
║          │                   ▲                                        ║
║          ▼                   │                                        ║
║   [Ingestion Pipelines]  ────┘                                        ║
║     • Cricsheet ETL                                                   ║
║     • Injury connectors                                               ║
║     • Social connectors                                               ║
║     • Headshot pipeline  ──→  [CDN]                                   ║
╚═══════════════════════════════════════════════════════════════════════╝
                              │
                              ▼
╔═══════════════════════════════════════════════════════════════════════╗
║                     CROSS-CUTTING SERVICES                            ║
║                                                                       ║
║   [Observability: Otel + Prometheus + Grafana + Loki]                 ║
║   [Secrets: Vault]   [Config: dynamic]   [CI/CD: Argo]                ║
║   [Auth: JWT + session tokens]                                        ║
╚═══════════════════════════════════════════════════════════════════════╝
```

---

## 5. Core Components Deep Dive

### 5.1 Web Frontend

- **Stack:** Next.js (React), TypeScript, Tailwind, Zustand for client state.
- **Transport:** WebSocket (WSS) for live events; REST for static lookups.
- **Service worker:** caches headshot ladder + static assets; enables offline replay viewer.
- **Rendering rules (from §16.2 of functional spec):** blurhash placeholders, priority hints, prefetch-next, low-bandwidth mode.
- **Rationale panel:** renders the `score_breakdown` vector for every bid; spectators can see *why* an agent moved.

### 5.2 BFF / API Gateway

- **Stack:** Fastify (Node) or FastAPI (Python) — single-responsibility edge.
- **Responsibilities:** auth, rate limiting, request shaping, response aggregation, WSS upgrade, CORS.
- **Auth:** JWT for operators; anon session tokens (short-lived) for spectators.
- **Rate limits:** per-IP (spectator-safe) + per-session (admin-abuse-safe).

### 5.3 Auction Manager (Control-Plane Core)

- **Pattern:** Finite state machine per auction session; singleton per `auction_id` via Redis-backed leader election.
- **Event-sourced.** Every command produces one or more events, appended to the Event Store; projections are rebuilt from events.
- **State machine phases:** `prep → nominating → opening_bid → open_bidding → closing → sold|unsold → next`.
- **Idempotency:** commands carry `(client_id, seq)`; duplicates are dropped at the command handler.
- **Deterministic clocks:** all time-bound logic uses a monotonic clock source injected at session start; replays pin to recorded wall-clock for reproducibility.
- **Concurrency:** single-writer model — only the Auction Manager for a given session writes events; readers subscribe to projections.

### 5.4 Agent Orchestrator (LangGraph Subgraphs)

- **One subgraph per agent.** Shared root node = public auction state (read-only). No edges between agent subgraphs.
- **Per-nomination fanout:** on `player.nominated` event, orchestrator dispatches 10 parallel agent evaluations.
- **Observation builder:** assembles each agent's input from public state + own private state + SAG payload. Typed boundaries enforce that agent A's builder cannot reach agent B's state.
- **Timeouts:** hard cap per agent call = bid-window minus safety margin (e.g., 6 s of an 8 s window).
- **Backpressure:** if an agent's response is late, orchestrator emits `agent.timeout` event; agent auto-drops for that round.

### 5.5 LLM Gateway (Reliability Keystone)

This is the most production-critical component. Responsibilities:

| Capability | Design |
|---|---|
| Routing | Per-agent model binding per the TeamModel table; lookup by `agent_id` |
| Isolation | Stateless calls; per-call ephemeral system prompt; no shared provider-side memory |
| Retry | Exponential backoff with jitter, max 2 retries, honoring provider `Retry-After` headers |
| Timeout | Hard deadline derived from bid window minus margin |
| Circuit breaker | Per-model (open after N consecutive failures; half-open probe every T seconds) |
| **Fallback cascade** | **Per-model alternates pre-declared, personality-tier-preserving (e.g., CSK 70B → CSK 8B; never swap personalities)** |
| Schema validation | Strict validation against `agent_output.schema.json`; single repair attempt with schema-in-prompt on first failure |
| Cost tracking | Per-call token count + cost; per-auction budget enforcement |
| Rate limit management | Token bucket per model; pre-flight check before dispatch |
| Observability | Trace span per call; metrics on latency, error rate, retries, cost, fallback activations |

**Fallback cascade table (example — to be finalized):**

| Primary | First Fallback | Second Fallback |
|---|---|---|
| llama-3.1-70b | llama-3.1-8b | gemma-2-9b |
| gemini-flash-1.5-8b | llama-3.1-8b | phi-3-mini-128k |
| mistral-7b | zephyr-7b | openchat-7b |
| *(etc. — each team pre-configured)* | | |

Fallbacks are chosen to preserve personality tier (AGGRESSIVE/BALANCED/CONSERVATIVE) so gameplay dynamics stay consistent.

### 5.6 SAG Service

- **Connector framework:** pluggable source adapters (Cricsheet, injury feed, social, scouting, auction history).
- **Orchestration:** on `sag.lookup` request, fan out to relevant adapters; aggregate with provenance.
- **Cold-start branch:** when `query_type=cold_start`, route to Cold-Start Profile Builder (§5.9) with K-NN cohort resolution.
- **Cache:** Redis hot layer + edge CDN for cohort-level pre-computes.
- **Provenance enforcement:** any output lacking source metadata is rejected at the SAG output boundary.

### 5.7 Feature Store

- **Hot tier:** Redis — `player:{id}:features_v1`; TTL = auction-window duration; pre-warmed at prep time.
- **Cold tier:** Postgres — versioned feature vectors (`feature_v1`, `feature_v2`, ...); immutable per version.
- **Read path:** agents → SAG → Feature Store (hot → cold fallback).
- **Write path:** Ingestion Pipelines (batch) + Cold-Start Profile Builder.

### 5.8 Ingestion Pipelines

- **Cricsheet ETL.** Nightly batch. Steps: fetch → parse JSON → canonical player ID resolution → compute career + form + phase + venue splits → write `feature_v1`.
- **Injury connectors.** Polling every 15 min; normalized to internal injury schema; written to `injury_events`.
- **Social connectors.** Polling every 5–10 min during auction; aggregated metrics only; written to `social_buzz_snapshots`.
- **Orchestration:** Airflow or Prefect for batch; serverless workers for polling.
- **Failure handling:** every source has a `last_successful_fetch_at`; staleness alarms fire when exceeded.

### 5.9 Cold-Start Profile Builder

- **Trigger:** preprocessing time (build all known missing players) + on-demand via SAG.
- **Algorithm:**
  1. For target player, extract available meta (role, age, nationality, declared skills).
  2. Query Feature Store for K nearest neighbors with full coverage in same role bucket.
  3. Weighted mean across cohort; role-median overrides for role-specific metrics.
  4. Apply declared-role priors where external scouting signals exist.
  5. Compute `imputation_confidence` from cohort coherence (inverse of cohort variance).
- **Output:** `cold_start_profile` (per §16.1 of functional spec) written to Feature Store and returned to SAG.
- **Evaluation hook:** cold-start profiles re-scored post-season using actual performance for λ_uncertainty tuning.

### 5.10 Headshot Asset Pipeline

Two-stage: ingest (offline) + serve (online).

**Ingest (prep time):**
- Fetch from approved sources.
- Normalize: EXIF strip, center-crop square, deterministic face alignment where available.
- Generate ladder: 64 / 256 / 512 px in WebP, AVIF, JPEG.
- Compute blurhash.
- Content-hash filenames (enables `Cache-Control: immutable`).
- Upload to object store → invalidate CDN if refresh.
- Emit `headshot_ingestion_report.json`.

**Serve (runtime):**
- CDN with multi-region edge; India edge prioritized.
- Frontend rules per §16.2 of functional spec.
- Fallback cascade: primary CDN → secondary region → deterministic initials avatar (rendered client-side; zero network dependency).

### 5.11 Event Bus & Realtime Broadcaster

- **Internal bus:** Redis Streams (MVP) → Kafka (Mega) when sustained throughput demands.
- **Partition key:** `auction_id` for strict ordering per session.
- **Broadcaster:** pulls from internal bus; fans out to WebSocket clients via pub/sub layer (Redis pub/sub or Centrifugo).
- **Client reconnect protocol:** on reconnect, client sends last seen `event_offset`; broadcaster replays missed events + current snapshot.

### 5.12 Observability Stack

| Layer | Stack |
|---|---|
| Traces | OpenTelemetry → Tempo/Jaeger |
| Metrics | Prometheus + Grafana |
| Logs | Structured JSON → Loki |
| LLM decision forensics | Dedicated index of agent I/O with inputs hash, rationale vector, model/version |

**Key traces to instrument:**
- One trace per nomination, spanning: SAG fanout → 10 agent calls → rule validation → event persist → broadcast.
- Per-call spans for every LLM request with model, retry count, cost, latency.

**Key metrics:**
- `agent_decision_latency_ms{agent,model}` histograms.
- `llm_error_rate{model,code}` counters.
- `sag_source_staleness_seconds{source}` gauges.
- `isolation_leak_attempts_total` counter (from adversarial probes in CI + prod canaries).
- `headshot_lcp_ms` histogram (reported from RUM).

**Key alerts:**
- Isolation leak detected → page on-call.
- Model down > 2 min → auto-activate fallback; notify on-call.
- SAG source staleness exceeds TTL × 3 → degrade confidence; notify.
- Auction Manager leader lost → automatic re-election; alert if re-election fails.

### 5.13 Simulation Harness (Evaluation)

- **Input:** built roster from a completed auction session.
- **Process:** Monte Carlo (N ≥ 1000) over simulated matches using Cricsheet-derived player distributions; venue-conditioned; opposition-sampled.
- **Output:** projected wins, NRR, XI coherence score, role-balance score.
- **Use:** post-auction reporting, λ_uncertainty tuning, weight-preset A/B tests.

---

## 6. Data Model & Storage

### 6.1 Core entities (Postgres)

| Table | Purpose | Key fields |
|---|---|---|
| `players` | Canonical player meta | `player_id`, name, DOB, nationality, role, hand, bowling_style |
| `player_features` | Versioned feature vectors | `player_id`, `feature_version`, `metrics_json`, `data_coverage_score` |
| `cold_start_profiles` | Imputed profiles | `player_id`, `cohort_ids[]`, `imputed_metrics_json`, `imputation_confidence` |
| `headshot_assets` | Asset metadata | `player_id`, `sizes_json`, `blurhash`, `license`, `is_fallback` |
| `injury_events` | Injury history | `player_id`, `source`, `severity`, `reported_at`, `expected_return` |
| `social_buzz_snapshots` | Aggregated buzz | `player_id`, `captured_at`, `volume`, `sentiment` |
| `franchises` | Franchise state | `team_id`, `budget`, `squad_ids[]`, `plans_json` |
| `auction_sessions` | Auction metadata | `auction_id`, `config_json`, `started_at`, `ended_at` |
| `auction_events` | Event-sourced log (append-only) | `event_id`, `auction_id`, `seq`, `type`, `payload_json`, `occurred_at` |
| `agent_decisions` | Per-call audit | `call_id`, `auction_id`, `agent_id`, `model`, `inputs_hash`, `output_json`, `latency_ms`, `cost` |
| `sag_lookups` | SAG cache + audit | `lookup_id`, `player_id`, `query_type`, `output_json`, `fetched_at`, `confidence` |
| `model_health` | Gateway telemetry | `model`, `window`, `success_rate`, `p95_latency_ms` |

### 6.2 Hot storage (Redis)

- `auction:{id}:state` — current projection snapshot.
- `auction:{id}:events:stream` — event stream for broadcaster.
- `player:{id}:features_v1` — hot feature cache.
- `sag:{player_id}:{query_type}` — SAG cache with TTL.
- `lock:auction_manager:{id}` — leader election key.

### 6.3 Object storage (S3-compatible)

- `raw/cricsheet/{match_id}.json` — immutable source data.
- `headshots/{player_id}/{size}.{ext}` — content-hashed asset paths.
- `audit/{auction_id}/snapshot_{seq}.json` — periodic auction snapshots.

### 6.4 Retention

- Auction events: indefinite (replay archive).
- Agent decisions: 90 days (hot) → cold archive.
- SAG cache: TTL-based (per §3 of functional spec).
- Raw social buzz text: not retained (aggregated metrics only).

---

## 7. API Surface

### 7.1 REST (operator + admin)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auctions` | Create new auction session |
| GET | `/api/auctions/{id}` | Get session metadata |
| POST | `/api/auctions/{id}/start` | Transition `prep → nominating` |
| POST | `/api/auctions/{id}/nominate` | Operator-triggered nomination |
| POST | `/api/auctions/{id}/pause` | Emergency pause |
| GET | `/api/auctions/{id}/replay` | Stream events for replay viewer |
| GET | `/api/players/{id}` | Canonical player + feature vector |
| POST | `/api/sag/lookup` | SAG on-demand (admin-only in MVP) |
| GET | `/api/franchises/{id}` | Franchise state + squad + plans |
| GET | `/api/health` | Liveness / readiness |

### 7.2 WebSocket events (spectator + operator)

Server → client:
- `auction.state` — full snapshot (on connect + reconnect).
- `player.nominated` — new player on block.
- `bid.placed` — accepted bid.
- `bid.rejected` — rejected with rule ID.
- `agent.rationale` — rationale panel payload.
- `player.sold` / `player.unsold`.
- `phase.changed` — state-machine transition.
- `connection.heartbeat` — every 15 s.

Client → server (operator channel only):
- `nominate.request`.
- `pause.request`.
- `resume.request`.

All events carry `(auction_id, seq, occurred_at)` for ordering and idempotent client projections.

---

## 8. Real-Time Event Model

### 8.1 Command / Event split

Commands express intent (`Nominate`, `PlaceBid`, `DropAgent`). Events express facts (`PlayerNominated`, `BidPlaced`, `AgentDropped`). Commands validate → emit events → events append to log → projections rebuild state.

### 8.2 Ordering & idempotency

- **Ordering:** single Auction Manager writer per session serializes events monotonically (`seq` is gapless).
- **Idempotency:** commands carry `(client_id, seq)`; dedupe window = 5 min.
- **At-least-once delivery** to clients; clients dedupe by `event_id`.

### 8.3 Snapshots

- Every 50 events, Auction Manager emits a snapshot to object storage.
- Replays start from the nearest snapshot + forward event log → O(1) cold-start time.

### 8.4 Determinism for replay

- Seeded RNG per auction session (`auction_seed`); all stochastic decisions (nomination order jitter, tie-breaks, agent stochasticity) pull from the seeded stream.
- LLM calls are not bit-reproducible; determinism is achieved at the *event* level — replays reproduce event ordering and outcomes from the recorded log, not by re-calling LLMs.

---

## 9. Cross-Cutting Concerns

### 9.1 Reliability

| Failure mode | Mitigation |
|---|---|
| LLM provider 5xx or timeout | Retry with backoff → circuit-break → fallback cascade |
| LLM schema violation | Single repair attempt with schema in prompt; on repeat failure, agent auto-passes + alert |
| LLM free-tier rate limit hit | Token bucket per model + pre-flight check; spillover to fallback model |
| SAG source down | Stale-if-error from cache; degraded `confidence` |
| Auction Manager process crash | Redis-based leader election re-elects within 5 s; projection rebuilt from event log |
| Postgres primary failure | Standby promotion via managed DB; in-flight commands retried from event log |
| Redis failure | Cold-path fallback to Postgres (slower but correct); alert fires |
| CDN failure | Secondary region → initials avatar; auction never blocks on images |
| Network partition between services | Commands queued with bounded queue depth; shed load with `503` + retry-after |

### 9.2 Isolation — Production-Grade

- **Per-agent API keys** (or scoped routing keys) at the LLM Gateway; cross-agent API key use is rejected.
- **Typed prompt builders** — one builder per agent, accepting only that agent's private state handle + public state. Attempt to pass another agent's state is a compile-time type error.
- **Zero shared context** across LangGraph subgraphs except the read-only public state node.
- **Audit hash** — every assembled prompt is hashed and logged; a diff tool flags unexpected cross-agent token overlap.
- **Adversarial CI suite** — 50+ probes that attempt to elicit opponent state; must score 0 leaks.
- **Production canaries** — synthetic agents periodically probe live system; page on any leak signal.

### 9.3 Observability

- **One trace per nomination** (fanout to SAG + 10 agents + validation + persist + broadcast).
- **RUM on frontend** — LCP, CLS, FID, WebSocket round-trip, image error rate.
- **LLM forensics index** — searchable by `agent_id`, `player_id`, `model`, `call_id`; retains inputs hash, output JSON, rationale vector.
- **Grafana dashboards:** Auction Health, LLM Health, Agent Fairness, Data Freshness, Spectator Experience.

### 9.4 Security

- **Secrets in Vault;** short-lived tokens; rotation enforced.
- **mTLS** between internal services.
- **CSP** and subresource integrity on frontend.
- **Rate limiting at edge** (IP + session).
- **Input validation** via JSON Schema at every API boundary.
- **Audit log integrity** — append-only + periodic Merkle root to detect tampering.
- **No PII from social feeds** — aggregated metrics only; raw text discarded at ingestion.
- **Least privilege** — each service has its own DB role with minimum required access.

### 9.5 Cost Control

- **Per-auction LLM budget** configured at session create; gateway hard-stops at 95 % with alert.
- **Cost tracker** per model; per-auction report exported post-hoc.
- **Aggressive SAG caching** — edge + Redis; cohort pre-computes shared across cold-start lookups.
- **Prompt minimization** — observation builder trims public-state payload to bid-relevant fields only.
- **Free-tier quota manager** — schedules calls within provider free-tier windows where feasible; falls back to smaller models during exhaustion.

### 9.6 Fairness & Consistency of Competition

An under-discussed risk: *different models compete unequally*. Design choices that mitigate:
- **Common scoring function** — the quantitative layer is shared; LLMs evaluate and select, not compute raw scores.
- **Normalized observation format** — every agent sees identically-structured inputs.
- **Equal decision budget** — same token ceiling, same time budget, same retry policy.
- **Personality weights are per-personality, not per-model** — any AGGRESSIVE agent uses the same weight preset regardless of which model powers it.
- **Model-swap A/B test** (in evaluation harness): rotate models across teams; if outcomes are dominated by model choice alone, personality weights or prompt contracts are re-tuned.

### 9.7 Determinism & Reproducibility

- Seeded RNG per session (see §8.4).
- All agent decisions logged with inputs hash + output JSON → replay reconstructs events without re-calling LLMs.
- Golden auctions in CI: fixed seeds, frozen LLM outputs (replayed from fixtures), expected event sequence; regression blocks merge.

---

## 10. Infrastructure & Deployment

### 10.1 Stack

| Layer | Tech (MVP) | Tech (Mega) |
|---|---|---|
| Frontend | Next.js on Vercel or Cloudflare Pages | Same + edge rendering |
| BFF | Fastify on containerized runtime | Same + autoscaling |
| Services | Node / Python containers | Same |
| Orchestration | Fly.io or single-cluster K8s | Multi-cluster K8s |
| Event bus | Redis Streams | Kafka |
| DB | Managed Postgres (Neon / Supabase) | Managed HA Postgres |
| Cache | Redis (managed) | Redis Cluster |
| Object store | S3 or R2 | Same |
| CDN | Cloudflare | Same, multi-region |
| Secrets | Vault or managed KMS | HashiCorp Vault |
| Observability | Grafana Cloud or self-hosted LGTM | Self-hosted LGTM |

### 10.2 Environments

- `dev` — individual developer stacks; ephemeral.
- `staging` — runs nightly mock auction for regression; mirrors prod topology.
- `prod` — gated deploy; canary release for Auction Manager and Agent Orchestrator.

### 10.3 CI/CD

- **CI:** GitHub Actions. Pipeline: lint → unit tests → schema conformance tests → **isolation adversarial suite** → **golden auction regression** → container build → push.
- **CD:** ArgoCD; canary deploy for high-risk services; automatic rollback on SLO violation.
- **Feature flags** for experimental isolation modes, bidding protocol variants, weight presets.

---

## 11. Scaling Strategy

### 11.1 MVP scale
- 1 concurrent auction, ≤ 100 concurrent spectators, ~75 nominations per auction.

### 11.2 Mega scale target
- 10+ concurrent auctions, 10 000+ spectators per flagship auction.

### 11.3 Scaling levers

| Component | Scaling approach |
|---|---|
| Frontend | Static + edge; trivially horizontal |
| BFF | Stateless; autoscale on CPU + RPS |
| Auction Manager | Shard by `auction_id`; one leader per session; horizontal across sessions |
| Agent Orchestrator | Stateless; horizontal; concurrency-bound by LLM gateway |
| LLM Gateway | Horizontal; per-model connection pools; rate-limit-aware scheduler |
| SAG | Horizontal; cache-heavy |
| Event Bus | Redis Streams (MVP) → Kafka (Mega) with partition-by-auction |
| WebSocket broadcaster | Horizontal with sticky sessions or consistent hashing |
| Postgres | Read replicas for projections; partition `auction_events` by `auction_id` |
| CDN | Multi-region edge; cache hit ratio monitored |

### 11.4 Bottlenecks and mitigations

| Bottleneck | Mitigation |
|---|---|
| LLM free-tier rate limits during peak fanout | Per-model token bucket + pre-flight check; stagger agent dispatch by 50–100 ms; fallback cascade |
| Postgres write throughput on event log | Batch commits via unlogged staging table; partition by session; archive old sessions |
| WebSocket fan-out to 10k+ clients | Broadcaster tier with pub/sub; snapshot + delta protocol; bounded per-client queue |
| SAG external source rate limits | Cohort-level pre-computes; aggressive cache; shared cache across sessions |
| Cold-start profile computation under load | Pre-compute all known missing players at prep time; on-demand path only for unexpected entrants |

---

## 12. Evaluation Harness

Three complementary evaluation modes.

### 12.1 Offline evaluation
- **Realism:** KL divergence between generated bid distribution and historical reference.
- **Roster quality:** Monte Carlo season simulation (§5.13).
- **Schema conformance:** 100% of agent outputs validate.

### 12.2 Online evaluation
- **Isolation leak rate:** adversarial canaries; target 0.
- **Decision latency SLOs:** per model, per personality.
- **Fallback activation rate:** by model, by reason (timeout, schema, circuit-break).
- **Cost per auction:** per model breakdown.

### 12.3 A/B experiments
- Isolation strictness (strict vs. relaxed digest).
- Open bidding vs. two-active-bidders.
- Weight-preset variants per personality.
- Model rotation across teams (fairness audit).

### 12.4 Golden auctions
- Fixed seeds + fixture-replayed LLM outputs.
- Expected event sequence; regression gate in CI.

---

## 13. Rollout & Migration

| Phase | Audience | Scope | Exit criteria |
|---|---|---|---|
| A — Dark launch | Internal only | Mock auctions, no spectators | 10 clean runs, 0 isolation leaks, SLOs green |
| B — Closed beta | Invited spectators | Read-only viewing | < 1% error rate, positive qualitative review, RUM within SLO |
| C — GA | Public | Full live auction events | Sustained SLOs under load; post-mortem infrastructure |
| D — Mega | Public + human participants | Marketplace, persistent isolated learning | Research paper quality analysis of agent behavior; ethics + fairness review passed |

---

## 14. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | LLM provider outage during live auction | Medium | High | Fallback cascade; per-personality alternates; pause-and-resume support |
| 2 | Free-tier rate limits hit at peak | High | Medium | Pre-flight quota manager; fallback model; stagger dispatch |
| 3 | Cross-agent leakage via prompt engineering | Low | Critical | Typed boundaries + adversarial CI + prod canaries + audit hashing |
| 4 | Model JSON drift (new provider versions) | Medium | Medium | Strict schema validation + repair + alert; pin model versions in TeamModel |
| 5 | Cricsheet gaps → cold-start dominates auction | Medium | Medium | Operator review of `missing_players_report` pre-auction; λ_uncertainty tuning |
| 6 | Headshot source deprecation or license loss | Medium | Low | Licensing registry; pipeline re-runs with new sources; initials-avatar fallback always available |
| 7 | Auction Manager leader flap under load | Low | High | Redis lock with safe re-election; snapshot-based recovery |
| 8 | Event log bloat | Low | Low | Partition by auction; archive old sessions to cold storage |
| 9 | Model-induced unfairness (one model dominates) | Medium | Medium | Common scoring function + model-rotation A/B test |
| 10 | Cost overrun from retries + fallbacks | Medium | Medium | Per-auction budget with hard stop + alert |
| 11 | WebSocket reconnect storms after network blip | Low | Medium | Jittered reconnect + snapshot-and-delta protocol |
| 12 | Data poisoning via compromised social feed | Low | Low | Source whitelisting + anomaly detection on buzz metrics |

---

## 15. Open Design Decisions

1. **LLM provider routing** — OpenRouter as the primary abstraction vs. direct per-provider SDKs. Tradeoff: simplicity vs. provider-specific features.
2. **Event bus** — stay on Redis Streams for MVP and beta, or jump to Kafka before GA? Driven by concurrent auction count.
3. **Frontend framework choice** — Next.js vs. a lighter SPA (Vite + React). Driven by SEO + edge-render needs.
4. **Database engine** — Postgres vs. a TSDB for event log. Current choice: Postgres with partitioning; revisit at mega scale.
5. **Human participants (Phase D) auth model** — SSO vs. custodial wallet-style session; product decision pending.
6. **Weight-preset tuning cadence** — static per season vs. learned post-auction; needs eval data from Phase B.
7. **Snapshot cadence** — every 50 events is a guess; measure recovery time and tune.
8. **Fallback model selections** — current cascade is tentative; finalize after beta telemetry.

---

## Novelty Checklist (one-pager for reviews)

- [ ] 10 distinct LLMs in a single live auction — not instances of one model
- [ ] Zero cross-agent state leakage, verified by adversarial CI + prod canaries
- [ ] Quantitative scoring function shared across all agents; LLMs select, don't compute raw scores
- [ ] Cold-start imputation via K-NN cohort + declared-role priors + uncertainty propagation
- [ ] Every decision carries a numeric rationale vector + chosen plan — fully auditable
- [ ] Event-sourced auction state; any run replayable deterministically
- [ ] SAG with mandatory per-claim provenance
- [ ] Personality-scaled stochasticity with plausibility caps
- [ ] Cricsheet-driven season simulator closes the loop between auction and performance
- [ ] Per-model fallback cascade preserves personality tier under LLM failures
- [ ] Headshot pipeline with blurhash + content-hashed CDN + init-avatar fallback
- [ ] Model-rotation fairness audit in evaluation harness

---

## Production Acceptance Checklist

- [ ] All MVP acceptance criteria from the functional spec are met.
- [ ] SLOs in §1 met in staging for 7 consecutive days.
- [ ] Isolation adversarial suite passes with 0 leaks over 1 000 probes.
- [ ] Golden-auction regression passes on every merge.
- [ ] Fallback cascade verified by chaos test (killing primary model mid-auction).
- [ ] Disaster recovery drill: Auction Manager killed mid-session, resumed from snapshot + event log within 30 s.
- [ ] Cost budget enforcement verified (intentional overrun attempt blocked).
- [ ] Rate-limit exhaustion verified (synthetic load forces cascade; auction completes).
- [ ] RUM LCP p95 ≤ 1 s across 24 h of production traffic.
- [ ] Audit log Merkle-root integrity check passing.
- [ ] On-call runbook published; paging tested end-to-end.
