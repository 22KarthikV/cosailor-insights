from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class ContractorRecord(BaseModel):
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
    lead_score: int = Field(..., ge=1, le=10)
    score_rationale: str
    ai_summary: str
    talking_points: list[str] = Field(..., min_length=1, max_length=3)
    recommended_approach: str


class LeadResponse(BaseModel):
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
    ai_summary: Optional[str] = None
    talking_points: list[str] = []
    recommended_approach: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    enriched_at: Optional[datetime] = None
    created_at: datetime


class PipelineRunRequest(BaseModel):
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25
    limit: Optional[int] = None


class PipelineRunResponse(BaseModel):
    run_id: UUID
    status: str
    message: str


class PipelineStatusResponse(BaseModel):
    run_id: UUID
    status: str
    leads_scraped: int
    leads_enriched: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
