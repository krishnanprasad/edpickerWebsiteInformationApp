-- Migration 002: Add early_identity JSONB column to analysis_sessions
-- Stores homepage-extracted identity signals (social URLs, principal, founding year, vision/mission)
-- populated immediately after the homepage is crawled, before the full crawl completes.

BEGIN;

ALTER TABLE analysis_sessions
  ADD COLUMN IF NOT EXISTS early_identity JSONB;

COMMIT;
