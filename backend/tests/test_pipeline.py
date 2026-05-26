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
        convertibility_score=8, convertibility_rationale="High conversion potential.",
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
        convertibility_score=6, convertibility_rationale="Medium conversion potential.",
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
