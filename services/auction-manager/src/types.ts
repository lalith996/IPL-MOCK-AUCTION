/**
 * Shared types for the Auction Manager.
 */

export type AgentId =
  | "MI" | "CSK" | "RCB" | "DC" | "KKR"
  | "RR" | "PBKS" | "SRH" | "LSG" | "GT";

export const ALL_AGENT_IDS: readonly AgentId[] = [
  "MI", "CSK", "RCB", "DC", "KKR", "RR", "PBKS", "SRH", "LSG", "GT",
];

export type AuctionPhase =
  | "prep"
  | "nominating"
  | "opening_bid"
  | "open_bidding"
  | "closing"
  | "sold"
  | "unsold"
  | "complete";

export interface SquadPlayer {
  playerId: string;
  role: string;
  nationality: "indian" | "overseas";
  priceLakhs: number;
}

export interface TeamBudget {
  agentId: AgentId;
  budgetRemainingCr: number;
  squad: SquadPlayer[];
  overseasCount: number;
  /** Number of consecutive drops for the current player (triggers withdrawal rule). */
  consecutiveDrops: number;
  /** Whether the team is locked out from bidding on the current player. */
  lockedOut: boolean;
}

export interface AuctionState {
  auctionId: string;
  phase: AuctionPhase;
  seq: number;
  nominatedPlayerId: string | null;
  nominatedPlayerRole: string | null;
  currentBidLakhs: number;
  currentBidder: AgentId | null;
  /** Top-2 active bidders in the two-bidder protocol. */
  activeBidders: [AgentId, AgentId] | [];
  standbyQueue: AgentId[];
  teams: Record<AgentId, TeamBudget>;
  seed: string;
}

export interface RuleViolation {
  ruleId: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type CommandType =
  | "StartAuction"
  | "NominatePlayer"
  | "PlaceBid"
  | "DropBid"
  | "PauseAuction"
  | "ResumeAuction";

export interface Command {
  type: CommandType;
  clientId: string;
  seq: number;
  auctionId: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Events (append-only log)
// ---------------------------------------------------------------------------

export type EventType =
  | "auction.started"
  | "player.nominated"
  | "opening_bid.placed"
  | "bid.placed"
  | "bid.dropped"
  | "player.sold"
  | "player.unsold"
  | "auction.paused"
  | "auction.resumed"
  | "auction.complete"
  | "rule.violation"
  | "agent.timeout";

export interface AuctionEvent {
  eventId: string;
  auctionId: string;
  seq: number;
  type: EventType;
  agentId: AgentId | null;
  payload: Record<string, unknown>;
  timestamp: string;
}
