import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4


@pytest.mark.asyncio
async def test_upsert_contractor_returns_row_with_id(sample_contractor):
    from app.repositories.lead_repository import LeadRepository

    new_id = str(uuid4())
    mock_result = MagicMock()
    mock_result.data = [{"id": new_id, "company_name": "Acme Roofing Inc"}]

    # supabase query chain is SYNCHRONOUS until .execute() which is async
    mock_table = MagicMock()
    mock_table.upsert.return_value.execute = AsyncMock(return_value=mock_result)

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    repo = LeadRepository(client=mock_client)
    result = await repo.upsert_contractor(sample_contractor)

    assert result["id"] == new_id
    mock_client.table.assert_called_with("leads")


@pytest.mark.asyncio
async def test_get_all_leads_returns_list_ordered_by_score(sample_lead_row):
    from app.repositories.lead_repository import LeadRepository

    mock_result = MagicMock()
    mock_result.data = [sample_lead_row]

    # .select().order().execute() — all sync except execute
    mock_table = MagicMock()
    mock_table.select.return_value.order.return_value.execute = AsyncMock(
        return_value=mock_result
    )

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    repo = LeadRepository(client=mock_client)
    leads = await repo.get_all_leads()

    assert len(leads) == 1
    assert leads[0]["company_name"] == "Acme Roofing Inc"


@pytest.mark.asyncio
async def test_update_enrichment_sets_status_to_enriched():
    from app.models.lead import LeadInsight
    from app.repositories.lead_repository import LeadRepository

    lead_id = str(uuid4())
    insight = LeadInsight(
        lead_score=9,
        score_rationale="Master Elite",
        convertibility_score=7,
        convertibility_rationale="Competitor brands detected.",
        distance_miles=5.2,
        distance_band="near",
        priority_index=8.0,
        ai_summary="High priority lead.",
        talking_points=["Point 1", "Point 2", "Point 3"],
        recommended_approach="Call owner.",
    )

    mock_result = MagicMock()
    mock_result.data = [{"id": lead_id}]
    # .update().eq().execute() — all sync except execute
    mock_table = MagicMock()
    mock_table.update.return_value.eq.return_value.execute = AsyncMock(return_value=mock_result)
    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    repo = LeadRepository(client=mock_client)
    result = await repo.update_enrichment(lead_id, insight)

    assert result["id"] == lead_id
    call_data = mock_table.update.call_args[0][0]
    assert call_data["lead_score"] == 9
    assert call_data["convertibility_score"] == 7
    assert call_data["status"] == "enriched"
