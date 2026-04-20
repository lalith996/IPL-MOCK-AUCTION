// AUTO-GENERATED — do not edit manually.
// Run `make schemas` to regenerate.

/**
 * Current snapshot of the auction, rebuilt from the event log.
 */
export interface AuctionState {
  auction_id: string;
  phase: "prep" | "nominating" | "opening_bid" | "open_bidding" | "closing" | "sold" | "unsold" | "ended";
  current_player?: {
    player_id: string;
    base_price: number;
    current_bid: number;
    current_bidder: string | null;
    bid_count: number;
  } | null;
  /**
   * @maxItems 2
   */
  active_bidders?: [] | [string] | [string, string];
  standby_queue?: string[];
  /**
   * Keyed by agent_id.
   */
  teams: {
    [k: string]:
      | {
          budget_remaining: number;
          squad: {
            player_id: string;
            price_paid: number;
            role: string;
            is_overseas: boolean;
          }[];
          overseas_count: number;
          warnings: number;
        }
      | undefined;
  };
  nomination_order: string[];
  sold_players: string[];
  unsold_players: string[];
  remaining_pool: string[];
  last_event_seq?: number;
  seed?: number;
}
