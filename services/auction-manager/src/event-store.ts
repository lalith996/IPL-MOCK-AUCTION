/**
 * Append-only event store backed by Postgres.
 *
 * Writes to `auction_events` table (DDL: infra/docker/migrations/002_auction_events.sql).
 * Periodic snapshots go to `auction_snapshots`.
 * Uses seeded RNG stored in `auction_sessions` for deterministic replay.
 */

import type postgres from "postgres";
import type { AuctionEvent, AuctionState, EventType, AgentId } from "./types.js";
import { randomUUID } from "node:crypto";

// Snapshot every 20 events
const SNAPSHOT_INTERVAL = 20;

export class EventStore {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Persists an event and possibly a snapshot transactionally.
   * Marking idempotency state could also go here if needed per-client.
   */
  async persistEventAndSnapshot(
    event: AuctionEvent,
    state: AuctionState,
    clientId: string,
    clientSeq: number
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      // 1. Insert Event
      await tx`
        INSERT INTO auction_events
          (event_id, auction_id, seq, type, agent_id, payload, timestamp)
        VALUES (
          ${event.eventId},
          ${event.auctionId},
          ${event.seq},
          ${event.type},
          ${event.agentId},
          ${tx.json(event.payload as unknown as Parameters<typeof tx.json>[0])},
          ${event.timestamp}
        )
      `;

      // 2. Mark command processed
      await tx`
        INSERT INTO processed_commands (client_id, client_seq, processed_at)
        VALUES (${clientId}, ${clientSeq}, ${new Date().toISOString()})
        ON CONFLICT DO NOTHING
      `;

      // 3. Save snapshot periodically
      if (state.seq % SNAPSHOT_INTERVAL === 0) {
        await tx`
          INSERT INTO auction_snapshots (auction_id, seq, state, created_at)
          VALUES (
            ${state.auctionId},
            ${state.seq},
            ${tx.json(state as unknown as Parameters<typeof tx.json>[0])},
            ${new Date().toISOString()}
          )
          ON CONFLICT (auction_id, seq) DO NOTHING
        `;
      }
    });
  }

  async appendEvent(
    auctionId: string,
    type: EventType,
    agentId: AgentId | null,
    payload: Record<string, unknown>,
    seq: number,
  ): Promise<AuctionEvent> {
    const event: AuctionEvent = {
      eventId: randomUUID(),
      auctionId,
      seq,
      type,
      agentId,
      payload,
      timestamp: new Date().toISOString(),
    };

    await this.sql`
      INSERT INTO auction_events
        (event_id, auction_id, seq, type, agent_id, payload, timestamp)
      VALUES (
        ${event.eventId},
        ${event.auctionId},
        ${event.seq},
        ${event.type},
        ${event.agentId},
        ${this.sql.json(event.payload as unknown as Parameters<typeof this.sql.json>[0])},
        ${event.timestamp}
      )
    `;

    return event;
  }

  async saveSnapshot(state: AuctionState): Promise<void> {
    if (state.seq % SNAPSHOT_INTERVAL !== 0) return;
    await this.sql`
      INSERT INTO auction_snapshots (auction_id, seq, state, created_at)
      VALUES (
        ${state.auctionId},
        ${state.seq},
        ${this.sql.json(state as unknown as Parameters<typeof this.sql.json>[0])},
        ${new Date().toISOString()}
      )
      ON CONFLICT (auction_id, seq) DO NOTHING
    `;
  }

  async getLatestSnapshot(auctionId: string): Promise<AuctionState | null> {
    const rows = await this.sql<Array<{ state: AuctionState }>>`
      SELECT state FROM auction_snapshots
      WHERE auction_id = ${auctionId}
      ORDER BY seq DESC
      LIMIT 1
    `;
    return rows[0]?.state ?? null;
  }

  async getEventsSinceSeq(auctionId: string, fromSeq: number): Promise<AuctionEvent[]> {
    return this.sql<AuctionEvent[]>`
      SELECT event_id, auction_id, seq, type, agent_id, payload, timestamp
      FROM auction_events
      WHERE auction_id = ${auctionId}
        AND seq > ${fromSeq}
      ORDER BY seq ASC
    `;
  }

  /** Replay: reconstruct full event log for an auction (for the replay viewer). */
  async getAllEvents(auctionId: string): Promise<AuctionEvent[]> {
    return this.sql<AuctionEvent[]>`
      SELECT event_id, auction_id, seq, type, agent_id, payload, timestamp
      FROM auction_events
      WHERE auction_id = ${auctionId}
      ORDER BY seq ASC
    `;
  }

  /** Record idempotency key — drop duplicate commands. */
  async isCommandProcessed(clientId: string, clientSeq: number): Promise<boolean> {
    const rows = await this.sql<Array<{ count: string }>>`
      SELECT COUNT(*) as count FROM processed_commands
      WHERE client_id = ${clientId} AND client_seq = ${clientSeq}
    `;
    return parseInt(rows[0]?.count ?? "0", 10) > 0;
  }

  async markCommandProcessed(clientId: string, clientSeq: number): Promise<void> {
    await this.sql`
      INSERT INTO processed_commands (client_id, client_seq, processed_at)
      VALUES (${clientId}, ${clientSeq}, ${new Date().toISOString()})
      ON CONFLICT DO NOTHING
    `;
  }
}
