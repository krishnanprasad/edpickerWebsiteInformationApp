-- Migration 009: Paid reports pipeline v1
-- Usage: psql $DATABASE_URL -f sql/migrations/009_paid_reports_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS admin_runtime_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pin_code CHAR(6) NOT NULL CHECK (pin_code ~ '^[0-9]{6}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_admin_runtime_pins_active
  ON admin_runtime_pins(is_active, expires_at DESC);

CREATE TABLE IF NOT EXISTS paid_report_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  analysis_session_id UUID REFERENCES analysis_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'awaiting_admin_pdf', 'completed', 'failed', 'stopped')),
  preflight_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  crawl_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  social_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  google_reviews_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  openai_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  gemini_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  claude_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_audit_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  overall_score INT,
  limited_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  pdf_url TEXT,
  access_code CHAR(8) CHECK (access_code IS NULL OR access_code ~ '^[0-9]{8}$'),
  access_code_used_at TIMESTAMPTZ,
  total_runtime_ms INT,
  reasoning_runtime_ms INT,
  queue_wait_ms INT,
  error_message TEXT,
  admin_name TEXT,
  admin_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_paid_report_sessions_school
  ON paid_report_sessions(school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paid_report_sessions_status
  ON paid_report_sessions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS paid_report_step_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_session_id UUID NOT NULL REFERENCES paid_report_sessions(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt_no INT NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_ms INT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paid_report_step_metrics_report
  ON paid_report_step_metrics(report_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paid_report_model_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_session_id UUID NOT NULL REFERENCES paid_report_sessions(id) ON DELETE CASCADE,
  layer_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed', 'fallback_used', 'skipped')),
  input_tokens INT,
  output_tokens INT,
  total_tokens INT,
  duration_ms INT,
  error_message TEXT,
  request_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paid_report_model_runs_report
  ON paid_report_model_runs(report_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paid_report_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_session_id UUID NOT NULL REFERENCES paid_report_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  admin_name TEXT,
  admin_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paid_report_events_report
  ON paid_report_events(report_session_id, created_at DESC);

COMMIT;
