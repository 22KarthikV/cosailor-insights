import math
import re
from dataclasses import dataclass
from typing import Optional


# ── Data containers ──────────────────────────────────────────────────────────

@dataclass
class LeadScoreComponents:
    cert_points: float
    size_points: float   # always 5.0 from Python; Claude adjusts final score ±1
    rating_points: float
    review_points: float
    baseline: float      # weighted sum, clamped 1–10


@dataclass
class ConvertibilityComponents:
    portfolio_gap_detected: bool
    growth_signal_detected: bool
    cert_momentum_detected: bool
    baseline: float      # weighted sum, clamped 1–10


@dataclass
class DistanceResult:
    distance_miles: Optional[float]
    distance_band: str   # 'near' | 'mid' | 'far'


# ── Constants ─────────────────────────────────────────────────────────────────

_CERT_POINTS: dict[str, float] = {
    "master elite": 10.0,
    "certified":     7.0,
}
_CERT_DEFAULT = 2.0

_COMPETITOR_BRANDS = [
    "owens corning", "certainteed", "iko", "tamko", "atlas", "malarkey",
]
_EXCLUSIVE_GAF = re.compile(r"exclusive(?:ly)?\s+gaf|gaf\s+exclusive", re.IGNORECASE)

_GROWTH_KEYWORDS = [
    "hiring", "expanding", "new location", "new market", "growing", "opened",
]

_CERT_MOMENTUM_KEYWORDS = [
    "recently certified", "just became", "newly certified",
    "recently became", "just certified", "new certification", "newly became",
]

_DISTANCE_MODIFIER: dict[str, float] = {
    "near": 1.00,
    "mid":  0.95,
    "far":  0.90,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cert_points(certifications: list[str]) -> float:
    if not certifications:
        return _CERT_DEFAULT
    cert_str = " ".join(certifications).lower()
    if "master elite" in cert_str:
        return _CERT_POINTS["master elite"]
    if "certified" in cert_str:
        return _CERT_POINTS["certified"]
    return _CERT_DEFAULT


def _rating_points(rating: Optional[float]) -> float:
    if rating is None:
        return 5.0  # neutral when missing
    return min(rating * 2.0, 10.0)


def _review_points(review_count: Optional[int]) -> float:
    if not review_count:
        return 0.0
    return min((review_count / 50.0) * 10.0, 10.0)


# ── Service ───────────────────────────────────────────────────────────────────

class ScoringService:
    def compute_lead_baseline(self, contractor) -> LeadScoreComponents:
        cert    = _cert_points(contractor.certifications)
        size    = 5.0  # neutral; Claude adjusts based on research text
        rating  = _rating_points(contractor.rating)
        reviews = _review_points(contractor.review_count)

        raw = cert * 0.40 + size * 0.25 + rating * 0.25 + reviews * 0.10
        baseline = max(1.0, min(10.0, round(raw, 1)))

        return LeadScoreComponents(
            cert_points=cert,
            size_points=size,
            rating_points=rating,
            review_points=reviews,
            baseline=baseline,
        )

    def compute_convertibility_baseline(
        self, research_text: Optional[str]
    ) -> ConvertibilityComponents:
        raise NotImplementedError

    def compute_distance(
        self, contractor_postal: Optional[str], search_postal: str
    ) -> DistanceResult:
        raise NotImplementedError


def compute_priority_index(
    lead_score: int,
    convertibility_score: int,
    distance_band: str,
) -> float:
    modifier = _DISTANCE_MODIFIER.get(distance_band, 1.0)
    return round(((lead_score + convertibility_score) / 2) * modifier, 2)
