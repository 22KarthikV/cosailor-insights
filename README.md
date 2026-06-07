# Cosailor Insights — B2B Sales Intelligence Platform

AI-powered lead generation for roofing distributors. Scrapes the GAF commercial contractor directory, enriches each lead with real web research and Claude AI-generated sales insights, and presents actionable leads in a polished dark-themed dashboard.

---

## Screenshots

![Dashboard](dashboard-new.png)

---

## 3-Stage Pipeline

1. **Playwright + Coveo** — Headless browser scrapes the GAF contractor directory (bypasses Akamai Bot Manager), captures the Coveo search token, then paginates all results via direct API calls
2. **Perplexity Sonar** — Searches the web for contractor reputation, growth signals, and competitive intel
3. **Claude Haiku** — Generates a lead score (1–10), 2-3 sentence AI summary, 3 sales talking points, recommended approach, and a convertibility index

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 App Router, Tailwind CSS, TypeScript |
| Backend | Python 3.14, FastAPI, uvicorn |
| Database | Supabase PostgreSQL |
| Scraping | Playwright (headless Chromium) + Coveo REST API |
| Research | Perplexity Sonar API |
| AI Enrichment | Anthropic Claude Haiku (`claude-haiku-4-5`) |

---

## Features

### Dark Command Center UI
- **Color system**: near-black `#08090C` base, cyan `#00C8FF` accent, score-tier greens/ambers/reds
- **Typography**: Syne (headings), DM Sans (body), JetBrains Mono (data/scores)
- **Animated score rings**: SVG arcs that animate from 0 → score on card mount, color-coded by tier
- **Card hover states**: Y-lift + priority-colored border glow

### Mission Terminal Modal
Full-screen overlay that opens automatically when the pipeline starts:
- **3 stage nodes** (SCRAPE → RESEARCH → ENRICH) with live glow animations and flow particles
- **Scrolling terminal log** with pre-scripted lines at timed intervals, personalised with real scrape/enrich counts
- **Live stats** panel: scraped count, enriched count, throughput (leads/min), elapsed timer
- **MISSION COMPLETE** banner with green bloom when pipeline finishes
- Rendered via React Portal to guarantee full-screen coverage regardless of page stacking context

### Lead Detail Page
Two-column layout with sticky score panel:
- AI Summary, 3 Talking Points, Recommended Approach, Sales Opportunity Signals
- Collapsible Web Research card (raw Perplexity output)
- Dual score rings (Lead Score + Convertibility Index)
- Distance band + priority index stat chips

### Pipeline Controls
- ZIP code + distance (25/50/100 mi) inputs directly in the sticky header
- Run state persists across page refresh (localStorage + latest-run API)
- Retry button on interrupted/failed runs
- Real-time enriched-count progress bar

### Filtering & Pagination
- Server-side score-tier filter (All / High 8–10 / Medium 5–7 / Low 1–4)
- Sort by: Score ↓, Name A–Z, Recently Enriched
- URL-driven state (shareable links)
- Configurable per-page (12 / 24 / 48)

---

## Setup

### Prerequisites
- Python 3.14+, Node.js 18+
- Supabase project (free tier works)
- API keys: Perplexity, Anthropic
- Playwright Chromium: `playwright install chromium`

### 1. Database
Run the DDL in your Supabase SQL Editor (see `backend/app/db/schema.sql`).

### 2. Backend
```bash
cd backend
cp .env.example .env   # fill in your keys
pip install -r requirements.txt
playwright install chromium
uvicorn app.main:app --reload   # http://localhost:8000
```

Required environment variables:
```
SUPABASE_URL=
SUPABASE_KEY=
PERPLEXITY_API_KEY=
ANTHROPIC_API_KEY=
```

### 3. Frontend
```bash
cd frontend
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_URL
npm install
npm run dev   # http://localhost:3000
```

Required environment variable:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Open **http://localhost:3000** and click **⚡ Run Pipeline**.

---

## Pipeline Configuration

| Parameter | Default | Options |
|---|---|---|
| `postal_code` | `10013` | any US ZIP code |
| `country_code` | `us` | `us` |
| `distance` | `25` | `25`, `50`, `100` miles |

```bash
curl -X POST http://localhost:8000/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"postal_code": "90210", "country_code": "us", "distance": 50}'
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/leads/` | List leads (score_tier, sort_by, page, limit) |
| GET | `/api/leads/{id}` | Single lead detail |
| POST | `/api/pipeline/run` | Start pipeline → 202 + `run_id` |
| GET | `/api/pipeline/status/{run_id}` | Poll run status |
| GET | `/api/pipeline/latest` | Latest run (for page-refresh restore) |

---

## Architecture

```
Frontend (Next.js 15 App Router)
  DashboardPage (Server Component) ──→ GET /api/leads/ (SSR)
  PipelineControls (Client) ──────────→ POST /api/pipeline/run
  [polls every 3s] ───────────────────→ GET /api/pipeline/status/{id}
  PipelineMissionModal (Portal) ──────→ Full-screen live progress overlay
  LeadCard ───────────────────────────→ /leads/[id] (Server Component)

Backend (FastAPI + BackgroundTask)
  PlaywrightScraper ──→ Playwright browser → GAF + Coveo API → contractor records
  ContractorResearcher → Perplexity Sonar → per-contractor web research
  LeadEnricher ──────→ Claude Haiku → score + summary + talking points
  LeadRepository ────→ Supabase PostgreSQL (upsert by gaf_contractor_id)
```

### Key Architecture Decisions
- **Pipeline as BackgroundTask**: POST returns 202 immediately; frontend polls status
- **Playwright + Coveo hybrid**: Browser handles Akamai Bot Manager; httpx handles pagination with forwarded browser cookies
- **Concurrent research**: Perplexity calls use `asyncio.Semaphore(3)` for rate-safe concurrency
- **Idempotent upserts**: Re-running skips already-enriched leads; safe to re-run on interruption
- **Portal rendering**: Mission Terminal modal uses `ReactDOM.createPortal` to escape header stacking context

---

## Development

```bash
# Backend tests
cd backend
pytest tests/ -v                       # all tests
pytest tests/ -v -m "not integration"  # unit only

# Frontend type check
cd frontend
npx tsc --noEmit
npm run build
```

---

## Project Structure

```
CaseStudy/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app + routers
│   │   ├── config.py                  # ScraperConfig, Settings
│   │   ├── models/lead.py             # Pydantic models
│   │   ├── repositories/lead_repo.py  # Supabase data access
│   │   ├── routers/                   # leads, pipeline endpoints
│   │   └── services/
│   │       ├── playwright_scraper.py  # Playwright + Coveo hybrid
│   │       ├── researcher.py          # Perplexity Sonar
│   │       ├── enricher.py            # Claude Haiku
│   │       └── pipeline.py            # Orchestration
│   └── requirements.txt
└── frontend/
    ├── app/
    │   ├── page.tsx                   # Dashboard (Server Component)
    │   ├── globals.css                # Dark theme + keyframes
    │   └── leads/[id]/page.tsx        # Lead detail
    └── components/
        ├── PipelineControls.tsx       # Run button + status chips
        ├── PipelineMissionModal.tsx   # Mission Terminal overlay
        ├── LeadCard.tsx               # Score ring + hover card
        ├── LeadsGridClient.tsx        # Filter bar + grid + pagination
        └── ScoreRing.tsx              # Animated SVG score arc
```
