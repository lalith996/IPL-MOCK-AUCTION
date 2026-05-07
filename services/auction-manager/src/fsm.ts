/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unused-vars */
/**
 * Auction Manager FSM.
 *
 * Phases: prep → nominating → opening_bid → open_bidding → closing → sold|unsold → next
 *
 * The FSM processes commands, validates rules, emits events, and updates state.
 * State is kept in-memory; events are the source of truth (written to Postgres).
 */

import { randomUUID } from "node:crypto";
import type { EventStore } from "./event-store.js";
import type {
  AgentId,
  AuctionEvent,
  AuctionPhase,
  AuctionState,
  Command,
  RuleViolation,
} from "./types.js";
import { ALL_AGENT_IDS } from "./types.js";
import { validateBid } from "./rules/index.js";
import {
  computeInitialPair,
  handleActiveDrop,
  isActiveBidder,
} from "./two-bidder-protocol.js";

// Closing countdown: player sold to current bidder after this many ms of no new bids
const CLOSING_TIMEOUT_MS = 8_000;

// Warning count before lock-out (withdrawal rule threshold)
const WARNING_THRESHOLD = 2;

export class AuctionFSM {
  private _state: AuctionState;
  private _closingTimer: ReturnType<typeof setTimeout> | null = null;
  private _processedCommands = new Set<string>(); // clientId:seq

  constructor(
    private readonly store: EventStore,
    initialState: AuctionState,
  ) {
    this._state = { ...initialState };
  }

  get state(): Readonly<AuctionState> {
    return this._state;
  }

  // ---------------------------------------------------------------------------
  // Command dispatch
  // ---------------------------------------------------------------------------

  async handleCommand(cmd: Command): Promise<AuctionEvent | RuleViolation> {
    const idempKey = `${cmd.clientId}:${cmd.seq}`;
    if (this._processedCommands.has(idempKey)) {
      // Idempotent — return a synthetic no-op event
      return this._makeEvent("auction.resumed", null, { duplicate: true });
    }
    this._processedCommands.add(idempKey);

    switch (cmd.type) {
      case "StartAuction":    return this._handleStart(cmd);
      case "NominatePlayer":  return this._handleNominate(cmd);
      case "PlaceBid":        return this._handlePlaceBid(cmd);
      case "DropBid":         return this._handleDrop(cmd);
      case "PauseAuction":    return this._handlePause(cmd);
      case "ResumeAuction":   return this._handleResume(cmd);
      default:
        throw new Error(`Unknown command type: ${(cmd as Command).type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Command handlers
  // ---------------------------------------------------------------------------

  private async _handleStart(cmd: Command): Promise<AuctionEvent> {
    this._assertPhase("prep");
    this._transition("nominating");
    const event = this._makeEvent("auction.started", null, { seed: this._state.seed });
    await this._persist(event);
    return event;
  }

  private async _handleNominate(cmd: Command): Promise<AuctionEvent> {
    this._assertPhase("nominating");
    const playerId = cmd.payload["playerId"] as string;
    const role = cmd.payload["role"] as string;
    if (!playerId) throw new Error("NominatePlayer requires playerId");

    this._state.nominatedPlayerId = playerId;
    this._state.nominatedPlayerRole = role ?? null;
    this._state.currentBidLakhs = 0;
    this._state.currentBidder = null;
    this._state.activeBidders = [];
    this._state.standbyQueue = [...ALL_AGENT_IDS];

    // Reset consecutive drops for all teams
    for (const team of Object.values(this._state.teams)) {
      team.consecutiveDrops = 0;
      team.lockedOut = false;
    }

    this._transition("opening_bid");
    const event = this._makeEvent("player.nominated", null, { playerId, role });
    await this._persist(event);
    return event;
  }

  private async _handlePlaceBid(cmd: Command): Promise<AuctionEvent | RuleViolation> {
    this._assertPhase("opening_bid", "open_bidding");
    const agentId = cmd.payload["agentId"] as AgentId;
    const bidLakhs = cmd.payload["bidLakhs"] as number;
    const nationality = (cmd.payload["playerNationality"] as "indian" | "overseas") ?? "indian";

    // Rule validation
    const violation = validateBid(this._state, agentId, bidLakhs, nationality);
    if (violation) {
      const event = this._makeEvent("rule.violation", agentId, {
        ruleId: violation.ruleId,
        message: violation.message,
        bidLakhs,
      });
      await this._persist(event);
      return violation;
    }

    // Update state
    const previousBidder = this._state.currentBidder;
    this._state.currentBidLakhs = bidLakhs;
    this._state.currentBidder = agentId;

    // Reset consecutive drops for this agent (they bid)
    const team = this._state.teams[agentId];
    if (team) {
      team.consecutiveDrops = 0;
    }

    // Two-bidder protocol: if this is the first bid, seed the active pair
    if (this._state.phase === "opening_bid") {
      this._transition("open_bidding");
    }

    // Restart closing timer
    this._restartClosingTimer();

    const eventType = this._state.phase === "open_bidding" && previousBidder === null
      ? "opening_bid.placed"
      : "bid.placed";

    const event = this._makeEvent(eventType as "bid.placed" | "opening_bid.placed", agentId, {
      bidLakhs,
      previousBidder,
    });
    await this._persist(event);
    return event;
  }

  private async _handleDrop(cmd: Command): Promise<AuctionEvent | RuleViolation> {
    this._assertPhase("open_bidding");
    const agentId = cmd.payload["agentId"] as AgentId;

    const team = this._state.teams[agentId];
    if (team) {
      team.consecutiveDrops += 1;
      if (team.consecutiveDrops >= WARNING_THRESHOLD) {
        team.lockedOut = true;
      }
    }

    // Update two-bidder pair if the dropper was active
    if (isActiveBidder(this._state, agentId)) {
      const update = handleActiveDrop(this._state, agentId);
      this._state.activeBidders = update.activeBidders;
      this._state.standbyQueue = update.standbyQueue;
    }

    // Check if everyone has dropped
    const activeBidderCount = (this._state.activeBidders as AgentId[]).length;
    const allDropped =
      activeBidderCount === 0 ||
      (activeBidderCount <= 1 && this._state.currentBidder !== null);

    const event = this._makeEvent("bid.dropped", agentId, {
      currentBid: this._state.currentBidLakhs,
      allDropped,
    });
    await this._persist(event);

    if (allDropped && this._state.currentBidder) {
      await this._closeSold();
    } else if (allDropped) {
      await this._closeUnsold();
    }

    return event;
  }

  private async _handlePause(cmd: Command): Promise<AuctionEvent> {
    this._clearClosingTimer();
    const event = this._makeEvent("auction.paused", null, {});
    await this._persist(event);
    return event;
  }

  private async _handleResume(cmd: Command): Promise<AuctionEvent> {
    this._restartClosingTimer();
    const event = this._makeEvent("auction.resumed", null, {});
    await this._persist(event);
    return event;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async _closeSold(): Promise<void> {
    const winner = this._state.currentBidder!;
    const priceLakhs = this._state.currentBidLakhs;
    const playerId = this._state.nominatedPlayerId!;
    const role = this._state.nominatedPlayerRole ?? "player";

    const team = this._state.teams[winner];
    if (team) {
      team.budgetRemainingCr -= priceLakhs / 100;
      team.squad.push({
        playerId,
        role,
        nationality: "indian", // nationality resolved by caller in real flow
        priceLakhs,
      });
    }

    this._transition("sold");
    const event = this._makeEvent("player.sold", winner, { playerId, priceLakhs });
    await this._persist(event);
    this._transition("nominating");
  }

  private async _closeUnsold(): Promise<void> {
    this._transition("unsold");
    const event = this._makeEvent("player.unsold", null, {
      playerId: this._state.nominatedPlayerId,
    });
    await this._persist(event);
    this._transition("nominating");
  }

  private _restartClosingTimer(): void {
    this._clearClosingTimer();
    this._closingTimer = setTimeout(() => {
      void (async () => {
        if (this._state.phase !== "open_bidding") return;
        if (this._state.currentBidder) {
          await this._closeSold();
        } else {
          await this._closeUnsold();
        }
      })();
    }, CLOSING_TIMEOUT_MS);
  }

  private _clearClosingTimer(): void {
    if (this._closingTimer) {
      clearTimeout(this._closingTimer);
      this._closingTimer = null;
    }
  }

  private _transition(phase: AuctionPhase): void {
    this._state.phase = phase;
    this._state.seq += 1;
  }

  private _assertPhase(...allowed: AuctionPhase[]): void {
    if (!allowed.includes(this._state.phase)) {
      throw new Error(
        `Invalid phase: ${this._state.phase}. Expected one of: ${allowed.join(", ")}`,
      );
    }
  }

  private _makeEvent(
    type: AuctionEvent["type"],
    agentId: AgentId | null,
    payload: Record<string, unknown>,
  ): AuctionEvent {
    return {
      eventId: randomUUID(),
      auctionId: this._state.auctionId,
      seq: this._state.seq,
      type,
      agentId,
      payload,
      timestamp: new Date().toISOString(),
    };
  }

  private async _persist(event: AuctionEvent): Promise<void> {
    await this.store.appendEvent(
      event.auctionId,
      event.type,
      event.agentId,
      event.payload,
      event.seq,
    );
    await this.store.saveSnapshot(this._state);
  }
}

// ---------------------------------------------------------------------------
// Factory — create a fresh AuctionState for a new session
// ---------------------------------------------------------------------------

export function createInitialState(
  auctionId: string,
  seed: string,
  initialBudgetCr = 100,
): AuctionState {
  const teams = Object.fromEntries(
    ALL_AGENT_IDS.map((id) => [
      id,
      {
        agentId: id,
        budgetRemainingCr: initialBudgetCr,
        squad: [],
        overseasCount: 0,
        consecutiveDrops: 0,
        lockedOut: false,
      },
    ]),
  ) as unknown as AuctionState["teams"];

  return {
    auctionId,
    phase: "prep",
    seq: 0,
    nominatedPlayerId: null,
    nominatedPlayerRole: null,
    currentBidLakhs: 0,
    currentBidder: null,
    activeBidders: [],
    standbyQueue: [],
    teams,
    seed,
  };
}
