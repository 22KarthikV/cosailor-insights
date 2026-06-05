"""Claude AI lead enrichment service.

LeadEnricher orchestrates the following for each contractor:
  1. Compute deterministic scoring baselines via ScoringService.
  2. Call claude-haiku-4-5 with a structured prompt containing GAF data,
     Perplexity research, and the pre-computed baselines.
  3. Parse and clamp the returned JSON to within ±1 of each Python baseline.
  4. Assemble and return a LeadInsight ready for database persistence.

The scoring baselines act as an anchor: Claude may adjust each score by at
most ±1 based on research context, keeping outputs deterministic and auditable
regardless of LLM temperature drift.
"""
import asyncio
import json
import re
from anthropic import Anthropic
from app.models.lead import ContractorRecord, LeadInsight
from app.services.scorer import ScoringService, compute_priority_index

# System prompt instructs Claude to return a single JSON object with no
# markdown wrapping. Strict format required because _parse() only does one
# level of fence-stripping before raising.
_SYSTEM = """You are a sales intelligence analyst for a roofing materials distributor.
Score and analyze roofing contractor leads for sales rep prioritization.

IMPORTANT: Respond with a single valid JSON object — NO markdown fences, NO preamble.

Required keys:
  lead_score               (integer — must equal lead baseline ± 1 at most)
  score_rationale          (string, 1 sentence)
  convertibility_score     (integer — must equal convertibility baseline ± 1 at most)
  convertibility_rationale (string, 1 sentence)
  ai_summary               (string, 2-3 sentences)
  talking_points           (array of exactly 3 strings)
  recommended_approach     (string, 1-2 sentences)"""


def _fmt(detected: bool) -> str:
    """Convert a boolean signal flag to a human-readable label for the Claude prompt."""
    return "DETECTED" if detected else "NOT FOUND"


def _prompt(c: ContractorRecord, research: dict, lead_comps, conv_comps) -> str:
    """Build the user turn sent to Claude with contractor data, research, and baselines.

    Baselines are embedded in the prompt so Claude can see the Python-computed
    anchor values before producing its response, enabling the ±1 adjustment rule.
    """
    certs = ", ".join(c.certifications) if c.certifications else "none"
    lead_int = round(lead_comps.baseline)
    conv_int  = round(conv_comps.baseline)

    return f"""Analyze this lead.

=== GAF DATA ===
Company: {c.company_name}
Location: {c.city or ''}, {c.state or ''} {c.postal_code or ''}
Phone: {c.phone or 'N/A'}
Website: {c.website or 'N/A'}
GAF Certifications: {certs}
Rating: {c.rating or 'N/A'} ({c.review_count or 0} reviews)

=== WEB RESEARCH ===
{research.get('summary') or 'No research available.'}

=== SCORING BASELINES ===
Lead score baseline: {lead_comps.baseline} → rounded to {lead_int}
  - Certification:  {lead_comps.cert_points:.1f} pts (weight 40%)
  - Size/Revenue:   {lead_comps.size_points:.1f} pts (weight 25%) → unknown, use research context
  - Star Rating:    {lead_comps.rating_points:.1f} pts (weight 25%)
  - Review Count:   {lead_comps.review_points:.1f} pts (weight 10%)

Convertibility baseline: {conv_comps.baseline} → rounded to {conv_int}
  - Portfolio gap:      {_fmt(conv_comps.portfolio_gap_detected)}   (40%)
  - Growth signals:     {_fmt(conv_comps.growth_signal_detected)}   (35%)
  - Cert momentum:      {_fmt(conv_comps.cert_momentum_detected)}   (25%)

RULES:
- You may adjust lead_score by ±1 from its baseline ({lead_int}) based on research context.
- You may adjust convertibility_score by ±1 from its baseline ({conv_int}) based on research context.
- Do not exceed these bounds under any circumstances.
- Return both scores as integers.

Return JSON with the exact keys from your instructions.
Talking points must reference this specific contractor's certifications, location, or research findings."""


class LeadEnricher:
    """Enriches a contractor record with Claude AI scoring and sales intelligence."""

    def __init__(self, api_key: str):
        self._client = Anthropic(api_key=api_key)
        self._scorer = ScoringService()

    def enrich(
        self,
        contractor: ContractorRecord,
        research: dict,
        search_postal_code: str = "",
    ) -> LeadInsight:
        """Run the full enrichment flow synchronously and return a LeadInsight.

        Computes baselines first, calls Claude, then clamps the returned scores
        to ±1 of their respective Python baselines as a safety net against drift.
        """
        lead_comps    = self._scorer.compute_lead_baseline(contractor)
        conv_comps    = self._scorer.compute_convertibility_baseline(
            research.get("summary")
        )
        distance      = self._scorer.compute_distance(
            contractor.postal_code, search_postal_code
        )

        message = self._client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=900,
            temperature=0.3,
            system=_SYSTEM,
            messages=[{
                "role": "user",
                "content": _prompt(contractor, research, lead_comps, conv_comps),
            }],
        )
        raw  = message.content[0].text.strip()
        data = self._parse(raw)

        # Clamp each score within ±1 of its Python baseline to prevent LLM drift
        lead_int = round(lead_comps.baseline)
        conv_int = round(conv_comps.baseline)
        data["lead_score"] = max(
            max(1, lead_int - 1),
            min(min(10, lead_int + 1), int(data.get("lead_score", lead_int))),
        )
        data["convertibility_score"] = max(
            max(1, conv_int - 1),
            min(min(10, conv_int + 1), int(data.get("convertibility_score", conv_int))),
        )

        data["talking_points"] = data.get("talking_points", [])[:3]
        data["distance_miles"]  = distance.distance_miles
        data["distance_band"]   = distance.distance_band
        data["priority_index"]  = compute_priority_index(
            data["lead_score"], data["convertibility_score"], distance.distance_band
        )

        return LeadInsight(**data)

    async def enrich_async(
        self,
        contractor: ContractorRecord,
        research: dict,
        search_postal_code: str = "",
    ) -> LeadInsight:
        """Async wrapper around enrich() for use in async pipeline contexts.

        The Anthropic SDK client is synchronous, so this offloads the call to a
        thread pool executor to avoid blocking the event loop.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self.enrich, contractor, research, search_postal_code
        )

    @staticmethod
    def _parse(raw: str) -> dict:
        """Parse Claude's JSON response, stripping markdown fences if present.

        Claude occasionally wraps JSON in ```json``` blocks despite instructions
        not to. This method handles both clean and fenced responses before raising.
        """
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
            return json.loads(cleaned)
