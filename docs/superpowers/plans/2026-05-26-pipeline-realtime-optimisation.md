# Pipeline Realtime Optimisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GAF contractor pipeline ~2× faster and deliver a live card-by-card reveal during demo via parallel enrichment + Supabase Realtime, plus fix markdown rendering in the lead detail view.

**Architecture:** Enrichment moves from a sequential `for` loop to `asyncio.gather` with `Semaphore(5)`, using a new `enrich_async` wrapper on `LeadEnricher` that runs the synchronous Anthropic SDK call in a thread pool. The frontend subscribes to Supabase Realtime `postgres_changes` on the `leads` table; each enriched DB write instantly fires an event that upserts the card into the grid with a fade-in animation. `react-markdown` replaces raw `<p>` tags in the lead detail view.

**Tech Stack:** Python 3.14, FastAPI, asyncio, Anthropic SDK (sync, thread-pooled), `@supabase/supabase-js`, `react-markdown`, Next.js 15 App Router, Tailwind CSS + tailwindcss-animate (already installed via shadcn/ui).

---

## File Map

**Backend — modified:**
- `backend/app/services/enricher.py` — add `enrich_async` method
- `backend/app/services/researcher.py` — bump `_CONCURRENCY` and `_DELAY`
- `backend/app/services/pipeline.py` — replace sequential for-loop with `asyncio.gather`
- `backend/tests/test_enricher.py` — add `test_enrich_async_returns_lead_insight`
- `backend/tests/test_pipeline.py` — update mock to use `enrich_async`; add multi-lead concurrency test

**Frontend — new:**
- `frontend/lib/supabase.ts` — Supabase browser client (anon key)
- `frontend/hooks/useLeadsRealtime.ts` — Realtime subscription hook

**Frontend — modified:**
- `frontend/components/LeadsGridClient.tsx` — wire `useLeadsRealtime`; add card entrance animation
- `frontend/app/leads/[id]/page.tsx` — replace raw text with `<ReactMarkdown>` for markdown fields
- `frontend/.env.local` — add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Prerequisites (check before starting)

- [ ] **Enable Supabase Realtime on `leads` table:**
  In the Supabase dashboard → Database → Replication → enable the `leads` table for Realtime.
  Alternatively run in the Supabase SQL editor:
  ```sql
  ALTER PUBLICATION supabase_realtime ADD TABLE leads;
  ```

- [ ] **Locate your Supabase anon key:**
  Supabase dashboard → Project Settings → API → `anon` / `public` key.
  This is safe to expose in frontend code — it is a read-only public key governed by RLS.

- [ ] **Confirm RLS allows anon SELECT on `leads`:**
  If Row Level Security is enabled, either disable it for `leads` or add a policy:
  ```sql
  CREATE POLICY "anon can read leads"
    ON leads FOR SELECT TO anon USING (true);
  ```
  If RLS is **not** enabled on `leads`, no action needed.

---

## Task 1: Add `enrich_async` to `LeadEnricher`

**Files:**
- Modify: `backend/app/services/enricher.py`
- Modify: `backend/tests/test_enricher.py`

- [ ] **Step 1: Write the failing test**

  Add this test at the bottom of `backend/tests/test_enricher.py`:

  ```python
  @pytest.mark.asyncio
  async def test_enrich_async_returns_lead_insight(sample_contractor):
      from app.services.enricher import LeadEnricher
      from app.models.lead import LeadInsight

      mock_msg = MagicMock()
      mock_msg.content = [MagicMock(text=MOCK_JSON)]
      mock_client = MagicMock()
      mock_client.messages.create.return_value = mock_msg

      with patch("app.services.enricher.Anthropic", return_value=mock_client):
          enricher = LeadEnricher(api_key="test-key")
          insight = await enricher.enrich_async(
              sample_contractor, {"summary": "Strong.", "sources": []}
          )

      assert isinstance(insight, LeadInsight)
      assert insight.lead_score == 9
      assert len(insight.talking_points) == 3
  ```

  Also add `import pytest` at the top of the file if not already present (it is — confirm with a quick scan).

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd backend
  pytest tests/test_enricher.py::test_enrich_async_returns_lead_insight -v
  ```

  Expected: `FAILED` with `AttributeError: 'LeadEnricher' object has no attribute 'enrich_async'`

- [ ] **Step 3: Add `enrich_async` to `LeadEnricher`**

  In `backend/app/services/enricher.py`, add `import asyncio` at the top (after the existing imports), then add this method inside the `LeadEnricher` class immediately after the `enrich` method:

  ```python
  async def enrich_async(self, contractor: ContractorRecord, research: dict) -> LeadInsight:
      loop = asyncio.get_running_loop()
      return await loop.run_in_executor(None, self.enrich, contractor, research)
  ```

  The `enrich` method (synchronous) is **not changed** — existing tests continue to work.

- [ ] **Step 4: Run all enricher tests to verify they pass**

  ```bash
  cd backend
  pytest tests/test_enricher.py -v
  ```

  Expected: all 4 tests `PASSED` (`test_enricher_parses_clean_json`, `test_enricher_strips_markdown_fences`, `test_enricher_clamps_score_out_of_range`, `test_enrich_async_returns_lead_insight`).

- [ ] **Step 5: Commit**

  ```bash
  git add backend/app/services/enricher.py backend/tests/test_enricher.py
  git commit -m "feat: add enrich_async to LeadEnricher for concurrent pipeline"
  ```

---

## Task 2: Tune researcher concurrency

**Files:**
- Modify: `backend/app/services/researcher.py`

- [ ] **Step 1: Update the two constants**

  In `backend/app/services/researcher.py`, change lines 11–12 from:
  ```python
  _CONCURRENCY = 3
  _DELAY = 1.2
  ```
  to:
  ```python
  _CONCURRENCY = 5
  _DELAY = 0.8
  ```

- [ ] **Step 2: Run existing researcher tests to verify nothing broke**

  ```bash
  cd backend
  pytest tests/test_researcher.py -v
  ```

  Expected: all tests `PASSED`.

- [ ] **Step 3: Commit**

  ```bash
  git add backend/app/services/researcher.py
  git commit -m "perf: increase researcher concurrency 3→5, reduce delay 1.2→0.8s"
  ```

---

## Task 3: Parallel enrichment in `pipeline.py`

**Files:**
- Modify: `backend/app/services/pipeline.py`
- Modify: `backend/tests/test_pipeline.py`

- [ ] **Step 1: Update the existing pipeline test to expect `enrich_async`**

  In `backend/tests/test_pipeline.py`, replace the entire file with:

  ```python
  import pytest
  from unittest.mock import AsyncMock, MagicMock
  from uuid import uuid4


  @pytest.mark.asyncio
  async def test_pipeline_execute_stores_all_enriched_leads(sample_contractor, sample_lead_row):
      from app.services.pipeline import PipelineService
      from app.models.lead import LeadInsight

      run_id = str(uuid4())
      insight = LeadInsight(
          lead_score=9, score_rationale="Master Elite",
          ai_summary="High priority.", talking_points=["P1", "P2", "P3"],
          recommended_approach="Call owner."
      )

      mock_repo = AsyncMock()
      mock_repo.upsert_contractor.return_value = {**sample_lead_row, "id": str(uuid4())}
      mock_repo.update_research = AsyncMock()
      mock_repo.update_enrichment = AsyncMock()
      mock_repo.complete_pipeline_run = AsyncMock()
      mock_repo.update_pipeline_progress = AsyncMock()

      mock_scraper = MagicMock()
      mock_scraper.scrape_contractors.return_value = [sample_contractor]

      mock_researcher = AsyncMock()
      mock_researcher.research_all.return_value = [{"summary": "Good.", "sources": []}]

      mock_enricher = MagicMock()
      mock_enricher.enrich_async = AsyncMock(return_value=insight)

      service = PipelineService(
          repo=mock_repo,
          scraper=mock_scraper,
          researcher=mock_researcher,
          enricher=mock_enricher,
      )

      await service.execute(
          run_id=run_id,
          request=MagicMock(postal_code="10013", country_code="us", distance=25, limit=None)
      )

      mock_scraper.scrape_contractors.assert_called_once()
      mock_researcher.research_all.assert_called_once()
      mock_enricher.enrich_async.assert_called_once()
      mock_repo.update_enrichment.assert_called_once()
      mock_repo.complete_pipeline_run.assert_called_once_with(run_id, leads_enriched=1)


  @pytest.mark.asyncio
  async def test_pipeline_enriches_multiple_leads_concurrently(sample_contractor, sample_lead_row):
      from app.services.pipeline import PipelineService
      from app.models.lead import LeadInsight

      insight = LeadInsight(
          lead_score=7, score_rationale="GAF Certified",
          ai_summary="Good lead.", talking_points=["P1", "P2", "P3"],
          recommended_approach="Email first."
      )

      mock_repo = AsyncMock()
      mock_repo.update_pipeline_progress = AsyncMock()
      mock_repo.upsert_contractor.side_effect = [
          {**sample_lead_row, "id": f"lead-{i}"} for i in range(3)
      ]
      mock_repo.update_enrichment = AsyncMock()
      mock_repo.complete_pipeline_run = AsyncMock()

      mock_scraper = MagicMock()
      mock_scraper.scrape_contractors.return_value = [sample_contractor] * 3

      mock_researcher = AsyncMock()
      mock_researcher.research_all.return_value = [{"summary": "Ok.", "sources": []}] * 3

      mock_enricher = MagicMock()
      mock_enricher.enrich_async = AsyncMock(return_value=insight)

      service = PipelineService(
          repo=mock_repo,
          scraper=mock_scraper,
          researcher=mock_researcher,
          enricher=mock_enricher,
      )

      await service.execute(
          run_id="run-123",
          request=MagicMock(postal_code="10013", country_code="us", distance=25, limit=None)
      )

      assert mock_enricher.enrich_async.call_count == 3
      assert mock_repo.update_enrichment.call_count == 3
      mock_repo.complete_pipeline_run.assert_called_once_with("run-123", leads_enriched=3)
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd backend
  pytest tests/test_pipeline.py -v
  ```

  Expected: both tests `FAILED` — `mock_enricher.enrich_async` never called because pipeline still calls `enrich`.

- [ ] **Step 3: Replace the sequential enrichment loop in `pipeline.py`**

  Open `backend/app/services/pipeline.py`. Replace the entire `execute` method with:

  ```python
  async def execute(self, run_id: str, request: PipelineRunRequest) -> None:
      try:
          config = ScraperConfig(
              postal_code=request.postal_code,
              country_code=request.country_code,
              distance=request.distance,
              limit=request.limit,
          )

          # Stage 1: Scrape
          contractors = self._scraper.scrape_contractors(config)
          await self._repo.update_pipeline_progress(run_id, leads_scraped=len(contractors))

          lead_rows = [await self._repo.upsert_contractor(c) for c in contractors]

          # Stage 2: Research (concurrent)
          research_results = await self._researcher.research_all(contractors)
          for row, research in zip(lead_rows, research_results):
              await self._repo.update_research(
                  row["id"], research.get("summary", ""), research.get("sources", [])
              )

          # Stage 3: Enrich with Claude (concurrent, max 5 at once)
          semaphore = asyncio.Semaphore(5)

          async def enrich_one(row: dict, contractor: object, research: dict) -> bool:
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

          await self._repo.complete_pipeline_run(run_id, leads_enriched=enriched)

      except Exception as exc:
          await self._repo.fail_pipeline_run(run_id, str(exc))
          raise
  ```

  Also add `import asyncio` at the top of the file (after the existing imports).

- [ ] **Step 4: Run all pipeline tests to verify they pass**

  ```bash
  cd backend
  pytest tests/test_pipeline.py -v
  ```

  Expected: both tests `PASSED`.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

  ```bash
  cd backend
  pytest tests/ -v -m "not integration"
  ```

  Expected: all tests `PASSED`.

- [ ] **Step 6: Commit**

  ```bash
  git add backend/app/services/pipeline.py backend/tests/test_pipeline.py
  git commit -m "perf: parallel enrichment with asyncio.gather + Semaphore(5)"
  ```

---

## Task 4: Frontend dependencies, env vars, and Supabase client

**Files:**
- Modify: `frontend/.env.local`
- Create: `frontend/lib/supabase.ts`

- [ ] **Step 1: Install npm dependencies**

  ```bash
  cd frontend
  npm install @supabase/supabase-js react-markdown
  ```

  Expected output: packages added, no peer-dep errors.

- [ ] **Step 2: Add environment variables to `frontend/.env.local`**

  Open `frontend/.env.local` and append (do **not** overwrite existing lines):

  ```env
  NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-public-key>
  ```

  Replace the placeholders with actual values from Supabase dashboard → Project Settings → API.
  `NEXT_PUBLIC_SUPABASE_URL` is the same URL as `SUPABASE_URL` in the backend `.env`.

- [ ] **Step 3: Create `frontend/lib/supabase.ts`**

  Create a new file at `frontend/lib/supabase.ts` with this exact content:

  ```typescript
  import { createClient } from '@supabase/supabase-js'

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!supabaseAnonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')

  export const supabase = createClient(supabaseUrl, supabaseAnonKey)
  ```

- [ ] **Step 4: Verify the dev server still starts**

  ```bash
  cd frontend
  npm run dev
  ```

  Expected: dev server starts on port 3000 with no TypeScript errors. Press `Ctrl+C` to stop.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/lib/supabase.ts frontend/package.json frontend/package-lock.json
  git commit -m "feat: add supabase-js + react-markdown deps, create Supabase browser client"
  ```

  Note: **do not** commit `frontend/.env.local` — it contains secrets and is gitignored.

---

## Task 5: Create `useLeadsRealtime` hook

**Files:**
- Create: `frontend/hooks/useLeadsRealtime.ts`

- [ ] **Step 1: Create the hooks directory and file**

  Create `frontend/hooks/useLeadsRealtime.ts` with this exact content:

  ```typescript
  'use client'

  import { useEffect, useRef, useState } from 'react'
  import { supabase } from '@/lib/supabase'
  import type { Lead } from '@/lib/types'

  export function useLeadsRealtime(initialLeads: Lead[]): Lead[] {
    const [leads, setLeads] = useState<Lead[]>(initialLeads)
    // Keep a ref so the effect closure always has the latest initialLeads
    const initialRef = useRef(initialLeads)

    // Sync state when server re-fetches (e.g. after router.refresh())
    useEffect(() => {
      initialRef.current = initialLeads
      setLeads(initialLeads)
    }, [initialLeads])

    useEffect(() => {
      const channel = supabase
        .channel('leads-realtime')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'leads',
            filter: 'status=eq.enriched',
          },
          (payload) => {
            const incoming = payload.new as Lead
            setLeads((prev) => {
              const exists = prev.some((l) => l.id === incoming.id)
              return exists
                ? prev.map((l) => (l.id === incoming.id ? incoming : l))
                : [...prev, incoming]
            })
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }, []) // only subscribe once on mount

    return leads
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```bash
  cd frontend
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/hooks/useLeadsRealtime.ts
  git commit -m "feat: useLeadsRealtime hook — Supabase Realtime subscription for live card reveal"
  ```

---

## Task 6: Wire `LeadsGridClient` to Realtime + card animation

**Files:**
- Modify: `frontend/components/LeadsGridClient.tsx`

- [ ] **Step 1: Add the Realtime hook and card animation**

  In `frontend/components/LeadsGridClient.tsx`:

  1. Add the import after the existing imports:
     ```typescript
     import { useLeadsRealtime } from '@/hooks/useLeadsRealtime'
     ```

  2. Inside `LeadsGridClient`, add the hook call as the **first line** of the component body (before the existing `useState` calls):
     ```typescript
     const leads = useLeadsRealtime(props.leads)
     ```

  3. Update the component signature to use `props` explicitly so the hook receives `initialLeads`:
     ```typescript
     export function LeadsGridClient({ leads: initialLeads }: LeadsGridClientProps): React.JSX.Element {
       const leads = useLeadsRealtime(initialLeads)
       // ... rest unchanged
     ```

  4. In the grid section, wrap each `<LeadCard>` with an animated `<div>`:
     ```tsx
     // BEFORE:
     {displayedLeads.map((lead) => (
       <LeadCard key={lead.id} lead={lead} />
     ))}

     // AFTER:
     {displayedLeads.map((lead) => (
       <div
         key={lead.id}
         className="animate-in fade-in slide-in-from-bottom-2 duration-300"
       >
         <LeadCard lead={lead} />
       </div>
     ))}
     ```

  The full updated export function should look like this:

  ```tsx
  export function LeadsGridClient({ leads: initialLeads }: LeadsGridClientProps): React.JSX.Element {
    const leads = useLeadsRealtime(initialLeads)
    const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all')
    const [sortOption, setSortOption] = useState<SortOption>('score_desc')

    const { total, enrichedCount, avgScore } = useMemo(() => computeStats(leads), [leads])
    const displayedLeads = useMemo(
      () => sortLeads(filterLeads(leads, scoreFilter), sortOption),
      [leads, scoreFilter, sortOption]
    )

    if (leads.length === 0) {
      return (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-lg font-medium text-gray-700">No leads yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Run the pipeline to scrape and enrich GAF contractors.
          </p>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <StatsBar
          total={total}
          enrichedCount={enrichedCount}
          avgScore={avgScore !== null ? avgScore.toFixed(1) : '—'}
        />
        <p className="text-xs text-gray-400 mb-2">{leads.length} contractors found</p>
        <LeadFilterControls
          scoreFilter={scoreFilter}
          sortOption={sortOption}
          resultCount={displayedLeads.length}
          onFilterChange={setScoreFilter}
          onSortChange={setSortOption}
        />
        {displayedLeads.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No leads match the selected filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {displayedLeads.map((lead) => (
              <div
                key={lead.id}
                className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <LeadCard lead={lead} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```bash
  cd frontend
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Smoke test in browser**

  Start both servers:
  ```bash
  # Terminal 1
  cd backend && uvicorn app.main:app --reload --port 8000

  # Terminal 2
  cd frontend && npm run dev
  ```

  Open `http://localhost:3000`. The dashboard should load with existing leads. No console errors.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/components/LeadsGridClient.tsx
  git commit -m "feat: wire LeadsGridClient to Supabase Realtime, add card entrance animation"
  ```

---

## Task 7: Markdown rendering in lead detail view

**Files:**
- Modify: `frontend/app/leads/[id]/page.tsx`

- [ ] **Step 1: Add the `react-markdown` import**

  At the top of `frontend/app/leads/[id]/page.tsx`, add after the existing imports:

  ```typescript
  import ReactMarkdown from 'react-markdown'
  ```

- [ ] **Step 2: Replace raw text with `ReactMarkdown` for the three markdown fields**

  **Field 1 — `research_summary`** (Perplexity output — definitely contains markdown):

  ```tsx
  // BEFORE:
  <CardContent>
    <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-line">
      {lead.research_summary}
    </p>
  </CardContent>

  // AFTER:
  <CardContent>
    <ReactMarkdown className="prose prose-xs prose-gray max-w-none text-xs leading-relaxed">
      {lead.research_summary}
    </ReactMarkdown>
  </CardContent>
  ```

  **Field 2 — `ai_summary`** (Claude output — may contain bold/italic):

  ```tsx
  // BEFORE:
  <CardContent>
    <p className="text-sm text-gray-700 leading-relaxed">{lead.ai_summary}</p>
    {lead.score_rationale && (
      <p className="text-xs text-gray-500 mt-2 italic">{lead.score_rationale}</p>
    )}
  </CardContent>

  // AFTER:
  <CardContent>
    <ReactMarkdown className="prose prose-sm prose-gray max-w-none">
      {lead.ai_summary}
    </ReactMarkdown>
    {lead.score_rationale && (
      <p className="text-xs text-gray-500 mt-2 italic">{lead.score_rationale}</p>
    )}
  </CardContent>
  ```

  **Field 3 — `recommended_approach`** (Claude output — may contain markdown):

  ```tsx
  // BEFORE:
  <CardContent>
    <p className="text-sm text-gray-700 leading-relaxed">{lead.recommended_approach}</p>
  </CardContent>

  // AFTER:
  <CardContent>
    <ReactMarkdown className="prose prose-sm prose-gray max-w-none">
      {lead.recommended_approach}
    </ReactMarkdown>
  </CardContent>
  ```

- [ ] **Step 3: Add `@tailwindcss/typography` plugin for `prose` classes**

  `react-markdown` with `className="prose"` requires the Tailwind typography plugin. Check if it's installed:

  ```bash
  cd frontend
  cat package.json | grep typography
  ```

  If **not found**, install it:
  ```bash
  npm install @tailwindcss/typography
  ```

  Then add to `frontend/tailwind.config.ts` (or `tailwind.config.js`) in the `plugins` array:
  ```typescript
  plugins: [require('@tailwindcss/typography'), ...]
  ```

  If it **is already installed** (shadcn sometimes includes it), skip this step.

- [ ] **Step 4: Verify TypeScript compiles cleanly**

  ```bash
  cd frontend
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 5: Smoke test the lead detail page**

  With both servers running, click any lead card in the dashboard. The lead detail page should now show:
  - Perplexity research rendered as formatted markdown (bold headers, bullet points, numbered lists)
  - AI summary rendered with any bold/italic formatting
  - No raw `**text**` or `- bullet` visible

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/app/leads/[id]/page.tsx frontend/package.json frontend/package-lock.json
  # If tailwind config was modified:
  git add frontend/tailwind.config.ts
  git commit -m "fix: render markdown in lead detail view (research_summary, ai_summary, recommended_approach)"
  ```

---

## Final Verification

- [ ] **Run full backend test suite**

  ```bash
  cd backend
  pytest tests/ -v -m "not integration"
  ```

  Expected: all tests `PASSED`.

- [ ] **End-to-end demo run**

  1. Start both servers (backend port 8000, frontend port 3000)
  2. Open `http://localhost:3000`
  3. Click "Run Pipeline"
  4. Watch: after ~10s (scrape complete), cards should begin appearing one-by-one as each lead is enriched
  5. Total time to all cards: ~27s (down from ~55s)
  6. Click any lead card — confirm markdown renders as formatted prose, no raw `**` visible

- [ ] **Final commit (if anything was missed)**

  ```bash
  git add -A
  git commit -m "feat: pipeline realtime optimisation — parallel enrichment + Supabase Realtime + markdown fix"
  ```
