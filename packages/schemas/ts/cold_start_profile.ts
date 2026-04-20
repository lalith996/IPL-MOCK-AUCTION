// AUTO-GENERATED — do not edit manually.
// Run `make schemas` to regenerate.

/**
 * Imputed feature vector for a player with data_coverage_score < 0.5.
 */
export interface ColdStartProfile {
  player_id: string;
  cold_start_profile: {
    /**
     * @minItems 1
     */
    cohort_ids: [string, ...string[]];
    cohort_size: number;
    imputed_metrics: {
      strike_rate: number;
      economy: number;
      role_fit: number;
    };
    /**
     * @minItems 1
     */
    source_signals: [
      "domestic_scorecards" | "scout_reports" | "auction_history" | "declared_role",
      ...("domestic_scorecards" | "scout_reports" | "auction_history" | "declared_role")[]
    ];
    data_coverage_score: number;
    imputation_confidence: number;
  };
  confidence: number;
  /**
   * @minItems 1
   */
  provenance: [
    {
      source: string;
      fetched_at: string;
      type: string;
    },
    ...{
      source: string;
      fetched_at: string;
      type: string;
    }[]
  ];
}
