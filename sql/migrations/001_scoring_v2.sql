-- Migration 001: Safety Score, Parent Clarity Index, Crawl Transparency, Education Classification
-- Apply on top of sql/schema.sql
-- Usage: psql -f sql/migrations/001_scoring_v2.sql

BEGIN;

-- ============================================================
-- 1. Add crawl stats & extended status to analysis_sessions
-- ============================================================
ALTER TABLE analysis_sessions
  ADD COLUMN IF NOT EXISTS pages_scanned       INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdfs_scanned        INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS images_scanned      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_depth_reached   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS structured_data_detected BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scan_duration_ms    INT,
  ADD COLUMN IF NOT EXISTS scan_confidence     INT,
  ADD COLUMN IF NOT EXISTS scan_confidence_label TEXT;

-- status now supports: Queued, Classifying, Crawling, Scoring, Ready, Rejected

-- ============================================================
-- 2. Education classification (pre-scan filter)
-- ============================================================
CREATE TABLE IF NOT EXISTS education_classification (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL UNIQUE REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  is_educational BOOLEAN NOT NULL,
  confidence     FLOAT NOT NULL,
  matched_keywords JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_education_classification_session
  ON education_classification(session_id);

-- ============================================================
-- 3. Safety & Transparency Score
-- ============================================================
CREATE TABLE IF NOT EXISTS safety_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL UNIQUE REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  total_score           INT NOT NULL DEFAULT 0,
  fire_certificate      TEXT NOT NULL DEFAULT 'missing' CHECK (fire_certificate      IN ('found','missing','unclear')),
  sanitary_certificate  TEXT NOT NULL DEFAULT 'missing' CHECK (sanitary_certificate  IN ('found','missing','unclear')),
  cctv_mention          TEXT NOT NULL DEFAULT 'missing' CHECK (cctv_mention          IN ('found','missing','unclear')),
  transport_safety      TEXT NOT NULL DEFAULT 'missing' CHECK (transport_safety      IN ('found','missing','unclear')),
  anti_bullying_policy  TEXT NOT NULL DEFAULT 'missing' CHECK (anti_bullying_policy  IN ('found','missing','unclear')),
  badge_level           TEXT NOT NULL DEFAULT 'not_found' CHECK (badge_level IN ('verified','partial','not_found')),
  raw_evidence          JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_scores_session
  ON safety_scores(session_id);

-- ============================================================
-- 4. Parent Clarity Index
-- ============================================================
CREATE TABLE IF NOT EXISTS clarity_scores (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID NOT NULL UNIQUE REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  total_score              INT NOT NULL DEFAULT 0,
  admission_dates_visible  BOOLEAN NOT NULL DEFAULT FALSE,
  fee_clarity              BOOLEAN NOT NULL DEFAULT FALSE,
  academic_calendar        BOOLEAN NOT NULL DEFAULT FALSE,
  contact_and_map          BOOLEAN NOT NULL DEFAULT FALSE,
  results_published        BOOLEAN NOT NULL DEFAULT FALSE,
  clarity_label            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clarity_scores_session
  ON clarity_scores(session_id);

-- ============================================================
-- 5. B2B Leads (bonus CTA tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b_leads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_b2b_leads_session
  ON b2b_leads(session_id);

COMMIT;
