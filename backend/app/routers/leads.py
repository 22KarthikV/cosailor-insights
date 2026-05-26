from fastapi import APIRouter, HTTPException
from supabase import acreate_client

from app.config import settings
from app.models.lead import LeadResponse
from app.repositories.lead_repository import LeadRepository

router = APIRouter()


async def _get_repo() -> LeadRepository:
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    return LeadRepository(client)


@router.get("/", response_model=list[LeadResponse])
async def list_leads():
    repo = await _get_repo()
    rows = await repo.get_all_leads()
    return rows


@router.get("/{lead_id}", response_model=LeadResponse)
async def get_lead(lead_id: str):
    repo = await _get_repo()
    row = await repo.get_lead_by_id(lead_id)
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    return row


@router.delete("/")
async def delete_all_leads():
    """Dev utility: clear all leads."""
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    result = (
        await client.table("leads")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
    )
    return {"deleted": len(result.data)}
