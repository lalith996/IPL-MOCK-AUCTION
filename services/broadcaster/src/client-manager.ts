/**
 * WebSocket client state management.
 *
 * Tracks per-client:
 *   - Last acknowledged stream offset (for gap-free reconnect)
 *   - Per-client bounded event queue (max 500 events)
 *   - Heartbeat state
 *
 * Slow-consumer eviction: if the queue exceeds MAX_QUEUE_SIZE, the client
 * is forcibly closed with a notification message.
 */

import type { WebSocket } from "ws";

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_MISS_LIMIT = 2;
const MAX_QUEUE_SIZE = 500;

export interface Client {
  id: string;
  socket: WebSocket;
  auctionId: string;
  lastEventId: string; // Redis Stream ID, e.g. "1234567890-0"
  queueSize: number;
  heartbeatMisses: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

const _clients = new Map<string, Client>();

export function registerClient(
  id: string,
  socket: WebSocket,
  auctionId: string,
  lastEventId: string,
): Client {
  const client: Client = {
    id,
    socket,
    auctionId,
    lastEventId,
    queueSize: 0,
    heartbeatMisses: 0,
    heartbeatTimer: null,
  };
  _clients.set(id, client);
  _startHeartbeat(client);
  return client;
}

export function removeClient(id: string): void {
  const client = _clients.get(id);
  if (client?.heartbeatTimer) clearInterval(client.heartbeatTimer);
  _clients.delete(id);
}

export function getClientsForAuction(auctionId: string): Client[] {
  return [..._clients.values()].filter((c) => c.auctionId === auctionId);
}

export function updateLastEventId(clientId: string, streamId: string): void {
  const c = _clients.get(clientId);
  if (c) c.lastEventId = streamId;
}

/**
 * Send a JSON message to a client.
 * Enforces the MAX_QUEUE_SIZE and evicts slow consumers.
 */
export function sendToClient(client: Client, msg: unknown): void {
  if (client.socket.readyState !== 1 /* OPEN */) return;

  if (client.queueSize >= MAX_QUEUE_SIZE) {
    client.socket.send(
      JSON.stringify({ type: "error", code: "slow_consumer", message: "Queue full — disconnecting" }),
    );
    client.socket.close(1008, "slow_consumer");
    removeClient(client.id);
    return;
  }

  client.queueSize += 1;
  client.socket.send(JSON.stringify(msg), () => {
    client.queueSize = Math.max(0, client.queueSize - 1);
  });
}

export function broadcast(auctionId: string, msg: unknown): void {
  for (const client of getClientsForAuction(auctionId)) {
    sendToClient(client, msg);
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function _startHeartbeat(client: Client): void {
  client.heartbeatTimer = setInterval(() => {
    if (client.socket.readyState !== 1) {
      removeClient(client.id);
      return;
    }
    client.heartbeatMisses += 1;
    if (client.heartbeatMisses > HEARTBEAT_MISS_LIMIT) {
      client.socket.close(1001, "heartbeat_timeout");
      removeClient(client.id);
      return;
    }
    client.socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
  }, HEARTBEAT_INTERVAL_MS);
}

export function handlePong(clientId: string): void {
  const c = _clients.get(clientId);
  if (c) c.heartbeatMisses = 0;
}

export function clientCount(): number {
  return _clients.size;
}
