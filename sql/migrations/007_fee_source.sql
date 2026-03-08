-- Migration 007: Add fee source tracking to clarity scores
-- Usage: psql $DATABASE_URL -f sql/migrations/007_fee_source.sql

BEGIN;

ALTER TABLE clarity_scores
  ADD COLUMN IF NOT EXISTS fee_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clarity_scores_fee_source_check'
  ) THEN
    ALTER TABLE clarity_scores
      ADD CONSTRAINT clarity_scores_fee_source_check
      CHECK (fee_source IS NULL OR fee_source IN ('html', 'pdf', 'secondary_html'));
  END IF;
END $$;

COMMIT;
