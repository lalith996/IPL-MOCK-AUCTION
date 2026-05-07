import type { IncomingMessage } from 'node:http';
/**
 * Broadcaster — WebSocket fan-out from Redis Streams.
 *
 * Protocol (see docs/websocket-protocol.md):
 *   1. Client connects with ?auctionId=X&offset=Y (or offset=0 for first connect)
 *   2. Server sends current snapshot from DB, then live deltas from stream
 *   3. On reconnect: client sends last known offset; server replays missed events
 *   4. Heartbeat every 15s; disconnect after 2 missed pongs
 *   5. Events deduplicated by event_id on client side
 */

import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Redis as IORedis } from "ioredis";
import postgres from "postgres";
import {
  registerClient,
  removeClient,
  broadcast,
  handlePong,
  updateLastEventId,
  sendToClient,
  clientCount,
} from "./client-manager.js";
import { blockRead, readStream } from "./stream-consumer.js";

const PORT = parseInt(process.env["PORT"] ?? "3003", 10);
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379/0";
const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/ipl";

// ---------------------------------------------------------------------------
// Redis + Postgres
// ---------------------------------------------------------------------------

const redis = new IORedis(REDIS_URL);
const sql = postgres(DATABASE_URL);

// ---------------------------------------------------------------------------
// HTTP server (health check endpoint)
// ---------------------------------------------------------------------------

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", clients: clientCount() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://localhost:${String(PORT)}`);
    const auctionId = url.searchParams.get("auctionId") ?? "";
    const offsetParam = url.searchParams.get("offset") ?? "0-0";

    if (!auctionId) {
      socket.close(1008, "auctionId required");
      return;
    }

    const clientId = randomUUID();
    const client = registerClient(clientId, socket, auctionId, offsetParam);

    // 1. Send current snapshot from Postgres
    try {
      const snapshotRows = await sql<Array<{ state: unknown }>>`
        SELECT state FROM auction_snapshots
        WHERE auction_id = ${auctionId}
        ORDER BY seq DESC LIMIT 1
      `;
      const snapshot = snapshotRows[0]?.state ?? null;
      sendToClient(client, { type: "snapshot", auctionId, data: snapshot });
    } catch {
      sendToClient(client, { type: "snapshot", auctionId, data: null });
    }

    // 2. Replay missed events from stream since client's last offset
    try {
      const missed = await readStream(redis, auctionId, offsetParam);
      for (const entry of missed) {
        const eventData = JSON.parse(entry.fields["data"] ?? "{}") as unknown;
        sendToClient(client, { type: "event", streamId: entry.id, data: eventData });
        updateLastEventId(clientId, entry.id);
      }
    } catch {
      // Non-fatal — client will receive live events going forward
    }

    // 3. Message handling
    socket.on("message", (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "pong") handlePong(clientId);
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on("close", () => { removeClient(clientId); });
    socket.on("error", () => { removeClient(clientId); });
  })();
});

// ---------------------------------------------------------------------------
// Background stream consumer loop — fan out live events to connected clients
// ---------------------------------------------------------------------------

// ✅ BUG FIX #6: Track active loops to prevent race condition duplicates
const activeLoops = new Set<string>();

async function _safeConsumeLoop(auctionId: string, lastId: string): Promise<void> {
  if (activeLoops.has(auctionId)) {
    console.warn(
      `[broadcaster] Consume loop already running for ${auctionId}, skipping duplicate`
    );
    return;
  }

  activeLoops.add(auctionId);
  try {
    await _consumeLoop(auctionId, lastId);
  } finally {
    activeLoops.delete(auctionId);
  }
}

async function _consumeLoop(auctionId: string, lastId: string): Promise<void> {
  let cursor = lastId;
  for (;;) {
    try {
      const entries = await blockRead(redis, auctionId, cursor);
      for (const entry of entries) {
        const eventData = JSON.parse(entry.fields["data"] ?? "{}") as unknown;
        broadcast(auctionId, { type: "event", streamId: entry.id, data: eventData });
        cursor = entry.id;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1_000)); // brief backoff on error
    }
  }
}

// Listen for new auction IDs on a control channel
const controlSub = new IORedis(REDIS_URL);
await controlSub.subscribe("broadcaster:register_auction");
controlSub.on("message", (_channel: string, auctionId: string) => {
  // ✅ Use safe wrapper to prevent duplicate loops
  void _safeConsumeLoop(auctionId, "0-0");
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`[broadcaster] Listening on port ${String(PORT)}`);
});

process.on("SIGTERM", () => {
  void (async () => {
    wss.close();
    httpServer.close();
    redis.disconnect();
    controlSub.disconnect();
    await sql.end();
    process.exit(0);
  })();
});
