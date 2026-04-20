// AUTO-GENERATED — do not edit manually.
// Run `make schemas` to regenerate.

/**
 * Versioned feature vector for a player, derived from Cricsheet ETL.
 */
export interface PlayerFeatureV1 {
  player_id: string;
  canonical_name: string;
  role: "batter" | "bowler" | "all-rounder" | "keeper";
  role_subtype?: "opener" | "anchor" | "finisher" | "pp-spinner" | "death-bowler" | "all-rounder" | "keeper";
  nationality: string;
  is_overseas: boolean;
  data_coverage_score: number;
  feature_version: string;
  career: StatsBlock;
  form_5?: StatsBlock;
  form_10?: StatsBlock;
  form_20?: StatsBlock;
  phase_metrics?: {
    powerplay?: PhaseBlock;
    middle?: PhaseBlock;
    death?: PhaseBlock;
  };
  specialist_ratings?: {
    death_bowler?: number;
    powerplay_batter?: number;
    powerplay_bowler?: number;
    anchor?: number;
    finisher?: number;
  };
  /**
   * Keyed by ground name.
   */
  venue_splits?: {
    [k: string]: StatsBlock;
  };
  /**
   * Base price in INR (e.g., 2000000 = 20L).
   */
  base_price_tier?: number;
  form_score?: number;
  value_score?: number;
}
export interface StatsBlock {
  matches?: number;
  innings?: number;
  runs?: number;
  balls_faced?: number;
  average?: number;
  strike_rate?: number;
  hundreds?: number;
  fifties?: number;
  fours?: number;
  sixes?: number;
  boundary_pct?: number;
  dot_pct?: number;
  wickets?: number;
  economy?: number;
  bowling_avg?: number;
  bowling_sr?: number;
}
export interface PhaseBlock {
  sr?: number;
  economy?: number;
  wickets?: number;
}
