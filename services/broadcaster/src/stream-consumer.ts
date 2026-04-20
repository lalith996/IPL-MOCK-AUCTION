/**
 * Redis Streams consumer for the auction event bus.
 *
 * Partitioned by auction_id: each auction has its own stream key.
 * Broadcaster reads with XREAD and fans out to WebSocket clients.
 */

import type { Redis as IORedis } from "ioredis";

export type StreamEntry = {
  id: string;
  fields: Record<string, string>;
};

const BLOCK_MS = 2_000; // XREAD block timeout
const BATCH_SIZE = 100;

export function streamKey(auctionId: string): string {
  return `auction:events:${auctionId}`;
}

/**
 * Append a serialised event to the auction's Redis Stream.
 * Called by the Auction Manager (or a bridge) when an event is emitted.
 */
export async function appendToStream(
  redis: IORedis,
  auctionId: string,
  eventJson: string,
): Promise<string> {
  const key = streamKey(auctionId);
  return redis.xadd(key, "*", "data", eventJson) as Promise<string>;
}

/**
 * Read entries from the stream starting at `fromId` (exclusive).
 * Returns up to BATCH_SIZE entries. Non-blocking (COUNT only, no BLOCK).
 */
export async function readStream(
  redis: IORedis,
  auctionId: string,
  fromId: string,
): Promise<StreamEntry[]> {
  const key = streamKey(auctionId);
  const result = await redis.xrange(key, `(${fromId}`, "+", "COUNT", BATCH_SIZE);
  return (result as Array<[string, string[]]>).map(([id, fields]) => ({
    id,
    fields: _parseFields(fields),
  }));
}

/**
 * Block-read the latest entries since `lastId`.
 * Used in the background consumer loop for real-time delivery.
 */
export async function blockRead(
  redis: IORedis,
  auctionId: string,
  lastId: string,
): Promise<StreamEntry[]> {
  const key = streamKey(auctionId);
  const result = await redis.xread(
    "COUNT",
    BATCH_SIZE,
    "BLOCK",
    BLOCK_MS,
    "STREAMS",
    key,
    lastId,
  );
  if (!result) return [];
  const entries = (result as Array<[string, Array<[string, string[]]>]>)[0]?.[1] ?? [];
  return entries.map(([id, fields]) => ({ id, fields: _parseFields(fields) }));
}

function _parseFields(rawFields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < rawFields.length - 1; i += 2) {
    out[rawFields[i] ?? ""] = rawFields[i + 1] ?? "";
  }
  return out;
}
