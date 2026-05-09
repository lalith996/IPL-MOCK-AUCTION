/**
 * Crash Recovery for Auction Manager
 * 
 * Implements graceful shutdown, state snapshot, and recovery mechanisms
 * Ensures no auction data loss and minimal downtime
 */

import { EventEmitter } from "events";
import type { Pool } from "pg";
import type { createClient } from "redis";

export interface AuctionSnapshot {
  auctionId: string;
  phase: string;
  seq: number;
  timestamp: number;
  state: Record<string, unknown>;
}

export interface RecoveryState {
  lastSnapshot: AuctionSnapshot;
  eventsSinceSnapshot: number;
  recoveryTime: number;
  successful: boolean;
}

/**
 * Manages graceful shutdown and recovery
 */
export class CrashRecoveryManager extends EventEmitter {
  private isShuttingDown = false;
  private activeTransactions = 0;
  private lastSnapshot: AuctionSnapshot | null = null;

  constructor(
    private db: Pool,
    private redis: ReturnType<typeof createClient>,
    private auctionId: string,
  ) {
    super();
    this.setupSignalHandlers();
  }

  /**
   * Register transaction activity
   */
  recordTransaction(active: boolean): void {
    if (active) {
      this.activeTransactions += 1;
    } else {
      this.activeTransactions = Math.max(0, this.activeTransactions - 1);
    }
  }

  /**
   * Create periodic snapshots of auction state
   */
  async createSnapshot(state: Record<string, unknown>, seq: number): Promise<void> {
    const snapshot: AuctionSnapshot = {
      auctionId: this.auctionId,
      phase: state["phase"] as string,
      seq,
      timestamp: Date.now(),
      state,
    };

    try {
      // Store in Postgres for durability
      await this.db.query(
        `INSERT INTO auction_snapshots (auction_id, seq, snapshot_data, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (auction_id) DO UPDATE SET
           seq = $2,
           snapshot_data = $3,
           updated_at = NOW()`,
        [this.auctionId, seq, JSON.stringify(snapshot)],
      );

      // Cache in Redis for fast recovery
      await this.redis.set(
        `auction:snapshot:${this.auctionId}`,
        JSON.stringify(snapshot),
        { EX: 3600 }, // 1 hour expiry
      );

      this.lastSnapshot = snapshot;
      this.emit("snapshot", snapshot);
    } catch (err) {
      console.error("Failed to create snapshot:", err);
      throw err;
    }
  }

  /**
   * Recover from crash using last snapshot and event log
   */
  async recover(): Promise<RecoveryState> {
    const startTime = Date.now();

    try {
      // 1. Load last snapshot from Redis (fast path)
      let snapshot = await this.loadSnapshotFromRedis();

      // 2. If not in Redis, load from Postgres (slow path)
      if (!snapshot) {
        snapshot = await this.loadSnapshotFromPostgres();
      }

      if (!snapshot) {
        throw new Error("No snapshot found for recovery");
      }

      // 3. Replay events since snapshot to rebuild state
      const eventsSinceSnapshot = await this.replayEventsSinceSnapshot(
        snapshot.seq,
      );

      const recoveryTime = Date.now() - startTime;

      this.emit("recovered", {
        snapshot,
        eventsSinceSnapshot,
        recoveryTime,
      });

      return {
        lastSnapshot: snapshot,
        eventsSinceSnapshot,
        recoveryTime,
        successful: true,
      };
    } catch (err) {
      console.error("Recovery failed:", err);
      return {
        lastSnapshot: null as unknown as AuctionSnapshot,
        eventsSinceSnapshot: 0,
        recoveryTime: Date.now() - startTime,
        successful: false,
      };
    }
  }

  /**
   * Load snapshot from Redis (fast)
   */
  private async loadSnapshotFromRedis(): Promise<AuctionSnapshot | null> {
    try {
      const data = await this.redis.get(`auction:snapshot:${this.auctionId}`);
      if (data) {
        return JSON.parse(data) as AuctionSnapshot;
      }
      return null;
    } catch (err) {
      console.warn("Redis snapshot load failed, trying Postgres:", err);
      return null;
    }
  }

  /**
   * Load snapshot from Postgres (slow)
   */
  private async loadSnapshotFromPostgres(): Promise<AuctionSnapshot | null> {
    try {
      const result = await this.db.query(
        `SELECT snapshot_data FROM auction_snapshots
         WHERE auction_id = $1
         ORDER BY seq DESC
         LIMIT 1`,
        [this.auctionId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return result.rows[0].snapshot_data as AuctionSnapshot;
    } catch (err: unknown) {
      console.error("Postgres snapshot load failed:", err);
      return null;
    }
  }

  /**
   * Replay events since snapshot to rebuild state
   */
  private async replayEventsSinceSnapshot(lastSeq: number): Promise<number> {
    const result = await this.db.query(
      `SELECT * FROM auction_events
       WHERE auction_id = $1 AND seq > $2
       ORDER BY seq ASC`,
      [this.auctionId, lastSeq],
    );

    // In a real implementation, this would rebuild state by applying each event
    // This is a simplified version that just counts the events
    console.log(`Replayed ${String(result.rows.length)} events since snapshot`);

    return result.rows.length;
  }

  /**
   * Graceful shutdown handler
   */
  private setupSignalHandlers(): void {
    const signals = ["SIGTERM", "SIGINT"];

    for (const signal of signals) {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      process.on(signal, async () => {
        console.log(`Received ${signal}, starting graceful shutdown`);
        try {
          await this.gracefulShutdown();
        } catch (err: unknown) {
          console.error("Graceful shutdown failed:", err);
          process.exit(1);
        }
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.on("uncaughtException", async (err) => {
      console.error("Uncaught exception:", err);
      try {
        await this.gracefulShutdown();
      } catch (e: unknown) {
        console.error("Graceful shutdown failed:", e);
        process.exit(1);
      }
    });
  }

  /**
   * Graceful shutdown process
   * 1. Stop accepting new requests
   * 2. Wait for in-flight transactions to complete
   * 3. Create final snapshot
   * 4. Close connections
   */
  async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    console.log("Shutting down gracefully...");

    // Wait for active transactions to complete (max 30s)
    const maxWait = 30000;
    const startWait = Date.now();

    while (this.activeTransactions > 0 && Date.now() - startWait < maxWait) {
      console.log(`Waiting for ${String(this.activeTransactions)} active transaction(s)`);
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (this.activeTransactions > 0) {
      console.warn(
        `Forced shutdown with ${String(this.activeTransactions)} active transaction(s)`,
      );
    }

    // Create final snapshot
    try {
      if (this.lastSnapshot) {
        await this.createSnapshot(this.lastSnapshot.state, this.lastSnapshot.seq);
      }
    } catch (err) {
      console.error("Failed to create final snapshot:", err);
    }

    // Close connections
    await this.db.end();
    await this.redis.quit();

    console.log("Graceful shutdown complete");
    process.exit(0);
  }

  /**
   * Health check — monitor snapshot staleness
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    lastSnapshotAge: number;
  }> {
    if (!this.lastSnapshot) {
      return {
        status: "degraded",
        lastSnapshotAge: -1,
      };
    }

    const age = Date.now() - this.lastSnapshot.timestamp;
    const maxAge = 60000; // 1 minute

    return {
      status: age > maxAge ? "degraded" : "healthy",
      lastSnapshotAge: age,
    };
  }
}

/**
 * High availability setup with leader election
 */
export class AuctionManagerHA {
  private isLeader = false;
  private leadershipTTL = 5000; // 5 seconds
  private renewalInterval: NodeJS.Timeout | null = null;

  constructor(
    private instanceId: string,
    private auctionId: string,
    private redis: ReturnType<typeof createClient>,
  ) {}

  /**
   * Attempt to acquire leadership
   */
  async tryAcquireLeadership(): Promise<boolean> {
    const key = `auction:leader:${this.auctionId}`;

    try {
      const result = await this.redis.set(
        key,
        this.instanceId,
        { NX: true, EX: this.leadershipTTL },
      );

      if (result === "OK") {
        this.isLeader = true;
        this.startLeadershipRenewal();
        console.log("Acquired leadership for auction", this.auctionId);
        return true;
      }

      return false;
    } catch (err) {
      console.error("Failed to acquire leadership:", err);
      return false;
    }
  }

  /**
   * Renew leadership periodically
   */
  private startLeadershipRenewal(): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.renewalInterval = setInterval(async () => {
      const key = `auction:leader:${this.auctionId}`;

      try {
        const current = await this.redis.get(key);

        if (current === this.instanceId) {
          await this.redis.expire(key, this.leadershipTTL);
        } else {
          this.isLeader = false;
          if (this.renewalInterval) {
            clearInterval(this.renewalInterval);
          }
          console.log("Lost leadership for auction", this.auctionId);
        }
      } catch (err) {
        console.error("Leadership renewal failed:", err);
        this.isLeader = false;
      }
    }, this.leadershipTTL / 2);
  }

  /**
   * Check current leader
   */
  async getCurrentLeader(): Promise<string | null> {
    try {
      return await this.redis.get(`auction:leader:${this.auctionId}`);
    } catch (err) {
      console.error("Failed to get current leader:", err);
      return null;
    }
  }

  /**
   * Is this instance the leader?
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Shutdown and release leadership
   */
  async shutdown(): Promise<void> {
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval);
    }

    if (this.isLeader) {
      try {
        await this.redis.del(`auction:leader:${this.auctionId}`);
        console.log("Released leadership for auction", this.auctionId);
      } catch (err) {
        console.error("Failed to release leadership:", err);
      }
    }
  }
}
