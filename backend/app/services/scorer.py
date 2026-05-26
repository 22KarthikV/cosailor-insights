import math
import re
from dataclasses import dataclass
from typing import Optional

import pgeocode


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
        if not research_text:
            return ConvertibilityComponents(
                portfolio_gap_detected=False,
                growth_signal_detected=False,
                cert_momentum_detected=False,
                baseline=1.0,
            )

        text_lower = research_text.lower()

        # Portfolio gap: competitor brands present, no exclusive-GAF language
        has_competitor = any(brand in text_lower for brand in _COMPETITOR_BRANDS)
        has_exclusive = bool(_EXCLUSIVE_GAF.search(research_text))
        portfolio_gap = has_competitor and not has_exclusive

        # Growth signals
        growth = any(kw in text_lower for kw in _GROWTH_KEYWORDS)

        # Certification momentum
        cert_momentum = any(kw in text_lower for kw in _CERT_MOMENTUM_KEYWORDS)

        raw = (
            (10.0 * 0.40 if portfolio_gap  else 0.0) +
            (10.0 * 0.35 if growth         else 0.0) +
            (10.0 * 0.25 if cert_momentum  else 0.0)
        )
        baseline = float(max(1, round(raw)))

        return ConvertibilityComponents(
            portfolio_gap_detected=portfolio_gap,
            growth_signal_detected=growth,
            cert_momentum_detected=cert_momentum,
            baseline=baseline,
        )

    def compute_distance(
        self, contractor_postal: Optional[str], search_postal: str
    ) -> DistanceResult:
        if not contractor_postal or not search_postal:
            return DistanceResult(distance_miles=None, distance_band="near")

        try:
            nomi = pgeocode.Nominatim("us")
            dest   = nomi.query_postal_code(contractor_postal)
            origin = nomi.query_postal_code(search_postal)

            # Guard against NaN values (unrecognised postal codes)
            coords = [dest.latitude, dest.longitude, origin.latitude, origin.longitude]
            if any(math.isnan(float(v)) for v in coords):
                return DistanceResult(distance_miles=None, distance_band="near")

            # Haversine formula
            lat1 = math.radians(float(origin.latitude))
            lon1 = math.radians(float(origin.longitude))
            lat2 = math.radians(float(dest.latitude))
            lon2 = math.radians(float(dest.longitude))

            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = (
                math.sin(dlat / 2) ** 2
                + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
            )
            miles = 6371 * 2 * math.asin(math.sqrt(a)) * 0.621371

            if miles <= 25:
                band = "near"
            elif miles <= 50:
                band = "mid"
            else:
                band = "far"

            return DistanceResult(distance_miles=round(miles, 2), distance_band=band)

        except Exception:
            return DistanceResult(distance_miles=None, distance_band="near")


def compute_priority_index(
    lead_score: int,
    convertibility_score: int,
    distance_band: str,
) -> float:
    modifier = _DISTANCE_MODIFIER.get(distance_band, 1.0)
    return round(((lead_score + convertibility_score) / 2) * modifier, 3)
