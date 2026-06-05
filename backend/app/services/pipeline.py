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

from app.config import ScraperConfig
from app.models.lead import PipelineRunRequest
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.researcher import ContractorResearcher

logger = logging.getLogger(__name__)

_ENRICH_CONCURRENCY = 5


class PipelineService:
    """Coordinates the end-to-end lead enrichment pipeline."""

    def __init__(self, repo: LeadRepository, scraper, researcher: ContractorResearcher, enricher: LeadEnricher):
        self._repo = repo
        self._scraper = scraper
        self._researcher = researcher
        self._enricher = enricher

    async def execute(self, run_id: str, request: PipelineRunRequest) -> None:
        """Run all three pipeline stages for a single scrape request.

        Marks the pipeline run as failed in the database if any unrecoverable
        error occurs before enrichment finishes, then re-raises so the
        BackgroundTask framework can log the full traceback.
        """
        try:
            config = ScraperConfig(
                postal_code=request.postal_code,
                country_code=request.country_code,
                distance=request.distance,
                limit=request.limit,
            )

            # Stage 1: Scrape contractors from the GAF directory
            contractors = await asyncio.to_thread(self._scraper.scrape_contractors, config)
            await self._repo.update_pipeline_progress(run_id, leads_scraped=len(contractors))

            lead_rows = [await self._repo.upsert_contractor(c) for c in contractors]

            # Stage 2: Research all contractors via Perplexity
            research_results = await self._researcher.research_all(contractors)
            for row, research in zip(lead_rows, research_results):
                await self._repo.update_research(
                    row["id"], research.get("summary", ""), research.get("sources", [])
                )

            # Stage 3: Enrich in parallel with a concurrency cap
            enriched_count = await self._enrich_parallel(
                lead_rows, contractors, research_results, request.postal_code, run_id
            )

            await self._repo.complete_pipeline_run(run_id, leads_enriched=enriched_count)

        except Exception as exc:
            await self._repo.fail_pipeline_run(run_id, str(exc))
            raise

    async def _enrich_parallel(
        self,
        lead_rows: list[dict],
        contractors: list,
        research_results: list[dict],
        search_postal_code: str,
        run_id: str,
    ) -> int:
        """Enrich all leads in parallel up to _ENRICH_CONCURRENCY at a time.

        Returns the count of successfully enriched leads.
        Each lead's enrichment result is written to DB immediately on completion.
        """
        sem = asyncio.Semaphore(_ENRICH_CONCURRENCY)

        async def enrich_one(row: dict, contractor, research: dict) -> bool:
            async with sem:
                try:
                    insight = await asyncio.to_thread(
                        self._enricher.enrich,
                        contractor,
                        research,
                        search_postal_code=search_postal_code,
                    )
                    await self._repo.update_enrichment(row["id"], insight)
                    return True
                except Exception as exc:
                    logger.exception("Enrichment failed for lead %s", row["id"])
                    await self._repo.mark_lead_failed(row["id"], str(exc))
                    return False

        results = await asyncio.gather(
            *[enrich_one(row, contractor, research)
              for row, contractor, research in zip(lead_rows, contractors, research_results)],
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)
