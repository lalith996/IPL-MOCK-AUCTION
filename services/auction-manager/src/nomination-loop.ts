/**
 * Nomination Loop — automated auction cycle.
 *
 * For each player in the session's player_pool:
 *   1. Pause-aware wait
 *   2. Fetch player features from Postgres
 *   3. SAG lookup for human-readable summary + confidence
 *   4. NominatePlayer command → FSM (transitions to opening_bid)
 *   5. Call Agent Orchestrator → all 10 agents evaluate simultaneously
 *   6. Translate each AgentOutput into PlaceBid / DropBid commands
 *   7. Wait for the FSM's closing timer to fire (sold | unsold → nominating)
 *   8. Remove player from session's player_pool in Postgres
 *
 * Then marks the session ended and calls onComplete.
 */

import type postgres from "postgres";
import type { Redis } from "ioredis";
import { type AuctionFSM } from "./fsm.js";
import type { PublishingEventStore } from "./stream-publisher.js";
import type { AgentId } from "./types.js";

// ---------------------------------------------------------------------------
// Types mirroring the Agent Orchestrator Pydantic models (snake_case)
// ---------------------------------------------------------------------------

interface SquadSlot {
  player_id: string;
  role: string;
  price_lakhs: number;
}

interface TeamState {
  agent_id: AgentId;
  budget_remaining_cr: number;
  squad: SquadSlot[];
  overseas_count: number;
}

interface NominatedPlayer {
  player_id: string;
  canonical_name: string;
  role: string;
  player_summary: string;
  confidence: number;
  is_cold_start: boolean;
  strike_rate: number;
  average: number;
  economy: number;
  wickets: number;
  data_coverage_score: number;
  // ✅ BUG FIX #4: Add headshot metadata fields
  headshot_url?: string;
  blurhash?: string;
}

interface PublicState {
  auction_id: string;
  nominated_player: NominatedPlayer;
  current_bid_lakhs: number;
  current_bidder: AgentId | null;
  bid_deadline_iso: string;
  phase: "opening_bid" | "open_bidding";
}

interface ScoreBreakdown {
  form_score: number;
  value_score: number;
  role_fit: number;
  squad_need: number;
  data_confidence: number;
  budget_pressure: number;
  personality_bonus: number;
  cold_start_penalty: number;
  composite: number;
}

interface AgentOutput {
  agent_id: AgentId;
  action: "bid" | "drop" | "pass";
  bid_amount_lakhs: number | null;
  confidence_score: number;
  chosen_plan: "A" | "B" | "C" | "D";
  score_breakdown: ScoreBreakdown;
  reasoning_summary: string;
  is_cold_start: boolean;
}

interface EvaluateRequest {
  auction_id: string;
  nominated_player: NominatedPlayer;
  public_state: PublicState;
  team_states: Record<AgentId, TeamState>;
}

interface EvaluateResponse {
  auction_id: string;
  player_id: string;
  agent_outputs: AgentOutput[];
}

interface PlayerRow {
  player_id: string;
  canonical_name: string;
  role: string;
  nationality: "indian" | "overseas";
  data_coverage_score: number | string; // postgres returns numeric as string
  strike_rate: number;
  batting_average: number;
  economy_rate: number;
  wickets: number;
}

interface SagOutput {
  player_id: string;
  player_summary: string;
  confidence: number;
  missing_fields: string[];
}

// ---------------------------------------------------------------------------
// Deps interface — injected from main.ts
// ---------------------------------------------------------------------------

export interface NominationLoopDeps {
  auctionId: string;
  fsm: AuctionFSM;
  store: PublishingEventStore;
  sql: ReturnType<typeof postgres>;
  redis: Redis;
  orchestratorUrl: string;
  sagUrl: string;
  /** Team ID controlled by a human player; null/undefined = fully automated */
  humanTeam?: AgentId | null;
  /** Injected from main.ts — awaits human bid or auto-drops after timeoutMs */
  waitForHumanBid?: (timeoutMs: number) => Promise<{ action: "bid" | "drop"; bidLakhs?: number }>;
  isPaused: () => boolean;
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runNominationLoop(deps: NominationLoopDeps): Promise<void> {
  const {
    auctionId,
    fsm,
    sql,
    redis,
    orchestratorUrl,
    sagUrl,
    humanTeam = null,
    waitForHumanBid,
    isPaused,
    onComplete,
  } = deps;

  try {
    // ── 1. Load nomination order ─────────────────────────────────────────────
    const sessionRows = await sql<Array<{ player_pool: string[] }>>`
      SELECT player_pool FROM auction_sessions WHERE id = ${auctionId}
    `;
    const nominationOrder: string[] = sessionRows[0]?.player_pool ?? [];

    if (nominationOrder.length === 0) {
      console.warn(`[nomination-loop] ${auctionId}: player_pool is empty — ending immediately`);
      await _markEnded(sql, auctionId);
      onComplete();
      return;
    }

    // ── 2. Iterate over each player ──────────────────────────────────────────
    for (const playerId of nominationOrder) {
      // Respect pause
      while (isPaused()) {
        await _sleep(500);
      }

      // Check if the FSM has already finished (e.g. manually ended)
      if (fsm.state.phase === "complete") break;

      // ── 2a. Fetch player features from Postgres ────────────────────────────
      const player = await _fetchPlayer(sql, playerId);
      if (!player) {
        console.warn(`[nomination-loop] ${auctionId}: player ${playerId} not in player_features — skipping`);
        continue;
      }

      // ── 2b. SAG lookup ────────────────────────────────────────────────────
      const sag = await _fetchSag(sagUrl, playerId);

      // ✅ BUG FIX #4: Fetch headshot metadata after SAG lookup
      const headshot = await _fetchHeadshot(sagUrl, playerId);

      // ── 2c. NominatePlayer → FSM ──────────────────────────────────────────
      await fsm.handleCommand({
        type: "NominatePlayer",
        clientId: "nomination-loop",
        seq: Date.now(),
        auctionId,
        payload: { playerId, role: player.role },
      });

      // ── 2d. Build orchestrator request ────────────────────────────────────
      const bidDeadline = new Date(Date.now() + 8_000).toISOString();
      const nominatedPlayer: NominatedPlayer = {
        player_id: player.player_id,
        canonical_name: player.canonical_name,
        role: player.role,
        player_summary: sag?.player_summary ?? "",
        confidence: sag?.confidence ?? Number(player.data_coverage_score),
        is_cold_start: Number(player.data_coverage_score) < 0.5,
        strike_rate: player.strike_rate,
        average: player.batting_average,
        economy: player.economy_rate,
        wickets: player.wickets,
        data_coverage_score: Number(player.data_coverage_score),
        // headshot metadata (optional — omit key entirely when absent)
        ...(headshot?.primary_url !== undefined ? { headshot_url: headshot.primary_url } : {}),
        ...(headshot?.blurhash !== undefined ? { blurhash: headshot.blurhash } : {}),
      };

      const publicState: PublicState = {
        auction_id: auctionId,
        nominated_player: nominatedPlayer,
        current_bid_lakhs: 0,
        current_bidder: null,
        bid_deadline_iso: bidDeadline,
        phase: "opening_bid",
      };

      const teamStates = _buildTeamStates(fsm);

      const evalReq: EvaluateRequest = {
        auction_id: auctionId,
        nominated_player: nominatedPlayer,
        public_state: publicState,
        team_states: teamStates,
      };

      // ── 2e. Call orchestrator for LLM-controlled teams ───────────────────
      // If there's a human team, build team_states without it (9 teams only)
      // so the orchestrator doesn't produce a bid on the human's behalf.
      const evalReqFiltered = humanTeam
        ? {
            ...evalReq,
            team_states: Object.fromEntries(
              Object.entries(evalReq.team_states).filter(([k]) => k !== humanTeam),
            ) as Record<AgentId, TeamState>,
          }
        : evalReq;

      let agentOutputs: AgentOutput[] = [];
      try {
        agentOutputs = await _callOrchestrator(orchestratorUrl, evalReqFiltered);
      } catch (err) {
        console.error(`[nomination-loop] ${auctionId}: orchestrator call failed for ${playerId}:`, err);
        // On orchestrator failure, still wait for human bid if applicable
        agentOutputs = [];
      }

      // ── 2f. Dispatch PlaceBid commands from LLM agent outputs ────────────
      const { randomUUID } = await import("node:crypto");
      const llmBidders = agentOutputs
        .filter((o) => o.action === "bid" && o.bid_amount_lakhs !== null && o.bid_amount_lakhs > 0)
        .sort((a, b) => (b.bid_amount_lakhs ?? 0) - (a.bid_amount_lakhs ?? 0));

      for (const output of llmBidders) {
        while (isPaused()) await _sleep(500);
        const seq = parseInt(randomUUID().replace(/-/g, "").slice(0, 15), 16);
        const result = await fsm.handleCommand({
          type: "PlaceBid",
          clientId: output.agent_id,
          seq,
          auctionId,
          payload: {
            agentId: output.agent_id,
            bidLakhs: output.bid_amount_lakhs!,
            playerNationality: player.nationality === "overseas" ? "overseas" : "indian",
          },
        });
        if ("ruleId" in result) {
          console.warn(`[nomination-loop] ${auctionId}: LLM rule violation for ${output.agent_id}: ${result.message}`);
        }
      }

      // ── 2g. Wait for human bid (if this session has a human player) ───────
      // The human has 30s to bid or drop. If they don't act, auto-drop.
      // This window runs CONCURRENTLY with the LLM bids — human can still
      // outbid after LLM bids are submitted.
      if (humanTeam && waitForHumanBid) {
        const HUMAN_BID_WINDOW_MS = 30_000;
        console.log(`[nomination-loop] ${auctionId}: waiting for human bid from ${humanTeam} (${HUMAN_BID_WINDOW_MS / 1000}s)`);

        // Publish a special event so the frontend knows it's the human's turn
        try {
          const { randomUUID: uuid } = await import("node:crypto");
          // We use the broadcaster stream directly — publish a meta event
          await redis.xadd(
            `auction:events:${auctionId}`,
            "*",
            "data",
            JSON.stringify({
              eventId: uuid(),
              auctionId,
              seq: fsm.state.seq,
              type: "human.bid_window_open",
              agentId: humanTeam,
              payload: {
                humanTeam,
                currentBidLakhs: fsm.state.currentBidLakhs,
                windowMs: HUMAN_BID_WINDOW_MS,
                playerId,
                playerNationality: player.nationality,
              },
              timestamp: new Date().toISOString(),
            }),
          );
        } catch {
          // Non-fatal — frontend will figure it out from phase
        }

        const humanSignal = await waitForHumanBid(HUMAN_BID_WINDOW_MS);

        if (humanSignal.action === "bid" && humanSignal.bidLakhs && humanSignal.bidLakhs > 0) {
          const seq = parseInt((await import("node:crypto")).randomUUID().replace(/-/g, "").slice(0, 15), 16);
          const result = await fsm.handleCommand({
            type: "PlaceBid",
            clientId: humanTeam,
            seq,
            auctionId,
            payload: {
              agentId: humanTeam,
              bidLakhs: humanSignal.bidLakhs,
              playerNationality: player.nationality === "overseas" ? "overseas" : "indian",
            },
          });
          if ("ruleId" in result) {
            console.warn(`[nomination-loop] ${auctionId}: human bid rejected (${humanTeam}): ${result.message}`);
          } else {
            console.log(`[nomination-loop] ${auctionId}: human ${humanTeam} bids ₹${humanSignal.bidLakhs}L`);
          }
        } else {
          console.log(`[nomination-loop] ${auctionId}: human ${humanTeam} dropped/timed out`);
        }
      }

      // ── 2h. Wait for FSM closing timer to resolve player ─────────────────
      await _waitForResolution(fsm, 20_000);

      // ── 2h. Remove from pool in Postgres ──────────────────────────────────
      await _removeFromPool(sql, auctionId, playerId);
    }

    // ── 3. All players done ──────────────────────────────────────────────────
    await _markEnded(sql, auctionId);
    onComplete();
  } catch (err) {
    console.error(`[nomination-loop] ${auctionId}: fatal error in nomination loop:`, err);
    onComplete();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function _fetchPlayer(
  sql: ReturnType<typeof postgres>,
  playerId: string,
): Promise<PlayerRow | null> {
  // Query uses the actual player_features schema columns:
  //   feature_version, canonical_name, career_stats (JSONB), form_score, value_score
  const rows = await sql<PlayerRow[]>`
    SELECT
      player_id,
      canonical_name,
      role,
      CASE WHEN is_overseas THEN 'overseas' ELSE 'indian' END AS nationality,
      data_coverage_score,
      COALESCE((career_stats->>'strike_rate')::float, 0)    AS strike_rate,
      COALESCE((career_stats->>'batting_average')::float, 0) AS batting_average,
      COALESCE((career_stats->>'economy_rate')::float, 0)   AS economy_rate,
      COALESCE((career_stats->>'wickets')::float, 0)        AS wickets
    FROM player_features
    WHERE player_id = ${playerId}
      AND feature_version = 'feature_v1'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function _fetchSag(sagUrl: string, playerId: string): Promise<SagOutput | null> {
  try {
    const resp = await fetch(`${sagUrl}/sag/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: playerId, query_type: "summary" }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as SagOutput;
  } catch {
    return null; // SAG failure is non-fatal
  }
}

// ✅ BUG FIX #4: Fetch headshot metadata from SAG service
async function _fetchHeadshot(
  sagUrl: string,
  playerId: string,
): Promise<{ primary_url: string; blurhash: string } | null> {
  try {
    const resp = await fetch(`${sagUrl}/sag/headshot/${playerId}`, {
      method: "GET",
      signal: AbortSignal.timeout(3_000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as { primary_url: string; blurhash: string };
  } catch {
    // Non-fatal: UI will render initials avatar fallback
    return null;
  }
}

async function _callOrchestrator(
  orchestratorUrl: string,
  req: EvaluateRequest,
): Promise<AgentOutput[]> {
  const resp = await fetch(`${orchestratorUrl}/orchestrator/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(30_000), // 10 agents × ~3s each
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Orchestrator HTTP ${String(resp.status)}: ${text}`);
  }
  const body = (await resp.json()) as EvaluateResponse;
  return body.agent_outputs;
}

function _buildTeamStates(fsm: AuctionFSM): Record<AgentId, TeamState> {
  const result: Partial<Record<AgentId, TeamState>> = {};
  for (const [agentId, team] of Object.entries(fsm.state.teams)) {
    result[agentId as AgentId] = {
      agent_id: agentId as AgentId,
      budget_remaining_cr: team.budgetRemainingCr,
      overseas_count: team.overseasCount,
      squad: team.squad.map((p) => ({
        player_id: p.playerId,
        role: p.role,
        price_lakhs: p.priceLakhs,
      })),
    };
  }
  return result as Record<AgentId, TeamState>;
}

async function _waitForResolution(fsm: AuctionFSM, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { phase } = fsm.state;
    if (phase === "nominating" || phase === "complete") return;
    await _sleep(200);
  }
  console.warn("[nomination-loop] waitForResolution timed out — advancing anyway");
}

async function _removeFromPool(
  sql: ReturnType<typeof postgres>,
  auctionId: string,
  playerId: string,
): Promise<void> {
  await sql`
    UPDATE auction_sessions
    SET player_pool = array_remove(player_pool, ${playerId})
    WHERE id = ${auctionId}
  `;
}

async function _markEnded(
  sql: ReturnType<typeof postgres>,
  auctionId: string,
): Promise<void> {
  await sql`
    UPDATE auction_sessions SET status = 'ended' WHERE id = ${auctionId}
  `;
}

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
