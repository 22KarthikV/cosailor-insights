# Pipeline Realtime Optimisation — Design Spec
**Date:** 2026-05-26  
**Status:** Approved  
**Goal:** Make the GAF contractor scraping pipeline faster and visually live for the demo (10–15 leads, fast + progressive card reveal).

---

## Problem

The current pipeline has two compounding issues for demo quality:

1. **Enrichment is sequential** — a `for` loop calls Claude Haiku one lead at a time (~2–3 s each). For 12 leads that is ~30 s of blocking work after scraping and research are done.
2. **Frontend only updates on completion** — `PipelineControls` polls `/api/pipeline/status/{run_id}` every 3 s and triggers `router.refresh()` only when `status = "completed"`. The audience stares at a spinner for the full ~55 s before any cards appear.
3. **Markdown not rendered** — the lead detail page displays raw markdown strings (`**bold**`, `- bullets`) as plain text.

---

## Target State

| Metric | Before | After |
|--------|--------|-------|
| Total pipeline time (12 leads) | ~55 s | ~27 s |
| Time to first card visible | ~55 s | ~10 s |
| Cards appear | All at once | One-by-one as enriched |
| Markdown in detail view | Raw `**text**` | Rendered prose |

---

## Architecture

```
[Click Run Pipeline]
        │
        ▼
POST /api/pipeline/run  →  202 Accepted
        │
        ▼
Stage 1: Scrape (Firecrawl)          ~10 s  (unchanged)
        │
        ▼
Stage 2: Research x12 (5 concurrent) ~9 s   (was 3 concurrent, ~15 s)
        │
        ▼
Stage 3: Enrich x12 (5 concurrent)  ~8 s   (was sequential, ~30 s)
        │  Each lead: DB write → Supabase Realtime event → card pops in ✨
        ▼
pipeline_runs.status = completed
```

The frontend subscribes to Supabase Realtime on session start. Cards appear the instant each `leads` row is written — no waiting for the full pipeline.

---

## Backend Changes

### `backend/app/services/pipeline.py`

Replace the sequential enrichment `for` loop with `asyncio.gather` + `Semaphore(5)`:

```python
# Stage 3: Enrich with Claude (concurrent)
semaphore = asyncio.Semaphore(5)

async def enrich_one(row, contractor, research):
    async with semaphore:
        try:
            insight = await self._enricher.enrich_async(contractor, research)
            await self._repo.update_enrichment(row["id"], insight)
            return True
        except Exception as exc:
            logger.exception("Enrichment failed for lead %s", row["id"])
            await self._repo.mark_lead_failed(row["id"], str(exc))
            return False

results = await asyncio.gather(*[
    enrich_one(row, c, r)
    for row, c, r in zip(lead_rows, contractors, research_results)
])
enriched = sum(results)
```

### `backend/app/services/enricher.py`

Add `enrich_async` — runs the existing synchronous Anthropic SDK call in a thread pool so it does not block the event loop:

```python
import asyncio

async def enrich_async(self, contractor: ContractorRecord, research: dict) -> LeadInsight:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, self.enrich, contractor, research)
```

The existing synchronous `enrich` method is **kept unchanged** so tests and any other callers are unaffected.

### `backend/app/services/researcher.py`

Tune concurrency constants:

```python
_CONCURRENCY = 5   # was 3
_DELAY = 0.8       # was 1.2
```

No structural changes — the semaphore + `asyncio.gather` pattern is already in place.

---

## Frontend Changes

### New: `frontend/lib/supabase.ts`

Thin Supabase browser client (uses the anon/public key — read-only Realtime only):

```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

### New: `frontend/hooks/useLeadsRealtime.ts`

`'use client'` hook that subscribes to `leads` table changes. Merges arriving leads into local state (upsert by `id`):

```typescript
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/lib/types'

export function useLeadsRealtime(initialLeads: Lead[]) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)

  useEffect(() => {
    const channel = supabase
      .channel('leads-realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'leads',
        filter: 'status=eq.enriched',
      }, (payload) => {
        setLeads(prev => {
          const incoming = payload.new as Lead
          const exists = prev.some(l => l.id === incoming.id)
          return exists
            ? prev.map(l => l.id === incoming.id ? incoming : l)
            : [...prev, incoming]
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return leads
}
```

### Modified: `frontend/components/LeadsGridClient.tsx`

Replace static `leads` prop with `useLeadsRealtime(initialLeads)`. Add Tailwind entrance animation class to each new card:

```tsx
// Card wrapper gets animation on mount
<div
  key={lead.id}
  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
>
  <LeadCard lead={lead} />
</div>
```

> **Note:** `animate-in` / `fade-in` / `slide-in-from-*` are from `tailwindcss-animate`, which shadcn/ui already installs. No additional dependency needed.

The `initialLeads` (server-fetched on page load) seed the hook so existing leads show immediately without a flash.

### Modified: `frontend/app/leads/[id]/page.tsx`

Install `react-markdown` and replace raw text fields with rendered markdown:

```tsx
import ReactMarkdown from 'react-markdown'

// Wherever research_summary, ai_summary, or recommended_approach are rendered:
<ReactMarkdown className="prose prose-sm max-w-none">
  {lead.research_summary}
</ReactMarkdown>
```

### New environment variables: `frontend/.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=<same value as backend SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase project anon/public key>
```

> **Security note:** The anon key is safe to expose — it is the public read key. Supabase RLS policies govern what it can read. Realtime subscriptions respect those same policies.

---

## What Does NOT Change

- `scraper.py` — Firecrawl call is unchanged
- All repository methods — unchanged
- `pipeline.py` router — unchanged
- `PipelineControls.tsx` polling — kept for the run-status banner ("12 of 14 enriched…"); only card reveal moves to Realtime
- Database schema — no migrations needed
- All existing tests — `enrich` (sync) is kept; only `enrich_async` is added

---

## Dependency Additions

| Package | Where | Size | Purpose |
|---------|-------|------|---------|
| `@supabase/supabase-js` | frontend | ~50 kB gzipped | Realtime subscription |
| `react-markdown` | frontend | ~15 kB gzipped | Markdown rendering |

No new backend dependencies.

---

## Error Handling

- If Supabase Realtime disconnects mid-pipeline, the frontend falls back gracefully: `PipelineControls` polling still fires `router.refresh()` on completion, so all leads render eventually.
- If an individual enrichment fails, `mark_lead_failed` is called (unchanged behaviour); that lead simply does not trigger a Realtime event.
- `enrich_async` wraps the thread executor call in the existing try/except in `enrich_one`, so one failure does not cancel the `asyncio.gather`.

---

## Testing Notes

- Existing unit tests for `enrich` (sync path) remain valid — no changes to that method.
- Add a unit test for `enrich_async` that mocks `run_in_executor` and verifies it returns a `LeadInsight`.
- Add an integration test for the concurrent pipeline path that asserts all leads are enriched when `asyncio.gather` completes.
- No frontend tests are required for the Realtime hook at this stage (demo scope).
