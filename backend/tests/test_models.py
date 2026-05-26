def test_lead_insight_requires_convertibility_fields():
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
