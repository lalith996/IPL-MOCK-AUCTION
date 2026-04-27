-- Migration 003: Idempotency table + auction_events event_id column
--
-- event-store.ts inserts using column name "event_id" but 002 defines the
-- primary key as "id".  We add event_id as a stable alias so the TypeScript
-- EventStore works without touching existing data.
--
-- Also adds the processed_commands table used by EventStore.isCommandProcessed /
-- markCommandProcessed for idempotent command deduplication.

-- ── uuid-ossp is required for uuid_generate_v4() ──────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Fix auction_events: expose event_id column that event-store.ts writes to ──
ALTER TABLE auction_events
    ADD COLUMN IF NOT EXISTS event_id UUID NOT NULL DEFAULT uuid_generate_v4();

CREATE UNIQUE INDEX IF NOT EXISTS auction_events_event_id_idx
    ON auction_events (event_id);

-- ── Idempotency table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_commands (
    id           BIGSERIAL PRIMARY KEY,
    client_id    TEXT    NOT NULL,
    client_seq   BIGINT  NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, client_seq)
);

CREATE INDEX IF NOT EXISTS processed_commands_lookup
    ON processed_commands (client_id, client_seq);
