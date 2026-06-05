"""Tests for PipelineService (services/pipeline.py).

Verifies the three-stage orchestration flow: correct delegation to scraper,
researcher, and enricher; per-lead failure isolation; and accurate completion
counts written back to the pipeline_runs table.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4


@pytest.fixture
def _insight():
    """A valid LeadInsight used as the enricher's return value in pipeline tests."""
    from app.models.lead import LeadInsight
    return LeadInsight(
        lead_score=9,
        score_rationale="Master Elite certified, strong reviews.",
        convertibility_score=7,
        convertibility_rationale="Growth signals and competitor brands detected.",
        distance_miles=5.2,
        distance_band="near",
        priority_index=8.0,
        ai_summary="High priority.",
        talking_points=["P1", "P2", "P3"],
        recommended_approach="Call owner.",
    )


@pytest.mark.asyncio
async def test_pipeline_execute_stores_all_enriched_leads(sample_contractor, sample_lead_row, _insight):
    """A single-contractor run calls all three stages and marks the run as completed."""
    from app.services.pipeline import PipelineService

    run_id = str(uuid4())

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
    mock_enricher.enrich.return_value = _insight

    service = PipelineService(
        repo=mock_repo,
        scraper=mock_scraper,
        researcher=mock_researcher,
        enricher=mock_enricher,
    )

    await service.execute(
        run_id=run_id,
        request=MagicMock(postal_code="10013", country_code="us", distance=25, limit=None),
    )

    mock_scraper.scrape_contractors.assert_called_once()
    mock_researcher.research_all.assert_called_once()
    mock_enricher.enrich.assert_called_once_with(
        sample_contractor,
        {"summary": "Good.", "sources": []},
        search_postal_code="10013",
    )
    mock_repo.update_enrichment.assert_called_once()
    mock_repo.complete_pipeline_run.assert_called_once_with(run_id, leads_enriched=1)


@pytest.mark.asyncio
async def test_pipeline_enriches_multiple_leads(sample_contractor, sample_lead_row, _insight):
    """A three-contractor run calls enrich() and update_enrichment() exactly three times."""
    from app.services.pipeline import PipelineService

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
    mock_enricher.enrich.return_value = _insight

    service = PipelineService(
        repo=mock_repo,
        scraper=mock_scraper,
        researcher=mock_researcher,
        enricher=mock_enricher,
    )

    await service.execute(
        run_id="run-123",
        request=MagicMock(postal_code="10013", country_code="us", distance=25, limit=None),
    )

    assert mock_enricher.enrich.call_count == 3
    assert mock_repo.update_enrichment.call_count == 3
    mock_repo.complete_pipeline_run.assert_called_once_with("run-123", leads_enriched=3)


@pytest.mark.asyncio
async def test_pipeline_continues_when_one_enrichment_fails(sample_contractor, sample_lead_row, _insight):
    """A per-lead enrichment failure is isolated: the failed lead is marked failed,
    the remaining lead is enriched, and the run completes with leads_enriched=1."""
    from app.services.pipeline import PipelineService

    mock_repo = AsyncMock()
    mock_repo.update_pipeline_progress = AsyncMock()
    mock_repo.upsert_contractor.side_effect = [
        {**sample_lead_row, "id": "lead-0"},
        {**sample_lead_row, "id": "lead-1"},
    ]
    mock_repo.update_enrichment = AsyncMock()
    mock_repo.mark_lead_failed = AsyncMock()
    mock_repo.complete_pipeline_run = AsyncMock()

    mock_scraper = MagicMock()
    mock_scraper.scrape_contractors.return_value = [sample_contractor] * 2

    mock_researcher = AsyncMock()
    mock_researcher.research_all.return_value = [{"summary": "Ok.", "sources": []}] * 2

    mock_enricher = MagicMock()
    mock_enricher.enrich.side_effect = [RuntimeError("API timeout"), _insight]

    service = PipelineService(
        repo=mock_repo,
        scraper=mock_scraper,
        researcher=mock_researcher,
        enricher=mock_enricher,
    )

    await service.execute(
        run_id="run-fail",
        request=MagicMock(postal_code="10013", country_code="us", distance=25, limit=None),
    )

    assert mock_enricher.enrich.call_count == 2
    mock_repo.mark_lead_failed.assert_called_once()
    assert mock_repo.update_enrichment.call_count == 1
    mock_repo.complete_pipeline_run.assert_called_once_with("run-fail", leads_enriched=1)


@pytest.mark.asyncio
async def test_pipeline_uses_semaphore_for_parallel_enrichment(sample_contractor, sample_lead_row, _insight):
    """Enrichment runs via asyncio.gather() — all enrich() calls happen before complete_pipeline_run."""
    import asyncio
    from app.services.pipeline import PipelineService

    call_order = []

    mock_repo = AsyncMock()
    mock_repo.update_pipeline_progress = AsyncMock()
    mock_repo.upsert_contractor.side_effect = [
        {**sample_lead_row, "id": f"lead-{i}"} for i in range(3)
    ]

    async def fake_update_enrichment(lead_id, insight):
        call_order.append(("enriched", lead_id))

    mock_repo.update_enrichment.side_effect = fake_update_enrichment
    mock_repo.complete_pipeline_run = AsyncMock(
        side_effect=lambda *a, **kw: call_order.append(("completed",))
    )

    mock_scraper = MagicMock()
    mock_scraper.scrape_contractors.return_value = [sample_contractor] * 3

    mock_researcher = AsyncMock()
    mock_researcher.research_all.return_value = [{"summary": "Ok.", "sources": []}] * 3

    mock_enricher = MagicMock()
    mock_enricher.enrich.return_value = _insight

    service = PipelineService(
        repo=mock_repo,
        scraper=mock_scraper,
        researcher=mock_researcher,
        enricher=mock_enricher,
    )

    await service.execute(
        run_id="run-parallel",
        request=MagicMock(postal_code="10013", country_code="us", distance=25, limit=None, scraper="playwright"),
    )

    # All three enrichments must complete before the run is marked completed
    completed_idx = next(i for i, e in enumerate(call_order) if e[0] == "completed")
    enriched_indices = [i for i, e in enumerate(call_order) if e[0] == "enriched"]
    assert all(i < completed_idx for i in enriched_indices)
    assert len(enriched_indices) == 3
