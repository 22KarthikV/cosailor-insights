import pytest
from unittest.mock import MagicMock, patch


def _make_mock_result(contractors_data: list | None = None) -> MagicMock:
    """Build a mock ScrapeResponse where json_field matches firecrawl-py 2.x structure."""
    mock_result = MagicMock()
    if contractors_data is None:
        mock_result.json_field = None
    else:
        mock_result.json_field = {"contractors": contractors_data}
    return mock_result


def test_scraper_url_uses_configurable_params():
    """Scraper URL must use postal_code, country_code, and distance — never hardcoded."""
    from app.services.scraper import GafScraper
    from app.config import ScraperConfig

    mock_app = MagicMock()
    mock_app.scrape_url.return_value = _make_mock_result([])

    config = ScraperConfig(postal_code="10001", country_code="us", distance=50)

    with patch("app.services.scraper.FirecrawlApp", return_value=mock_app):
        scraper = GafScraper(api_key="test-key")
        scraper.scrape_contractors(config)

    called_url = mock_app.scrape_url.call_args[0][0]
    assert "postalCode=10001" in called_url
    assert "countryCode=us" in called_url
    assert "distance=50" in called_url


def test_scraper_returns_contractor_records():
    """Scraper maps Firecrawl response to ContractorRecord list."""
    from app.services.scraper import GafScraper
    from app.config import ScraperConfig

    contractor_dict = {
        "company_name": "Acme Roofing Inc",
        "city": "New York",
        "state": "NY",
        "postal_code": "10013",
        "country_code": "us",
        "phone": "212-555-0100",
        "website": "https://acmeroofing.com",
        "gaf_profile_url": None,
        "certifications": ["GAF Master Elite"],
        "rating": 4.8,
        "review_count": 47,
        "years_in_business": None,
        "service_area": None,
        "address": None,
        "gaf_contractor_id": None,
    }

    mock_app = MagicMock()
    mock_app.scrape_url.return_value = _make_mock_result([contractor_dict])

    with patch("app.services.scraper.FirecrawlApp", return_value=mock_app):
        scraper = GafScraper(api_key="test-key")
        contractors = scraper.scrape_contractors(ScraperConfig(postal_code="10013"))

    assert len(contractors) == 1
    assert contractors[0].company_name == "Acme Roofing Inc"
    assert contractors[0].rating == 4.8
    assert "GAF Master Elite" in contractors[0].certifications


def test_scraper_handles_null_json_gracefully():
    from app.services.scraper import GafScraper
    from app.config import ScraperConfig

    mock_app = MagicMock()
    mock_app.scrape_url.return_value = _make_mock_result(None)  # json_field is None

    with patch("app.services.scraper.FirecrawlApp", return_value=mock_app):
        scraper = GafScraper(api_key="test-key")
        result = scraper.scrape_contractors(ScraperConfig())

    assert result == []


def test_scraper_respects_limit():
    """limit=1 in ScraperConfig should return at most 1 contractor."""
    from app.services.scraper import GafScraper
    from app.config import ScraperConfig

    contractors_data = [{"company_name": f"Co {i}", "certifications": []} for i in range(5)]

    mock_app = MagicMock()
    mock_app.scrape_url.return_value = _make_mock_result(contractors_data)

    with patch("app.services.scraper.FirecrawlApp", return_value=mock_app):
        scraper = GafScraper(api_key="test-key")
        result = scraper.scrape_contractors(ScraperConfig(limit=1))

    assert len(result) == 1
