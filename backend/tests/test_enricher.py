import pytest
from unittest.mock import MagicMock, patch

MOCK_JSON = """{
  "lead_score": 9,
  "score_rationale": "Master Elite certified, strong reviews.",
  "ai_summary": "Acme Roofing is a top-tier GAF contractor in NYC with 47 5-star reviews. Master Elite status makes them ideal for distributor outreach.",
  "talking_points": [
    "As a Master Elite contractor you qualify for exclusive GAF volume rebates — let's review what's available.",
    "With 47 reviews at 4.8 stars your reputation is a competitive advantage — GAF warranty programs amplify this.",
    "Timberline HDZ demand is strong in NYC — your certification positions you to capture that market."
  ],
  "recommended_approach": "Open with a call to the owner referencing their Master Elite status. Lead with the rebate program then discuss new product availability."
}"""


def test_enricher_parses_clean_json(sample_contractor):
    from app.services.enricher import LeadEnricher
    from app.models.lead import LeadInsight

    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=MOCK_JSON)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    with patch("app.services.enricher.Anthropic", return_value=mock_client):
        enricher = LeadEnricher(api_key="test-key")
        insight = enricher.enrich(sample_contractor, {"summary": "Strong.", "sources": []})

    assert isinstance(insight, LeadInsight)
    assert insight.lead_score == 9
    assert len(insight.talking_points) == 3


def test_enricher_strips_markdown_fences(sample_contractor):
    from app.services.enricher import LeadEnricher

    fenced = f"```json\n{MOCK_JSON}\n```"
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=fenced)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    with patch("app.services.enricher.Anthropic", return_value=mock_client):
        enricher = LeadEnricher(api_key="test-key")
        insight = enricher.enrich(sample_contractor, {"summary": "Strong.", "sources": []})

    assert insight.lead_score == 9


def test_enricher_clamps_score_out_of_range(sample_contractor):
    import json
    from app.services.enricher import LeadEnricher

    bad = json.dumps({
        "lead_score": 15,
        "score_rationale": "r",
        "ai_summary": "s",
        "talking_points": ["a", "b", "c"],
        "recommended_approach": "x",
    })
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=bad)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    with patch("app.services.enricher.Anthropic", return_value=mock_client):
        enricher = LeadEnricher(api_key="test-key")
        insight = enricher.enrich(sample_contractor, {})

    assert 1 <= insight.lead_score <= 10
