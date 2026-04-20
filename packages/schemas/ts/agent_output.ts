// AUTO-GENERATED — do not edit manually.
// Run `make schemas` to regenerate.

/**
 * Output produced by one team LLM agent per nomination.
 */
export interface AgentOutput {
  /**
   * Franchise identifier.
   */
  agent_id: "MI" | "CSK" | "RCB" | "DC" | "KKR" | "RR" | "PBKS" | "SRH" | "LSG" | "GT";
  /**
   * ISO-8601 UTC timestamp of when the agent produced this output.
   */
  timestamp: string;
  /**
   * Canonical player identifier from the feature store.
   */
  player_id: string;
  /**
   * Action the agent has chosen for this nomination cycle.
   */
  action: "pass" | "bid" | "raise" | "drop";
  /**
   * Bid amount in INR. Must be null when action is 'pass' or 'drop'.
   */
  bid_amount?: number | null;
  /**
   * Confidence in the chosen action. Used to rank active bidders.
   */
  confidence_score: number;
  rationale: {
    score_breakdown: {
      form_score: number;
      role_fit: number;
      home_ground_fit: number;
      career_score: number;
      phase_fit: number;
      injury_risk: number;
      social_buzz: number;
      price_elasticity: number;
      total: number;
    };
    /**
     * Human-readable summary (≤80 words).
     */
    reasoning_summary: string;
    /**
     * True when data_coverage_score < 0.5 for this player (§16.1).
     */
    is_cold_start?: boolean;
  };
  /**
   * Which agent plan this action maps to.
   */
  chosen_plan: "A" | "B" | "C" | "D";
}
