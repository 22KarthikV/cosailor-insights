-- Run this in Supabase SQL Editor (Settings → SQL Editor → New query)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE leads (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- GAF scraped data
  company_name         TEXT          NOT NULL,
  gaf_contractor_id    TEXT          UNIQUE,
  address              TEXT,
  city                 TEXT,
  state                TEXT,
  postal_code          TEXT,
  country_code         TEXT          DEFAULT 'us',
  phone                TEXT,
  website              TEXT,
  gaf_profile_url      TEXT,
  certifications       TEXT[]        DEFAULT '{}',
  years_in_business    INTEGER,
  service_area         TEXT,
  rating               NUMERIC(3,2),
  review_count         INTEGER,
  -- Perplexity research
  research_summary     TEXT,
  research_sources     TEXT[]        DEFAULT '{}',
  -- Claude AI insights
  lead_score           INTEGER       CHECK (lead_score BETWEEN 1 AND 10),
  score_rationale      TEXT,
  ai_summary           TEXT,
  talking_points       TEXT[]        DEFAULT '{}',
  recommended_approach TEXT,
  -- Pipeline state
  status               TEXT          NOT NULL DEFAULT 'scraped'
                       CHECK (status IN ('scraped', 'researched', 'enriched', 'failed')),
  error_message        TEXT,
  -- Timestamps
  scraped_at           TIMESTAMPTZ   DEFAULT NOW(),
  researched_at        TIMESTAMPTZ,
  enriched_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_leads_lead_score ON leads (lead_score DESC NULLS LAST);
CREATE INDEX idx_leads_status     ON leads (status);

-- RLS: disabled for both tables — this is a backend-only service (FastAPI is the
-- sole client). All access goes through the service_role key; user-level RLS is
-- not needed and causes INSERT/UPDATE to be blocked when no policy matches.
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;

CREATE TABLE pipeline_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  status         TEXT        NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'completed', 'failed')),
  postal_code    TEXT,
  country_code   TEXT,
  distance       INTEGER,
  leads_scraped  INTEGER     DEFAULT 0,
  leads_enriched INTEGER     DEFAULT 0,
  error_message  TEXT
);

ALTER TABLE pipeline_runs DISABLE ROW LEVEL SECURITY;
