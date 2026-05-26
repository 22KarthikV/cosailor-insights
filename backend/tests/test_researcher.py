import pytest
from unittest.mock import AsyncMock, MagicMock, patch

MOCK_PERPLEXITY_RESPONSE = {
    "choices": [{"message": {"content": "Acme Roofing is strong in NYC. A+ BBB rating. Uses GAF products."}}],
    "citations": ["https://bbb.org/acme", "https://yelp.com/acme"],
}


@pytest.mark.asyncio
async def test_researcher_returns_summary_and_sources(sample_contractor):
    from app.services.researcher import ContractorResearcher

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = MOCK_PERPLEXITY_RESPONSE
    mock_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("app.services.researcher.httpx.AsyncClient", return_value=mock_client):
        researcher = ContractorResearcher(api_key="test-key")
        result = await researcher.research(sample_contractor)

    assert "summary" in result
    assert "sources" in result
    assert "Acme Roofing" in result["summary"]
    assert len(result["sources"]) == 2


@pytest.mark.asyncio
async def test_researcher_returns_empty_dict_on_api_error(sample_contractor):
    from app.services.researcher import ContractorResearcher

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(side_effect=Exception("network error"))

    with patch("app.services.researcher.httpx.AsyncClient", return_value=mock_client):
        researcher = ContractorResearcher(api_key="test-key")
        result = await researcher.research(sample_contractor)

    assert result == {"summary": "", "sources": []}
