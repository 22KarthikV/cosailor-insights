# Scraper Fix + Progressive UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix incomplete GAF scraping, add a Playwright-based scraper, eliminate the status-reset bug, parallelize enrichment, and deliver a progressive card-fill UX with server-side pagination and post-run caching.

**Architecture:** A new `PlaywrightScraper` is built alongside the existing `GafScraper` (which is untouched). The pipeline router selects the active scraper at request time based on `body.scraper`. Parallel enrichment uses `asyncio.gather()` + `asyncio.Semaphore(5)`. The frontend polls every 3 s and calls `router.refresh()` each time so partial cards appear as scraping and enrichment complete. After the run, `revalidateTag('leads-list')` caches the final state for fast subsequent loads. Pagination is URL-based (`?page=1&limit=12`) and handled server-side via Supabase `.range()`.

**Tech Stack:** Python 3.14, FastAPI, Playwright (sync_api), Supabase-py, asyncio; Next.js 15 App Router, `unstable_cache`, `revalidateTag`, useRouter

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/app/config.py` | Modify | Add `scraper` field to `ScraperConfig` |
| `backend/app/models/lead.py` | Modify | Add `scraper` to `PipelineRunRequest`; add `PaginatedLeadsResponse` |
| `backend/app/services/playwright_scraper.py` | **Create** | Playwright scroll-to-stable scraper |
| `backend/app/repositories/lead_repository.py` | Modify | Fix status-reset bug; add pagination to `get_all_leads` |
| `backend/app/services/pipeline.py` | Modify | Parallel enrichment with `asyncio.gather()` + `Semaphore(5)` |
| `backend/app/routers/leads.py` | Modify | `page` + `limit` query params; return `PaginatedLeadsResponse` |
| `backend/app/routers/pipeline.py` | Modify | Instantiate correct scraper based on `body.scraper` |
| `backend/tests/test_playwright_scraper.py` | **Create** | Unit tests for `PlaywrightScraper` |
| `backend/tests/test_repository.py` | Modify | Update mocks for paginated `get_all_leads`; add upsert status-preservation test |
| `backend/tests/test_pipeline.py` | Modify | Update for parallel enrichment; add `scraper` field to request mock |
| `frontend/lib/types.ts` | Modify | Add `PaginatedLeadsResponse` interface |
| `frontend/lib/api.ts` | Modify | Update `getLeads` for pagination; update `triggerPipeline` for `scraper` param |
| `frontend/lib/leads.ts` | **Create** | `getCachedLeads()` using `unstable_cache` |
| `frontend/app/actions.ts` | **Create** | `revalidateLeads()` server action |
| `frontend/app/page.tsx` | Modify | Accept `searchParams`; pass `page`/`limit`/`total` to `LeadsGridClient` |
| `frontend/components/PipelineControls.tsx` | Modify | Call `router.refresh()` on every poll; call `revalidateLeads()` on completion |
| `frontend/components/LeadsGridClient.tsx` | Modify | Add pagination controls (prev/next, page-size selector, showing label) |
| `frontend/hooks/useLeadsRealtime.ts` | Modify | Remove append behaviour (update-only) so pagination stays stable |

---

## Task 1: Add `scraper` field to `ScraperConfig` and `PipelineRunRequest`

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/models/lead.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_models.py  (add at end of existing file)
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
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend
pytest tests/test_models.py::test_scraper_config_defaults_to_playwright tests/test_models.py::test_scraper_config_accepts_firecrawl tests/test_models.py::test_pipeline_run_request_scraper_defaults_to_playwright -v
```

Expected: `FAILED — AttributeError: ScraperConfig has no attribute 'scraper'`

- [ ] **Step 3: Add `scraper` to `ScraperConfig` in `backend/app/config.py`**

Replace the `ScraperConfig` dataclass (lines 29–45) with:

```python
from typing import Literal

@dataclass
class ScraperConfig:
    """Runtime parameters for a single GAF contractor scrape.

    distance must be one of the three values supported by the GAF URL schema
    (25 / 50 / 100 miles); anything else raises ValueError at construction time.
    limit is a test-only cap — set it to a small integer to avoid burning
    API credits during development.
    scraper selects which scraper implementation to use at pipeline start time.
    """
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25
    limit: int | None = None
    scraper: Literal["firecrawl", "playwright"] = "playwright"

    def __post_init__(self):
        if self.distance not in (25, 50, 100):
            raise ValueError(f"distance must be 25, 50, or 100. Got: {self.distance}")
```

Also add `from typing import Literal` at the top of the file (after the existing imports).

- [ ] **Step 4: Add `scraper` to `PipelineRunRequest` in `backend/app/models/lead.py`**

Replace the `PipelineRunRequest` class (lines 92–98) with:

```python
class PipelineRunRequest(BaseModel):
    """Parameters for triggering a new pipeline run via POST /api/pipeline/run."""
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25
    limit: Optional[int] = None
    scraper: Literal["firecrawl", "playwright"] = "playwright"
```

Add `from typing import Literal` to the existing `from typing import Optional` import line:
```python
from typing import Optional, Literal
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend
pytest tests/test_models.py::test_scraper_config_defaults_to_playwright tests/test_models.py::test_scraper_config_accepts_firecrawl tests/test_models.py::test_pipeline_run_request_scraper_defaults_to_playwright -v
```

Expected: all three `PASSED`

- [ ] **Step 6: Verify existing model tests still pass**

```bash
cd backend
pytest tests/test_models.py -v
```

Expected: all `PASSED`

- [ ] **Step 7: Commit**

```bash
git add backend/app/config.py backend/app/models/lead.py backend/tests/test_models.py
git commit -m "feat: add scraper field to ScraperConfig and PipelineRunRequest"
```

---

## Task 2: Add `playwright` to requirements and create `PlaywrightScraper`

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/services/playwright_scraper.py`
- Create: `backend/tests/test_playwright_scraper.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_playwright_scraper.py`:

```python
"""Tests for PlaywrightScraper (services/playwright_scraper.py).

All Playwright browser calls are mocked so these tests run without a browser.
"""
import pytest
from unittest.mock import MagicMock, patch


def _make_mock_page(contractors_js_result: list) -> MagicMock:
    """Build a mock Playwright Page whose evaluate() returns contractor dicts."""
    page = MagicMock()
    # evaluate() is called twice: once for card count, once for data extraction
    page.evaluate.side_effect = [
        len(contractors_js_result),  # first call: count cards
        contractors_js_result,       # second call: extract data
    ]
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

    mock_page = MagicMock()
    mock_page.evaluate.side_effect = [5, raw]
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

    mock_page = MagicMock()
    mock_page.evaluate.side_effect = [0, []]
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
        result = scraper.scrape_contractors(ScraperConfig())

    assert result == []
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend
pytest tests/test_playwright_scraper.py -v
```

Expected: `FAILED — ModuleNotFoundError: No module named 'app.services.playwright_scraper'`

- [ ] **Step 3: Add `playwright` to `backend/requirements.txt`**

Add this line after `pgeocode>=0.5.0`:

```
playwright>=1.44.0
```

- [ ] **Step 4: Install playwright and Chromium**

```bash
cd backend
pip install playwright
playwright install chromium
```

- [ ] **Step 5: Create `backend/app/services/playwright_scraper.py`**

```python
"""GAF contractor directory scraper powered by Playwright (headless Chromium).

PlaywrightScraper navigates to the GAF commercial contractor search page,
scrolls until no new cards appear (scroll-to-stable), then extracts
contractor data directly from the DOM via JavaScript evaluation.

Output contract is identical to GafScraper: returns list[ContractorRecord].
The existing GafScraper (services/scraper.py) is untouched.

Selector constants are defined at module level. If the GAF page structure
changes, update _CARD_SELECTOR and the extraction script in _extract_cards().
To find accurate selectors, run:
  playwright codegen "https://www.gaf.com/en-us/roofing-contractors/commercial?postalCode=10013&countryCode=us&distance=25"
"""
import logging
from playwright.sync_api import sync_playwright

from app.config import ScraperConfig
from app.models.lead import ContractorRecord

logger = logging.getLogger(__name__)

GAF_COMMERCIAL_URL = (
    "https://www.gaf.com/en-us/roofing-contractors/commercial"
    "?postalCode={postal_code}&countryCode={country_code}&distance={distance}"
)

# CSS selector that matches each contractor card on the results page.
# Update this constant if GAF changes their markup.
_CARD_SELECTOR = '[class*="ContractorCard"], [class*="contractor-card"], [data-testid*="contractor"]'

# Maximum number of scroll attempts before giving up (safety cap).
_MAX_SCROLL_ATTEMPTS = 30

# Milliseconds to wait after each scroll for new cards to render.
_SCROLL_WAIT_MS = 2000

# JavaScript run inside the page to extract structured data from all cards.
_EXTRACT_JS = """
(selector) => {
    const cards = document.querySelectorAll(selector);
    return Array.from(cards).map(card => {
        const nameEl = card.querySelector('h3, h4, [class*="name"], [class*="title"]');
        const phoneEl = card.querySelector('[href^="tel:"]');
        const addressEl = card.querySelector('[class*="address"], address');
        const linkEl = card.querySelector('a[href*="/roofing-contractors/"]');
        const certEls = card.querySelectorAll('[class*="certification"], [class*="badge"], [class*="tag"]');

        const name = nameEl ? nameEl.textContent.trim() : '';
        if (!name) return null;

        // Extract GAF contractor ID from the profile link (e.g. /roofing-contractors/commercial/12345)
        let gafId = null;
        if (linkEl) {
            const m = linkEl.href.match(/\\/([\\d]+)(?:\\?|$)/);
            if (m) gafId = m[1];
        }

        // Split address block into components by comma or newline
        let address = null, city = null, state = null, zip = null;
        if (addressEl) {
            const text = addressEl.textContent.trim();
            const parts = text.split(/,|\\n/).map(s => s.trim()).filter(Boolean);
            if (parts.length >= 3) {
                address = parts[0];
                city = parts[1];
                // Last part often "NY 10013"
                const stateZip = parts[parts.length - 1].split(/\\s+/);
                state = stateZip[0] || null;
                zip = stateZip[1] || null;
            } else if (parts.length === 2) {
                city = parts[0];
                const stateZip = parts[1].split(/\\s+/);
                state = stateZip[0] || null;
                zip = stateZip[1] || null;
            }
        }

        const certifications = Array.from(certEls)
            .map(el => el.textContent.trim())
            .filter(Boolean);

        return {
            company_name: name,
            address: address,
            city: city,
            state: state,
            postal_code: zip,
            phone: phoneEl ? phoneEl.href.replace('tel:', '').trim() : null,
            gaf_contractor_id: gafId,
            gaf_profile_url: linkEl ? linkEl.href : null,
            certifications: certifications,
        };
    }).filter(c => c !== null && c.company_name);
}
"""

_COUNT_JS = "(selector) => document.querySelectorAll(selector).length"


class PlaywrightScraper:
    """Scrapes all GAF contractor listings by scrolling until no new cards load."""

    def scrape_contractors(self, config: ScraperConfig) -> list[ContractorRecord]:
        """Open the GAF directory, scroll to stable card count, extract all contractors.

        Returns an empty list when the page renders zero results.
        Applies config.limit as a slice after extraction, never before scrolling.
        """
        url = GAF_COMMERCIAL_URL.format(
            postal_code=config.postal_code,
            country_code=config.country_code,
            distance=config.distance,
        )

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()

            try:
                page.goto(url, wait_until="networkidle", timeout=60_000)
                page.wait_for_selector(_CARD_SELECTOR, timeout=30_000)
                self._scroll_to_stable(page)
                raw_contractors = page.evaluate(_EXTRACT_JS, _CARD_SELECTOR)
            except Exception:
                logger.exception("Playwright extraction failed for %s", url)
                raw_contractors = []
            finally:
                browser.close()

        contractors = [
            ContractorRecord(
                company_name=c.get("company_name", "Unknown"),
                gaf_contractor_id=c.get("gaf_contractor_id"),
                address=c.get("address"),
                city=c.get("city"),
                state=c.get("state"),
                postal_code=c.get("postal_code"),
                country_code=config.country_code,
                phone=c.get("phone"),
                gaf_profile_url=c.get("gaf_profile_url"),
                certifications=c.get("certifications") or [],
            )
            for c in (raw_contractors or [])
            if c.get("company_name")
        ]

        if config.limit is not None:
            contractors = contractors[: config.limit]

        logger.info("PlaywrightScraper extracted %d contractors", len(contractors))
        return contractors

    def _scroll_to_stable(self, page) -> None:
        """Scroll to the bottom repeatedly until the card count stops increasing."""
        prev_count = page.evaluate(_COUNT_JS, _CARD_SELECTOR)
        for _ in range(_MAX_SCROLL_ATTEMPTS):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(_SCROLL_WAIT_MS)
            current_count = page.evaluate(_COUNT_JS, _CARD_SELECTOR)
            if current_count == prev_count:
                break
            prev_count = current_count
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend
pytest tests/test_playwright_scraper.py -v
```

Expected: all three `PASSED`

- [ ] **Step 7: Verify existing scraper tests still pass (GafScraper untouched)**

```bash
cd backend
pytest tests/test_scraper.py -v
```

Expected: all `PASSED`

- [ ] **Step 8: Commit**

```bash
git add backend/requirements.txt backend/app/services/playwright_scraper.py backend/tests/test_playwright_scraper.py
git commit -m "feat: add PlaywrightScraper with scroll-to-stable extraction"
```

---

## Task 3: Fix status-reset bug in `upsert_contractor`

**Files:**
- Modify: `backend/app/repositories/lead_repository.py`
- Modify: `backend/tests/test_repository.py`

**Bug:** `upsert_contractor` always sets `status = "scraped"`, overwriting the status of already-enriched leads on every re-run.

**Fix:** Before upserting, check if a lead with the same `gaf_contractor_id` already exists with status `'researched'` or `'enriched'`. If so, preserve that status instead of resetting to `'scraped'`.

- [ ] **Step 1: Write the failing test**

Add this test to `backend/tests/test_repository.py`:

```python
@pytest.mark.asyncio
async def test_upsert_contractor_preserves_enriched_status(sample_contractor):
    """Re-running upsert on an already-enriched lead must not reset its status to 'scraped'."""
    from app.repositories.lead_repository import LeadRepository

    lead_id = str(uuid4())

    # First call: SELECT to check existing status — returns 'enriched'
    check_result = MagicMock()
    check_result.data = [{"status": "enriched"}]

    # Second call: upsert — returns the row
    upsert_result = MagicMock()
    upsert_result.data = [{"id": lead_id, "status": "enriched"}]

    mock_table = MagicMock()
    # SELECT chain: .select().eq().execute()
    mock_table.select.return_value.eq.return_value.execute = AsyncMock(return_value=check_result)
    # UPSERT chain: .upsert().execute()
    mock_table.upsert.return_value.execute = AsyncMock(return_value=upsert_result)

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    repo = LeadRepository(client=mock_client)
    result = await repo.upsert_contractor(sample_contractor)

    # The status in the upserted row must not be 'scraped'
    upsert_payload = mock_table.upsert.call_args[0][0]
    assert upsert_payload["status"] == "enriched"
    assert result["status"] == "enriched"
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend
pytest tests/test_repository.py::test_upsert_contractor_preserves_enriched_status -v
```

Expected: `FAILED — AssertionError: assert 'scraped' == 'enriched'`

- [ ] **Step 3: Update `upsert_contractor` in `backend/app/repositories/lead_repository.py`**

Replace the entire `upsert_contractor` method (lines 18–47) with:

```python
async def upsert_contractor(self, contractor: ContractorRecord) -> dict:
    """Insert or update a contractor row, keyed on gaf_contractor_id.

    Preserves the existing status for leads already in 'researched' or 'enriched'
    state so that re-running the pipeline does not reset enriched leads to 'scraped'.
    Falls back to a plain insert when gaf_contractor_id is None.
    """
    preserved_status: str | None = None
    if contractor.gaf_contractor_id:
        check = (
            await self._client.table("leads")
            .select("status")
            .eq("gaf_contractor_id", contractor.gaf_contractor_id)
            .execute()
        )
        if check.data and check.data[0]["status"] in ("researched", "enriched"):
            preserved_status = check.data[0]["status"]

    row = {
        "company_name": contractor.company_name,
        "gaf_contractor_id": contractor.gaf_contractor_id,
        "address": contractor.address,
        "city": contractor.city,
        "state": contractor.state,
        "postal_code": contractor.postal_code,
        "country_code": contractor.country_code,
        "phone": contractor.phone,
        "website": contractor.website,
        "gaf_profile_url": contractor.gaf_profile_url,
        "certifications": contractor.certifications,
        "years_in_business": contractor.years_in_business,
        "service_area": contractor.service_area,
        "rating": float(contractor.rating) if contractor.rating else None,
        "review_count": contractor.review_count,
        "status": preserved_status or "scraped",
    }
    result = (
        await self._client.table("leads")
        .upsert(row, on_conflict="gaf_contractor_id")
        .execute()
    )
    return result.data[0]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
pytest tests/test_repository.py::test_upsert_contractor_preserves_enriched_status tests/test_repository.py::test_upsert_contractor_returns_row_with_id -v
```

Expected: both `PASSED`

- [ ] **Step 5: Run the full repository test suite**

```bash
cd backend
pytest tests/test_repository.py -v
```

Expected: all `PASSED`

- [ ] **Step 6: Commit**

```bash
git add backend/app/repositories/lead_repository.py backend/tests/test_repository.py
git commit -m "fix: preserve enriched/researched status on upsert re-run"
```

---

## Task 4: Add server-side pagination to `get_all_leads` and `GET /api/leads`

**Files:**
- Modify: `backend/app/repositories/lead_repository.py`
- Modify: `backend/app/models/lead.py`
- Modify: `backend/app/routers/leads.py`
- Modify: `backend/tests/test_repository.py`

- [ ] **Step 1: Write the failing test for `get_all_leads` pagination**

Add to `backend/tests/test_repository.py`:

```python
@pytest.mark.asyncio
async def test_get_all_leads_returns_paginated_result(sample_lead_row):
    """get_all_leads returns a dict with leads list, total, page, and limit."""
    from app.repositories.lead_repository import LeadRepository

    mock_result = MagicMock()
    mock_result.data = [sample_lead_row]
    mock_result.count = 42  # total across all pages

    mock_table = MagicMock()
    # .select().order().range().execute()
    mock_table.select.return_value.order.return_value.range.return_value.execute = AsyncMock(
        return_value=mock_result
    )

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    repo = LeadRepository(client=mock_client)
    result = await repo.get_all_leads(page=1, limit=12)

    assert result["total"] == 42
    assert result["page"] == 1
    assert result["limit"] == 12
    assert len(result["leads"]) == 1
    assert result["leads"][0]["company_name"] == "Acme Roofing Inc"
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend
pytest tests/test_repository.py::test_get_all_leads_returns_paginated_result -v
```

Expected: `FAILED — TypeError: get_all_leads() got unexpected keyword argument 'page'`

- [ ] **Step 3: Add `PaginatedLeadsResponse` to `backend/app/models/lead.py`**

Add this class after `LeadResponse` (after line 89):

```python
class PaginatedLeadsResponse(BaseModel):
    """Paginated response envelope for GET /api/leads."""
    leads: list[LeadResponse]
    total: int
    page: int
    limit: int
```

- [ ] **Step 4: Update `get_all_leads` in `backend/app/repositories/lead_repository.py`**

Replace the `get_all_leads` method (lines 49–70) with:

```python
async def get_all_leads(self, page: int = 1, limit: int = 12) -> dict:
    """Return a page of leads ordered by priority_index descending.

    Uses Supabase count="exact" to fetch total row count in one round-trip.
    Falls back to ordering by lead_score when priority_index column is missing.
    """
    offset = (page - 1) * limit
    try:
        result = (
            await self._client.table("leads")
            .select("*", count="exact")
            .order("priority_index", desc=True, nullsfirst=False)
            .range(offset, offset + limit - 1)
            .execute()
        )
    except Exception:
        result = (
            await self._client.table("leads")
            .select("*", count="exact")
            .order("lead_score", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
    return {
        "leads": result.data or [],
        "total": result.count or 0,
        "page": page,
        "limit": limit,
    }
```

- [ ] **Step 5: Update the existing `test_get_all_leads_returns_list_ordered_by_score` test**

The mock chain changes because `.range()` is now in the chain. Replace that test in `test_repository.py`:

```python
@pytest.mark.asyncio
async def test_get_all_leads_returns_list_ordered_by_score(sample_lead_row):
    """get_all_leads returns the list from Supabase inside a paginated envelope."""
    from app.repositories.lead_repository import LeadRepository

    mock_result = MagicMock()
    mock_result.data = [sample_lead_row]
    mock_result.count = 1

    mock_table = MagicMock()
    mock_table.select.return_value.order.return_value.range.return_value.execute = AsyncMock(
        return_value=mock_result
    )

    mock_client = MagicMock()
    mock_client.table.return_value = mock_table

    repo = LeadRepository(client=mock_client)
    result = await repo.get_all_leads()

    assert len(result["leads"]) == 1
    assert result["leads"][0]["company_name"] == "Acme Roofing Inc"
    assert result["total"] == 1
```

- [ ] **Step 6: Update `GET /api/leads` in `backend/app/routers/leads.py`**

Replace the full file content:

```python
"""FastAPI router for lead CRUD endpoints.

Mounted at /api/leads by main.py. A fresh Supabase async client is
created per request — there is no shared connection pool because the
Supabase Python client manages its own HTTP sessions internally.
"""
from fastapi import APIRouter, HTTPException, Query
from supabase import acreate_client

from app.config import settings
from app.models.lead import LeadResponse, PaginatedLeadsResponse
from app.repositories.lead_repository import LeadRepository

router = APIRouter()


async def _get_repo() -> LeadRepository:
    """Create a per-request Supabase async client and wrap it in the repository."""
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    return LeadRepository(client)


@router.get("/", response_model=PaginatedLeadsResponse)
async def list_leads(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=100),
):
    """Return a page of leads sorted by priority_index descending."""
    repo = await _get_repo()
    result = await repo.get_all_leads(page=page, limit=limit)
    return result


@router.get("/{lead_id}", response_model=LeadResponse)
async def get_lead(lead_id: str):
    """Return a single lead by UUID. Raises 404 when not found."""
    repo = await _get_repo()
    row = await repo.get_lead_by_id(lead_id)
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    return row


@router.delete("/")
async def delete_all_leads():
    """Dev utility: delete every lead row. Should not be exposed in production."""
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    result = (
        await client.table("leads")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
    )
    return {"deleted": len(result.data)}
```

- [ ] **Step 7: Run all repository tests**

```bash
cd backend
pytest tests/test_repository.py -v
```

Expected: all `PASSED`

- [ ] **Step 8: Commit**

```bash
git add backend/app/repositories/lead_repository.py backend/app/models/lead.py backend/app/routers/leads.py backend/tests/test_repository.py
git commit -m "feat: add server-side pagination to get_all_leads and GET /api/leads"
```

---

## Task 5: Parallel enrichment + scraper selection in pipeline router

**Files:**
- Modify: `backend/app/services/pipeline.py`
- Modify: `backend/app/routers/pipeline.py`
- Modify: `backend/tests/test_pipeline.py`

- [ ] **Step 1: Write the failing test for parallel enrichment**

Add to `backend/tests/test_pipeline.py`:

```python
@pytest.mark.asyncio
async def test_pipeline_uses_semaphore_for_parallel_enrichment(sample_contractor, sample_lead_row, _insight):
    """Enrichment runs via asyncio.gather() — all enrich() calls happen before complete_pipeline_run."""
    import asyncio
    from app.services.pipeline import PipelineService

    call_order = []

    mock_repo = AsyncMock()
    mock_repo.update_pipeline_progress = AsyncMock()
    mock_repo.upsert_contractor.side_effect = [
        {**sample_lead_row, "id": f"lead-{i}"} for i in range(3)
    ]

    async def fake_update_enrichment(lead_id, insight):
        call_order.append(("enriched", lead_id))

    mock_repo.update_enrichment.side_effect = fake_update_enrichment
    mock_repo.complete_pipeline_run = AsyncMock(
        side_effect=lambda *a, **kw: call_order.append(("completed",))
    )

    mock_scraper = MagicMock()
    mock_scraper.scrape_contractors.return_value = [sample_contractor] * 3

    mock_researcher = AsyncMock()
    mock_researcher.research_all.return_value = [{"summary": "Ok.", "sources": []}] * 3

    mock_enricher = MagicMock()
    mock_enricher.enrich.return_value = _insight

    service = PipelineService(
        repo=mock_repo,
        scraper=mock_scraper,
        researcher=mock_researcher,
        enricher=mock_enricher,
    )

    await service.execute(
        run_id="run-parallel",
        request=MagicMock(postal_code="10013", country_code="us", distance=25, limit=None, scraper="playwright"),
    )

    # All three enrichments must complete before the run is marked completed
    completed_idx = next(i for i, e in enumerate(call_order) if e[0] == "completed")
    enriched_indices = [i for i, e in enumerate(call_order) if e[0] == "enriched"]
    assert all(i < completed_idx for i in enriched_indices)
    assert len(enriched_indices) == 3
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend
pytest tests/test_pipeline.py::test_pipeline_uses_semaphore_for_parallel_enrichment -v
```

Expected: `FAILED` (import error or the test logic fails on the sequential implementation)

- [ ] **Step 3: Replace `backend/app/services/pipeline.py`**

```python
"""Orchestrates the three-stage scrape → research → enrich pipeline.

PipelineService.execute() runs as a FastAPI BackgroundTask so the HTTP
response is returned before the long-running work finishes.

Stage 1 — Scrape:    fetch contractor listings from the GAF directory.
Stage 2 — Research:  query Perplexity for web intelligence on each contractor.
Stage 3 — Enrich:    call Claude AI in parallel (up to 5 concurrent) to score leads.

Individual enrichment failures are isolated per-lead: one bad contractor does not
abort the rest of the batch. The pipeline_runs row is updated in Supabase after
each stage so the frontend can display live progress.
"""
import asyncio
import logging

from app.config import ScraperConfig
from app.models.lead import PipelineRunRequest
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.researcher import ContractorResearcher

logger = logging.getLogger(__name__)

_ENRICH_CONCURRENCY = 5


class PipelineService:
    """Coordinates the end-to-end lead enrichment pipeline."""

    def __init__(self, repo: LeadRepository, scraper, researcher: ContractorResearcher, enricher: LeadEnricher):
        self._repo = repo
        self._scraper = scraper
        self._researcher = researcher
        self._enricher = enricher

    async def execute(self, run_id: str, request: PipelineRunRequest) -> None:
        """Run all three pipeline stages for a single scrape request.

        Marks the pipeline run as failed in the database if any unrecoverable
        error occurs before enrichment finishes, then re-raises so the
        BackgroundTask framework can log the full traceback.
        """
        try:
            config = ScraperConfig(
                postal_code=request.postal_code,
                country_code=request.country_code,
                distance=request.distance,
                limit=request.limit,
            )

            # Stage 1: Scrape contractors from the GAF directory
            contractors = self._scraper.scrape_contractors(config)
            await self._repo.update_pipeline_progress(run_id, leads_scraped=len(contractors))

            lead_rows = [await self._repo.upsert_contractor(c) for c in contractors]

            # Stage 2: Research all contractors via Perplexity
            research_results = await self._researcher.research_all(contractors)
            for row, research in zip(lead_rows, research_results):
                await self._repo.update_research(
                    row["id"], research.get("summary", ""), research.get("sources", [])
                )

            # Stage 3: Enrich in parallel with a concurrency cap
            enriched_count = await self._enrich_parallel(
                lead_rows, contractors, research_results, request.postal_code, run_id
            )

            await self._repo.complete_pipeline_run(run_id, leads_enriched=enriched_count)

        except Exception as exc:
            await self._repo.fail_pipeline_run(run_id, str(exc))
            raise

    async def _enrich_parallel(
        self,
        lead_rows: list[dict],
        contractors: list,
        research_results: list[dict],
        search_postal_code: str,
        run_id: str,
    ) -> int:
        """Enrich all leads in parallel up to _ENRICH_CONCURRENCY at a time.

        Returns the count of successfully enriched leads.
        Each lead's enrichment result is written to DB immediately on completion.
        """
        sem = asyncio.Semaphore(_ENRICH_CONCURRENCY)
        enriched_count = 0

        async def enrich_one(row: dict, contractor, research: dict) -> bool:
            async with sem:
                try:
                    insight = self._enricher.enrich(
                        contractor,
                        research,
                        search_postal_code=search_postal_code,
                    )
                    await self._repo.update_enrichment(row["id"], insight)
                    return True
                except Exception as exc:
                    logger.exception("Enrichment failed for lead %s", row["id"])
                    await self._repo.mark_lead_failed(row["id"], str(exc))
                    return False

        results = await asyncio.gather(
            *[enrich_one(row, contractor, research)
              for row, contractor, research in zip(lead_rows, contractors, research_results)]
        )
        enriched_count = sum(1 for r in results if r)
        return enriched_count
```

- [ ] **Step 4: Update `backend/app/routers/pipeline.py` to select the correct scraper**

Replace the `run_pipeline` function (keep the module docstring and imports, replace from line 25 onward):

```python
"""FastAPI router for pipeline trigger and status-polling endpoints.

POST /run             — starts a pipeline BackgroundTask and returns 202 immediately.
GET  /status/{run_id} — polls the pipeline_runs table for current progress.

The pipeline runs as a FastAPI BackgroundTask so the HTTP response is returned
before the (potentially long) scrape / research / enrich work finishes.
Callers must poll /status/{run_id} at their chosen interval until status is
'completed' or 'failed'.
"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from supabase import acreate_client

from app.config import settings
from app.models.lead import PipelineRunRequest, PipelineRunResponse, PipelineStatusResponse
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.pipeline import PipelineService
from app.services.playwright_scraper import PlaywrightScraper
from app.services.researcher import ContractorResearcher
from app.services.scraper import GafScraper

router = APIRouter()


@router.post("/run", status_code=202, response_model=PipelineRunResponse)
async def run_pipeline(body: PipelineRunRequest, background_tasks: BackgroundTasks):
    """Queue a pipeline run and return 202 with a run_id for status polling.

    Instantiates PlaywrightScraper or GafScraper based on body.scraper.
    All four service dependencies are constructed here so they share the same
    Supabase client and API credentials for the lifetime of the background task.
    """
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    repo = LeadRepository(client)
    run_id = await repo.create_pipeline_run(
        postal_code=body.postal_code,
        country_code=body.country_code,
        distance=body.distance,
    )

    scraper = (
        PlaywrightScraper()
        if body.scraper == "playwright"
        else GafScraper(api_key=settings.firecrawl_api_key)
    )

    service = PipelineService(
        repo=repo,
        scraper=scraper,
        researcher=ContractorResearcher(api_key=settings.perplexity_api_key),
        enricher=LeadEnricher(api_key=settings.anthropic_api_key),
    )

    background_tasks.add_task(service.execute, run_id, body)

    return PipelineRunResponse(
        run_id=run_id,
        status="running",
        message=f"Pipeline started. Poll /api/pipeline/status/{run_id} for progress.",
    )


@router.get("/status/{run_id}", response_model=PipelineStatusResponse)
async def pipeline_status(run_id: str):
    """Return current state of a pipeline run. Raises 404 when run_id is unknown."""
    client = await acreate_client(settings.supabase_url, settings.supabase_key)
    repo = LeadRepository(client)
    run = await repo.get_pipeline_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    return {**run, "run_id": run["id"]}
```

- [ ] **Step 5: Run all pipeline tests**

```bash
cd backend
pytest tests/test_pipeline.py -v
```

Expected: all `PASSED`

- [ ] **Step 6: Run the full backend test suite**

```bash
cd backend
pytest tests/ -v -m "not integration"
```

Expected: all `PASSED`

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/pipeline.py backend/app/routers/pipeline.py backend/tests/test_pipeline.py
git commit -m "feat: parallel enrichment with asyncio.gather + Semaphore(5), scraper selection"
```

---

## Task 6: Update frontend types and API functions

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add `PaginatedLeadsResponse` to `frontend/lib/types.ts`**

Add this interface after the `Lead` interface (after line 45):

```typescript
/** Paginated response from GET /api/leads. */
export interface PaginatedLeadsResponse {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Update `frontend/lib/api.ts`**

Replace the full file:

```typescript
/**
 * HTTP client functions for the Cosailor Insights backend API.
 *
 * All functions are thin wrappers around fetch() that throw on non-2xx
 * responses. They are intentionally stateless — no caching layer is added
 * here; caching is handled by getCachedLeads() in lib/leads.ts.
 */
import type { Lead, PaginatedLeadsResponse, PipelineRunResponse, PipelineStatusResponse } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/** Fetch a paginated page of leads ordered by priority_index descending. */
export async function getLeads(page: number = 1, limit: number = 12): Promise<PaginatedLeadsResponse> {
  const res = await fetch(`${API_BASE}/api/leads/?page=${page}&limit=${limit}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to fetch leads: ${res.status}`);
  return res.json();
}

/** Fetch a single lead by UUID. Throws when not found (404). */
export async function getLead(id: string): Promise<Lead> {
  const res = await fetch(`${API_BASE}/api/leads/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Lead not found: ${res.status}`);
  return res.json();
}

/**
 * Start a new pipeline run and return the 202 response with a run_id.
 * scraper selects which backend scraper to use ('playwright' or 'firecrawl').
 */
export async function triggerPipeline(
  postalCode: string = '10013',
  countryCode: string = 'us',
  distance: number = 25,
  scraper: 'playwright' | 'firecrawl' = 'playwright'
): Promise<PipelineRunResponse> {
  const res = await fetch(`${API_BASE}/api/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postal_code: postalCode, country_code: countryCode, distance, scraper }),
  });
  if (!res.ok) throw new Error(`Failed to start pipeline: ${res.status}`);
  return res.json();
}

/** Poll the current state of a pipeline run. Used every 3 s by PipelineControls. */
export async function getPipelineStatus(runId: string): Promise<PipelineStatusResponse> {
  const res = await fetch(`${API_BASE}/api/pipeline/status/${runId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Pipeline run not found: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat: update frontend types and API functions for pagination and scraper selection"
```

---

## Task 7: Add caching layer (`unstable_cache` + `revalidateTag`)

**Files:**
- Create: `frontend/lib/leads.ts`
- Create: `frontend/app/actions.ts`

- [ ] **Step 1: Create `frontend/lib/leads.ts`**

```typescript
/**
 * Cached leads fetch using Next.js unstable_cache.
 *
 * During a pipeline run, PipelineControls calls revalidateLeads() (in actions.ts)
 * before every router.refresh() to bust the cache and ensure fresh data.
 * After the run completes, the cache is left populated so subsequent page
 * loads are served instantly without a Supabase round-trip.
 *
 * Each page/limit combination gets its own cache entry; all share the
 * 'leads-list' tag so a single revalidateTag() invalidates all of them.
 */
import { unstable_cache } from 'next/cache';
import { getLeads } from './api';
import type { PaginatedLeadsResponse } from './types';

export function getCachedLeads(page: number, limit: number): Promise<PaginatedLeadsResponse> {
  return unstable_cache(
    () => getLeads(page, limit),
    ['leads-list', String(page), String(limit)],
    { tags: ['leads-list'] }
  )();
}
```

- [ ] **Step 2: Create `frontend/app/actions.ts`**

```typescript
'use server';

/**
 * Server actions for cache management.
 *
 * revalidateLeads() is called by PipelineControls on every poll during a
 * pipeline run (to force fresh data) and once more when the run completes
 * (to populate the cache with the final enriched state).
 */
import { revalidateTag } from 'next/cache';

export async function revalidateLeads(): Promise<void> {
  revalidateTag('leads-list');
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/leads.ts frontend/app/actions.ts
git commit -m "feat: add unstable_cache caching layer and revalidateLeads server action"
```

---

## Task 8: Update `PipelineControls` to refresh on every poll

**Files:**
- Modify: `frontend/components/PipelineControls.tsx`

**Change:** Currently `router.refresh()` is called only when the pipeline reaches a terminal state. This means the user sees no leads for the entire scraping duration. Fix: call `router.refresh()` (and `revalidateLeads()`) on every successful poll so partial cards appear immediately after scraping.

- [ ] **Step 1: Replace `frontend/components/PipelineControls.tsx`**

```typescript
'use client';

/**
 * PipelineControls — form for triggering a pipeline run and tracking progress.
 *
 * Polls GET /api/pipeline/status/:run_id every 3 seconds while a run is active.
 * On every successful poll, calls revalidateLeads() (server action) then
 * router.refresh() so the Server Component re-fetches fresh leads from the DB.
 * This means partial cards appear as soon as scraping writes leads to the DB,
 * and score badges fill in progressively as each enrichment completes.
 */
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerPipeline, getPipelineStatus } from '@/lib/api';
import { revalidateLeads } from '@/app/actions';
import type { PipelineStatusResponse } from '@/lib/types';

const DISTANCE_OPTIONS = [25, 50, 100] as const;
type DistanceOption = (typeof DISTANCE_OPTIONS)[number];

const DEFAULT_COUNTRY_CODE = 'us' as const;
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;

export function PipelineControls(): React.JSX.Element {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [pipeStatus, setPipeStatus] = useState<PipelineStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState<string>('10013');
  const [distance, setDistance] = useState<DistanceOption>(25);

  const isRunning = pipeStatus?.status === 'running';
  const isValidPostalCode = US_ZIP_REGEX.test(postalCode.trim());
  const isSubmitDisabled = loading || isRunning || postalCode.trim() === '' || !isValidPostalCode;

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      // Bust cache so the first refresh after scraping shows fresh data
      await revalidateLeads();
      const data = await triggerPipeline(postalCode.trim(), DEFAULT_COUNTRY_CODE, distance, 'playwright');
      setRunId(data.run_id);
      setPipeStatus({
        run_id: data.run_id,
        status: 'running',
        leads_scraped: 0,
        leads_enriched: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
        error_message: null,
      });
    } catch {
      setError('Failed to start pipeline. Is the backend running on port 8000?');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Poll every 3 seconds while a run is active.
   * Each tick: revalidate cache, then refresh the Server Component so
   * partial cards appear progressively as leads are scraped and enriched.
   */
  useEffect(() => {
    if (!runId || !isRunning) return;

    const interval = setInterval(async () => {
      try {
        const status = await getPipelineStatus(runId);
        setPipeStatus(status);
        // Always revalidate + refresh — shows partial cards during scraping
        // and progressively filled cards during enrichment.
        await revalidateLeads();
        router.refresh();
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(interval);
        }
      } catch {
        /* keep polling — transient network errors should not cancel the interval */
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [runId, isRunning, router]);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex flex-col gap-1">
        <label htmlFor="pipeline-postal-code" className="text-xs font-medium text-gray-600">
          ZIP Code
        </label>
        <input
          id="pipeline-postal-code"
          type="text"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          disabled={isRunning || loading}
          placeholder="e.g. 10013"
          className="h-9 w-28 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {postalCode.length > 0 && !isValidPostalCode && (
          <p className="text-xs text-red-500 mt-1">Enter a valid US ZIP code</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pipeline-distance" className="text-xs font-medium text-gray-600">
          Distance
        </label>
        <select
          id="pipeline-distance"
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value) as DistanceOption)}
          disabled={isRunning || loading}
          className="h-9 w-28 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {DISTANCE_OPTIONS.map((miles) => (
            <option key={miles} value={miles}>
              {miles} miles
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col justify-end gap-1">
        <span className="text-xs font-medium text-transparent select-none" aria-hidden="true">
          &nbsp;
        </span>
        <Button
          onClick={handleRun}
          disabled={isSubmitDisabled}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isRunning ? (
            <>
              <span className="animate-spin mr-2 inline-block">&#x27F3;</span>
              Running Pipeline...
            </>
          ) : (
            '⚡ Run Pipeline'
          )}
        </Button>
      </div>

      {pipeStatus && (
        <div className="text-sm">
          {pipeStatus.status === 'running' && (
            <span className="text-gray-600">
              Scraped {pipeStatus.leads_scraped} &middot; Enriched {pipeStatus.leads_enriched}
            </span>
          )}
          {pipeStatus.status === 'completed' && (
            <span className="text-green-600 font-medium">
              &#x2713; {pipeStatus.leads_enriched} leads enriched
            </span>
          )}
          {pipeStatus.status === 'failed' && (
            <span className="text-red-600">&#x2717; Pipeline failed</span>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PipelineControls.tsx
git commit -m "feat: call router.refresh() on every poll for progressive card display"
```

---

## Task 9: Update `useLeadsRealtime` for pagination safety

**Files:**
- Modify: `frontend/hooks/useLeadsRealtime.ts`

**Why:** The current hook appends new leads to local state when they arrive via Supabase realtime. With pagination, new leads might belong to a different page — appending them would mix pages. Since `router.refresh()` now fires on every poll and re-syncs `initialLeads` with the server, the append behaviour is no longer needed. Change to update-only.

- [ ] **Step 1: Replace `frontend/hooks/useLeadsRealtime.ts`**

```typescript
'use client'

/**
 * useLeadsRealtime — subscribes to Supabase Postgres changes and merges
 * incoming lead updates into local state.
 *
 * The hook accepts an initial leads array (fetched server-side) and returns
 * a live copy that updates in place when the backend enriches a lead.
 *
 * Design notes:
 * - Only UPDATE events are handled. New leads (INSERT) are picked up via
 *   router.refresh() in PipelineControls, which re-fetches the current page
 *   from the server every 3 seconds during a pipeline run.
 * - Update-only (no append) keeps pagination stable: a realtime event for
 *   a lead on page 3 does not pollute the current page 1 view.
 * - The initialLeads effect re-syncs state whenever the parent Server Component
 *   re-fetches (e.g. after router.refresh() is called by PipelineControls).
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/lib/types'

export function useLeadsRealtime(initialLeads: Lead[]): Lead[] {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)

  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

  useEffect(() => {
    const channel = supabase
      .channel('leads-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leads',
        },
        (payload) => {
          const incoming = payload.new as Lead
          setLeads((prev) =>
            prev.map((l) => (l.id === incoming.id ? incoming : l))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return leads
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/hooks/useLeadsRealtime.ts
git commit -m "fix: useLeadsRealtime update-only — no append — keeps pagination stable"
```

---

## Task 10: Build pagination UI and wire up page.tsx

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/LeadsGridClient.tsx`

- [ ] **Step 1: Replace `frontend/app/page.tsx`**

```typescript
/**
 * Dashboard page — the application's home route ("/").
 *
 * Reads page and limit from URL searchParams so pagination is URL-driven
 * (shareable, back-button safe). Falls back to page=1, limit=12 when absent.
 * Uses getCachedLeads() so post-run loads are served from the Next.js cache.
 * During a pipeline run the cache is busted every 3 s by PipelineControls.
 */
import { Suspense } from 'react';
import { LeadsGridClient } from '@/components/LeadsGridClient';
import { PipelineControls } from '@/components/PipelineControls';
import { Skeleton } from '@/components/ui/skeleton';
import { getCachedLeads } from '@/lib/leads';
import type { Lead } from '@/lib/types';

const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

interface LeadsSectionProps {
  page: number;
  limit: number;
}

async function LeadsSection({ page, limit }: LeadsSectionProps) {
  let leads: Lead[] = [];
  let total = 0;
  try {
    const result = await getCachedLeads(page, limit);
    leads = result.leads;
    total = result.total;
  } catch (err) {
    console.error('[LeadsSection] Failed to fetch leads:', err);
  }
  return <LeadsGridClient leads={leads} page={page} limit={limit} total={total} />;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const rawLimit = parseInt(params.limit ?? '12', 10);
  const limit = PAGE_SIZE_OPTIONS.includes(rawLimit as (typeof PAGE_SIZE_OPTIONS)[number])
    ? rawLimit
    : 12;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cosailor Insights</h1>
            <p className="text-sm text-gray-500 mt-1">
              GAF Roofing Contractors &middot; Commercial &middot; United States
            </p>
          </div>
          <PipelineControls />
        </div>

        <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-green-400 inline-block" />
            High priority (8-10)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" />
            Medium (5-7)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
            Low (1-4)
          </span>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        }
      >
        <LeadsSection page={page} limit={limit} />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Add pagination props and controls to `frontend/components/LeadsGridClient.tsx`**

Replace the `LeadsGridClientProps` interface (line 23) with:

```typescript
interface LeadsGridClientProps {
  leads: Lead[];
  page: number;
  limit: number;
  total: number;
}
```

Add these components before `LeadsGridClient` export (after the `SORT_OPTIONS` block):

```typescript
const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

interface PaginationControlsProps {
  page: number;
  limit: number;
  total: number;
}

function PaginationControls({ page, limit, total }: PaginationControlsProps): React.JSX.Element {
  const router = useRouter();
  const totalPages = Math.ceil(total / limit);
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const navigate = (newPage: number, newLimit: number) => {
    const params = new URLSearchParams();
    params.set('page', String(newPage));
    params.set('limit', String(newLimit));
    router.push(`/?${params.toString()}`);
  };

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mt-4">
      <span className="text-xs text-gray-500">
        {total === 0 ? 'No leads' : `Showing ${startItem}–${endItem} of ${total} leads`}
      </span>

      <div className="flex items-center gap-2">
        <label htmlFor="page-size" className="text-xs text-gray-500">
          Per page:
        </label>
        <select
          id="page-size"
          value={limit}
          onChange={(e) => navigate(1, Number(e.target.value))}
          className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => navigate(page - 1, limit)}
          disabled={page <= 1}
          className="px-3 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span className="text-xs text-gray-500">
          {page} / {totalPages || 1}
        </span>
        <button
          type="button"
          onClick={() => navigate(page + 1, limit)}
          disabled={page >= totalPages}
          className="px-3 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `useRouter` import to `LeadsGridClient.tsx`**

At the top of the file, add to the existing imports:

```typescript
import { useRouter } from 'next/navigation';
```

- [ ] **Step 4: Update `LeadsGridClient` function signature and render**

Replace the `LeadsGridClient` function signature (line 183) with:

```typescript
export function LeadsGridClient({ leads: initialLeads, page, limit, total }: LeadsGridClientProps): React.JSX.Element {
```

At the end of the component's return, add `<PaginationControls>` after the grid and before the closing `</div>`:

In the return JSX, find the closing `</div>` of the `space-y-4` container and add `<PaginationControls>` just before it:

```typescript
      {/* ... existing grid JSX ... */}
      <PaginationControls page={page} limit={limit} total={total} />
    </div>
  );
```

Also update the `computeStats` call to show page-local stats. No change needed — `computeStats` already works on whatever leads it receives.

Replace the "X contractors found" count line (line 214) to use `total`:

```typescript
<p className="text-xs text-gray-400 mb-2">{total} contractors total</p>
```

- [ ] **Step 5: Start the dev server and verify visually**

```bash
cd frontend && npm run dev
```

Open `http://localhost:3000` in the browser. Verify:
- Page loads showing 12 leads (default page size)
- "Showing 1–12 of N leads" label is visible
- "Per page" selector changes between 12/24/48
- Prev button is disabled on page 1
- Next button navigates to page 2 and updates the URL to `/?page=2&limit=12`
- Back button returns to page 1

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx frontend/components/LeadsGridClient.tsx
git commit -m "feat: URL-driven pagination with prev/next and page-size selector"
```

---

## Final: Run full backend test suite

- [ ] **Step 1: Run all backend tests**

```bash
cd backend
pytest tests/ -v -m "not integration"
```

Expected: all `PASSED`

- [ ] **Step 2: Verify the dev server has no TypeScript errors**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Final commit if any loose files remain**

```bash
git status
# Stage any unstaged changes, then:
git commit -m "chore: finalize scraper UX implementation"
```
