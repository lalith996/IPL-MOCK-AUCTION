/**
 * LLM Gateway — Fastify entrypoint.
 *
 * Exposes /gateway/call consumed by the Agent Orchestrator.
 * Internal endpoints (/gateway/budget, /gateway/usage) for admin/observability.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { routeCall, AgentTimeoutError, type RouterCallRequest } from "./router.js";
import {
  getUsage,
  setBudget,
  BudgetExceededError,
} from "./cost-tracker.js";
import type { AgentId } from "./team-model.js";

const server = Fastify({ logger: { level: process.env["LOG_LEVEL"] ?? "info" } });

await server.register(cors, { origin: false });

// ---------------------------------------------------------------------------
// /gateway/call — primary endpoint consumed by Agent Orchestrator
// ---------------------------------------------------------------------------

server.post<{ Body: RouterCallRequest }>(
  "/gateway/call",
  {
    schema: {
      body: {
        type: "object",
        required: ["auctionId", "agentId", "context"],
        properties: {
          auctionId: { type: "string" },
          agentId: { type: "string" },
          context: { type: "object" },
        },
      },
    },
  },
  async (request, reply) => {
    try {
      const result = await routeCall(request.body);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof AgentTimeoutError) {
        return reply.code(504).send({ error: "agent.timeout", detail: err.message });
      }
      if (err instanceof BudgetExceededError) {
        return reply.code(402).send({
          error: "budget.exceeded",
          auctionId: err.auctionId,
          usedCents: err.usedCents,
          limitCents: err.limitCents,
        });
      }
      server.log.error(err);
      return reply.code(500).send({ error: "internal_error" });
    }
  },
);

// ---------------------------------------------------------------------------
// /gateway/budget — set per-auction budget (called by Auction Manager)
// ---------------------------------------------------------------------------

server.post<{ Body: { auctionId: string; limitCents: number } }>(
  "/gateway/budget",
  {
    schema: {
      body: {
        type: "object",
        required: ["auctionId", "limitCents"],
        properties: {
          auctionId: { type: "string" },
          limitCents: { type: "number", minimum: 0 },
        },
      },
    },
  },
  async (request, reply) => {
    setBudget(request.body.auctionId, request.body.limitCents);
    return reply.code(200).send({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// /gateway/usage — query per-auction usage (observability / admin)
// ---------------------------------------------------------------------------

server.get<{ Querystring: { auctionId: string } }>(
  "/gateway/usage",
  async (request, reply) => {
    const { auctionId } = request.query;
    if (!auctionId) {
      return reply.code(400).send({ error: "auctionId query param required" });
    }
    return reply.code(200).send(getUsage(auctionId));
  },
);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

server.get("/healthz", async (_req, reply) => reply.send({ status: "ok" }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env["PORT"] ?? "3002", 10);
const HOST = process.env["HOST"] ?? "0.0.0.0";

try {
  await server.listen({ port: PORT, host: HOST });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
