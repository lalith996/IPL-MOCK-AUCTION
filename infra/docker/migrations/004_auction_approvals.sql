-- Migration 004: Operator approval gates for auction start
--
-- The admin BFF enforces that an operator approves both the missing-players
-- report and the headshot ingestion report before a session can start.
-- This table tracks those approvals per auction session.

CREATE TABLE IF NOT EXISTS auction_approvals (
    auction_id                UUID PRIMARY KEY
                              REFERENCES auction_sessions (id) ON DELETE CASCADE,
    missing_players_approved  BOOLEAN NOT NULL DEFAULT FALSE,
    headshots_approved        BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by               TEXT,
    approved_at               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER auction_approvals_updated_at
    BEFORE UPDATE ON auction_approvals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- When a session is created, insert a pending approval row automatically
CREATE OR REPLACE FUNCTION _insert_approval_on_session_create()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO auction_approvals (auction_id)
    VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER auction_session_create_approval
    AFTER INSERT ON auction_sessions
    FOR EACH ROW EXECUTE FUNCTION _insert_approval_on_session_create();
