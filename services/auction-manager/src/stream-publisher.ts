/**
 * Redis Stream publisher for the Auction Manager.
 *
 * The Broadcaster service consumes from `auction:events:{auctionId}` Redis
 * Streams.  We cannot import from services/broadcaster (circular workspace
 * dependency), so the 5-line publish helper lives here instead.
 *
 * PublishingEventStore wraps EventStore and fire-and-forgets every persisted
 * event to Redis so the Broadcaster gets live updates with zero changes to
 * fsm.ts or event-store.ts.
 */

import type postgres from "postgres";
import type { Redis } from "ioredis";
import { EventStore } from "./event-store.js";
import type { AgentId, AuctionEvent, EventType } from "./types.js";

// ---------------------------------------------------------------------------
// Stream key convention (must match broadcaster/src/stream-consumer.ts)
// ---------------------------------------------------------------------------

export function streamKey(auctionId: string): string {
  return `auction:events:${auctionId}`;
}

// ---------------------------------------------------------------------------
// Low-level publish — fire-and-forget from call sites
// ---------------------------------------------------------------------------

export async function publishEvent(
  redis: Redis,
  auctionId: string,
  event: unknown,
): Promise<void> {
  await redis.xadd(streamKey(auctionId), "*", "data", JSON.stringify(event));
}

// ---------------------------------------------------------------------------
// PublishingEventStore — drop-in replacement for EventStore that mirrors
// every Postgres write to the Redis Stream consumed by the Broadcaster.
// ---------------------------------------------------------------------------

export class PublishingEventStore extends EventStore {
  constructor(
    sql: ReturnType<typeof postgres>,
    private readonly redis: Redis,
  ) {
    super(sql);
  }

  override async appendEvent(
    auctionId: string,
    type: EventType,
    agentId: AgentId | null,
    payload: Record<string, unknown>,
    seq: number,
  ): Promise<AuctionEvent> {
    const event = await super.appendEvent(auctionId, type, agentId, payload, seq);

    // Fire-and-forget: Redis failure must never fail the FSM state machine.
    // Events are already durable in Postgres; Redis is only the delivery channel.
    void publishEvent(this.redis, auctionId, event).catch((err: unknown) => {
      console.warn("[stream-publisher] Redis publish failed (non-fatal):", err);
    });

    return event;
  }
}
