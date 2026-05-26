# Cosailor Insights — B2B Sales Intelligence Platform

AI-powered lead generation for roofing distributors. Scrapes GAF contractor listings,
enriches each lead with real web research and AI-generated sales insights,
and presents actionable leads in a polished dashboard.

## 3-Stage Pipeline

1. **Firecrawl** — Scrapes the GAF commercial contractor directory (configurable postal code, country, distance)
2. **Perplexity Sonar** — Searches the web for reputation, growth signals, and competitive intel per contractor
3. **Claude Haiku** — Generates a lead score (1–10), 2-3 sentence summary, 3 talking points, and recommended sales approach

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, Tailwind CSS, shadcn/ui |
| Backend | Python 3.14, FastAPI, uvicorn |
| Database | Supabase PostgreSQL |
| Scraping | Firecrawl API |
| Research | Perplexity Sonar API |
| AI | Anthropic Claude Haiku |

## Setup

### Prerequisites
- Python 3.14+, Node.js 18+
- Supabase project (free tier)
- API keys: Firecrawl, Perplexity, Anthropic

### 1. Database
Run the SQL from the schema section below in your Supabase SQL editor.

### 2. Backend
```bash
cd backend
cp .env.example .env   # add your API keys
python3.14 -m pip install -r requirements.txt
uvicorn app.main:app --reload   # runs on :8000
```

### 3. Frontend
```bash
cd frontend
npm install && npm run dev     # runs on :3000
```

Open **http://localhost:3000** and click **⚡ Run Pipeline**.

## Pipeline Configuration

The pipeline is fully configurable — no hardcoded values:

| Parameter | Default | Options |
|---|---|---|
| `postal_code` | `10013` | any US postal code |
| `country_code` | `us` | any 2-letter country code |
| `distance` | `25` | `25`, `50`, `100` miles |

Pass these as JSON to `POST /api/pipeline/run`:
```json
{ "postal_code": "90210", "country_code": "us", "distance": 50 }
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/leads/` | List all leads (ordered by score desc) |
| GET | `/api/leads/{id}` | Get single lead |
| POST | `/api/pipeline/run` | Start pipeline (returns 202 + run_id) |
| GET | `/api/pipeline/status/{run_id}` | Poll pipeline status |

## Architecture

```
Frontend (Next.js 15)          Backend (FastAPI)
  DashboardPage ──────────────→ GET /api/leads/
  PipelineControls ───────────→ POST /api/pipeline/run (202)
  [polls every 3s] ───────────→ GET /api/pipeline/status/{id}
  [router.refresh() on done]

Backend Pipeline (BackgroundTask):
  GafScraper → Firecrawl API → GAF contractor listings
  ContractorResearcher → Perplexity Sonar → web research per contractor
  LeadEnricher → Claude Haiku → score + summary + talking points
  LeadRepository → Supabase PostgreSQL → upsert (idempotent)
```

## Scalability Notes

- **Async pipeline**: Runs as a FastAPI `BackgroundTask` — decoupled from the HTTP request
- **Concurrent research**: Perplexity calls run with an `asyncio.Semaphore(3)` for rate-safe concurrency
- **Idempotent**: Supabase upsert by `gaf_contractor_id` — safe to re-run, no duplicates
- **Extensible**: Services are injected into `PipelineService` — easy to swap Firecrawl for another scraper, or Claude for another LLM
- **Production path**: Replace BackgroundTasks with Celery + Redis for distributed workers at scale

## Development

```bash
# Backend tests
cd backend
pytest tests/ -v                      # all 13 tests
pytest tests/ -v -m "not integration" # unit tests only

# Frontend type check
cd frontend
npx tsc --noEmit
```
