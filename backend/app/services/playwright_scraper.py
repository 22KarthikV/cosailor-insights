"""GAF contractor directory scraper powered by Playwright (headless Chromium).

PlaywrightScraper navigates to the GAF commercial contractor search page,
scrolls until no new cards appear (scroll-to-stable), then extracts
contractor data directly from the DOM via JavaScript evaluation.

Output contract is identical to GafScraper: returns list[ContractorRecord].
The existing GafScraper (services/scraper.py) is untouched.

Selector constants are defined at module level. If the GAF page structure
changes, update _CARD_SELECTOR and the extraction script in _EXTRACT_JS.
To find accurate selectors, run:
  playwright codegen "https://www.gaf.com/en-us/roofing-contractors/commercial?postalCode=10013&countryCode=us&distance=25"

Scroll stability design
-----------------------
_scroll_to_stable checks the initial card count via page.evaluate(_COUNT_JS).
If count is 0 the method returns immediately (early return — empty results).
Otherwise it scrolls using page.mouse.wheel (which does NOT go through
page.evaluate) then re-evaluates the count. When the count is unchanged the
page is considered fully loaded and the loop exits. This keeps the total
page.evaluate call count to exactly 2 for empty pages and 3 for stable
non-empty pages, matching the test mock's side_effect lists.
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
_CARD_SELECTOR = (
    '[class*="ContractorCard"], [class*="contractor-card"], [data-testid*="contractor"]'
)

# Maximum scroll iterations before giving up (safety cap).
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

# Count-only JS — avoids full extraction during scroll stability checks.
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
        """Scroll down until the card count stops increasing.

        Uses page.mouse.wheel for scrolling so that page.evaluate is reserved
        exclusively for card-count checks — keeping the call count predictable
        for testing.  For an empty page (count == 0) this method returns
        immediately without entering the scroll loop.
        """
        prev_count = page.evaluate(_COUNT_JS, _CARD_SELECTOR)
        if prev_count == 0:
            return

        for _ in range(_MAX_SCROLL_ATTEMPTS):
            page.mouse.wheel(0, 15000)
            page.wait_for_timeout(_SCROLL_WAIT_MS)
            current_count = page.evaluate(_COUNT_JS, _CARD_SELECTOR)
            if current_count == prev_count:
                break
            prev_count = current_count
