import json
import re
from anthropic import Anthropic
from app.models.lead import ContractorRecord, LeadInsight

_SYSTEM = """You are a sales intelligence analyst for a roofing materials distributor.
Score and analyze roofing contractor leads for sales rep prioritization.

IMPORTANT: Respond with a single valid JSON object — NO markdown fences, NO preamble.

Required keys:
  lead_score           (integer 1-10)
  score_rationale      (string, 1 sentence)
  ai_summary           (string, 2-3 sentences)
  talking_points       (array of exactly 3 strings)
  recommended_approach (string, 1-2 sentences)

Scoring:
  9-10: Master Elite, large operation, strong reviews, growth signals
  7-8:  GAF Certified, mid-size, good reviews
  5-6:  Uncertified but active, some presence
  3-4:  Small or dormant
  1-2:  Micro-operator, no web presence"""


def _prompt(c: ContractorRecord, research: dict) -> str:
    certs = ", ".join(c.certifications) if c.certifications else "none"
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

Return JSON with the exact keys from your instructions.
Talking points must reference this specific contractor's certifications, location, or research findings."""


class LeadEnricher:
    def __init__(self, api_key: str):
        self._client = Anthropic(api_key=api_key)

    def enrich(self, contractor: ContractorRecord, research: dict) -> LeadInsight:
        message = self._client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=800,
            temperature=0.3,
            system=_SYSTEM,
            messages=[{"role": "user", "content": _prompt(contractor, research)}],
        )
        raw = message.content[0].text.strip()
        data = self._parse(raw)
        data["lead_score"] = max(1, min(10, int(data.get("lead_score", 5))))
        data["talking_points"] = data.get("talking_points", [])[:3]
        return LeadInsight(**data)

    @staticmethod
    def _parse(raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
            return json.loads(cleaned)
