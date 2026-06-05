"""Perplexity AI web research service for contractor intelligence gathering.

ContractorResearcher queries the Perplexity Sonar model to retrieve publicly
available B2B intelligence about each contractor (brands used, company size,
reputation, growth signals) before the data reaches the Claude enrichment step.

Concurrency is capped at _CONCURRENCY simultaneous requests with a _DELAY
between each slot to avoid triggering Perplexity's rate limits. API errors
are silently caught and return an empty result so a single failure does not
stall the rest of the batch.
"""
import asyncio
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.models.lead import ContractorRecord

# System prompt keeps Perplexity responses focused on sales-relevant facts.
_SYSTEM = """You are a B2B sales research assistant for a roofing materials distributor.
Gather factual intelligence about roofing contractors for sales outreach preparation.
Be concise. Focus only on B2B-relevant information."""

# Rate-limiting constants for the batch research call.
_CONCURRENCY = 5   # max simultaneous Perplexity requests
_DELAY = 0.8       # seconds to wait after each request within a semaphore slot


def _build_prompt(c: ContractorRecord) -> str:
    """Format the Perplexity user prompt with contractor identity information."""
    location = f"{c.city}, {c.state}" if c.city else c.postal_code or "unknown"
    certs = ", ".join(c.certifications) if c.certifications else "none"
    return f"""Research this roofing contractor for a sales team at a GAF roofing distributor:

Company: {c.company_name}
Location: {location}
Phone: {c.phone or 'unknown'}
Website: {c.website or 'not provided'}
GAF Certifications: {certs}

Provide briefly:
1. Roofing brands/products they currently use or advertise
2. Approximate company size (employees/revenue tier)
3. Online reputation (BBB, Google review sentiment)
4. Any recent growth signals or new markets
If information is unavailable, say so briefly."""


class ContractorResearcher:
    """Queries Perplexity Sonar to gather B2B web intelligence for each contractor."""

    def __init__(self, api_key: str):
        self._api_key = api_key

    async def research(self, contractor: ContractorRecord) -> dict:
        """Research a single contractor. Returns an empty result dict on any API failure."""
        try:
            return await self._call_perplexity(contractor)
        except Exception:
            return {"summary": "", "sources": []}

    @retry(
        retry=retry_if_exception_type(httpx.HTTPStatusError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _call_perplexity(self, contractor: ContractorRecord) -> dict:
        """Make a single Perplexity API call with exponential backoff on HTTP errors.

        return_citations=True instructs Perplexity to include source URLs in the
        response, which are stored alongside the summary for traceability.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "sonar",
                    "messages": [
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": _build_prompt(contractor)},
                    ],
                    "max_tokens": 600,
                    "temperature": 0.2,
                    "return_citations": True,
                },
            )
            response.raise_for_status()
            data = response.json()
            return {
                "summary": data["choices"][0]["message"]["content"],
                "sources": data.get("citations", []),
            }

    async def research_all(self, contractors: list[ContractorRecord]) -> list[dict]:
        """Research all contractors concurrently, bounded by the semaphore limit.

        Results are returned in the same order as the input list so callers can
        safely zip contractors with their research dicts.
        """
        semaphore = asyncio.Semaphore(_CONCURRENCY)

        async def one(c: ContractorRecord) -> dict:
            async with semaphore:
                result = await self.research(c)
                await asyncio.sleep(_DELAY)
                return result

        return list(await asyncio.gather(*[one(c) for c in contractors]))
