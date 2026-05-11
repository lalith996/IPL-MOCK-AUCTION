-- Migration 005: Human player team support
-- Stores which franchise team a human player controls in a session.
-- NULL = fully automated (all 10 teams are LLM-controlled).

ALTER TABLE auction_sessions
  ADD COLUMN IF NOT EXISTS human_team TEXT
  CHECK (human_team IN ('MI','CSK','RCB','DC','KKR','RR','PBKS','SRH','LSG','GT'));
