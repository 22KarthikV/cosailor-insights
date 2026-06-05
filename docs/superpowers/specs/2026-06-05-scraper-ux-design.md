# Scraper Fix + Progressive UX Design
Date: 2026-06-05

## Problem Summary

Three interconnected issues in the current pipeline:
1. **Incomplete scraping** — `GafScraper` makes a single `scrape_url` call and captures only the first-page render (~10–25 contractors). The GAF directory is JS-rendered and paginated.
2. **No new vendors on re-runs** — re-runs always hit the same first-page batch, and the status reset bug causes already-enriched leads to be re-processed.
3. **Poor UX** — `router.refresh()` is called only once at pipeline completion; users stare at a counter for 3+ minutes before any leads appear.

## Goals

- Scrape all vendors from the GAF directory (not just first page)
- Show partial lead cards within 30–60 seconds of clicking Run Pipeline
- Cards fill in progressively as each lead is enriched
- Parallel enrichment to reduce total pipeline time
- Caching so post-run page loads are instant
- Pagination so users control how many cards they see at once
- Do NOT break the existing Firecrawl scraper

---

## Section 1: Scraper Architecture

### New `PlaywrightScraper`

- **File:** `backend/app/services/playwright_scraper.py`
- **Output contract:** returns `list[ContractorLead]` — identical to `GafScraper` output
- **Existing `GafScraper`:** untouched, still functional

**Playwright behaviour:**
1. Open GAF directory URL in headless Chromium
2. Wait for contractor cards to render
3. Scroll to bottom, wait for new cards to load
4. Repeat scroll until no new cards appear (stable count)
5. Extract from DOM: company name, address, city, state, zip, phone, GAF contractor ID
6. Return `list[ContractorLead]`

**Scraper selection:**
- `ScraperConfig` gains: `scraper: Literal["firecrawl", "playwright"] = "playwright"`
- `PipelineRunRequest` exposes the same field
- Pipeline service instantiates the correct scraper class based on `config.scraper`
- `playwright` Python package installed; `playwright install chromium` run at setup

---

## Section 2: Pipeline Changes

### 2a. Status Reset Fix

**Bug:** `upsert_contractor` always sets `"status": "scraped"`, resetting already-enriched leads on every re-run.

**Fix:** Change the SQL upsert to preserve existing status for enriched leads:

```sql
ON CONFLICT (gaf_contractor_id) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  address      = EXCLUDED.address,
  ...
  status = CASE
    WHEN leads.status IN ('researched', 'enriched') THEN leads.status
    ELSE 'scraped'
  END
```

**Effect:** Re-runs only enrich genuinely new leads; existing enriched leads are skipped.

### 2b. Parallel Enrichment

**Current:** Sequential `for` loop — each lead waits for the previous to finish.

**Fix:** `asyncio.gather()` with a `asyncio.Semaphore(5)` concurrency cap to respect Perplexity and Anthropic rate limits.

```python
sem = asyncio.Semaphore(5)
async def enrich_one(row, contractor, research):
    async with sem:
        insight = self._enricher.enrich(contractor, research, ...)
        await self._repo.update_enrichment(row["id"], insight)

await asyncio.gather(*[enrich_one(r, c, res) for r, c, res in zip(...)])
```

Each enrichment writes to DB immediately on completion — not batched at the end.

### 2c. Progressive DB Writes

- After scraping: all leads upserted immediately (already the case)
- Frontend poll picks up scraped leads within 2 seconds → partial cards appear
- As each enrichment completes and writes to DB → next poll shows updated card
- No change to poll interval (stays at 2–3 seconds)

---

## Section 3: Caching Layer

**Strategy:** Next.js `unstable_cache` wrapping the Supabase leads fetch.

- **During pipeline run:** fetch uses `cache: 'no-store'` — polls always get fresh DB data
- **After pipeline completes:** server action calls `revalidateTag('leads-list')` — cache is populated
- **Subsequent page loads:** served from cache, no Supabase round-trip
- **New pipeline run starts:** `revalidateTag('leads-list')` called again to bust the cache

**Cache tag:** `'leads-list'`

---

## Section 4: Frontend Pagination

### Backend

- `GET /api/leads` gains optional query params: `?page=1&limit=12`
- `LeadRepository.get_all_leads()` accepts `page: int = 1`, `limit: int = 12`
- Uses Supabase `.range(offset, offset + limit - 1)` for efficient server-side pagination
- Response includes `{ leads: [...], total: N, page: P, limit: L }`

### Frontend

- Leads page reads `page` and `limit` from Next.js `searchParams`
- Page size selector: 12 / 24 / 48 cards per page
- Prev / Next buttons (disabled at boundaries)
- "Showing 1–12 of 80 leads" label
- Pagination works during pipeline run — users can browse other pages while cards fill in

---

## Section 5: User Experience Flow

1. **User clicks "Run Pipeline"** — button enters loading state, 202 returned
2. **~30–60s — Playwright finishes scraping** — 80 leads written to DB as `scraped`; next poll triggers `router.refresh()`; dashboard shows 80 partial cards (name, company, address only)
3. **Next 2–4 minutes — cards fill in** — parallel enrichment writes to DB as each lead finishes; every 2s poll refreshes page; score badge and AI summary appear per card progressively
4. **Pipeline completes** — all cards fully enriched; `revalidateTag('leads-list')` called; button re-enabled; subsequent loads are cached

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `backend/app/services/playwright_scraper.py` | New — Playwright-based scraper |
| `backend/app/services/pipeline.py` | Parallel enrichment, scraper selection |
| `backend/app/repositories/lead_repository.py` | Status fix in upsert, pagination in get_all_leads |
| `backend/app/config.py` | `scraper` field on `ScraperConfig` |
| `backend/app/models/lead.py` | `scraper` field on `PipelineRunRequest` |
| `backend/app/routers/leads.py` | `page` + `limit` query params |
| `frontend/lib/api.ts` | Pass `scraper` param; pagination fetch |
| `frontend/components/PipelineControls.tsx` | `router.refresh()` on every poll during run |
| `frontend/app/page.tsx` (or leads page) | Read `searchParams`, pass to fetch, render pagination UI |
| `frontend/lib/leads.ts` (or similar) | Wrap Supabase fetch with `unstable_cache` + `revalidateTag` |

---

## Out of Scope

- Replacing the Firecrawl scraper (it stays as-is, selectable via config)
- WebSocket or SSE real-time streaming
- Infinite scroll
- Multi-user cache isolation
