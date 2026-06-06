"""GAF contractor directory scraper — Playwright + Coveo API hybrid.

GAF's contractor locator is a React SPA that fetches data from a Coveo search
backend (POST *.coveo.com/rest/search/v2).  DOM-based scraping yields 0 cards
because markup is rendered asynchronously.  Scrolling does not trigger additional
Coveo batches (GAF paginates via UI buttons, not infinite scroll).

Strategy
--------
1. Playwright (headless=False) — needed to bypass Akamai Bot Manager which
   blocks headless Chromium at HTTP level before any JavaScript runs.
   Navigates to the search page and intercepts the first Coveo request,
   capturing the auth token, full request body (including the geocoded
   lat/lng for the postal code), and the first 10 results.

2. httpx pagination — using the captured auth token and request body,
   makes successive POST requests with increasing `firstResult` offsets
   until all pages are fetched.  Playwright is closed before this phase
   so the browser window is open for only ~15 seconds.

The lat/lng for the requested postal code is embedded by GAF's frontend into
the `queryFunctions` array of the Coveo request body.  Capturing it from the
first browser request ensures correct geocoding without a separate lookup.
"""
import json
import logging
from datetime import datetime, timezone

import httpx
from playwright.sync_api import sync_playwright, Page

from app.config import ScraperConfig
from app.models.lead import ContractorRecord

logger = logging.getLogger(__name__)

GAF_COMMERCIAL_URL = (
    "https://www.gaf.com/en-us/roofing-contractors/commercial"
    "?postalCode={postal_code}&countryCode={country_code}&distance={distance}"
)

GAF_PROFILE_URL_TEMPLATE = (
    "https://www.gaf.com/en-us/roofing-contractors/commercial/{contractor_id}"
)

_COVEO_URL_FRAGMENT = "coveo.com/rest/search"

# Milliseconds to wait after domcontentloaded for React to bootstrap and
# fire the initial Coveo XHR (empirically determined: ~5–8 seconds needed).
_INITIAL_WAIT_MS = 10_000

# Results per httpx pagination page (Coveo default is 10; 100 is accepted).
_PAGE_SIZE = 100

# Stealth patches injected before every page script so Akamai's bot detection
# sees a normal browser rather than a headless automation environment.
_STEALTH_JS = """
// 1. Remove the primary automation flag
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
});

// 2. Provide a realistic window.chrome object (missing in headless)
if (!window.chrome) {
    window.chrome = {
        app: { isInstalled: false },
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
    };
}

// 3. Realistic plugin list (headless has 0 plugins)
Object.defineProperty(navigator, 'plugins', {
    get: () => {
        const arr = [
            { name: 'Chrome PDF Plugin',   filename: 'internal-pdf-viewer',            description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer',   filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client',       filename: 'internal-nacl-plugin',            description: '' },
        ];
        arr.item    = (i) => arr[i];
        arr.namedItem = (n) => arr.find(p => p.name === n) || null;
        arr.refresh = () => {};
        return arr;
    },
    configurable: true,
});

// 4. Language list
Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true,
});

// 5. Permissions — headless returns 'denied' for notifications
const _origPermQuery = window.navigator.permissions && window.navigator.permissions.query;
if (_origPermQuery) {
    window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : _origPermQuery.call(navigator.permissions, params);
}

// 6. Hardware concurrency — headless often reports 2; real machines report 4–16
Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true,
});

// 7. Remove CDP / DevTools artefacts left on window
['__cdc_asdjflasutopfhvcZLmcfl_Array',
 '__cdc_asdjflasutopfhvcZLmcfl_Promise',
 '__cdc_asdjflasutopfhvcZLmcfl_Symbol'].forEach(k => {
    try { delete window[k]; } catch(_) {}
});
"""


def _coerce_str(val) -> str | None:
    """Coveo facetable fields may arrive as a list or a bare string."""
    if isinstance(val, list):
        return val[0] if val else None
    return val or None


def _extract_certifications(raw: dict) -> list[str]:
    """Merge commercial and residential certification arrays, de-duplicated."""
    commercial = raw.get("gaf_f_contractor_certifications_and_awards_commercial") or []
    residential = raw.get("gaf_f_contractor_certifications_and_awards_residential") or []
    if isinstance(commercial, str):
        commercial = [commercial]
    if isinstance(residential, str):
        residential = [residential]
    seen: set[str] = set()
    result: list[str] = []
    for cert in commercial + residential:
        if cert and cert not in seen:
            seen.add(cert)
            result.append(cert)
    return result


def _map_coveo_result(result: dict, country_code: str) -> ContractorRecord:
    """Map a single Coveo search result dict to a ContractorRecord."""
    raw = result.get("raw", {})
    name = _coerce_str(raw.get("gaf_navigation_title")) or result.get("title", "Unknown")
    contractor_id = str(raw.get("gaf_contractor_id", "")).strip() or None
    return ContractorRecord(
        company_name=name,
        gaf_contractor_id=contractor_id,
        address=None,
        city=_coerce_str(raw.get("gaf_f_city")),
        state=_coerce_str(raw.get("gaf_f_state_code")),
        postal_code=_coerce_str(raw.get("gaf_postal_code")),
        country_code=country_code,
        phone=_coerce_str(raw.get("gaf_phone")),
        gaf_profile_url=(
            GAF_PROFILE_URL_TEMPLATE.format(contractor_id=contractor_id)
            if contractor_id
            else None
        ),
        certifications=_extract_certifications(raw),
        rating=raw.get("gaf_rating"),
        review_count=raw.get("gaf_number_of_reviews"),
        website=None,
        years_in_business=None,
        service_area=None,
    )


class PlaywrightScraper:
    """Scrapes GAF contractors via Playwright + Coveo API hybrid.

    Phase 1 (Playwright, headless=False): Navigate to the GAF search page to
    capture the Coveo auth token, geocoded request body, and first 10 results.
    The browser is closed immediately after Phase 1.

    Phase 2 (httpx): Use the captured token and request body to fetch all
    remaining pages from the Coveo API directly, without a browser.
    """

    def scrape_contractors(self, config: ScraperConfig) -> list[ContractorRecord]:
        url = GAF_COMMERCIAL_URL.format(
            postal_code=config.postal_code,
            country_code=config.country_code,
            distance=config.distance,
        )

        first_batch: list[dict] = []
        total_count = 0
        coveo_token: str = ""
        coveo_request_body: dict = {}

        def on_request(req) -> None:
            nonlocal coveo_token, coveo_request_body
            if _COVEO_URL_FRAGMENT in req.url and not coveo_token:
                coveo_token = req.headers.get("authorization", "")
                try:
                    coveo_request_body = json.loads(req.post_data or "{}")
                except Exception:
                    pass

        def on_response(resp) -> None:
            nonlocal total_count
            if _COVEO_URL_FRAGMENT in resp.url and not first_batch:
                try:
                    data = resp.json()
                    first_batch.extend(data.get("results", []))
                    total_count = data.get("totalCount", 0)
                except Exception:
                    pass

        with sync_playwright() as pw:
            browser = None
            page = None
            try:
                browser = pw.chromium.launch(
                    headless=False,
                    args=["--disable-blink-features=AutomationControlled", "--start-maximized"],
                )
                context = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"
                    ),
                    viewport={"width": 1280, "height": 800},
                    locale="en-US",
                    timezone_id="America/New_York",
                    extra_http_headers={
                        "Accept-Language": "en-US,en;q=0.9",
                        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                        "sec-ch-ua-mobile": "?0",
                        "sec-ch-ua-platform": '"Windows"',
                    },
                )
                context.add_init_script(_STEALTH_JS)
                page = context.new_page()
                page.on("request", on_request)
                page.on("response", on_response)
                page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_timeout(_INITIAL_WAIT_MS)
            except Exception:
                logger.exception("Playwright phase failed for %s", url)
            finally:
                if page is not None:
                    page.close()
                if browser is not None:
                    browser.close()

        if not first_batch:
            logger.warning("No Coveo data captured for %s", url)
            return []

        all_results = list(first_batch)

        # Fetch remaining pages via httpx if there are more results.
        if coveo_token and coveo_request_body and total_count > len(first_batch):
            all_results += self._paginate_coveo(
                coveo_token, coveo_request_body, total_count, start=len(first_batch)
            )

        seen: set[str] = set()
        unique: list[dict] = []
        for r in all_results:
            raw = r.get("raw", {})
            key = str(raw.get("gaf_contractor_id", "")).strip() or r.get("title", "")
            if key and key not in seen:
                seen.add(key)
                unique.append(r)

        contractors = [_map_coveo_result(r, config.country_code) for r in unique]
        if config.limit is not None:
            contractors = contractors[: config.limit]
        logger.info("PlaywrightScraper extracted %d contractors", len(contractors))
        return contractors

    def _paginate_coveo(
        self,
        token: str,
        base_body: dict,
        total_count: int,
        start: int,
    ) -> list[dict]:
        """Fetch all Coveo pages beyond the first browser-captured batch."""
        extra: list[dict] = []
        coveo_url = (
            "https://gafmaterialscorporationproduction3yalqk12.org.coveo.com"
            "/rest/search/v2?organizationId=gafmaterialscorporationproduction3yalqk12"
        )
        headers = {
            "Authorization": token,
            "Content-Type": "application/json",
        }
        first_result = start
        while first_result < total_count:
            body = {
                **base_body,
                "firstResult": first_result,
                "numberOfResults": _PAGE_SIZE,
                "analytics": {
                    **base_body.get("analytics", {}),
                    "clientTimestamp": datetime.now(timezone.utc).isoformat(),
                },
            }
            try:
                resp = httpx.post(coveo_url, json=body, headers=headers, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                batch = data.get("results", [])
                if not batch:
                    break
                extra.extend(batch)
                first_result += len(batch)
                logger.debug("Coveo page firstResult=%d → +%d results", first_result - len(batch), len(batch))
            except Exception:
                logger.exception("httpx Coveo pagination failed at firstResult=%d", first_result)
                break
        return extra
