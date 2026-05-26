import logging

from app.config import ScraperConfig
from app.models.lead import PipelineRunRequest
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.researcher import ContractorResearcher
from app.services.scraper import GafScraper

logger = logging.getLogger(__name__)


class PipelineService:
    def __init__(
        self,
        repo: LeadRepository,
        scraper: GafScraper,
        researcher: ContractorResearcher,
        enricher: LeadEnricher,
    ):
        self._repo = repo
        self._scraper = scraper
        self._researcher = researcher
        self._enricher = enricher

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

            # Stage 3: Enrich with Claude + ScoringService
            enriched = 0
            for row, contractor, research in zip(lead_rows, contractors, research_results):
                try:
                    insight = self._enricher.enrich(
                        contractor,
                        research,
                        search_postal_code=request.postal_code,
                    )
                    await self._repo.update_enrichment(row["id"], insight)
                    enriched += 1
                except Exception as exc:
                    logger.exception("Enrichment failed for lead %s", row["id"])
                    await self._repo.mark_lead_failed(row["id"], str(exc))

            await self._repo.complete_pipeline_run(run_id, leads_enriched=enriched)

        except Exception as exc:
            await self._repo.fail_pipeline_run(run_id, str(exc))
            raise
