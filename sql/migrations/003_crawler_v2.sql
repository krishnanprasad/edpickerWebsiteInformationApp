-- Migration 003: Crawler V2 — crawl_facts, crawl_queue, new session columns
-- Supports: Cheerio-first crawling, fact extraction, crash-safe resume, SSE streaming
-- Usage: psql -f sql/migrations/003_crawler_v2.sql

BEGIN;

-- ============================================================
-- 1. crawl_facts — idempotent per-fact storage with fingerprint dedup
-- ============================================================
CREATE TABLE IF NOT EXISTS crawl_facts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  fact_key    VARCHAR(100) NOT NULL,
  fact_value  TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 0.5,
  source_url  TEXT,
  source_type VARCHAR(30) NOT NULL DEFAULT 'inner_page',
  fingerprint CHAR(64) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_facts_session
  ON crawl_facts(session_id);
CREATE INDEX IF NOT EXISTS idx_crawl_facts_key
  ON crawl_facts(session_id, fact_key);

-- ============================================================
-- 2. crawl_queue — crash-safe URL queue for resumable crawling
-- ============================================================
CREATE TABLE IF NOT EXISTS crawl_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  url_hash          CHAR(64) NOT NULL,
  tier              INT NOT NULL DEFAULT 2,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','done','failed','skipped')),
  cheerio_tried     BOOLEAN NOT NULL DEFAULT FALSE,
  playwright_tried  BOOLEAN NOT NULL DEFAULT FALSE,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, url_hash)
);

CREATE INDEX IF NOT EXISTS idx_crawl_queue_session
  ON crawl_queue(session_id);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_pending
  ON crawl_queue(session_id, status, tier);

-- ============================================================
-- 3. New columns on analysis_sessions for V2 crawl tracking
-- ============================================================
ALTER TABLE analysis_sessions
  ADD COLUMN IF NOT EXISTS crawl_phase          VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS heartbeat_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preliminary_score    INT,
  ADD COLUMN IF NOT EXISTS facts_extracted      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urls_discovered      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS playwright_budget_used INT DEFAULT 0;

COMMIT;
