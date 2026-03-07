-- Migration 006: Mandatory CBSE document audit storage
-- Usage: psql $DATABASE_URL -f sql/migrations/006_mandatory_documents.sql

BEGIN;

CREATE TABLE IF NOT EXISTS school_mandatory_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id UUID REFERENCES analysis_sessions(id) ON DELETE SET NULL,

  document_code VARCHAR(80) NOT NULL,
  document_name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'missing', 'needs_review')),

  source_url VARCHAR(500),
  expiry_date DATE,
  extracted_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_message VARCHAR(500),
  confidence SMALLINT NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),

  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, document_code)
);

CREATE INDEX IF NOT EXISTS idx_school_docs_school ON school_mandatory_documents(school_id);
CREATE INDEX IF NOT EXISTS idx_school_docs_session ON school_mandatory_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_school_docs_status ON school_mandatory_documents(status);
CREATE INDEX IF NOT EXISTS idx_school_docs_expiry ON school_mandatory_documents(expiry_date);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_school_docs_updated_at') THEN
    CREATE TRIGGER trg_school_docs_updated_at
    BEFORE UPDATE ON school_mandatory_documents
    FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
  END IF;
END $$;

COMMIT;
