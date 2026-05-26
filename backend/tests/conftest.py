import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from datetime import datetime, timezone


@pytest.fixture
def sample_contractor():
    from app.models.lead import ContractorRecord
    return ContractorRecord(
        company_name="Acme Roofing Inc",
        city="New York",
        state="NY",
        postal_code="10013",
        country_code="us",
        phone="212-555-0100",
        website="https://acmeroofing.com",
        certifications=["GAF Master Elite"],
        rating=4.8,
        review_count=47,
    )


@pytest.fixture
def sample_lead_row():
    return {
        "id": str(uuid4()),
        "company_name": "Acme Roofing Inc",
        "city": "New York",
        "state": "NY",
        "postal_code": "10013",
        "country_code": "us",
        "phone": "212-555-0100",
        "website": "https://acmeroofing.com",
        "certifications": ["GAF Master Elite"],
        "rating": 4.8,
        "review_count": 47,
        "lead_score": 9,
        "score_rationale": "Master Elite certified, strong reviews",
        "ai_summary": "Acme Roofing is a high-priority lead.",
        "talking_points": ["Point 1", "Point 2", "Point 3"],
        "recommended_approach": "Call the owner directly.",
        "status": "enriched",
        "research_summary": "Strong web presence.",
        "research_sources": [],
        "error_message": None,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
