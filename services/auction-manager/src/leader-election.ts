/**
 * Redis-based leader election — ensures singleton Auction Manager per auction session.
 *
 * Uses SET NX EX: the first instance to acquire the lock becomes leader.
 * Heartbeat renews the lease; on failure, another instance can take over.
 */

import type { Redis as IORedis } from "ioredis";

const LEASE_TTL_SECONDS = 15;
const HEARTBEAT_INTERVAL_MS = 5_000;

export class LeaderElection {
  private _leaderKey: string;
  private _instanceId: string;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _isLeader = false;

  constructor(
    private readonly redis: InstanceType<typeof IORedis>,
    private readonly auctionId: string,
    instanceId: string,
  ) {
    this._leaderKey = `auction:${auctionId}:leader`;
    this._instanceId = instanceId;
  }

  async tryAcquire(): Promise<boolean> {
    const result = await this.redis.set(
      this._leaderKey,
      this._instanceId,
      "EX",
      LEASE_TTL_SECONDS,
      "NX",
    );
    this._isLeader = result === "OK";
    if (this._isLeader) {
      this._startHeartbeat();
    }
    return this._isLeader;
  }

  get isLeader(): boolean {
    return this._isLeader;
  }

  async release(): Promise<void> {
    this._stopHeartbeat();
    if (!this._isLeader) return;
    // Only delete if we still hold the key (Lua script for atomicity)
    await this.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      this._leaderKey,
      this._instanceId,
    );
    this._isLeader = false;
  }

  private _startHeartbeat(): void {
    this._heartbeatTimer = setInterval(() => { void (async () => {
      if (!this._isLeader) return;
      const current = await this.redis.get(this._leaderKey);
      if (current !== this._instanceId) {
        // Lost the lease — another instance took over
        this._isLeader = false;
        this._stopHeartbeat();
        return;
      }
      await this.redis.expire(this._leaderKey, LEASE_TTL_SECONDS);
    })(); }, HEARTBEAT_INTERVAL_MS);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}
