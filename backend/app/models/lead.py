"""Pydantic models for the leads and pipeline domains.

ContractorRecord       — raw data returned by the GAF scraper
LeadInsight            — AI-enriched scoring output produced by LeadEnricher
LeadResponse           — full DB row shape returned by the leads API
PipelineRunRequest     — request body for POST /api/pipeline/run
PipelineRunResponse    — 202 response with run_id for status polling
PipelineStatusResponse — payload for GET /api/pipeline/status/{run_id}
"""
from datetime import datetime
from typing import Optional, Literal
from uuid import UUID
from pydantic import BaseModel, Field


class ContractorRecord(BaseModel):
    """Structured representation of a single GAF contractor as returned by the scraper.

    All fields beyond company_name are Optional because the GAF directory does not
    guarantee the presence of every field for every listing.
    """
    company_name: str
    gaf_contractor_id: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country_code: str = "us"
    phone: Optional[str] = None
    website: Optional[str] = None
    gaf_profile_url: Optional[str] = None
    certifications: list[str] = Field(default_factory=list)
    years_in_business: Optional[int] = None
    service_area: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None


class LeadInsight(BaseModel):
    """AI-generated scoring and sales intelligence for a single contractor.

    lead_score and convertibility_score are constrained to 1–10 by Field validators.
    ScoringService also enforces a ±1 clamp around each Python baseline after
    Claude responds, so the database never receives out-of-range values.
    """
    lead_score: int = Field(..., ge=1, le=10)
    score_rationale: str
    convertibility_score: int = Field(..., ge=1, le=10)
    convertibility_rationale: str
    distance_miles: Optional[float] = None
    distance_band: str = "near"       # 'near' | 'mid' | 'far'
    priority_index: float = 0.0       # composite rank: (lead + conv) / 2 × distance modifier
    ai_summary: str
    talking_points: list[str] = Field(..., min_length=1, max_length=3)
    recommended_approach: str


class LeadResponse(BaseModel):
    """API response shape for a single lead row from the database.

    Mirrors the leads table schema. All enrichment fields are Optional because a
    lead may still be in the 'scraped' or 'researched' state when queried.
    """
    id: UUID
    company_name: str
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country_code: str = "us"
    phone: Optional[str] = None
    website: Optional[str] = None
    certifications: list[str] = []
    rating: Optional[float] = None
    review_count: Optional[int] = None
    research_summary: Optional[str] = None
    lead_score: Optional[int] = None
    score_rationale: Optional[str] = None
    convertibility_score: Optional[int] = None
    convertibility_rationale: Optional[str] = None
    distance_miles: Optional[float] = None
    distance_band: Optional[str] = None
    priority_index: Optional[float] = None
    ai_summary: Optional[str] = None
    talking_points: list[str] = []
    recommended_approach: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    enriched_at: Optional[datetime] = None
    created_at: datetime


class PaginatedLeadsResponse(BaseModel):
    """Paginated response envelope for GET /api/leads."""
    leads: list[LeadResponse]
    total: int
    page: int
    limit: int


class PipelineRunRequest(BaseModel):
    """Parameters for triggering a new pipeline run via POST /api/pipeline/run."""
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25
    limit: Optional[int] = None   # test-only cap on number of contractors scraped
    scraper: Literal["firecrawl", "playwright"] = "playwright"


class PipelineRunResponse(BaseModel):
    """Immediate 202 response returned after a pipeline run is queued.

    Callers should use run_id to poll GET /api/pipeline/status/{run_id}.
    """
    run_id: UUID
    status: str
    message: str


class PipelineStatusResponse(BaseModel):
    """Current state of a pipeline run, returned by the status polling endpoint."""
    run_id: UUID
    status: str   # 'running' | 'completed' | 'failed'
    leads_scraped: int
    leads_enriched: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
