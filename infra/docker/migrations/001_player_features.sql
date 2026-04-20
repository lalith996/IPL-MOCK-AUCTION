-- Migration 001: Player features table and cold-start profiles
-- Applied by: make db-migrate

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── Player features (Cricsheet ETL output) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS player_features (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id             TEXT NOT NULL UNIQUE,
    canonical_name        TEXT NOT NULL,
    feature_version       TEXT NOT NULL DEFAULT 'feature_v1',
    role                  TEXT NOT NULL CHECK (role IN ('batter', 'bowler', 'all-rounder', 'keeper')),
    role_subtype          TEXT,
    nationality           TEXT NOT NULL,
    is_overseas           BOOLEAN NOT NULL DEFAULT false,
    data_coverage_score   NUMERIC(4, 3) NOT NULL CHECK (data_coverage_score BETWEEN 0 AND 1),
    base_price_tier       BIGINT NOT NULL DEFAULT 2000000,
    form_score            NUMERIC(5, 2) NOT NULL DEFAULT 50,
    value_score           NUMERIC(5, 2) NOT NULL DEFAULT 50,
    -- JSONB blobs for flexible nested stats
    career_stats          JSONB NOT NULL DEFAULT '{}',
    form_5                JSONB NOT NULL DEFAULT '{}',
    form_10               JSONB NOT NULL DEFAULT '{}',
    form_20               JSONB NOT NULL DEFAULT '{}',
    phase_metrics         JSONB NOT NULL DEFAULT '{}',
    specialist_ratings    JSONB NOT NULL DEFAULT '{}',
    venue_splits          JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS player_features_player_id_idx ON player_features (player_id);
CREATE INDEX IF NOT EXISTS player_features_role_idx ON player_features (role);
CREATE INDEX IF NOT EXISTS player_features_coverage_idx ON player_features (data_coverage_score);
CREATE INDEX IF NOT EXISTS player_features_name_trgm ON player_features USING GIN (canonical_name gin_trgm_ops);

-- ── Cold-start profiles ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cold_start_profiles (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id               TEXT NOT NULL UNIQUE REFERENCES player_features (player_id),
    cohort_ids              TEXT[] NOT NULL,
    cohort_size             INTEGER NOT NULL CHECK (cohort_size > 0),
    imputed_metrics         JSONB NOT NULL DEFAULT '{}',
    source_signals          TEXT[] NOT NULL,
    imputation_confidence   NUMERIC(4, 3) NOT NULL CHECK (imputation_confidence BETWEEN 0 AND 1),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cold_start_player_id_idx ON cold_start_profiles (player_id);

-- ── Headshot metadata ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS headshot_metadata (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id   TEXT NOT NULL UNIQUE,
    sizes       JSONB NOT NULL,
    blurhash    TEXT NOT NULL,
    source      TEXT NOT NULL,
    license     TEXT NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL,
    is_fallback BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS headshot_player_id_idx ON headshot_metadata (player_id);

-- ── Update trigger ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER player_features_updated_at
    BEFORE UPDATE ON player_features
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER cold_start_profiles_updated_at
    BEFORE UPDATE ON cold_start_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
