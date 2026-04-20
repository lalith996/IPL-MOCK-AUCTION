// AUTO-GENERATED — do not edit manually.
// Run `make schemas` to regenerate.

/**
 * Structured player intelligence returned by the SAG service.
 */
export interface SagOutput {
  player_id: string;
  player_summary: string;
  last_12_innings_metrics?: {
    runs?: number;
    strike_rate?: number;
    average?: number;
    boundary_pct?: number;
    dot_pct?: number;
    wickets?: number;
    economy?: number;
    bowling_sr?: number;
  };
  situational_metrics?: {
    powerplay?: {
      sr?: number;
      economy?: number;
    };
    middle?: {
      sr?: number;
      economy?: number;
    };
    death?: {
      sr?: number;
      economy?: number;
    };
  };
  injury_status?: {
    source: string;
    timestamp: string;
    severity: "none" | "minor" | "moderate" | "major";
    expected_return?: string | null;
  };
  social_buzz?: {
    volume?: number;
    sentiment?: number;
    /**
     * @maxItems 5
     */
    top_sources?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string];
  };
  /**
   * Present when query_type is cold_start or player has data_coverage_score < 0.5.
   */
  cold_start_profile?: {
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
    source_signals: [string, ...string[]];
    data_coverage_score: number;
    imputation_confidence: number;
  };
  /**
   * Overall confidence in this response; degrades with source staleness.
   */
  confidence: number;
  /**
   * Fields that could not be populated due to missing source data.
   */
  missing_fields?: string[];
  /**
   * @minItems 1
   */
  provenance: [
    {
      source: string;
      fetched_at: string;
      type: "cricsheet" | "injury" | "social" | "api" | "cold_start" | "cache";
      stale?: boolean;
    },
    ...{
      source: string;
      fetched_at: string;
      type: "cricsheet" | "injury" | "social" | "api" | "cold_start" | "cache";
      stale?: boolean;
    }[]
  ];
}
