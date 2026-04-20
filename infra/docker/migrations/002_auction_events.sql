-- Migration 002: Event-sourced auction log and session tables

-- ── Auction sessions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auction_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seed            BIGINT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'prep'
                    CHECK (status IN ('prep', 'active', 'paused', 'ended')),
    player_pool     TEXT[] NOT NULL DEFAULT '{}',
    config          JSONB NOT NULL DEFAULT '{}',
    leader_node     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER auction_sessions_updated_at
    BEFORE UPDATE ON auction_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Append-only auction events ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auction_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auction_id  UUID NOT NULL REFERENCES auction_sessions (id),
    seq         BIGINT NOT NULL,
    type        TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    agent_id    TEXT,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (auction_id, seq)
);

CREATE INDEX IF NOT EXISTS auction_events_auction_id_seq ON auction_events (auction_id, seq);
CREATE INDEX IF NOT EXISTS auction_events_type_idx ON auction_events (type);

-- ── Auction snapshots (periodic, for fast reconnect) ──────────────────────────

CREATE TABLE IF NOT EXISTS auction_snapshots (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auction_id  UUID NOT NULL REFERENCES auction_sessions (id),
    seq         BIGINT NOT NULL,
    state       JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (auction_id, seq)
);

CREATE INDEX IF NOT EXISTS auction_snapshots_auction_id ON auction_snapshots (auction_id, seq DESC);

-- ── Audit log (append-only, Merkle-checkable) ────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    auction_id  UUID NOT NULL,
    event_id    UUID NOT NULL,
    action      TEXT NOT NULL,
    actor       TEXT,
    payload     JSONB NOT NULL DEFAULT '{}',
    inputs_hash TEXT NOT NULL,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_auction_id ON audit_log (auction_id);
CREATE INDEX IF NOT EXISTS audit_log_timestamp ON audit_log (timestamp);
