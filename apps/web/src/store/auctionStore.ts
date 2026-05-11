/**
 * Zustand auction store — single source of truth for all real-time UI state.
 * All types derive from generated schema types (packages/schemas/ts/).
 */

"use client";

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types (inline until schema code-gen is wired — mirrors schema shapes)
// ---------------------------------------------------------------------------

export type AgentId =
  | "MI" | "CSK" | "RCB" | "DC" | "KKR"
  | "RR" | "PBKS" | "SRH" | "LSG" | "GT";

export type AuctionPhase =
  | "prep" | "nominating" | "opening_bid" | "open_bidding"
  | "closing" | "sold" | "unsold" | "complete";

export interface SquadPlayer {
  playerId: string;
  role: string;
  nationality: "indian" | "overseas";
  priceLakhs: number;
}

export interface TeamState {
  agentId: AgentId;
  budgetRemainingCr: number;
  squad: SquadPlayer[];
  overseasCount: number;
}

export interface NominatedPlayer {
  playerId: string;
  canonicalName: string;
  role: string;
  playerSummary: string;
  confidence: number;
  isColdStart: boolean;
  headshotUrl?: string;
  blurhash?: string;
}

export interface ScoreBreakdown {
  formScore: number;
  valueScore: number;
  roleFit: number;
  squadNeed: number;
  dataConfidence: number;
  budgetPressure: number;
  personalityBonus: number;
  coldStartPenalty: number;
  composite: number;
}

export interface AgentBidEvent {
  agentId: AgentId;
  action: "bid" | "drop" | "pass";
  bidAmountLakhs: number | null;
  confidenceScore: number;
  chosenPlan: "A" | "B" | "C" | "D";
  scoreBreakdown: ScoreBreakdown;
  reasoningSummary: string;
  isColdStart: boolean;
  timestamp: string;
}

export interface HumanBidWindow {
  /** Team the human controls */
  team: AgentId;
  /** ms remaining when window opened */
  windowMs: number;
  /** When the window opened (for countdown) */
  openedAt: number;
  /** Current bid in the room at window-open time */
  currentBidLakhs: number;
  /** Player being bid on */
  playerId: string;
  playerNationality: "indian" | "overseas";
}

export interface AuctionState {
  auctionId: string | null;
  phase: AuctionPhase;
  nominatedPlayer: NominatedPlayer | null;
  currentBidLakhs: number;
  currentBidder: AgentId | null;
  teams: Partial<Record<AgentId, TeamState>>;
  /** Most recent bid events per agent (for RationalePanel) */
  latestBidEvents: Partial<Record<AgentId, AgentBidEvent>>;
  /** Dedup set for event IDs */
  seenEventIds: Set<string>;
  connectionState: "disconnected" | "connecting" | "connected" | "reconnecting";
  lastStreamId: string;
  /** Human player team (from sessionStorage, null = spectator) */
  humanTeam: AgentId | null;
  /** Active bid window for the human player */
  humanBidWindow: HumanBidWindow | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface AuctionActions {
  setSnapshot: (snapshot: AuctionState) => void;
  applyEvent: (eventId: string, event: unknown) => void;
  setConnectionState: (state: AuctionState["connectionState"]) => void;
  setLastStreamId: (id: string) => void;
  setHumanTeam: (team: AgentId | null) => void;
  clearHumanBidWindow: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: AuctionState = {
  auctionId: null,
  phase: "prep",
  nominatedPlayer: null,
  currentBidLakhs: 0,
  currentBidder: null,
  teams: {},
  latestBidEvents: {},
  humanTeam: null,
  humanBidWindow: null,
  seenEventIds: new Set(),
  connectionState: "disconnected",
  lastStreamId: "0-0",
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuctionStore = create<AuctionState & AuctionActions>((set, get) => ({
  ...INITIAL_STATE,

  setSnapshot: (snapshot) =>
    set({
      ...snapshot,
      connectionState: "connected",
      seenEventIds: new Set(get().seenEventIds), // preserve dedup set
    }),

  applyEvent: (eventId: string, event: unknown) => {
    const state = get();
    if (state.seenEventIds.has(eventId)) return; // dedup

    const newSeenIds = new Set(state.seenEventIds);
    newSeenIds.add(eventId);

    // ✅ BUG FIX #5: Enforce max dedup set size (1000 event IDs)
    // to prevent unbounded memory growth on long auctions
    const MAX_DEDUP_SIZE = 1000;
    if (newSeenIds.size > MAX_DEDUP_SIZE) {
      const arr = Array.from(newSeenIds);
      arr.shift(); // remove oldest (first)
      newSeenIds.clear();
      arr.forEach((id) => newSeenIds.add(id));
    }

    const ev = event as Record<string, unknown>;
    const type = ev["type"] as string;

    set((s) => {
      const next: Partial<AuctionState> = { seenEventIds: newSeenIds };

      switch (type) {
        case "player.nominated": {
          const payload = ev["payload"] as Record<string, unknown>;
          next.nominatedPlayer = {
            playerId: payload["playerId"] as string,
            canonicalName: (payload["canonicalName"] as string) ?? payload["playerId"],
            role: (payload["role"] as string) ?? "player",
            playerSummary: (payload["playerSummary"] as string) ?? "",
            confidence: (payload["confidence"] as number) ?? 0,
            isColdStart: (payload["isColdStart"] as boolean) ?? false,
            headshotUrl: payload["headshotUrl"] as string | undefined,
            blurhash: payload["blurhash"] as string | undefined,
          };
          next.currentBidLakhs = 0;
          next.currentBidder = null;
          next.phase = "opening_bid";
          break;
        }
        case "bid.placed":
        case "opening_bid.placed": {
          const payload = ev["payload"] as Record<string, unknown>;
          next.currentBidLakhs = (payload["bidLakhs"] as number) ?? s.currentBidLakhs;
          next.currentBidder = (payload["agentId"] as AgentId) ?? s.currentBidder;
          next.phase = "open_bidding";
          break;
        }
        case "player.sold": {
          const payload = ev["payload"] as Record<string, unknown>;
          next.phase = "sold";
          next.currentBidder = (payload["agentId"] as AgentId) ?? s.currentBidder;
          next.humanBidWindow = null;
          break;
        }
        case "player.unsold":
          next.phase = "unsold";
          next.humanBidWindow = null;
          break;
        case "auction.started":
          next.phase = "nominating";
          break;
        case "auction.complete":
          next.phase = "complete";
          break;
        case "human.bid_window_open": {
          const payload = ev["payload"] as Record<string, unknown>;
          next.humanBidWindow = {
            team: payload["humanTeam"] as AgentId,
            windowMs: (payload["windowMs"] as number) ?? 30_000,
            openedAt: Date.now(),
            currentBidLakhs: (payload["currentBidLakhs"] as number) ?? s.currentBidLakhs,
            playerId: payload["playerId"] as string,
            playerNationality: (payload["playerNationality"] as "indian" | "overseas") ?? "indian",
          };
          break;
        }
      }

      return next;
    });
  },

  setConnectionState: (connectionState) => set({ connectionState }),
  setLastStreamId: (lastStreamId) => set({ lastStreamId }),
  setHumanTeam: (humanTeam) => set({ humanTeam }),
  clearHumanBidWindow: () => set({ humanBidWindow: null }),
  reset: () => set({ ...INITIAL_STATE, seenEventIds: new Set() }),
}));
