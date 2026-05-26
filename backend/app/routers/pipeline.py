from fastapi import APIRouter, BackgroundTasks, HTTPException
from supabase import acreate_client

from app.config import settings
from app.models.lead import PipelineRunRequest, PipelineRunResponse, PipelineStatusResponse
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.pipeline import PipelineService
from app.services.researcher import ContractorResearcher
from app.services.scraper import GafScraper

router = APIRouter()


@router.post("/run", status_code=202, response_model=PipelineRunResponse)
async def run_pipeline(body: PipelineRunRequest, background_tasks: BackgroundTasks):
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    repo = LeadRepository(client)
    run_id = await repo.create_pipeline_run(
        postal_code=body.postal_code,
        country_code=body.country_code,
        distance=body.distance,
    )

    service = PipelineService(
        repo=repo,
        scraper=GafScraper(api_key=settings.firecrawl_api_key),
        researcher=ContractorResearcher(api_key=settings.perplexity_api_key),
        enricher=LeadEnricher(api_key=settings.anthropic_api_key),
    )

    background_tasks.add_task(service.execute, run_id, body)

    return PipelineRunResponse(
        run_id=run_id,
        status="running",
        message=f"Pipeline started. Poll /api/pipeline/status/{run_id} for progress.",
    )


@router.get("/status/{run_id}", response_model=PipelineStatusResponse)
async def pipeline_status(run_id: str):
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    repo = LeadRepository(client)
    run = await repo.get_pipeline_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    # Supabase returns "id"; PipelineStatusResponse expects "run_id"
    return {**run, "run_id": run["id"]}
