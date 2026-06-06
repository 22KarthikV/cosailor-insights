"""FastAPI router for pipeline trigger and status-polling endpoints.

POST /run             — starts a pipeline BackgroundTask and returns 202 immediately.
GET  /status/{run_id} — polls the pipeline_runs table for current progress.

The pipeline runs as a FastAPI BackgroundTask so the HTTP response is returned
before the (potentially long) scrape / research / enrich work finishes.
Callers must poll /status/{run_id} at their chosen interval until status is
'completed' or 'failed'.
"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from supabase import acreate_client

from app.config import settings
from app.database import get_supabase
from app.models.lead import PipelineRunRequest, PipelineRunResponse, PipelineStatusResponse
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.pipeline import PipelineService
from app.services.playwright_scraper import PlaywrightScraper
from app.services.researcher import ContractorResearcher
from app.services.scraper import GafScraper

router = APIRouter()


def _run_to_status(run: dict) -> dict:
    """Map a pipeline_runs DB row to the PipelineStatusResponse shape."""
    return {**run, "run_id": run["id"]}


@router.post("/run", status_code=202, response_model=PipelineRunResponse)
async def run_pipeline(body: PipelineRunRequest, background_tasks: BackgroundTasks):
    """Queue a pipeline run and return 202 with a run_id for status polling.

    Instantiates PlaywrightScraper or GafScraper based on body.scraper.
    All four service dependencies are constructed here so they share the same
    Supabase client and API credentials for the lifetime of the background task.
    """
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    repo = LeadRepository(client)
    run_id = await repo.create_pipeline_run(
        postal_code=body.postal_code,
        country_code=body.country_code,
        distance=body.distance,
    )

    scraper = (
        PlaywrightScraper()
        if body.scraper == "playwright"
        else GafScraper(api_key=settings.firecrawl_api_key)
    )

    service = PipelineService(
        scraper=scraper,
        researcher=ContractorResearcher(api_key=settings.perplexity_api_key),
        enricher=LeadEnricher(api_key=settings.anthropic_api_key),
    )

    background_tasks.add_task(service.execute, run_id, body)

    return PipelineRunResponse(
        run_id=run_id,
        status="running",
        message=f"Pipeline started. Poll /api/pipeline/status/{run_id} for progress.",
    )


@router.get("/latest", response_model=PipelineStatusResponse)
async def latest_pipeline_run():
    """Return the most recent pipeline run regardless of status. Raises 404 when none exist."""
    repo = LeadRepository(await get_supabase())
    run = await repo.get_latest_pipeline_run()
    if not run:
        raise HTTPException(status_code=404, detail="No pipeline runs found")
    return _run_to_status(run)


@router.get("/status/{run_id}", response_model=PipelineStatusResponse)
async def pipeline_status(run_id: str):
    """Return current state of a pipeline run. Raises 404 when run_id is unknown."""
    repo = LeadRepository(await get_supabase())
    run = await repo.get_pipeline_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    return _run_to_status(run)
