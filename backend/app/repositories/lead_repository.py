"""Data-access layer for leads and pipeline runs.

All Supabase calls are isolated here so that routers and services never import
or instantiate the Supabase client directly. The interface follows the standard
repository pattern: upsert / get / update / mark-failed for leads, plus a set
of pipeline-run tracking helpers used by PipelineService.
"""
from datetime import datetime, timezone
from app.models.lead import ContractorRecord, LeadInsight


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
        return result.data[0]

    async def get_all_leads(self) -> list[dict]:
        """Return all leads ordered by priority_index descending.

        Falls back to ordering by lead_score when priority_index does not yet
        exist in the schema (e.g. the scoring-redesign migration is pending).
        """
        try:
            result = (
                await self._client.table("leads")
                .select("*")
                .order("priority_index", desc=True, nullsfirst=False)
                .execute()
            )
        except Exception:
            # Fallback: priority_index column may not exist if migration is pending
            result = (
                await self._client.table("leads")
                .select("*")
                .order("lead_score", desc=True)
                .execute()
            )
        return result.data or []

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

    async def update_research(self, lead_id: str, summary: str, sources: list[str]) -> dict:
        """Persist Perplexity research results and advance the lead status to 'researched'."""
        result = (
            await self._client.table("leads")
            .update({
                "research_summary": summary,
                "research_sources": sources,
                "status": "researched",
                "researched_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", lead_id)
            .execute()
        )
        return result.data[0]

    async def update_enrichment(self, lead_id: str, insight: LeadInsight) -> dict:
        """Persist Claude AI enrichment output and advance the lead status to 'enriched'."""
        result = (
            await self._client.table("leads")
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
        return result.data[0]

    async def mark_lead_failed(self, lead_id: str, error: str) -> None:
        """Record an enrichment failure. Truncates the error message to 500 characters to fit the column."""
        await (
            self._client.table("leads")
            .update({"status": "failed", "error_message": error[:500]})
            .eq("id", lead_id)
            .execute()
        )

    # ── Pipeline run tracking ──────────────────────────────────────────────

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
