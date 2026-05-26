# Instalily Cosailor Insights — Project Rules for Claude

## What We're Building
B2B sales intelligence platform for a roofing distributor sales team.
- Scrapes GAF contractor directory (configurable postal code, country, distance)
- Enriches each lead: Firecrawl → Perplexity → Claude (claude-haiku-4-5)
- Displays leads in a Next.js 15 dashboard with a pipeline trigger button

## Stack
- Frontend: Next.js 15 App Router, Tailwind CSS, shadcn/ui — port 3000
- Backend: Python 3.14, FastAPI, uvicorn — port 8000
- Database: Supabase PostgreSQL (supabase-py)
- Pipeline APIs: Firecrawl, Perplexity, Anthropic

## GAF URL Format (ALWAYS use this pattern — never hardcode values)
https://www.gaf.com/en-us/roofing-contractors/commercial?postalCode={postal_code}&countryCode={country_code}&distance={distance}

Supported distances: 25, 50, 100 (miles)
Default: postalCode=10013, countryCode=us, distance=25

## Vertical Build Strategy
Each phase is a complete vertical slice touching frontend + backend + DB.
DO NOT build all backend first and then all frontend.
After every phase the app must be in a demo-able state.

Phase 0: Foundation (skeleton + CLAUDE.md files + DDL)
Phase 1: First Lead — 1 contractor scraped → stored → displayed (no AI)
Phase 2: Enriched Lead — 1 lead enriched Perplexity + Claude → score visible in UI
Phase 3: Full Pipeline — batch + pipeline button + status polling
Phase 4: Lead Detail — full detail page

## Architecture Decisions (DO NOT CHANGE)
- Pipeline runs as FastAPI BackgroundTask. POST /api/pipeline/run returns 202 immediately.
- Frontend polls GET /api/pipeline/status/{run_id} every 3 seconds.
- On completion, frontend calls router.refresh() to reload Server Component.
- All external API calls live in services/ ONLY.
- All DB access lives in repositories/ ONLY. Routers NEVER touch Supabase directly.
- Repository methods: get_all_leads / get_lead_by_id / upsert_contractor / update_research / update_enrichment / mark_lead_failed

## TDD Rules
1. Write the failing test FIRST — every feature
2. Run test and confirm it FAILS (RED)
3. Write minimum code to pass (GREEN)
4. Refactor, verify tests still pass
5. Commit after each phase

## Code Rules
- NEVER hardcode API keys, postal codes, distances — always use config/env
- NEVER mutate objects — return new copies
- Functions max 50 lines
- Files max 400 lines
- ALWAYS handle errors explicitly
- Backend: async/await everywhere
- Frontend: Server Components by default, 'use client' only for useState/useEffect/events

## Environment Variable Names (exact)
Backend (.env):
  SUPABASE_URL=
  SUPABASE_KEY=
  FIRECRAWL_API_KEY=
  PERPLEXITY_API_KEY=
  ANTHROPIC_API_KEY=

Frontend (.env.local):
  NEXT_PUBLIC_API_URL=http://localhost:8000
