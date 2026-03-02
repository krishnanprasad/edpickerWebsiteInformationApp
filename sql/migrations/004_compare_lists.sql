-- Migration 004: Compare Lists (3-slot) — anonymous server-stored compare lists
-- Stores up to 3 analysis_sessions per list for side-by-side comparisons.
-- Usage: psql -f sql/migrations/004_compare_lists.sql

BEGIN;

CREATE TABLE IF NOT EXISTS compare_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compare_list_items (
  compare_list_id UUID NOT NULL REFERENCES compare_lists(id) ON DELETE CASCADE,
  slot            INT  NOT NULL CHECK (slot IN (1,2,3)),
  session_id      UUID NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  url_hash        CHAR(64) NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (compare_list_id, slot)
);

-- Prevent duplicates within a list (same URL hash cannot be added twice)
CREATE UNIQUE INDEX IF NOT EXISTS ux_compare_list_items_list_urlhash
  ON compare_list_items(compare_list_id, url_hash);

CREATE INDEX IF NOT EXISTS idx_compare_list_items_list
  ON compare_list_items(compare_list_id);

COMMIT;
