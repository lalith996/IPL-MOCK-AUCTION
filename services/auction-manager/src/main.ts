/**
 * Auction Manager — Fastify HTTP server.
 *
 * Port: 3004 (configurable via PORT env var).
 *
 * Exposes REST endpoints consumed by the Admin BFF:
 *   POST /auctions                          — create session
 *   GET  /auctions                          — list sessions
 *   POST /auctions/:id/start                — start auction
 *   POST /auctions/:id/pause                — pause auction
 *   POST /auctions/:id/resume               — resume auction
 *   GET  /auctions/:id/replay               — stream NDJSON event log
 *   GET  /auctions/:id/state                — current FSM snapshot
 *   POST /auctions/:id/commands             — dispatch any command
 *   GET  /healthz
 *
 * The Admin BFF routes are:
 *   POST /api/auctions                      → POST /auctions
 *   GET  /api/auctions                      → GET  /auctions
 *   POST /api/auctions/:id?action=start     → POST /auctions/:id/start
 *   POST /api/auctions/:id?action=pause     → POST /auctions/:id/pause
 *   POST /api/auctions/:id?action=resume    → POST /auctions/:id/resume
 *   GET  /api/auctions/:id/replay           → GET  /auctions/:id/replay
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { Redis as IORedis } from "ioredis";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

import { AuctionFSM, createInitialState } from "./fsm.js";
import { EventStore } from "./event-store.js";
import { PublishingEventStore } from "./stream-publisher.js";
import { LeaderElection } from "./leader-election.js";
import { runNominationLoop } from "./nomination-loop.js";
import type { AgentId, Command } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env["PORT"] ?? "3004", 10);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/ipl_auction";
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379/0";
const LLM_GATEWAY_URL = process.env["LLM_GATEWAY_URL"] ?? "http://localhost:3002";
const ORCHESTRATOR_URL = process.env["ORCHESTRATOR_URL"] ?? "http://localhost:8001";
const SAG_URL = process.env["SAG_URL"] ?? "http://localhost:8002";
const LLM_BUDGET_CENTS = parseInt(process.env["LLM_BUDGET_CENTS_PER_AUCTION"] ?? "500", 10);
const INSTANCE_ID = process.env["INSTANCE_ID"] ?? randomUUID();

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const redis = new IORedis(REDIS_URL);
const sql = postgres(DATABASE_URL);

// ---------------------------------------------------------------------------
// In-memory registry of running auction FSMs
// ---------------------------------------------------------------------------

interface AuctionEntry {
  fsm: AuctionFSM;
  store: PublishingEventStore;
  election: LeaderElection;
  paused: boolean;
}

const _auctions = new Map<string, AuctionEntry>();

// ---------------------------------------------------------------------------
// Fastify server
// ---------------------------------------------------------------------------

const server = Fastify({ logger: { level: process.env["LOG_LEVEL"] ?? "info" } });

await server.register(cors, { origin: "*" });
await server.register(helmet, { contentSecurityPolicy: false });

// ---------------------------------------------------------------------------
// POST /auctions — create a new auction session
// ---------------------------------------------------------------------------

server.post<{
  Body: { seed?: number; playerPool?: string[] };
}>(
  "/auctions",
  {
    schema: {
      body: {
        type: "object",
        properties: {
          seed: { type: "number" },
          playerPool: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  async (request, reply) => {
    const seed = request.body.seed ?? Math.floor(Math.random() * 1_000_000);
    const playerPool: string[] = request.body.playerPool ?? [];

    // Insert into Postgres
    const rows = await sql<Array<{ id: string; created_at: string }>>`
      INSERT INTO auction_sessions (seed, status, player_pool)
      VALUES (${seed}, 'prep', ${sql.array(playerPool)})
      RETURNING id, created_at
    `;
    const row = rows[0];
    if (!row) return reply.code(500).send({ error: "Failed to create session" });

    const auctionId = row.id;

    // Initialise FSM + dependencies
    const initialState = createInitialState(auctionId, String(seed));
    const store = new PublishingEventStore(sql, redis);
    const fsm = new AuctionFSM(store, initialState);
    const election = new LeaderElection(redis, auctionId, INSTANCE_ID);
    await election.tryAcquire();

    _auctions.set(auctionId, { fsm, store, election, paused: false });

    // Notify broadcaster to start consuming this auction's Redis Stream
    await redis.publish("broadcaster:register_auction", auctionId);

    // Initialise LLM cost budget
    try {
      await fetch(`${LLM_GATEWAY_URL}/gateway/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId, limitCents: LLM_BUDGET_CENTS }),
      });
    } catch (err) {
      server.log.warn({ err }, "Failed to set LLM gateway budget (non-fatal)");
    }

    return reply.code(201).send({
      id: auctionId,
      seed,
      status: "prep",
      createdAt: row.created_at,
      playerPool,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /auctions — list all sessions
// ---------------------------------------------------------------------------

server.get("/auctions", async (_request, reply) => {
  const rows = await sql<
    Array<{ id: string; seed: number; status: string; created_at: string; updated_at: string }>
  >`
    SELECT id, seed, status, created_at, updated_at
    FROM auction_sessions
    ORDER BY created_at DESC
  `;
  return reply.send(
    rows.map((r) => ({
      id: r.id,
      seed: r.seed,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  );
});

// ---------------------------------------------------------------------------
// POST /auctions/:id/start
// ---------------------------------------------------------------------------

server.post<{ Params: { id: string } }>(
  "/auctions/:id/start",
  async (request, reply) => {
    const { id } = request.params;
    const entry = _auctions.get(id);
    if (!entry) return reply.code(404).send({ error: "Auction not found" });

    try {
      await entry.fsm.handleCommand({
        type: "StartAuction",
        clientId: "operator",
        seq: Date.now(),
        auctionId: id,
        payload: {},
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Start failed";
      return reply.code(409).send({ error: msg });
    }

    await sql`UPDATE auction_sessions SET status = 'active' WHERE id = ${id}`;

    // Kick off the nomination loop asynchronously — never await it here
    void runNominationLoop({
      auctionId: id,
      fsm: entry.fsm,
      store: entry.store,
      sql,
      redis,
      orchestratorUrl: ORCHESTRATOR_URL,
      sagUrl: SAG_URL,
      isPaused: () => entry.paused,
      onComplete: () => {
        server.log.info({ auctionId: id }, "Nomination loop completed");
      },
    });

    return reply.send({ ok: true, phase: "nominating" });
  },
);

// ---------------------------------------------------------------------------
// POST /auctions/:id/pause
// ---------------------------------------------------------------------------

server.post<{ Params: { id: string } }>(
  "/auctions/:id/pause",
  async (request, reply) => {
    const { id } = request.params;
    const entry = _auctions.get(id);
    if (!entry) return reply.code(404).send({ error: "Auction not found" });

    entry.paused = true;

    try {
      await entry.fsm.handleCommand({
        type: "PauseAuction",
        clientId: "operator",
        seq: Date.now(),
        auctionId: id,
        payload: {},
      });
    } catch {
      // PauseAuction may fail if the phase doesn't allow it — that's ok
    }

    await sql`UPDATE auction_sessions SET status = 'paused' WHERE id = ${id}`;

    return reply.send({ ok: true, phase: entry.fsm.state.phase });
  },
);

// ---------------------------------------------------------------------------
// POST /auctions/:id/resume
// ---------------------------------------------------------------------------

server.post<{ Params: { id: string } }>(
  "/auctions/:id/resume",
  async (request, reply) => {
    const { id } = request.params;
    const entry = _auctions.get(id);
    if (!entry) return reply.code(404).send({ error: "Auction not found" });

    entry.paused = false;

    try {
      await entry.fsm.handleCommand({
        type: "ResumeAuction",
        clientId: "operator",
        seq: Date.now(),
        auctionId: id,
        payload: {},
      });
    } catch {
      // ResumeAuction may fail if not paused — that's ok
    }

    await sql`UPDATE auction_sessions SET status = 'active' WHERE id = ${id}`;

    return reply.send({ ok: true, phase: entry.fsm.state.phase });
  },
);

// ---------------------------------------------------------------------------
// GET /auctions/:id/replay — stream full event log as NDJSON
// ---------------------------------------------------------------------------

server.get<{ Params: { id: string } }>(
  "/auctions/:id/replay",
  async (request, reply) => {
    const { id } = request.params;
    const entry = _auctions.get(id);
    // Use existing store if live, else create a read-only EventStore for ended sessions
    const store = entry?.store ?? new EventStore(sql);

    const events = await store.getAllEvents(id);

    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    });

    for (const ev of events) {
      reply.raw.write(JSON.stringify(ev) + "\n");
    }
    reply.raw.end();
    return reply;
  },
);

// ---------------------------------------------------------------------------
// GET /auctions/:id/state — current FSM snapshot
// ---------------------------------------------------------------------------

server.get<{ Params: { id: string } }>(
  "/auctions/:id/state",
  async (request, reply) => {
    const { id } = request.params;
    const entry = _auctions.get(id);
    if (!entry) {
      // Try loading latest snapshot from DB for ended/unknown sessions
      const rows = await sql<Array<{ state: unknown }>>`
        SELECT state FROM auction_snapshots
        WHERE auction_id = ${id}
        ORDER BY seq DESC LIMIT 1
      `;
      if (!rows[0]) return reply.code(404).send({ error: "Auction not found" });
      return reply.send(rows[0].state);
    }
    return reply.send(entry.fsm.state);
  },
);

// ---------------------------------------------------------------------------
// POST /auctions/:id/commands — generic command dispatch
// ---------------------------------------------------------------------------

server.post<{
  Params: { id: string };
  Body: { type: string; clientId: string; seq: number; payload: Record<string, unknown> };
}>(
  "/auctions/:id/commands",
  {
    schema: {
      body: {
        type: "object",
        required: ["type", "clientId", "seq"],
        properties: {
          type: { type: "string" },
          clientId: { type: "string" },
          seq: { type: "number" },
          payload: { type: "object" },
        },
      },
    },
  },
  async (request, reply) => {
    const { id } = request.params;
    const entry = _auctions.get(id);
    if (!entry) return reply.code(404).send({ error: "Auction not found" });

    const cmd: Command = {
      type: request.body.type as Command["type"],
      clientId: request.body.clientId,
      seq: request.body.seq,
      auctionId: id,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      payload: request.body.payload ?? {},
    };

    const result = await entry.fsm.handleCommand(cmd);

    if ("ruleId" in result) {
      return reply.code(422).send({ ruleViolation: result });
    }

    return reply.send({ event: result });
  },
);

// ---------------------------------------------------------------------------
// GET /healthz
// ---------------------------------------------------------------------------

server.get("/healthz", async (_request, reply) => {
  return reply.send({ status: "ok", auctionCount: _auctions.size });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGTERM", () => {
  void (async () => {
    server.log.info("SIGTERM received — shutting down");
    for (const [, entry] of _auctions) {
      await entry.election.release();
    }
    await redis.quit();
    await sql.end();
    await server.close();
    process.exit(0);
  })();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  await server.listen({ port: PORT, host: HOST });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Re-export AgentId for type usage in nomination-loop (avoids circular dep)
// ---------------------------------------------------------------------------
export type { AgentId };
