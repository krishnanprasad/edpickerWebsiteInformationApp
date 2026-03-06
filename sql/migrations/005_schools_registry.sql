-- Migration 005: Permanent schools registry + field-level provenance metadata
-- Usage: psql $DATABASE_URL -f sql/migrations/005_schools_registry.sql

BEGIN;

CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(250) NOT NULL UNIQUE,
  established_year INTEGER CHECK (established_year BETWEEN 1800 AND 2100),

  address_line1 VARCHAR(300),
  address_line2 VARCHAR(300),
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),

  phone_primary VARCHAR(20),
  phone_secondary VARCHAR(20),
  email_primary VARCHAR(200),
  email_secondary VARCHAR(200),
  website_url VARCHAR(500) NOT NULL UNIQUE,

  principal_name VARCHAR(200),
  principal_email VARCHAR(200),
  principal_phone VARCHAR(20),

  admission_contact_name VARCHAR(200),
  admission_contact_phone VARCHAR(20),
  admission_contact_email VARCHAR(200),
  admission_procedure TEXT,
  max_admissions_per_year INTEGER,

  board VARCHAR(50) CHECK (board IN ('CBSE', 'ICSE', 'STATE', 'IB', 'IGCSE', 'NIOS', 'OTHER')),
  affiliation_number VARCHAR(50),
  school_type VARCHAR(50) CHECK (school_type IN ('Primary', 'Secondary', 'Senior Secondary', 'Primary+Secondary', 'All (K-12)')),
  gender_type VARCHAR(20) CHECK (gender_type IN ('Boys', 'Girls', 'Co-ed')),
  medium_of_instruction VARCHAR(100),
  management_type VARCHAR(50) CHECK (management_type IN (
    'Private Unaided', 'Private Aided', 'Government', 'Government Aided',
    'Central Government', 'Minority', 'Trust'
  )),

  social_facebook VARCHAR(500),
  social_instagram VARCHAR(500),
  social_youtube VARCHAR(500),
  social_twitter VARCHAR(500),
  social_linkedin VARCHAR(500),
  social_whatsapp VARCHAR(20),

  vision_text TEXT,
  mission_text TEXT,
  motto_text VARCHAR(200),
  summary_text TEXT,

  crawl_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (crawl_status IN ('pending', 'crawling', 'analysed', 'failed', 'partial')),
  data_source VARCHAR(30) NOT NULL DEFAULT 'crawl' CHECK (data_source IN ('crawl', 'csv_upload', 'manual', 'google_search')),
  raw_input_url VARCHAR(500),
  last_crawled_at TIMESTAMPTZ,
  crawl_fail_reason VARCHAR(500),

  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  compare_count INTEGER NOT NULL DEFAULT 0 CHECK (compare_count >= 0),
  search_count INTEGER NOT NULL DEFAULT 0 CHECK (search_count >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_schools_phone_primary_fmt CHECK (phone_primary IS NULL OR phone_primary ~ '^\+?[0-9]{7,20}$'),
  CONSTRAINT chk_schools_phone_secondary_fmt CHECK (phone_secondary IS NULL OR phone_secondary ~ '^\+?[0-9]{7,20}$'),
  CONSTRAINT chk_schools_principal_phone_fmt CHECK (principal_phone IS NULL OR principal_phone ~ '^\+?[0-9]{7,20}$'),
  CONSTRAINT chk_schools_admission_phone_fmt CHECK (admission_contact_phone IS NULL OR admission_contact_phone ~ '^\+?[0-9]{7,20}$'),
  CONSTRAINT chk_schools_social_whatsapp_fmt CHECK (social_whatsapp IS NULL OR social_whatsapp ~ '^[0-9]{7,20}$'),
  CONSTRAINT chk_schools_website_domain_only CHECK (website_url = lower(website_url) AND website_url !~ '^https?://'),
  CONSTRAINT chk_schools_vision_len CHECK (vision_text IS NULL OR char_length(vision_text) <= 600),
  CONSTRAINT chk_schools_mission_len CHECK (mission_text IS NULL OR char_length(mission_text) <= 600),
  CONSTRAINT chk_schools_summary_len CHECK (summary_text IS NULL OR char_length(summary_text) <= 1200)
);

CREATE TABLE IF NOT EXISTS school_field_meta (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  field_name VARCHAR(64) NOT NULL,
  confidence SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  source_url VARCHAR(500),
  source_type VARCHAR(30),
  last_session_id UUID REFERENCES analysis_sessions(id) ON DELETE SET NULL,
  is_manually_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_schools_city ON schools(city);
CREATE INDEX IF NOT EXISTS idx_schools_state ON schools(state);
CREATE INDEX IF NOT EXISTS idx_schools_board ON schools(board);
CREATE INDEX IF NOT EXISTS idx_schools_crawl_status ON schools(crawl_status);
CREATE INDEX IF NOT EXISTS idx_schools_last_crawled_at ON schools(last_crawled_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_field_meta_session ON school_field_meta(last_session_id);
CREATE INDEX IF NOT EXISTS idx_school_field_meta_manual ON school_field_meta(school_id, is_manually_verified);

CREATE OR REPLACE FUNCTION set_row_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_schools_updated_at') THEN
    CREATE TRIGGER trg_schools_updated_at
    BEFORE UPDATE ON schools
    FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_school_field_meta_updated_at') THEN
    CREATE TRIGGER trg_school_field_meta_updated_at
    BEFORE UPDATE ON school_field_meta
    FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
  END IF;
END $$;

COMMIT;
