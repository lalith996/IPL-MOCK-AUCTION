// AUTO-GENERATED — do not edit manually.
// Run `make schemas` to regenerate.

/**
 * Append-only event log entry for the event-sourced auction.
 */
export interface AuctionEvent {
  event_id: string;
  auction_id: string;
  /**
   * Monotonically increasing sequence number per auction_id.
   */
  seq: number;
  type:
    | "auction.started"
    | "auction.paused"
    | "auction.resumed"
    | "auction.ended"
    | "player.nominated"
    | "bid.placed"
    | "bid.raised"
    | "bid.dropped"
    | "bid.rejected"
    | "player.sold"
    | "player.unsold"
    | "agent.timeout"
    | "agent.cooldown"
    | "snapshot.taken";
  /**
   * Event-type-specific data. Shape depends on 'type'.
   */
  payload: {};
  timestamp: string;
  /**
   * Present when the event is agent-specific.
   */
  agent_id?: "MI" | "CSK" | "RCB" | "DC" | "KKR" | "RR" | "PBKS" | "SRH" | "LSG" | "GT" | null;
}
