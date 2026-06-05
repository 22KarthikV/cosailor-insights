"""Tests for PlaywrightScraper (services/playwright_scraper.py).

All Playwright browser calls are mocked so these tests run without a browser.

Mock evaluate call order (per _scroll_to_stable + scrape_contractors):
  - For a non-empty stable page (n > 0 cards):
      call 1 → count (int n)   — initial count in _scroll_to_stable
      call 2 → count (int n)   — re-count after first scroll, same → breaks loop
      call 3 → raw data (list) — data extraction in scrape_contractors
  - For an empty page (0 cards):
      call 1 → 0               — initial count in _scroll_to_stable (early return)
      call 2 → raw data ([])   — data extraction in scrape_contractors
"""
import pytest
from unittest.mock import MagicMock, patch


def _make_mock_page(contractors_js_result: list) -> MagicMock:
    """Build a mock Playwright Page whose evaluate() returns contractor dicts.

    For an empty result (count == 0) the initial count check triggers the early
    return in _scroll_to_stable, so only 2 evaluate calls are needed in total.
    For a non-empty stable page the sequence is: count, count (stable → break),
    then the data extraction — 3 evaluate calls in total.
    """
    page = MagicMock()
    count = len(contractors_js_result)
    if count == 0:
        # Empty: count check (0) → early return → extract data ([])
        page.evaluate.side_effect = [0, contractors_js_result]
    else:
        # Non-empty stable: count check → re-count (same, breaks) → extract data
        page.evaluate.side_effect = [count, count, contractors_js_result]
    page.wait_for_selector.return_value = None
    page.wait_for_timeout.return_value = None
    return page


def test_playwright_scraper_returns_contractor_records():
    """DOM extraction is correctly mapped to ContractorRecord objects."""
    from app.services.playwright_scraper import PlaywrightScraper
    from app.config import ScraperConfig

    raw = [{
        "company_name": "Acme Roofing Inc",
        "address": "123 Main St",
        "city": "New York",
        "state": "NY",
        "postal_code": "10013",
        "phone": "212-555-0100",
        "gaf_contractor_id": "abc123",
        "certifications": ["GAF Master Elite"],
    }]

    mock_page = _make_mock_page(raw)
    mock_browser = MagicMock()
    mock_browser.new_page.return_value = mock_page

    mock_pw = MagicMock()
    mock_pw.__enter__ = MagicMock(return_value=mock_pw)
    mock_pw.__exit__ = MagicMock(return_value=False)
    mock_pw.chromium.launch.return_value = mock_browser

    with patch("app.services.playwright_scraper.sync_playwright", return_value=mock_pw):
        scraper = PlaywrightScraper()
        contractors = scraper.scrape_contractors(ScraperConfig(postal_code="10013"))

    assert len(contractors) == 1
    assert contractors[0].company_name == "Acme Roofing Inc"
    assert contractors[0].city == "New York"
    assert contractors[0].gaf_contractor_id == "abc123"


def test_playwright_scraper_respects_limit():
    """config.limit caps the returned list."""
    from app.services.playwright_scraper import PlaywrightScraper
    from app.config import ScraperConfig

    raw = [{"company_name": f"Co {i}", "certifications": []} for i in range(5)]
    count = len(raw)  # 5

    mock_page = MagicMock()
    # Non-empty stable: count, count (same → break), then data
    mock_page.evaluate.side_effect = [count, count, raw]
    mock_page.wait_for_selector.return_value = None
    mock_page.wait_for_timeout.return_value = None

    mock_browser = MagicMock()
    mock_browser.new_page.return_value = mock_page

    mock_pw = MagicMock()
    mock_pw.__enter__ = MagicMock(return_value=mock_pw)
    mock_pw.__exit__ = MagicMock(return_value=False)
    mock_pw.chromium.launch.return_value = mock_browser

    with patch("app.services.playwright_scraper.sync_playwright", return_value=mock_pw):
        scraper = PlaywrightScraper()
        result = scraper.scrape_contractors(ScraperConfig(limit=2))

    assert len(result) == 2


def test_playwright_scraper_handles_empty_page():
    """An empty page result returns an empty list without raising."""
    from app.services.playwright_scraper import PlaywrightScraper
    from app.config import ScraperConfig

    mock_page = _make_mock_page([])

    mock_browser = MagicMock()
    mock_browser.new_page.return_value = mock_page

    mock_pw = MagicMock()
    mock_pw.__enter__ = MagicMock(return_value=mock_pw)
    mock_pw.__exit__ = MagicMock(return_value=False)
    mock_pw.chromium.launch.return_value = mock_browser

    with patch("app.services.playwright_scraper.sync_playwright", return_value=mock_pw):
        scraper = PlaywrightScraper()
        result = scraper.scrape_contractors(ScraperConfig())

    assert result == []
