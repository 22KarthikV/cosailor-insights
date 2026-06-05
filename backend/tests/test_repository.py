"""Tests for LeadRepository (repositories/lead_repository.py).

Uses MagicMock to simulate the Supabase async client without hitting the
database. The Supabase query builder is entirely synchronous until .execute()
which returns a coroutine — the mocks reflect this pattern.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4


@pytest.mark.asyncio
async def test_upsert_contractor_returns_row_with_id(sample_contractor):
    """upsert_contractor returns the newly created or updated row dict."""
    from app.repositories.lead_repository import LeadRepository

    new_id = str(uuid4())
    mock_result = MagicMock()
    mock_result.data = [{"id": new_id, "company_name": "Acme Roofing Inc"}]

    # Supabase query chain is SYNCHRONOUS until .execute() which is async
    mock_table = MagicMock()
    # SELECT guard is not called when gaf_contractor_id is None, but mock it
    # explicitly so the test stays correct if sample_contractor gains a gaf_contractor_id later.
    mock_table.select.return_value.eq.return_value.execute = AsyncMock(
        return_value=MagicMock(data=[])
    )
    mock_table.upsert.return_value.execute = AsyncMock(return_value=mock_result)

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    repo = LeadRepository(client=mock_client)
    result = await repo.upsert_contractor(sample_contractor)

    assert result["id"] == new_id
    mock_client.table.assert_called_with("leads")


@pytest.mark.asyncio
async def test_get_all_leads_returns_list_ordered_by_score(sample_lead_row):
    """get_all_leads returns the list from Supabase as-is."""
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
@pytest.mark.parametrize("protected_status", ["enriched", "researched"])
async def test_upsert_contractor_preserves_protected_status(sample_contractor, protected_status):
    """Re-running upsert on a lead with 'enriched' or 'researched' status must not reset it to 'scraped'."""
    from app.repositories.lead_repository import LeadRepository

    lead_id = str(uuid4())

    check_result = MagicMock()
    check_result.data = [{"status": protected_status}]

    upsert_result = MagicMock()
    upsert_result.data = [{"id": lead_id, "status": protected_status}]

    mock_table = MagicMock()
    mock_table.select.return_value.eq.return_value.execute = AsyncMock(return_value=check_result)
    mock_table.upsert.return_value.execute = AsyncMock(return_value=upsert_result)

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    # Use a contractor with a gaf_contractor_id so the SELECT guard fires
    from app.models.lead import ContractorRecord
    contractor = ContractorRecord(
        company_name="Existing Co",
        gaf_contractor_id="existing-gaf-456",
    )

    repo = LeadRepository(client=mock_client)
    result = await repo.upsert_contractor(contractor)

    upsert_payload = mock_table.upsert.call_args[0][0]
    assert upsert_payload["status"] == protected_status
    assert result["status"] == protected_status


@pytest.mark.asyncio
async def test_upsert_contractor_new_lead_with_gaf_id_gets_scraped_status():
    """When gaf_contractor_id is set but no existing row is found, status defaults to 'scraped'."""
    from app.repositories.lead_repository import LeadRepository
    from app.models.lead import ContractorRecord

    lead_id = str(uuid4())

    # SELECT returns empty (new lead — no existing row)
    check_result = MagicMock()
    check_result.data = []

    upsert_result = MagicMock()
    upsert_result.data = [{"id": lead_id, "status": "scraped"}]

    mock_table = MagicMock()
    # SELECT chain: .select().eq().execute()
    mock_table.select.return_value.eq.return_value.execute = AsyncMock(return_value=check_result)
    # UPSERT chain: .upsert().execute()
    mock_table.upsert.return_value.execute = AsyncMock(return_value=upsert_result)

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    contractor = ContractorRecord(
        company_name="New Co",
        gaf_contractor_id="new-gaf-123",
    )
    repo = LeadRepository(client=mock_client)
    result = await repo.upsert_contractor(contractor)

    upsert_payload = mock_table.upsert.call_args[0][0]
    assert upsert_payload["status"] == "scraped"
    assert result["id"] == lead_id


@pytest.mark.asyncio
async def test_update_enrichment_sets_status_to_enriched():
    """update_enrichment writes all LeadInsight fields and sets status='enriched'."""
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
