# IPL 2026 Mini-Auction MVP — Engineering & LLM Design Brief

> A self-contained task brief for engineering, prompt design, and system integration teams building a multi-agent, AI-driven IPL-style auction web app. Use this document verbatim as the project spec.

---

## 1. Role and Goal

**System role(s):**
- Multi-agent AI auction platform: 10 autonomous LLM-powered team agents competing in an IPL-style mini-auction, orchestrated by a deterministic Auction Manager, enriched by a Search-Analyze-Generate (SAG) intelligence module, and routed via a knowledge-isolation layer.
- Engineering role: Build a production-grade MVP where each franchise is powered by a distinct LLM with its own ephemeral system prompt, private state, and quantitative decision pipeline — with zero cross-agent leakage.

**Primary objective of the MVP:**
- Simulate a realistic, auditable, human-plausible IPL-2026-style mini-auction where 10 team agents construct valid squads under IPL constraints, using Cricsheet-derived performance analytics, SAG-sourced freshness signals (injury, social buzz), and per-agent Plan A/B/C/D strategies — all exposed to spectators through a real-time web UI.

---

## 2. System Overview

**Components:**
- **Frontend Auction Room** — real-time spectator UI (bid ticker, current player, team rosters, budgets, rationale panel).
- **Auction Manager / Sequencer** — deterministic rules engine, nomination order, bid clock, phase transitions.
- **Per-Team LLM Agents (×10)** — one agent per franchise, each on its assigned model (see §5 TeamModel table).
- **LangGraph / Routing Layer** — per-agent subgraphs; model allocation; dispatch to assigned endpoint.
- **Knowledge Isolation Layer** — OpenRouter-style stateless proxy; ephemeral per-agent system prompts; no shared memory.
- **SAG Module** — on-demand + periodic player intelligence (stats, injury, buzz) with provenance.
- **Data Stores** — Cricsheet ball-by-ball, player meta, injury feeds, social signals, auction state, audit logs.
- **Real-time Event Bus** — WebSocket / pub-sub for auction events.
- **Observability & Audit** — per-call logging, replayable auction history.

**Text architecture diagram:**

```
              [Frontend Auction Room]
                        ^
                        | WebSocket
                        v
                  [Event Bus (pub/sub)]
                        ^
                        |
        +---------------+----------------+
        |                                |
        v                                v
[Auction Manager / Sequencer]      [Audit & Replay Log]
        |
        |  validates / sequences / clocks
        v
  [Rules Engine] ---> [Per-Agent Private State Store]
        |
        |  per-agent dispatch
        v
  [Routing Layer: LangGraph]
        |
        |  stateless calls
        v
  [Isolation Proxy: OpenRouter-style]
        |
  +-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+
  v     v     v     v     v     v     v     v     v     v
 MI   CSK   RCB   DC    KKR   RR    PBKS  SRH   LSG   GT   (10 LLM endpoints)
        \                                                    /
         \                                                  /
          +------------------ SAG requests ----------------+
                                 |
                                 v
                         [SAG Module]
                                 |
       +-------------------------+-------------------------+
       v                         v                         v
  [Cricsheet Store]       [Injury Feeds API]       [Social Buzz APIs]
       \                         |                         /
        +----------> [Feature Store / Redis Cache] <------+
```

---

## 3. Data Inputs & Preprocessing

**Datasets to use:**
1. **Cricsheet ball-by-ball** — authoritative source for all on-field metrics (JSON per match).
2. **Player profile meta** — name, DOB, nationality, role (batter/bowler/AR/keeper), batting hand, bowling style.
3. **Historical aggregate stats** — derived from Cricsheet for domestic and international formats.
4. **Injury reports** — RSS / structured feeds; must carry source + timestamp.
5. **Social media buzz** — aggregated volume and sentiment indicators (no raw PII).
6. **Auction history** — prior IPL auction prices (if available).
7. **Squad rosters + salary caps** — current franchise state and IPL 2026 cap rules.

**Preprocessing steps:**
1. **Canonical player_id resolution** — fuzzy name-match + manual override file.
2. **Career aggregates** — runs, SR, avg, boundary %, dot %, wickets, economy, bowling SR, bowling avg.
3. **Form windows** — rolling last 5 / 10 / 20 innings metrics.
4. **Phase-specific metrics** — powerplay SR/economy, middle-overs SR/economy, death-overs SR/economy.
5. **Home-ground performance** — venue-conditioned splits.
6. **Role classification** — opener, anchor, finisher, PP-spinner, death-bowler, all-rounder, keeper.
7. **Injury risk score** — numeric [0, 1] from injury feed + recency decay.
8. **Social buzz score** — `z(volume) × sentiment`.
9. **Feature vector per player** — fixed schema, versioned (`feature_v1`).
10. **Cold-start detection** — for every auctionable player, compute `data_coverage_score ∈ [0, 1]`; emit `missing_players_report.json` for operator review before auction start (see §16.1).
11. **Headshot ingestion** — ingest, normalize, and CDN-host player headshots at auction-prep time; compute size ladder (64 / 256 / 512 px) + blurhash; emit `headshot_ingestion_report.json` (see §16.2).

**Freshness rules (for SAG consumption):**

| Source | Refresh cadence | Cache TTL | Fallback |
|---|---|---|---|
| Cricsheet | Nightly batch | 24h | Last-known-good |
| Injury feed | Every 15 min | 30 min | Stale-if-error + degraded `confidence` |
| Social buzz | Every 5–10 min during auction | 10 min | Omit buzz + degraded `confidence` |
| Player meta | Weekly | 7d | Last-known-good |

---

## 4. Agent Design: Team LLMs

**Role prompt template (per agent):**

```
You are the auction agent for {TEAM_NAME}.
Franchise identity: {TEAM_IDENTITY_SUMMARY}
Home ground: {HOME_GROUND}
Personality: {PERSONALITY}   // AGGRESSIVE | BALANCED | CONSERVATIVE
Budget remaining: {BUDGET_INR_CR}
Salary cap: {SALARY_CAP}
Squad so far: {SQUAD_JSON}
Slots remaining by role: {SLOTS_BY_ROLE}

Hard constraints:
- Max overseas players in squad: 8
- Max overseas in playing XI: 4
- Min keepers: 1
- Min spinners: 2
- Min pacers: 3
- Never exceed remaining budget.

You must maintain Plan A / B / C / D at all times.
Return ONLY JSON conforming to the agent_output schema. No prose outside JSON.
```

**Behavior expectations:**
- Propose bids only when quantitative score and plan priority both justify them.
- Re-plan every N nominations (N configurable; default 5) or on any major event (sold, dropped, injury alert).
- Communicate only with the Auction Manager; never read another agent's internal state.
- Stay within personality-defined bid envelopes.

**Decision architecture — 3-stage pipeline per agent:**

**a) Observe** (inputs only):
- Public auction state (current player, current high bid, clock, sold list, remaining nominations).
- Own squad, own budget, own slot needs.
- SAG output for the nominated player (public view — same structure for all agents).

**b) Strategize:**

```
score(player) =
    w_form   * form_score
  + w_role   * role_fit
  + w_home   * home_ground_fit
  + w_career * career_score
  + w_phase  * phase_fit
  - w_injury * injury_risk
  + w_buzz   * social_buzz
  - w_price  * price_elasticity
```

Produce/update Plan A/B/C/D and rank the current player against plan slots.

**c) Act:**
- Return a single JSON object: `pass` | `bid` | `raise` | `drop`, with amount, confidence, rationale vector, and chosen plan tag.

**Agent output JSON schema:**

```json
{
  "agent_id": "string",
  "timestamp": "ISO-8601",
  "player_id": "string",
  "action": "pass | bid | raise | drop",
  "bid_amount": "number | null",
  "confidence_score": "number [0,1]",
  "rationale": {
    "score_breakdown": {
      "form_score": "number",
      "role_fit": "number",
      "home_ground_fit": "number",
      "career_score": "number",
      "phase_fit": "number",
      "injury_risk": "number",
      "social_buzz": "number",
      "price_elasticity": "number",
      "total": "number"
    },
    "reasoning_summary": "string (<= 80 words)"
  },
  "chosen_plan": "A | B | C | D"
}
```

---

## 5. Multi-Model Allocation & Isolation

**TeamModel assignment (authoritative — use exactly this mapping):**

| Team | Model | Why This Model | Personality |
|---|---|---|---|
| Mumbai Indians | meta-llama/llama-3.1-8b-instruct:free | Fast, excellent reasoning, JSON reliable | AGGRESSIVE |
| Chennai Super Kings | meta-llama/llama-3.1-70b-instruct:free | Most powerful FREE model (70B params) | BALANCED |
| RCB | google/gemini-flash-1.5-8b:free | 1M context window, lightning fast | AGGRESSIVE |
| Delhi Capitals | mistralai/mistral-7b-instruct:free | Great reasoning, efficient | BALANCED |
| KKR | microsoft/phi-3-mini-128k-instruct:free | 128K context, smart & compact | BALANCED |
| Rajasthan Royals | qwen/qwen-2-7b-instruct:free | Alibaba's model, good logic | CONSERVATIVE |
| Punjab Kings | google/gemma-2-9b-it:free | Fast, reliable JSON output | AGGRESSIVE |
| SRH | openchat/openchat-7b:free | Strategic, conversational | CONSERVATIVE |
| LSG | huggingfaceh4/zephyr-7b-beta:free | Battle-tested reasoning | BALANCED |
| Gujarat Titans | meta-llama/llama-3-8b-instruct:free | Stable, well-tested | CONSERVATIVE |

**Model selection criteria (for future additions):**
- Context window ≥ 8K for full auction state + squad + SAG payload.
- p95 latency ≤ SLA (default 4s).
- Reliable JSON mode or strict schema adherence.
- Reasoning benchmark parity within personality tier.

**Knowledge isolation design:**
- Each agent called via stateless endpoint. No session memory server-side.
- Per-agent ephemeral system prompt constructed fresh per call.
- LangGraph: one subgraph per agent; a single shared read-only node holds public auction state; no shared mutable state across subgraphs.
- No cross-agent fine-tuning or shared embeddings.

**Conversation history handling:**
- Per-agent private buffer: last K = 20 events affecting that agent (own bids, own wins/losses, SAG results consumed).
- Persistent data: roster + budget + plans — stored in a secured datastore, keyed by agent_id with strict ACLs.
- Other agents receive only the public auction digest, never raw opponent state or prompts.
- All agent calls logged with: inputs hash, output, model ID, model version, latency.

**Sequential / two-bidder turn-taking protocol:**
1. After SAG dispatch, all 10 agents return an initial action (`bid` | `pass`) with `confidence_score`.
2. Manager selects the top-2 `bid`-ers by `confidence_score` as the active pair.
3. Active pair alternates in 5–8s windows. Non-active agents receive event updates but do not bid.
4. Timeout (no response in window) → auto-drop from active pool.
5. When one drops, the next-highest-interest agent from the standby queue enters as the second active bidder (cooldown 2s before first action).
6. "Raise hand" re-entry: any standby agent may re-signal interest every 10s; if its `confidence_score` now exceeds an active bidder's, swap in.
7. Auction closes when both active bidders pass/drop and no standby raises hand within 8s.

---

## 6. SAG (Search-Analyze-Generate) Module

**Responsibilities:**
- On-demand player intelligence when an agent requests deeper info.
- Periodic top-prospects refresh (every 5 min during auction).
- Synthesize structured signals + provenance; never return raw prose from external feeds.

**API I/O:**

Input:
```json
{
  "player_id": "string",
  "query_type": "full | form | injury | buzz | situational | cold_start"
}
```

Output JSON schema:
```json
{
  "player_id": "string",
  "player_summary": "string",
  "last_12_innings_metrics": {
    "runs": "number",
    "strike_rate": "number",
    "average": "number",
    "boundary_pct": "number",
    "dot_pct": "number",
    "wickets": "number",
    "economy": "number",
    "bowling_sr": "number"
  },
  "situational_metrics": {
    "powerplay": { "sr": "number", "economy": "number" },
    "middle":    { "sr": "number", "economy": "number" },
    "death":     { "sr": "number", "economy": "number" }
  },
  "injury_status": {
    "source": "string",
    "timestamp": "ISO-8601",
    "severity": "none | minor | moderate | major",
    "expected_return": "ISO-8601 | null"
  },
  "social_buzz": {
    "volume": "number",
    "sentiment": "number [-1,1]",
    "top_sources": ["string"]
  },
  "confidence": "number [0,1]",
  "provenance": [
    { "source": "string", "fetched_at": "ISO-8601", "type": "cricsheet | injury | social | api" }
  ]
}
```

**Retrieval sources (priority order):**
1. Cricsheet-derived feature store (structured, cached).
2. Structured injury feeds (RSS / curated API).
3. Social buzz APIs (aggregated only).

**Rate limiting, caching, fallback:**
- Token-bucket per external source; configurable RPS.
- Redis cache keyed by `(player_id, query_type)`; TTLs per §3 table.
- On external failure: serve last-known-good, degrade `confidence` proportional to staleness; mark source as stale in `provenance`.
- Hard fail only if no cached data ever existed — return minimal payload with `confidence: 0` and explicit `missing_fields` list.

---

## 7. Auction Manager / Rules Engine

**IPL-like rules (defaults; configurable):**
- Teams: 10.
- Squad size: 18–25.
- Salary cap: ₹100 Cr (configurable per season).
- Overseas: max 8 in squad, max 4 in playing XI.
- Role minimums: ≥1 keeper, ≥2 spinners, ≥3 pacers.
- Base prices: tiered (e.g., 30L / 50L / 75L / 1 Cr / 1.5 Cr / 2 Cr).
- Bid increments: tiered — +5L up to 1 Cr, +10L up to 2 Cr, +20L up to 5 Cr, +25L up to 10 Cr, +50L above.
- Clock: 15s for opening bid, 8s per subsequent decision.
- Withdrawal: an agent may drop anytime; after 2 consecutive drops on the same player, that agent cannot re-enter for that player.
- Auction phases: `nominating → opening_bid → open_bidding → closing → sold | unsold`.

**Auction sequencing logic:**
1. **Nomination order** — rotating; each round prioritizes the franchise with the lowest spend-to-cap ratio, with small randomization to prevent deterministic ordering.
2. **Opening bid** — any interested agent signals at base price; ties broken by random seed logged in audit.
3. **Active bidder selection** — top-2 by initial `confidence_score`; refreshed after each completed round.
4. **Standby queue** — remaining interested agents ranked by `confidence_score`; next-in-line enters when one active bidder drops.
5. **Simultaneous bids** — earliest server-timestamp wins; final tie-break by deterministic hash of `agent_id`.

**Enforcement:**
- Every bid validated against: remaining budget, overseas cap, role caps, squad-size cap, bid increment rule.
- Invalid bid → hard reject + warning. 3 warnings in one auction → agent cooldown for 1 full round.
- All invalid-bid events logged with the rejecting rule ID.

---

## 8. Agent Strategies & Planning

**Plan structure (each agent maintains all four):**
- **Plan A** — preferred playing XI with per-slot budget allocation; total ≤ 85% of remaining cap.
- **Plan B** — alternate XI with ≥ 50% overlap with Plan A; cheaper substitutions where Plan A targets are unaffordable.
- **Plan C** — value-hunting list: mid-priced backups and uncapped talent filling remaining squad slots.
- **Plan D** — contingency: injury-cover picks, budget reallocation rules, last-round bargain list.

**Plan generation algorithm:**
1. **Greedy initialization** — rank candidate-slot pairs by `role_fit × (1 / expected_price)`.
2. **Constrained optimization** — integer programming (or LP relaxation + rounding) over `(player, slot)` with budget, overseas, role, and keeper constraints.
3. **Optional refinement** — beam search or MCTS over top-K candidates per slot when decision budget allows; depth ≤ 3.

**Personality → scoring-weight presets (starting defaults; tune via eval):**

| Weight | AGGRESSIVE | BALANCED | CONSERVATIVE |
|---|---|---|---|
| `w_form` | 0.25 | 0.20 | 0.15 |
| `w_role` | 0.20 | 0.20 | 0.20 |
| `w_home` | 0.10 | 0.15 | 0.10 |
| `w_career` | 0.10 | 0.15 | 0.20 |
| `w_phase` | 0.10 | 0.10 | 0.10 |
| `w_injury` | 0.10 | 0.10 | 0.15 |
| `w_buzz` | 0.10 | 0.05 | 0.02 |
| `w_price` | 0.05 | 0.05 | 0.08 |

**Required strategic behaviors:**
- Plan for home-ground conditions (spin-friendly vs. batting decks).
- Build complementary XI combinations (openers, anchors, finishers, death-bowlers).
- Maintain backups for every core role.
- Never bid blindly: any `bid` action must reference a `chosen_plan` and a positive `total` in `score_breakdown`.

---

## 9. Realism & Human-like Behavior

- **Stochastic thresholds** — add Gaussian noise `N(0, σ_personality)` to action boundaries; σ_AGGRESSIVE > σ_BALANCED > σ_CONSERVATIVE.
- **Exploration** — ε-greedy on marginal decisions: ε = 0.10 AGGRESSIVE, 0.05 BALANCED, 0.02 CONSERVATIVE.
- **Bluffing** — AGGRESSIVE agents have 5–8% chance of raising on low-priority players to drain rivals' budgets; bluff capped by plausibility rule.
- **Time-to-act variance** — uniform `[1.5s, 7.0s]` scaled inversely by personality aggressiveness.
- **Plausibility cap** — bids soft-capped at `1.5 × computed_fair_value`; hard-capped at remaining budget.
- **Auditability** — every `bid`/`raise` carries numeric rationale vector + chosen plan; a post-auction replay tool reconstructs each decision.

---

## 10. Evaluation & Metrics

**Offline metrics:**
- **Realism** — KL divergence between simulated bid distribution and historical IPL auction bid distribution; MAE on winning prices where comparable.
- **Roster quality** — simulated season performance via Cricsheet-driven Monte Carlo (N ≥ 1000 simulated matches per roster).
- **Plan coherence** — fraction of winning bids that reference an active Plan A/B slot.

**Online metrics:**
- **Isolation audit** — automated adversarial prompts attempting to elicit opponent state; target: 0 leaks.
- **Decision latency** — p50 / p95 per agent; SLA p95 ≤ 4s.
- **SAG retrieval latency** — p95 ≤ 1.5s cached, ≤ 5s uncached.
- **Stability** — roster-diversity index across repeated runs (same seeds → bounded variance).

**A/B tests:**
- Isolation strictness: strict (stateless) vs. relaxed (short shared digest).
- Bidding format: two active bidders vs. open bidding.
- Model allocations: swap personalities between models to isolate model-vs-personality effects.
- Weight presets: tuned vs. default.

---

## 11. Safety, Privacy & Compliance

- **No cross-agent memory** — enforced structurally via stateless proxy + per-call ephemeral prompts; verified by automated isolation tests.
- **Secrets** — API keys in vault; never logged; redacted in any stack traces.
- **External scraping** — respect ToS; enforce rate limits; prefer official APIs.
- **No PII** — social buzz aggregated only; no user handles, raw posts, or personal identifiers stored.
- **SAG provenance** — every external-sourced claim carries `source` + `fetched_at`; no unsourced claims enter agent context.
- **Logging** — per-call action log retained 30 days; raw feed text redacted; rationale vectors retained for audit.
- **Kill switch** — auction can be paused or rolled back to last committed state; all transitions are event-sourced.

---

## 12. Implementation Roadmap (MVP → Mega Auction)

**MVP (Milestone 1) — deliverables:**
- 10 team agents live, each on its assigned model per §5 table.
- Preloaded squads, budgets, and salary cap.
- Cricsheet preprocessing pipeline producing feature vectors at auction start.
- 1 SAG connector (pick one: structured injury feed OR one social buzz API).
- LangGraph routing layer dispatching to the correct model per team.
- Two-bidder turn-taking protocol with timeouts.
- Strict JSON output validation against `agent_output.schema.json`.
- Full rule engine enforcement.
- Basic real-time UI (current player, bids, rosters, budgets) over WebSocket.

*Acceptance:* End-to-end mini-auction of ≥ 50 nominations completes with zero rule violations and zero isolation leaks.

**Milestone 2 — Next:**
- Full nomination mechanics (sets, marquee tiers).
- Multi-source SAG with freshness scoring.
- Richer Plan A/B/C/D optimization (IP solver integration).
- Multi-season Cricsheet coverage; venue-adjusted features.
- Analytics dashboard for operators.

**Milestone 3 — Mega:**
- Full-size auction pool (hundreds of players).
- Public human participants as bidders alongside agents.
- Persistent, isolated per-agent learning (with audit).
- Marketplace + spectator mode; historical auction replays.

---

## 13. Example Auction Flow

*Timestamps and bid amounts are placeholders; no real statistics fabricated.*

```
T+00:00  Manager nominates player_id = P_0451 at base_price = <number>
T+00:00  SAG.fetch({player_id: "P_0451", query_type: "full"}) → SAG JSON (per §6 schema)
T+00:01  Manager broadcasts public auction state + SAG payload on event bus
T+00:02  All 10 agents run Observe → Strategize → Act (parallel, async)

-- Sample agent outputs (structure only, placeholder values) --

Agent MI output:
{
  "agent_id": "MI",
  "timestamp": "<ISO-8601>",
  "player_id": "P_0451",
  "action": "bid",
  "bid_amount": <number>,
  "confidence_score": <number>,
  "rationale": {
    "score_breakdown": { "form_score": <n>, "role_fit": <n>, "home_ground_fit": <n>,
                         "career_score": <n>, "phase_fit": <n>, "injury_risk": <n>,
                         "social_buzz": <n>, "price_elasticity": <n>, "total": <n> },
    "reasoning_summary": "role-fit strong, home-ground positive, within Plan A slot"
  },
  "chosen_plan": "A"
}

Agent CSK output:
{
  "agent_id": "CSK",
  "timestamp": "<ISO-8601>",
  "player_id": "P_0451",
  "action": "bid",
  "bid_amount": <number>,
  "confidence_score": <number>,
  "rationale": {
    "score_breakdown": { ... },
    "reasoning_summary": "form window high, low injury risk, fits Plan A slot 6"
  },
  "chosen_plan": "A"
}

T+00:05  Manager selects top-2 by confidence_score → active pair: MI, CSK
T+00:06  MI raises to <number> (within 8s window)
T+00:13  CSK raises to <number> (within 8s window)
T+00:21  MI raises to <number>
T+00:29  CSK raises to <number>
T+00:34  MI passes → standby queue head is RCB → RCB enters as second active bidder
T+00:36  RCB raises to <number>
T+00:44  CSK raises to <number>
T+00:52  RCB passes
T+00:54  No standby agent raises hand within 8s
T+01:00  Phase = closing. Sold to CSK at <number>.
T+01:00  Manager updates CSK roster + budget, broadcasts sold event.
T+01:01  Tie-resolution rule applied only if simultaneous bids — not triggered here.
T+01:02  Persist committed auction state. Next nomination scheduled.
```

---

## 14. Deliverables & Integration Checklist

**Artifacts to produce:**
- System prompts per team — 10 files (`prompts/{team}.txt`), each parameterized per §4 template.
- JSON schemas: `agent_output.schema.json`, `sag_output.schema.json`, `auction_state.schema.json`.
- SAG API spec — OpenAPI 3.x.
- LangGraph routing config — subgraph definitions + model bindings per §5 table.
- Auction Manager API spec — REST for admin/control + WebSocket for events.
- Cricsheet preprocessing notebooks — feature vector generation, versioned outputs.
- Frontend wireframes — auction room, team dashboard, replay viewer.
- Test harnesses — unit + integration + isolation adversarial tests.
- Evaluation scripts — offline realism + roster-quality simulators; online latency and leakage monitors.

**Integration tests (must pass before MVP sign-off):**
1. **Model isolation test** — adversarial prompt attempting to elicit opponent state/prompts; target: zero leakage across all 10 agents.
2. **Rule compliance test** — inject invalid bids (over budget, overseas exceeded, role minimums violated, wrong increments); all must be rejected with correct rule ID.
3. **End-to-end mock auction** — 10 agents, ≥ 50 nominations, ≥ 18 players per roster, completes without violations and with a replayable audit log.
4. **Schema conformance test** — 100% of agent outputs validate against `agent_output.schema.json`; 100% of SAG outputs validate against `sag_output.schema.json`.
5. **Fallback test** — simulate SAG external source failure; verify degraded `confidence` path and cached-serve behavior.

---

## 15. Questions & Assumptions

**Open questions (engineering team to resolve):**
1. What is the real-time latency SLA per decision? (Default assumed: p95 ≤ 4s; agent bid window 8s.)
2. Which external sources are approved for SAG (specific injury feed provider? specific social API)?
3. Will human participants be introduced in a later phase? What is the auth model?
4. What are the confirmed IPL 2026 salary cap, base-price tiers, and bid-increment bands?
5. Does the auction use sealed-bid phases anywhere, or is it open throughout?
6. Are RTM (Right To Match) or retention mechanics in scope for MVP?
7. What is the logging retention window and PII policy for the deployment region?
8. What is the acceptable fallback when a specific model endpoint is down mid-auction — skip the agent, hot-swap to a backup model, or pause the auction?

**Assumptions made in this spec:**
- Cricsheet coverage is sufficient to derive form, situational, and venue metrics for all auctionable players.
- A structured injury feed (RSS or API) is obtainable under the project's ToS constraints.
- At least one social-buzz API is accessible under rate limits.
- An OpenRouter-equivalent routing/proxy layer is available for stateless LLM calls.
- All listed models return valid JSON when prompted with strict schema + few-shot.
- Network and hosting region is compliant with external API terms.

---

## 16. Limitation Handling

Two cross-cutting production concerns with dedicated designs. Both must be implemented in the MVP.

### 16.1 Missing Players in Cricsheet (Cold-Start Problem)

**Problem.** Cricsheet coverage is strongest for international and top T20 leagues; it is partial or absent for uncapped domestic players, associate-nation players, and players auctioned under a name variant. MVP must not crash, silently zero-score, or anchor to career-medians for unknowns.

**Detection (preprocessing time):**
- Compute `data_coverage_score ∈ [0, 1]` per player:
  - `1.0` — full coverage, ≥ 20 innings in relevant format.
  - `0.5` — partial (≥ 5 innings, or adjacent formats only).
  - `0.0` — no matching Cricsheet records.
- Emit `missing_players_report.json` for operator review and approval before auction start. Audit block if not approved.

**Fallback: cold-start feature vectors.** For any player with `data_coverage_score < 0.5`, build an imputed feature vector via, in order:
1. **Role + age + nationality cohort K-NN** — nearest-K players with full coverage; use cohort mean as baseline.
2. **Declared-role priors** — role-median overrides cohort values for role-specific metrics (e.g., death-bowler → death-overs economy from role median).
3. **External scouting signals via SAG** — domestic scorecard aggregates, scout notes where licensed.
4. **Auction-history prior** — if previously auctioned, prior price as a weak prior on expected valuation.

**New SAG query type:** `cold_start`. Output extends the base SAG schema with:

```json
{
  "player_id": "string",
  "cold_start_profile": {
    "cohort_ids": ["string"],
    "cohort_size": "number",
    "imputed_metrics": {
      "strike_rate": "number",
      "economy": "number",
      "role_fit": "number"
    },
    "source_signals": [
      "domestic_scorecards | scout_reports | auction_history | declared_role"
    ],
    "data_coverage_score": "number [0,1]",
    "imputation_confidence": "number [0,1]"
  },
  "confidence": "number [0,1]",
  "provenance": [
    { "source": "string", "fetched_at": "ISO-8601", "type": "string" }
  ]
}
```

**Agent-side handling.** The role-prompt template (§4) must inject two additional fields when present:
- `data_coverage_score`
- `imputation_confidence`

Extend the scoring function (§8) with an uncertainty penalty:

```
data_confidence = min(data_coverage_score, imputation_confidence)
score_final     = score_base × (0.5 + 0.5 × data_confidence)
                  − λ_uncertainty × (1 − data_confidence)
```

**Personality-scaled λ_uncertainty:**

| Personality | λ_uncertainty | Cold-start bid cap |
|---|---|---|
| AGGRESSIVE | 0.05 | 1.5 × fair_value (standard) |
| BALANCED | 0.15 | 1.0 × fair_value |
| CONSERVATIVE | 0.30 | 1.0 × fair_value |

Rationale constraint: when `data_coverage_score < 0.5`, the agent must set `rationale.is_cold_start = true` (extend `agent_output.schema.json` accordingly).

**UI treatment.**
- "Limited historical data" badge on the nominated player card.
- `data_coverage_score` visible in the rationale panel for auditability.

**Evaluation (extends §10).**
- Track cold-start player outcomes separately: win rate, price-vs-fair-value ratio, post-auction simulated performance.
- Use this stream to tune `λ_uncertainty` per personality.

### 16.2 Headshot Load & Latency

**Problem.** Headshots loaded from heterogeneous external sources cause UI jank during live bidding, harm LCP, consume bandwidth on mobile, and fail silently when a source is down. None of this is acceptable while an 8-second bid clock is running.

**Asset pipeline (auction-prep time, never runtime):**
1. Ingest headshots only from approved, licensed sources.
2. Normalize — center-crop to square, strip EXIF, convert to **WebP** (primary), **AVIF** (progressive enhancement), **JPEG** (fallback).
3. Generate size ladder:
   - `64 px` — list thumbnail (rosters, standby queue).
   - `256 px` — player card.
   - `512 px` — hero / current nomination.
4. Compute **blurhash** for every image; store with metadata.
5. Upload to own CDN with edge prioritization close to user base.
6. Record license, source, and fetch timestamp per asset.

**Headshot metadata schema:**

```json
{
  "player_id": "string",
  "sizes": {
    "64":  { "webp": "url", "avif": "url", "jpeg": "url" },
    "256": { "webp": "url", "avif": "url", "jpeg": "url" },
    "512": { "webp": "url", "avif": "url", "jpeg": "url" }
  },
  "blurhash": "string",
  "source": "string",
  "license": "string",
  "fetched_at": "ISO-8601",
  "is_fallback": "boolean"
}
```

**Frontend rules.**
- **Priority hints** — current nominated player uses `<img fetchpriority="high">` at 512 px.
- **Prefetch** — on every `nominated` event, prefetch 256 px for the next 3 predicted nominations.
- **List views** — 64 px only, `loading="lazy"`, `decoding="async"`.
- **Placeholder** — render blurhash immediately; swap to real image on load. Never leave a blank square.
- **Fallback cascade** — CDN primary → CDN secondary region → deterministic initials avatar (team-color background, white initials). Single retry on image error, then fall through.
- **Low-bandwidth mode** — if `navigator.connection.effectiveType ∈ {2g, slow-2g}` or `saveData === true`: skip headshots in list views (initials avatars only); hero loads at 256 px instead of 512 px.
- **Caching** — `Cache-Control: public, max-age=2592000, immutable` on all CDN assets (URLs content-hashed). Service worker caches the current auction's asset set on session start.
- **Never block the auction** — no image error path may delay bid event rendering.

**Missing headshot.**
- Deterministic initials avatar generator: first letters of first + last name, team-color background, white text, stable across renders.
- Metadata flag `is_fallback: true`; tooltip reads "No photo available".

**Observability targets (MVP):**

| Metric | Target |
|---|---|
| Headshot LCP on nomination event (4G, p95) | ≤ 1.0 s |
| Image byte budget per nomination | ≤ 150 KB (512 px WebP) |
| Avatar fallback rate across auction pool | ≤ 5 % |
| Render-blocking image failures per 50-nomination test | 0 |

**Preprocessing deliverable:** `headshot_ingestion_report.json` — per-player ingestion status, license note, size-ladder confirmation, blurhash computed. Operators approve before auction start (same gate as `missing_players_report.json`).

**Integration tests (extend §14):**
- **Cold-start coverage test** — every player with `data_coverage_score < 0.5` has a valid `cold_start_profile` produced by SAG, and all agents tag `rationale.is_cold_start = true` when bidding on such players.
- **Headshot degradation test** — simulate CDN primary failure; verify fallback cascade lands on avatar within 1 retry; no blank states; auction continues uninterrupted.

---

## Acceptance Criteria Checklist (MVP)

- [ ] 10 team agents live, each on its assigned model exactly per the §5 TeamModel table.
- [ ] Every agent returns valid JSON conforming to `agent_output.schema.json`.
- [ ] SAG module returns valid JSON conforming to `sag_output.schema.json` with provenance on every call.
- [ ] Auction Manager enforces budget, overseas cap, role minimums, squad-size cap, and bid-increment rules.
- [ ] Two-bidder turn-taking protocol operates with 5–8s windows and correct timeout handling.
- [ ] Per-agent knowledge isolation verified: adversarial isolation test passes with zero leakage.
- [ ] LangGraph routing dispatches each agent call to the correct assigned model endpoint.
- [ ] Cricsheet-derived feature vectors available at auction start; version tagged.
- [ ] Real-time UI updates bids, sales, and roster changes over WebSocket with < 1s client latency.
- [ ] End-to-end mock auction (≥ 50 nominations) completes with valid rosters and a complete audit log.
- [ ] Decision latency p95 within configured SLA; SAG retrieval p95 within configured SLA.
- [ ] No cross-agent prompt or state leakage detected in logs or isolation tests.
- [ ] All external API calls cached and rate-limited per §6.
- [ ] Replay tool reproduces any past auction deterministically from the audit log.
- [ ] Cold-start players handled via imputed feature vectors + SAG `cold_start` query; `data_coverage_score` and `is_cold_start` flag visible in every agent rationale and on the UI card.
- [ ] `missing_players_report.json` generated and operator-approved before auction start.
- [ ] All auction-pool headshots pre-ingested, normalized, and served from own CDN with 64 / 256 / 512 px ladder + blurhash; deterministic initials avatar fallback for missing images.
- [ ] Headshot LCP on nomination event ≤ 1 s p95 on 4G; byte budget ≤ 150 KB per nomination; zero render-blocking image failures in a 50-nomination test.
- [ ] CDN-failure simulation: fallback cascade to avatar completes within 1 retry, auction proceeds uninterrupted.
