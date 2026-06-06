"""Orchestrates the three-stage scrape → research → enrich pipeline.

PipelineService.execute() runs as a FastAPI BackgroundTask so the HTTP
response is returned before the long-running work finishes.

Stage 1 — Scrape:    fetch contractor listings from the GAF directory.
Stage 2 — Research:  query Perplexity for web intelligence on each contractor.
Stage 3 — Enrich:    call Claude AI in parallel (up to 5 concurrent) to score leads.

Individual enrichment failures are isolated per-lead: one bad contractor does not
abort the rest of the batch. The pipeline_runs row is updated in Supabase after
each stage so the frontend can display live progress.
"""
import asyncio
import logging

from supabase import acreate_client

from app.config import ScraperConfig, settings
from app.models.lead import PipelineRunRequest
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.researcher import ContractorResearcher

logger = logging.getLogger(__name__)

_ENRICH_CONCURRENCY = 5


class PipelineService:
    """Coordinates the end-to-end lead enrichment pipeline."""

    def __init__(self, scraper, researcher: ContractorResearcher, enricher: LeadEnricher):
        self._scraper = scraper
        self._researcher = researcher
        self._enricher = enricher

    async def execute(self, run_id: str, request: PipelineRunRequest) -> None:
        """Run all three pipeline stages for a single scrape request.

        A fresh Supabase client is created here (not reused from the router)
        so the background task owns its own httpx connection lifetime.
        Marks the pipeline run as failed in the database if any unrecoverable
        error occurs before enrichment finishes, then re-raises so the
        BackgroundTask framework can log the full traceback.
        """
        # Own the Supabase connection — never share the router's client across
        # the request/background-task boundary (httpx session lifecycle mismatch).
        client = await acreate_client(settings.supabase_url, settings.supabase_key)
        repo = LeadRepository(client)
        try:
            config = ScraperConfig(
                postal_code=request.postal_code,
                country_code=request.country_code,
                distance=request.distance,
                limit=request.limit,
            )

            # Stage 1: Scrape contractors from the GAF directory
            contractors = await self._scraper.scrape_contractors(config)
            await repo.update_pipeline_progress(run_id, leads_scraped=len(contractors))

            lead_rows = [await repo.upsert_contractor(c) for c in contractors]

            # Bucket leads by how much work they still need.
            # Already-enriched leads are counted as done and skipped entirely.
            # Already-researched leads skip stage 2 but still run stage 3.
            # Scraped / failed leads run the full pipeline.
            to_research: list[tuple[dict, object]] = []
            to_enrich_only: list[tuple[dict, object, dict]] = []
            already_enriched_count = 0

            for row, contractor in zip(lead_rows, contractors):
                if row["status"] == "enriched":
                    already_enriched_count += 1
                elif row["status"] == "researched":
                    stored_summary = row.get("research_summary") or ""
                    to_enrich_only.append((row, contractor, {"summary": stored_summary, "sources": []}))
                else:
                    to_research.append((row, contractor))

            logger.info(
                "Pipeline %s: %d already enriched, %d need research+enrich, %d need enrich only",
                run_id, already_enriched_count, len(to_research), len(to_enrich_only),
            )

            # Reflect already-enriched count immediately so the UI doesn't show 0
            await repo.update_pipeline_progress(run_id, leads_enriched=already_enriched_count)

            # Stage 2: Research only leads that need it
            research_results: list[dict] = []
            if to_research:
                research_contractors = [c for _, c in to_research]
                research_results = await self._researcher.research_all(research_contractors)
                for (row, _), research in zip(to_research, research_results):
                    await repo.update_research(
                        row["id"], research.get("summary", ""), research.get("sources", [])
                    )

            # Stage 3: Enrich everything that isn't already done
            to_enrich_all = (
                [(row, c, research) for (row, c), research in zip(to_research, research_results)]
                + to_enrich_only
            )
            enriched_count = already_enriched_count + await self._enrich_parallel(
                repo, to_enrich_all, request.postal_code,
                run_id=run_id, initial_count=already_enriched_count,
            )

            await repo.complete_pipeline_run(run_id, leads_enriched=enriched_count)

        except Exception as exc:
            logger.exception("Pipeline run %s failed", run_id)
            error_detail = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
            await repo.fail_pipeline_run(run_id, error_detail)
            raise

    async def _enrich_parallel(
        self,
        repo: LeadRepository,
        to_enrich: list[tuple[dict, object, dict]],
        search_postal_code: str,
        run_id: str = "",
        initial_count: int = 0,
    ) -> int:
        """Enrich a list of (row, contractor, research) tuples in parallel.

        Increments the pipeline_runs.leads_enriched counter in the DB after
        each individual enrichment so the frontend progress display updates live.
        Returns the count of newly enriched leads (not including initial_count).
        """
        if not to_enrich:
            return 0

        sem = asyncio.Semaphore(_ENRICH_CONCURRENCY)
        count_lock = asyncio.Lock()
        running_total = [initial_count]

        async def enrich_one(row: dict, contractor, research: dict) -> bool:
            async with sem:
                try:
                    insight = await asyncio.to_thread(
                        self._enricher.enrich,
                        contractor,
                        research,
                        search_postal_code=search_postal_code,
                    )
                    await repo.update_enrichment(row["id"], insight)
                    if run_id:
                        async with count_lock:
                            running_total[0] += 1
                            await repo.update_pipeline_progress(
                                run_id, leads_enriched=running_total[0]
                            )
                    return True
                except Exception as exc:
                    logger.exception("Enrichment failed for lead %s", row["id"])
                    await repo.mark_lead_failed(row["id"], str(exc))
                    return False

        results = await asyncio.gather(
            *[enrich_one(row, contractor, research) for row, contractor, research in to_enrich],
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)
