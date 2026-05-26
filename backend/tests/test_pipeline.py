import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4


@pytest.mark.asyncio
async def test_pipeline_execute_stores_all_enriched_leads(sample_contractor, sample_lead_row):
    from app.services.pipeline import PipelineService
    from app.models.lead import LeadInsight, PipelineRunRequest

    run_id = str(uuid4())
    insight = LeadInsight(
        lead_score=9, score_rationale="Master Elite",
        ai_summary="High priority.", talking_points=["P1", "P2", "P3"],
        recommended_approach="Call owner."
    )

    mock_repo = AsyncMock()
    mock_repo.create_pipeline_run.return_value = run_id
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
    mock_enricher.enrich.return_value = insight

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
    mock_enricher.enrich.assert_called_once()
    mock_repo.update_enrichment.assert_called_once()
    mock_repo.complete_pipeline_run.assert_called_once_with(run_id, leads_enriched=1)
