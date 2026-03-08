-- Migration 008: Async AI audit metadata and log table
-- Usage: psql $DATABASE_URL -f sql/migrations/008_ai_audit.sql

BEGIN;

ALTER TABLE analysis_sessions
  ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analysis_sessions_audit_status_check'
  ) THEN
    ALTER TABLE analysis_sessions
      ADD CONSTRAINT analysis_sessions_audit_status_check
      CHECK (audit_status IN ('pending', 'completed', 'failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  model VARCHAR(120),
  audit_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_log_session ON ai_audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_created_at ON ai_audit_log(created_at DESC);

COMMIT;
