"""FastAPI router for lead CRUD endpoints.

Mounted at /api/leads by main.py. A fresh Supabase async client is
created per request — there is no shared connection pool because the
Supabase Python client manages its own HTTP sessions internally.
"""
from fastapi import APIRouter, HTTPException, Query

from app.database import get_supabase
from app.models.lead import LeadResponse, PaginatedLeadsResponse
from app.repositories.lead_repository import LeadRepository

router = APIRouter()


async def _get_repo() -> LeadRepository:
    """Return a repository backed by the shared singleton Supabase client."""
    return LeadRepository(await get_supabase())


@router.get("/", response_model=PaginatedLeadsResponse)
async def list_leads(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=100),
    score_tier: str | None = Query(default=None, pattern="^(high|medium|low)$"),
    sort_by: str | None = Query(default=None, pattern="^(score_desc|name_asc|recently_enriched)$"),
):
    """Return a filtered, sorted page of leads with an accurate total for pagination."""
    repo = await _get_repo()
    try:
        result = await repo.get_all_leads(page=page, limit=limit, score_tier=score_tier, sort_by=sort_by)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail="Unable to retrieve leads at this time") from exc
    return result


@router.get("/{lead_id}", response_model=LeadResponse)
async def get_lead(lead_id: str):
    """Return a single lead by UUID. Raises 404 when not found."""
    repo = await _get_repo()
    row = await repo.get_lead_by_id(lead_id)
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    return row


@router.delete("/")
async def delete_all_leads():
    """Dev utility: delete every lead row. Should not be exposed in production."""
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    result = (
        await client.table("leads")
        .delete()
        # Supabase requires at least one filter on DELETE; the zero UUID is never a real row.
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
    )
    return {"deleted": len(result.data)}
