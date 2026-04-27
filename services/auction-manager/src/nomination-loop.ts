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
  data_coverage_score: number;
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
    orchestratorUrl,
    sagUrl,
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
        confidence: sag?.confidence ?? player.data_coverage_score,
        is_cold_start: player.data_coverage_score < 0.5,
        strike_rate: player.strike_rate,
        average: player.batting_average,
        economy: player.economy_rate,
        wickets: player.wickets,
        data_coverage_score: player.data_coverage_score,
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

      // ── 2e. Call orchestrator ─────────────────────────────────────────────
      let agentOutputs: AgentOutput[] = [];
      try {
        agentOutputs = await _callOrchestrator(orchestratorUrl, evalReq);
      } catch (err) {
        console.error(`[nomination-loop] ${auctionId}: orchestrator call failed for ${playerId}:`, err);
        // Skip to next player on orchestrator failure
        await _removeFromPool(sql, auctionId, playerId);
        continue;
      }

      // ── 2f. Dispatch agent outputs as FSM commands ────────────────────────
      // Bidders first (sorted by bid amount descending), then drops
      const bidders = agentOutputs
        .filter((o) => o.action === "bid" && o.bid_amount_lakhs !== null && o.bid_amount_lakhs > 0)
        .sort((a, b) => (b.bid_amount_lakhs ?? 0) - (a.bid_amount_lakhs ?? 0));

      const droppers = agentOutputs.filter((o) => o.action !== "bid");

      for (const output of [...bidders, ...droppers]) {
        // Re-check pause between commands
        while (isPaused()) await _sleep(500);

        if (output.action === "bid" && output.bid_amount_lakhs !== null && output.bid_amount_lakhs > 0) {
          const result = await fsm.handleCommand({
            type: "PlaceBid",
            clientId: output.agent_id,
            seq: Date.now() + Math.random(), // jitter for uniqueness
            auctionId,
            payload: {
              agentId: output.agent_id,
              bidLakhs: output.bid_amount_lakhs,
              playerNationality: player.nationality,
            },
          });
          if ("ruleId" in result) {
            // Rule violation — not fatal, log and continue
            console.warn(`[nomination-loop] ${auctionId}: rule violation for ${output.agent_id}: ${result.message}`);
          }
        } else {
          await fsm.handleCommand({
            type: "DropBid",
            clientId: output.agent_id,
            seq: Date.now() + Math.random(),
            auctionId,
            payload: { agentId: output.agent_id },
          });
        }
      }

      // ── 2g. Wait for FSM closing timer to resolve player ─────────────────
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
  const rows = await sql<PlayerRow[]>`
    SELECT
      player_id,
      canonical_name,
      role,
      nationality,
      data_coverage_score,
      COALESCE((features->>'strike_rate')::float, 0)   AS strike_rate,
      COALESCE((features->>'batting_average')::float, 0) AS batting_average,
      COALESCE((features->>'economy_rate')::float, 0)  AS economy_rate,
      COALESCE((features->>'wickets')::float, 0)       AS wickets
    FROM player_features
    WHERE player_id = ${playerId}
      AND version = 'feature_v1'
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
