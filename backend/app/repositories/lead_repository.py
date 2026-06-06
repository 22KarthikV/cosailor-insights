"""Data-access layer for leads and pipeline runs.

All Supabase calls are isolated here so that routers and services never import
or instantiate the Supabase client directly. The interface follows the standard
repository pattern: upsert / get / update / mark-failed for leads, plus a set
of pipeline-run tracking helpers used by PipelineService.
"""
import logging
from datetime import datetime, timezone
from app.models.lead import ContractorRecord, LeadInsight

logger = logging.getLogger(__name__)


class LeadRepository:
    """Async repository wrapping the Supabase leads and pipeline_runs tables."""

    def __init__(self, client):
        self._client = client

    async def upsert_contractor(self, contractor: ContractorRecord) -> dict:
        """Insert or update a contractor row, keyed on gaf_contractor_id.

        Preserves the existing status for leads already in 'researched' or 'enriched'
        state so that re-running the pipeline does not reset enriched leads to 'scraped'.
        Falls back to a plain insert when gaf_contractor_id is None.
        """
        preserved_status: str | None = None
        if contractor.gaf_contractor_id:
            check = (
                await self._client.table("leads")
                .select("status")
                .eq("gaf_contractor_id", contractor.gaf_contractor_id)
                .execute()
            )
            if check.data and check.data[0]["status"] in ("researched", "enriched"):
                preserved_status = check.data[0]["status"]

        row = {
            "company_name": contractor.company_name,
            "gaf_contractor_id": contractor.gaf_contractor_id,
            "address": contractor.address,
            "city": contractor.city,
            "state": contractor.state,
            "postal_code": contractor.postal_code,
            "country_code": contractor.country_code,
            "phone": contractor.phone,
            "website": contractor.website,
            "gaf_profile_url": contractor.gaf_profile_url,
            "certifications": contractor.certifications,
            "years_in_business": contractor.years_in_business,
            "service_area": contractor.service_area,
            "rating": float(contractor.rating) if contractor.rating else None,
            "review_count": contractor.review_count,
            "status": preserved_status or "scraped",
        }
        result = (
            await self._client.table("leads")
            .upsert(row, on_conflict="gaf_contractor_id")
            .execute()
        )
        if result.data:
            return result.data[0]
        # Supabase may return empty data when the upsert resolved to a no-op update.
        # Fall back to a SELECT only when gaf_contractor_id is available for lookup.
        if contractor.gaf_contractor_id:
            select = (
                await self._client.table("leads")
                .select("*")
                .eq("gaf_contractor_id", contractor.gaf_contractor_id)
                .single()
                .execute()
            )
            return select.data
        raise RuntimeError(
            f"upsert returned no data and contractor has no gaf_contractor_id: {contractor.company_name}"
        )

    async def get_all_leads(
        self,
        page: int = 1,
        limit: int = 12,
        score_tier: str | None = None,
        sort_by: str | None = None,
    ) -> dict:
        """Return a filtered, sorted page of leads with an accurate total count.

        score_tier filters by lead_score range server-side so pagination totals
        reflect only the matching records — not the full table.
        sort_by controls ordering: 'score_desc' (default), 'name_asc', 'recently_enriched'.
        """
        offset = (page - 1) * limit
        query = self._client.table("leads").select("*", count="exact")

        if score_tier == "high":
            query = query.gte("lead_score", 8).lte("lead_score", 10)
        elif score_tier == "medium":
            query = query.gte("lead_score", 5).lte("lead_score", 7)
        elif score_tier == "low":
            query = query.gte("lead_score", 1).lte("lead_score", 4)

        if sort_by == "name_asc":
            query = query.order("company_name", desc=False)
        elif sort_by == "recently_enriched":
            query = query.order("enriched_at", desc=True, nullsfirst=False)
        else:
            query = query.order("priority_index", desc=True, nullsfirst=False)

        try:
            result = await query.range(offset, offset + limit - 1).execute()
        except Exception as exc:
            raise RuntimeError(
                f"Failed to fetch leads (page={page}, limit={limit}, "
                f"score_tier={score_tier}, sort_by={sort_by})"
            ) from exc

        return {
            "leads": result.data or [],
            "total": result.count or 0,
            "page": page,
            "limit": limit,
        }

    async def get_lead_by_id(self, lead_id: str) -> dict | None:
        """Fetch a single lead row by UUID. Returns None if not found."""
        result = (
            await self._client.table("leads")
            .select("*")
            .eq("id", lead_id)
            .single()
            .execute()
        )
        return result.data

    async def update_research(self, lead_id: str, summary: str, sources: list[str]) -> None:
        """Persist Perplexity research results and advance the lead status to 'researched'."""
        await (
            self._client.table("leads")
            .update({
                "research_summary": summary,
                "research_sources": sources,
                "status": "researched",
                "researched_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", lead_id)
            .execute()
        )

    async def update_enrichment(self, lead_id: str, insight: LeadInsight) -> None:
        """Persist Claude AI enrichment output and advance the lead status to 'enriched'."""
        await (
            self._client.table("leads")
            .update({
                "lead_score":               insight.lead_score,
                "score_rationale":          insight.score_rationale,
                "convertibility_score":     insight.convertibility_score,
                "convertibility_rationale": insight.convertibility_rationale,
                "distance_miles":           insight.distance_miles,
                "distance_band":            insight.distance_band,
                "priority_index":           insight.priority_index,
                "ai_summary":               insight.ai_summary,
                "talking_points":           insight.talking_points,
                "recommended_approach":     insight.recommended_approach,
                "status":                   "enriched",
                "enriched_at":              datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", lead_id)
            .execute()
        )

    async def mark_lead_failed(self, lead_id: str, error: str) -> None:
        """Record an enrichment failure. Truncates the error message to 500 characters to fit the column."""
        await (
            self._client.table("leads")
            .update({"status": "failed", "error_message": error[:500]})
            .eq("id", lead_id)
            .execute()
        )

    # ── Pipeline run tracking ──────────────────────────────────────────────

    async def interrupt_stale_runs(self) -> int:
        """Mark any pipeline_runs stuck in 'running' as failed with an interrupted message.

        Called once at server startup so runs orphaned by a previous server
        restart are never left displayed as 'running' forever in the UI.
        Returns the number of rows updated.
        """
        result = (
            await self._client.table("pipeline_runs")
            .update({
                "status": "failed",
                "error_message": "Server restarted — pipeline was interrupted. Re-run to resume (already-enriched leads will be skipped).",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("status", "running")
            .execute()
        )
        count = len(result.data) if result.data else 0
        if count:
            logger.warning("Marked %d stale pipeline run(s) as failed on startup", count)
        return count

    async def get_latest_pipeline_run(self) -> dict | None:
        """Return the most recent pipeline_runs row regardless of status."""
        result = (
            await self._client.table("pipeline_runs")
            .select("*")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None

    async def create_pipeline_run(self, postal_code: str, country_code: str, distance: int) -> str:
        """Insert a new pipeline_runs row and return the generated UUID."""
        result = await (
            self._client.table("pipeline_runs")
            .insert({
                "postal_code": postal_code,
                "country_code": country_code,
                "distance": distance,
            })
            .execute()
        )
        return result.data[0]["id"]

    async def get_pipeline_run(self, run_id: str) -> dict | None:
        """Fetch a pipeline run by UUID for status polling."""
        result = (
            await self._client.table("pipeline_runs")
            .select("*")
            .eq("id", run_id)
            .single()
            .execute()
        )
        return result.data

    async def update_pipeline_progress(self, run_id: str, **kwargs) -> None:
        """Patch arbitrary columns on a pipeline run (e.g. the leads_scraped counter)."""
        await self._client.table("pipeline_runs").update(kwargs).eq("id", run_id).execute()

    async def complete_pipeline_run(self, run_id: str, leads_enriched: int) -> None:
        """Mark a pipeline run as completed and record the final enriched count."""
        await (
            self._client.table("pipeline_runs")
            .update({
                "status": "completed",
                "leads_enriched": leads_enriched,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", run_id)
            .execute()
        )

    async def fail_pipeline_run(self, run_id: str, error: str) -> None:
        """Mark a pipeline run as failed and store the error. Truncates to 500 characters."""
        await (
            self._client.table("pipeline_runs")
            .update({
                "status": "failed",
                "error_message": error[:500],
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", run_id)
            .execute()
        )
