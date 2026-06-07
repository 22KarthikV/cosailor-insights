"""GAF contractor directory scraper — Playwright + Coveo API hybrid.

GAF's contractor locator is a React SPA that fetches data from a Coveo search
backend (POST *.coveo.com/rest/search/v2).  DOM-based scraping yields 0 cards
because markup is rendered asynchronously.

Strategy
--------
1. Playwright (headless=False) — needed to bypass Akamai Bot Manager.
   Navigates to the search page and intercepts the first Coveo request,
   capturing the auth token, full request body (including geocoded lat/lng),
   and the first 10 results.

2. httpx pagination — using the captured token and body, successive POST
   requests fetch remaining pages without a browser.

Windows / event-loop fix
------------------------
uvicorn on Windows uses SelectorEventLoop, which raises NotImplementedError
when any code tries to spawn a subprocess (asyncio.create_subprocess_exec).
async_playwright starts a Node.js subprocess, so it cannot run on the
SelectorEventLoop directly.

Fix: scrape_contractors dispatches via asyncio.to_thread to a worker thread
that owns a fresh ProactorEventLoop.  ProactorEventLoop supports subprocess
creation on Windows.  The main uvicorn loop is never touched.
"""
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

import httpx
from playwright.async_api import async_playwright

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
# fire the initial Coveo XHR (empirically ~5–8 s needed).
_INITIAL_WAIT_MS = 10_000

# Results per httpx pagination page (Coveo accepts up to 100).
_PAGE_SIZE = 100

_STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
if (!window.chrome) {
    window.chrome = { app: { isInstalled: false }, runtime: {}, loadTimes: function() {}, csi: function() {} };
}
Object.defineProperty(navigator, 'plugins', {
    get: () => {
        const arr = [
            { name: 'Chrome PDF Plugin',   filename: 'internal-pdf-viewer',            description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer',   filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client',       filename: 'internal-nacl-plugin',            description: '' },
        ];
        arr.item = (i) => arr[i];
        arr.namedItem = (n) => arr.find(p => p.name === n) || null;
        arr.refresh = () => {};
        return arr;
    },
    configurable: true,
});
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
const _origPermQuery = window.navigator.permissions && window.navigator.permissions.query;
if (_origPermQuery) {
    window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : _origPermQuery.call(navigator.permissions, params);
}
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
['__cdc_asdjflasutopfhvcZLmcfl_Array','__cdc_asdjflasutopfhvcZLmcfl_Promise','__cdc_asdjflasutopfhvcZLmcfl_Symbol'].forEach(k => {
    try { delete window[k]; } catch(_) {}
});
"""


def _coerce_str(val) -> str | None:
    if isinstance(val, list):
        return val[0] if val else None
    return val or None


def _extract_certifications(raw: dict) -> list[str]:
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

    scrape_contractors is async (called with await from the pipeline) but
    immediately hands off to a worker thread via asyncio.to_thread.  That
    thread creates a ProactorEventLoop so async_playwright can spawn the
    Node.js browser subprocess — something SelectorEventLoop cannot do on
    Windows.
    """

    async def scrape_contractors(self, config: ScraperConfig) -> list[ContractorRecord]:
        """Entry point — dispatches to a ProactorEventLoop thread."""
        return await asyncio.to_thread(self._run_in_proactor, config)

    # ── ProactorEventLoop bridge ───────────────────────────────────────────

    def _run_in_proactor(self, config: ScraperConfig) -> list[ContractorRecord]:
        """Run the async scraper inside a fresh ProactorEventLoop.

        Called from asyncio.to_thread so it executes in a worker thread with
        no pre-existing event loop.  ProactorEventLoop supports subprocess
        creation on Windows; SelectorEventLoop does not.
        """
        if sys.platform == "win32":
            loop = asyncio.ProactorEventLoop()
        else:
            loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self._async_scrape(config))
        finally:
            loop.close()
            asyncio.set_event_loop(None)

    # ── Async scrape implementation ────────────────────────────────────────

    async def _async_scrape(self, config: ScraperConfig) -> list[ContractorRecord]:
        url = GAF_COMMERCIAL_URL.format(
            postal_code=config.postal_code,
            country_code=config.country_code,
            distance=config.distance,
        )

        first_batch: list[dict] = []
        total_count = 0
        coveo_token: str = ""
        coveo_request_body: dict = {}
        cookie_header: str = ""

        def on_request(req) -> None:
            nonlocal coveo_token, coveo_request_body
            if _COVEO_URL_FRAGMENT in req.url and not coveo_token:
                coveo_token = req.headers.get("authorization", "")
                try:
                    coveo_request_body = json.loads(req.post_data or "{}")
                except Exception:
                    pass

        async def on_response(resp) -> None:
            nonlocal total_count
            if _COVEO_URL_FRAGMENT in resp.url and not first_batch:
                try:
                    data = await resp.json()
                    results = data.get("results", [])
                    total_count = data.get("totalCount", 0)
                    first_batch.extend(results)
                    logger.info(
                        "Coveo first batch: %d results captured, totalCount=%d",
                        len(results), total_count,
                    )
                except Exception:
                    logger.exception("Failed to parse first Coveo response")

        browser = None
        page = None
        context = None
        try:
            async with async_playwright() as pw:
                try:
                    browser = await pw.chromium.launch(
                        headless=True,
                        args=[
                            "--disable-blink-features=AutomationControlled",
                            "--no-sandbox",
                            "--disable-dev-shm-usage",
                            "--disable-gpu",
                            "--window-size=1280,800",
                        ],
                    )
                    context = await browser.new_context(
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
                    await context.add_init_script(_STEALTH_JS)
                    page = await context.new_page()
                    page.on("request", on_request)
                    page.on("response", on_response)
                    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                    await page.wait_for_timeout(_INITIAL_WAIT_MS)

                    # Capture Akamai session cookies so httpx pagination can
                    # present the same session identity to Coveo's API.
                    if context is not None:
                        cookies = await context.cookies()
                        cookie_header = "; ".join(
                            f"{c['name']}={c['value']}" for c in cookies
                        )
                        logger.debug("Captured %d browser cookies for pagination", len(cookies))
                except Exception:
                    logger.exception("Playwright phase failed for %s", url)
                finally:
                    if page is not None:
                        await page.close()
                    if browser is not None:
                        await browser.close()
        except Exception:
            logger.exception("Playwright initialisation failed for %s", url)

        if not first_batch:
            logger.warning("No Coveo data captured for %s", url)
            return []

        all_results = list(first_batch)

        logger.info(
            "Pagination check: totalCount=%d, first_batch=%d, token=%s, body_keys=%s",
            total_count, len(first_batch),
            "yes" if coveo_token else "no",
            list(coveo_request_body.keys()) if coveo_request_body else "none",
        )

        if coveo_token and coveo_request_body and total_count > len(first_batch):
            all_results += await self._paginate_coveo(
                coveo_token, coveo_request_body, total_count,
                start=len(first_batch), cookie_header=cookie_header,
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

    async def _paginate_coveo(
        self,
        token: str,
        base_body: dict,
        total_count: int,
        start: int,
        cookie_header: str = "",
    ) -> list[dict]:
        """Fetch all Coveo pages beyond the first browser-captured batch.

        Passes browser cookies and full browser-like headers so Akamai Bot Manager
        does not reject the direct httpx requests — the same session identity as the
        Playwright phase is presented to the Coveo API.
        """
        extra: list[dict] = []
        coveo_url = (
            "https://gafmaterialscorporationproduction3yalqk12.org.coveo.com"
            "/rest/search/v2?organizationId=gafmaterialscorporationproduction3yalqk12"
        )
        headers: dict[str, str] = {
            "Authorization": token,
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://www.gaf.com",
            "Referer": "https://www.gaf.com/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
        }
        if cookie_header:
            headers["Cookie"] = cookie_header

        first_result = start
        async with httpx.AsyncClient(follow_redirects=True) as client:
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
                    resp = await client.post(coveo_url, json=body, headers=headers, timeout=30)
                    resp.raise_for_status()
                    data = resp.json()
                    batch = data.get("results", [])
                    if not batch:
                        logger.warning(
                            "Coveo returned empty batch at firstResult=%d (totalCount=%d); stopping",
                            first_result, total_count,
                        )
                        break
                    extra.extend(batch)
                    first_result += len(batch)
                    logger.info(
                        "Coveo page firstResult=%d → +%d results (running total=%d / %d)",
                        first_result - len(batch), len(batch), len(extra) + start, total_count,
                    )
                except Exception:
                    logger.exception(
                        "httpx Coveo pagination failed at firstResult=%d (totalCount=%d, collected=%d)",
                        first_result, total_count, len(extra),
                    )
                    break
        logger.info(
            "Pagination complete: %d additional results fetched (first_batch=%d, total=%d)",
            len(extra), start, len(extra) + start,
        )
        return extra
