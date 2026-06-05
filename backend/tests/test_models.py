"""Tests for Pydantic model validation (models/lead.py).

Verifies that new scoring fields (convertibility, distance, priority_index)
have the expected optionality and default values, and that required fields
are enforced at model construction time.
"""


def test_lead_insight_requires_convertibility_fields():
    """LeadInsight raises when convertibility_score and convertibility_rationale are absent."""
    from app.models.lead import LeadInsight
    import pytest

    with pytest.raises(Exception):
        # Should fail: missing convertibility_score and convertibility_rationale
        LeadInsight(
            lead_score=7,
            score_rationale="Good lead.",
            ai_summary="Summary.",
            talking_points=["a", "b", "c"],
            recommended_approach="Call them.",
        )


def test_lead_insight_accepts_all_fields():
    """A fully-populated LeadInsight is constructed without errors."""
    from app.models.lead import LeadInsight

    insight = LeadInsight(
        lead_score=7,
        score_rationale="Good lead.",
        convertibility_score=5,
        convertibility_rationale="Some growth signals.",
        distance_miles=12.5,
        distance_band="near",
        priority_index=6.0,
        ai_summary="Summary.",
        talking_points=["a", "b", "c"],
        recommended_approach="Call them.",
    )
    assert insight.convertibility_score == 5
    assert insight.distance_band == "near"
    assert insight.priority_index == 6.0


def test_lead_response_new_fields_are_optional():
    """LeadResponse can be constructed without scoring-redesign fields (they default to None)."""
    from app.models.lead import LeadResponse
    from uuid import uuid4
    from datetime import datetime, timezone

    # Should not raise — all new fields are optional
    resp = LeadResponse(
        id=uuid4(),
        company_name="Test Co",
        status="scraped",
        created_at=datetime.now(timezone.utc),
    )
    assert resp.convertibility_score is None
    assert resp.distance_band is None
    assert resp.priority_index is None


def test_scraper_config_defaults_to_playwright():
    from app.config import ScraperConfig
    cfg = ScraperConfig()
    assert cfg.scraper == "playwright"


def test_scraper_config_accepts_firecrawl():
    from app.config import ScraperConfig
    cfg = ScraperConfig(scraper="firecrawl")
    assert cfg.scraper == "firecrawl"


def test_pipeline_run_request_scraper_defaults_to_playwright():
    from app.models.lead import PipelineRunRequest
    req = PipelineRunRequest()
    assert req.scraper == "playwright"


def test_scraper_config_rejects_invalid_scraper():
    from app.config import ScraperConfig
    import pytest
    with pytest.raises(ValueError, match="scraper must be"):
        ScraperConfig(scraper="selenium")
