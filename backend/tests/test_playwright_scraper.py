"""Tests for PlaywrightScraper (services/playwright_scraper.py).

The scraper uses a Playwright + Coveo API hybrid:
  Phase 1 — Playwright (headless=False) captures the first Coveo batch and
             auth token from request/response interception during page load.
  Phase 2 — httpx paginates through remaining Coveo pages using the token.

Tests simulate both phases by mocking the Playwright request/response handlers
and the httpx calls made by _paginate_coveo.
"""
import json
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_COVEO_URL = (
    "https://gafmaterialscorporationproduction3yalqk12.org.coveo.com/rest/search/v2"
    "?organizationId=gafmaterialscorporationproduction3yalqk12"
)
_TOKEN = "Bearer xx888e5a66-test"


def _coveo_result(name="Acme Roofing", contractor_id="123", phone="212-555-0100",
                  city="New York", state="NY", postal_code="10013") -> dict:
    return {
        "title": name,
        "raw": {
            "gaf_contractor_id": contractor_id,
            "gaf_navigation_title": name,
            "gaf_phone": phone,
            "gaf_f_city": city,
            "gaf_f_state_code": state,
            "gaf_postal_code": postal_code,
            "gaf_rating": 4.5,
            "gaf_number_of_reviews": 10,
            "gaf_f_contractor_certifications_and_awards_commercial": ["GAF Master Elite"],
        },
    }


def _base_request_body(distance: int = 25) -> dict:
    return {
        "aq": f"@distanceinmiles <= {distance} AND @gaf_f_country_code = USA",
        "numberOfResults": 10,
        "firstResult": 0,
        "analytics": {"clientTimestamp": "2026-01-01T00:00:00Z"},
        "queryFunctions": [{"fieldName": "@distanceinmiles", "function": "dist(...)"}],
    }


def _make_mock_page(coveo_results: list, total_count: int | None = None) -> MagicMock:
    """Mock Page that fires request + response handlers during goto()."""
    if total_count is None:
        total_count = len(coveo_results)
    request_handlers: list = []
    response_handlers: list = []

    def capture_on(event, handler):
        if event == "request":
            request_handlers.append(handler)
        elif event == "response":
            response_handlers.append(handler)

    def fire_on_goto(*args, **kwargs):
        # Simulate the Coveo request being captured
        mock_req = MagicMock()
        mock_req.url = _COVEO_URL
        mock_req.headers = {"authorization": _TOKEN}
        mock_req.post_data = json.dumps(_base_request_body())
        for h in request_handlers:
            h(mock_req)

        # Simulate the Coveo response being captured
        mock_resp = MagicMock()
        mock_resp.url = _COVEO_URL
        mock_resp.json.return_value = {
            "results": coveo_results,
            "totalCount": total_count,
        }
        for h in response_handlers:
            h(mock_resp)

    page = MagicMock()
    page.on.side_effect = capture_on
    page.goto.side_effect = fire_on_goto
    page.mouse.wheel.return_value = None
    page.wait_for_timeout.return_value = None
    return page


def _make_playwright_stack(mock_page: MagicMock) -> MagicMock:
    mock_context = MagicMock()
    mock_context.new_page.return_value = mock_page
    mock_browser = MagicMock()
    mock_browser.new_context.return_value = mock_context
    mock_pw = MagicMock()
    mock_pw.__enter__ = MagicMock(return_value=mock_pw)
    mock_pw.__exit__ = MagicMock(return_value=False)
    mock_pw.chromium.launch.return_value = mock_browser
    return mock_pw


# ---------------------------------------------------------------------------
# PlaywrightScraper integration tests (Phase 1 — Playwright)
# ---------------------------------------------------------------------------

def test_playwright_scraper_returns_contractor_records():
    """First Coveo batch is correctly mapped to ContractorRecord objects."""
    from app.services.playwright_scraper import PlaywrightScraper
    from app.config import ScraperConfig

    mock_page = _make_mock_page([_coveo_result(name="Acme Roofing Inc", contractor_id="abc123")])
    mock_pw = _make_playwright_stack(mock_page)

    with patch("app.services.playwright_scraper.sync_playwright", return_value=mock_pw):
        contractors = PlaywrightScraper().scrape_contractors(ScraperConfig(postal_code="10013"))

    assert len(contractors) == 1
    assert contractors[0].company_name == "Acme Roofing Inc"
    assert contractors[0].city == "New York"
    assert contractors[0].gaf_contractor_id == "abc123"
    assert contractors[0].phone == "212-555-0100"


def test_playwright_scraper_respects_limit():
    """config.limit slices the final contractor list."""
    from app.services.playwright_scraper import PlaywrightScraper
    from app.config import ScraperConfig

    results = [_coveo_result(name=f"Co {i}", contractor_id=str(i)) for i in range(5)]
    mock_page = _make_mock_page(results)
    mock_pw = _make_playwright_stack(mock_page)

    with patch("app.services.playwright_scraper.sync_playwright", return_value=mock_pw):
        contractors = PlaywrightScraper().scrape_contractors(ScraperConfig(limit=2))

    assert len(contractors) == 2


def test_playwright_scraper_handles_empty_page():
    """An empty Coveo response returns an empty list without raising."""
    from app.services.playwright_scraper import PlaywrightScraper
    from app.config import ScraperConfig

    mock_page = _make_mock_page([])
    mock_pw = _make_playwright_stack(mock_page)

    with patch("app.services.playwright_scraper.sync_playwright", return_value=mock_pw):
        result = PlaywrightScraper().scrape_contractors(ScraperConfig())

    assert result == []


# ---------------------------------------------------------------------------
# _paginate_coveo unit tests (Phase 2 — httpx)
# ---------------------------------------------------------------------------

def test_paginate_coveo_fetches_remaining_pages():
    """_paginate_coveo makes POST requests for pages beyond the first batch."""
    from app.services.playwright_scraper import PlaywrightScraper
    import httpx

    batch2 = [_coveo_result(name="Co B", contractor_id="b")]
    batch3 = [_coveo_result(name="Co C", contractor_id="c")]

    mock_resp2 = MagicMock(spec=httpx.Response)
    mock_resp2.status_code = 200
    mock_resp2.raise_for_status.return_value = None
    mock_resp2.json.return_value = {"results": batch2}

    mock_resp3 = MagicMock(spec=httpx.Response)
    mock_resp3.status_code = 200
    mock_resp3.raise_for_status.return_value = None
    mock_resp3.json.return_value = {"results": batch3}

    # Empty response signals end of results
    mock_resp_end = MagicMock(spec=httpx.Response)
    mock_resp_end.status_code = 200
    mock_resp_end.raise_for_status.return_value = None
    mock_resp_end.json.return_value = {"results": []}

    with patch("app.services.playwright_scraper.httpx.post",
               side_effect=[mock_resp2, mock_resp3, mock_resp_end]):
        extra = PlaywrightScraper()._paginate_coveo(
            token=_TOKEN,
            base_body=_base_request_body(),
            total_count=30,
            start=10,
        )

    assert len(extra) == 2
    assert extra[0]["title"] == "Co B"
    assert extra[1]["title"] == "Co C"


def test_paginate_coveo_stops_on_http_error():
    """_paginate_coveo returns results captured so far if a request fails."""
    from app.services.playwright_scraper import PlaywrightScraper
    import httpx

    batch = [_coveo_result(name="Co A", contractor_id="a")]
    mock_ok = MagicMock(spec=httpx.Response)
    mock_ok.status_code = 200
    mock_ok.raise_for_status.return_value = None
    mock_ok.json.return_value = {"results": batch}

    mock_fail = MagicMock(spec=httpx.Response)
    mock_fail.raise_for_status.side_effect = httpx.HTTPStatusError(
        "403", request=MagicMock(), response=MagicMock()
    )

    with patch("app.services.playwright_scraper.httpx.post",
               side_effect=[mock_ok, mock_fail]):
        extra = PlaywrightScraper()._paginate_coveo(
            token=_TOKEN,
            base_body=_base_request_body(),
            total_count=50,
            start=10,
        )

    assert len(extra) == 1


# ---------------------------------------------------------------------------
# Pure-function unit tests
# ---------------------------------------------------------------------------

def test_map_coveo_result_builds_profile_url():
    """Profile URL is constructed from gaf_contractor_id when present."""
    from app.services.playwright_scraper import _map_coveo_result

    result = _map_coveo_result(_coveo_result(contractor_id="9999"), country_code="us")
    assert result.gaf_profile_url == (
        "https://www.gaf.com/en-us/roofing-contractors/commercial/9999"
    )


def test_extract_certifications_merges_and_deduplicates():
    """Commercial and residential certs are merged; duplicates removed."""
    from app.services.playwright_scraper import _extract_certifications

    raw = {
        "gaf_f_contractor_certifications_and_awards_commercial": ["GAF Master Elite", "WeatherStopper"],
        "gaf_f_contractor_certifications_and_awards_residential": ["GAF Master Elite", "Star"],
    }
    certs = _extract_certifications(raw)
    assert "GAF Master Elite" in certs
    assert certs.count("GAF Master Elite") == 1
    assert "WeatherStopper" in certs
    assert "Star" in certs


def test_extract_certifications_handles_string_fields():
    """Single-value certification fields stored as a bare string are handled."""
    from app.services.playwright_scraper import _extract_certifications

    raw = {
        "gaf_f_contractor_certifications_and_awards_commercial": "GAF Certified",
        "gaf_f_contractor_certifications_and_awards_residential": [],
    }
    certs = _extract_certifications(raw)
    assert len(certs) == 1
