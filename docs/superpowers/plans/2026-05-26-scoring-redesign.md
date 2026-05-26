# Scoring System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the black-box Claude-only score with a hybrid weighted formula that produces two independent scores (lead quality + convertibility), a distance band, and a sortable priority index.

**Architecture:** A new `ScoringService` (pure Python, no I/O) computes weighted baselines for both scores and the distance band. `LeadEnricher` calls `ScoringService` first, then passes the baselines to Claude, which can adjust each score by ±1 and generates all narrative. `pipeline.py` passes `search_postal_code` through to the enricher.

**Tech Stack:** Python 3.14, FastAPI, `pgeocode>=0.5.0` (offline postal code geocoding), Anthropic `claude-haiku-4-5`, Supabase PostgreSQL, pytest

**Spec:** `docs/superpowers/specs/2026-05-26-scoring-redesign.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/requirements.txt` | Modify | Add `pgeocode>=0.5.0` |
| `backend/app/schema.sql` | Modify | Add 5 new columns + index |
| `backend/app/models/lead.py` | Modify | Update `LeadInsight`, `LeadResponse` with new fields |
| `backend/app/services/scorer.py` | **Create** | `ScoringService` — pure Python baseline computation |
| `backend/tests/test_scorer.py` | **Create** | Unit tests for all three scorer methods + priority index |
| `backend/app/services/enricher.py` | Modify | Use `ScoringService`, updated prompt, new signature |
| `backend/tests/test_enricher.py` | Modify | Updated MOCK_JSON, new signature, new field assertions |
| `backend/app/services/pipeline.py` | Modify | Pass `search_postal_code` to `enrich()` |
| `backend/tests/test_pipeline.py` | Modify | Updated `LeadInsight` construction + enricher call assertion |
| `backend/tests/conftest.py` | Modify | Add new fields to `sample_lead_row` fixture |
| `backend/app/repositories/lead_repository.py` | Modify | `update_enrichment` persists 5 new fields; `get_all_leads` sorts by `priority_index` |

---

## Task 1: Add Dependency + DB Migration

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/schema.sql`

- [ ] **Step 1: Add pgeocode to requirements**

Open `backend/requirements.txt` and add after the `tenacity` line:

```
pgeocode>=0.5.0
```

Full file after edit:
```
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic>=2.10.0
pydantic-settings>=2.6.0
supabase>=2.11.0
firecrawl-py>=2.0.0
httpx==0.27.2
anthropic==0.40.0
tenacity==9.0.0
pgeocode>=0.5.0
pytest==8.3.3
pytest-asyncio==0.24.0
pytest-mock==3.14.0
python-dotenv==1.0.1
```

- [ ] **Step 2: Install the new dependency**

```bash
cd backend
pip install pgeocode>=0.5.0
```

Expected: pgeocode installs successfully (it also installs `numpy` and `pandas` as dependencies).

- [ ] **Step 3: Add migration SQL to schema.sql**

Open `backend/app/schema.sql`. Append the following at the end of the file:

```sql
-- Migration: scoring redesign (2026-05-26)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS convertibility_score     INTEGER CHECK (convertibility_score BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS convertibility_rationale TEXT,
  ADD COLUMN IF NOT EXISTS distance_miles           NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS distance_band            TEXT CHECK (distance_band IN ('near','mid','far')),
  ADD COLUMN IF NOT EXISTS priority_index           NUMERIC(4,2);

CREATE INDEX IF NOT EXISTS idx_leads_priority_index ON leads (priority_index DESC NULLS LAST);
```

- [ ] **Step 4: Run the migration in Supabase**

Go to your Supabase project → SQL Editor → New query. Paste and run:

```sql
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS convertibility_score     INTEGER CHECK (convertibility_score BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS convertibility_rationale TEXT,
  ADD COLUMN IF NOT EXISTS distance_miles           NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS distance_band            TEXT CHECK (distance_band IN ('near','mid','far')),
  ADD COLUMN IF NOT EXISTS priority_index           NUMERIC(4,2);

CREATE INDEX IF NOT EXISTS idx_leads_priority_index ON leads (priority_index DESC NULLS LAST);
```

Expected: "Success. No rows returned."

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/schema.sql
git commit -m "chore: add pgeocode dependency and scoring migration SQL"
```

---

## Task 2: Update Models

**Files:**
- Modify: `backend/app/models/lead.py`

- [ ] **Step 1: Write the failing tests for new model fields**

Create a new test file `backend/tests/test_models.py`:

```python
def test_lead_insight_requires_convertibility_fields():
    from app.models.lead import LeadInsight
    import pytest

    with pytest.raises(Exception):
        # Should fail: missing convertibility_score and convertibility_rationale
        LeadInsight(
            lead_score=7,
            score_rationale="Good lead.",
            ai_summary="Summary.",
            talking_points=["a", "b", "c"],
            recommended_approach="Call them.",
        )


def test_lead_insight_accepts_all_fields():
    from app.models.lead import LeadInsight

    insight = LeadInsight(
        lead_score=7,
        score_rationale="Good lead.",
        convertibility_score=5,
        convertibility_rationale="Some growth signals.",
        distance_miles=12.5,
        distance_band="near",
        priority_index=6.0,
        ai_summary="Summary.",
        talking_points=["a", "b", "c"],
        recommended_approach="Call them.",
    )
    assert insight.convertibility_score == 5
    assert insight.distance_band == "near"
    assert insight.priority_index == 6.0


def test_lead_response_new_fields_are_optional():
    from app.models.lead import LeadResponse
    from uuid import uuid4
    from datetime import datetime, timezone

    # Should not raise — all new fields are optional
    resp = LeadResponse(
        id=uuid4(),
        company_name="Test Co",
        status="scraped",
        created_at=datetime.now(timezone.utc),
    )
    assert resp.convertibility_score is None
    assert resp.distance_band is None
    assert resp.priority_index is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
pytest tests/test_models.py -v
```

Expected: `test_lead_insight_requires_convertibility_fields` FAILS (LeadInsight currently doesn't have those fields), `test_lead_insight_accepts_all_fields` FAILS.

- [ ] **Step 3: Update LeadInsight and LeadResponse in models/lead.py**

Replace the contents of `backend/app/models/lead.py` with:

```python
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class ContractorRecord(BaseModel):
    company_name: str
    gaf_contractor_id: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country_code: str = "us"
    phone: Optional[str] = None
    website: Optional[str] = None
    gaf_profile_url: Optional[str] = None
    certifications: list[str] = Field(default_factory=list)
    years_in_business: Optional[int] = None
    service_area: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None


class LeadInsight(BaseModel):
    lead_score: int = Field(..., ge=1, le=10)
    score_rationale: str
    convertibility_score: int = Field(..., ge=1, le=10)
    convertibility_rationale: str
    distance_miles: Optional[float] = None
    distance_band: str = "near"
    priority_index: float = 0.0
    ai_summary: str
    talking_points: list[str] = Field(..., min_length=1, max_length=3)
    recommended_approach: str


class LeadResponse(BaseModel):
    id: UUID
    company_name: str
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country_code: str = "us"
    phone: Optional[str] = None
    website: Optional[str] = None
    certifications: list[str] = []
    rating: Optional[float] = None
    review_count: Optional[int] = None
    research_summary: Optional[str] = None
    lead_score: Optional[int] = None
    score_rationale: Optional[str] = None
    convertibility_score: Optional[int] = None
    convertibility_rationale: Optional[str] = None
    distance_miles: Optional[float] = None
    distance_band: Optional[str] = None
    priority_index: Optional[float] = None
    ai_summary: Optional[str] = None
    talking_points: list[str] = []
    recommended_approach: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    enriched_at: Optional[datetime] = None
    created_at: datetime


class PipelineRunRequest(BaseModel):
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25
    limit: Optional[int] = None


class PipelineRunResponse(BaseModel):
    run_id: UUID
    status: str
    message: str


class PipelineStatusResponse(BaseModel):
    run_id: UUID
    status: str
    leads_scraped: int
    leads_enriched: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/test_models.py -v
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/lead.py backend/tests/test_models.py
git commit -m "feat: update LeadInsight and LeadResponse with scoring redesign fields"
```

---

## Task 3: ScoringService — Lead Baseline

**Files:**
- Create: `backend/app/services/scorer.py`
- Create: `backend/tests/test_scorer.py`

- [ ] **Step 1: Write the failing tests for lead baseline**

Create `backend/tests/test_scorer.py`:

```python
import pytest


class TestLeadBaseline:
    def test_master_elite_cert_gives_10_points(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(
            company_name="Test",
            certifications=["GAF Master Elite"],
            rating=None,
            review_count=None,
        )
        result = svc.compute_lead_baseline(c)
        assert result.cert_points == 10.0

    def test_certified_gives_7_points(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(
            company_name="Test",
            certifications=["GAF Certified Contractor"],
        )
        result = svc.compute_lead_baseline(c)
        assert result.cert_points == 7.0

    def test_no_certification_gives_2_points(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(company_name="Test", certifications=[])
        result = svc.compute_lead_baseline(c)
        assert result.cert_points == 2.0

    def test_rating_converts_to_0_to_10_scale(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(company_name="Test", rating=4.8)
        result = svc.compute_lead_baseline(c)
        assert result.rating_points == pytest.approx(9.6)

    def test_missing_rating_gives_neutral_5_points(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(company_name="Test", rating=None)
        result = svc.compute_lead_baseline(c)
        assert result.rating_points == 5.0

    def test_review_count_capped_at_50(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(company_name="Test", review_count=100)
        result = svc.compute_lead_baseline(c)
        assert result.review_points == 10.0

    def test_partial_review_count(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(company_name="Test", review_count=25)
        result = svc.compute_lead_baseline(c)
        assert result.review_points == pytest.approx(5.0)

    def test_size_points_always_neutral(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(company_name="Test")
        result = svc.compute_lead_baseline(c)
        assert result.size_points == 5.0

    def test_full_baseline_calculation_master_elite(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(
            company_name="Acme Roofing",
            certifications=["GAF Master Elite"],
            rating=4.8,
            review_count=47,
        )
        result = svc.compute_lead_baseline(c)
        # cert=10*0.4 + size=5*0.25 + rating=9.6*0.25 + reviews=9.4*0.1
        # = 4.0 + 1.25 + 2.4 + 0.94 = 8.59 → rounds to 8.6
        assert result.baseline == pytest.approx(8.6, abs=0.1)
        assert 1 <= result.baseline <= 10

    def test_baseline_clamped_to_1_minimum(self):
        from app.services.scorer import ScoringService
        from app.models.lead import ContractorRecord

        svc = ScoringService()
        c = ContractorRecord(
            company_name="Tiny Co",
            certifications=[],
            rating=0.0,
            review_count=0,
        )
        result = svc.compute_lead_baseline(c)
        assert result.baseline >= 1.0
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend
pytest tests/test_scorer.py -v
```

Expected: All tests FAIL — `scorer` module does not exist yet.

- [ ] **Step 3: Create scorer.py with lead baseline only**

Create `backend/app/services/scorer.py`:

```python
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
        cert   = _cert_points(contractor.certifications)
        size   = 5.0  # neutral; Claude adjusts based on research text
        rating = _rating_points(contractor.rating)
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

    def compute_convertibility_baseline(self, research_text: Optional[str]) -> ConvertibilityComponents:
        raise NotImplementedError

    def compute_distance(self, contractor_postal: Optional[str], search_postal: str) -> DistanceResult:
        raise NotImplementedError


def compute_priority_index(
    lead_score: int,
    convertibility_score: int,
    distance_band: str,
) -> float:
    modifier = _DISTANCE_MODIFIER.get(distance_band, 1.0)
    return round(((lead_score + convertibility_score) / 2) * modifier, 2)
```

- [ ] **Step 4: Run lead baseline tests**

```bash
pytest tests/test_scorer.py::TestLeadBaseline -v
```

Expected: All 10 lead baseline tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scorer.py backend/tests/test_scorer.py
git commit -m "feat: ScoringService lead baseline with weighted formula"
```

---

## Task 4: ScoringService — Convertibility Baseline

**Files:**
- Modify: `backend/app/services/scorer.py`
- Modify: `backend/tests/test_scorer.py`

- [ ] **Step 1: Write the failing tests for convertibility baseline**

Append to `backend/tests/test_scorer.py`:

```python
class TestConvertibilityBaseline:
    def test_empty_research_returns_all_false_baseline_1(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(None)
        assert result.portfolio_gap_detected is False
        assert result.growth_signal_detected is False
        assert result.cert_momentum_detected is False
        assert result.baseline == 1.0

    def test_empty_string_research_returns_baseline_1(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline("")
        assert result.baseline == 1.0

    def test_competitor_brand_detected_as_portfolio_gap(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(
            "The company uses Owens Corning and IKO shingles."
        )
        assert result.portfolio_gap_detected is True

    def test_exclusive_gaf_suppresses_portfolio_gap(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(
            "They exclusively GAF products and also mentioned CertainTeed once."
        )
        assert result.portfolio_gap_detected is False

    def test_growth_keywords_detected(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(
            "The company is expanding into new markets and hiring aggressively."
        )
        assert result.growth_signal_detected is True

    def test_cert_momentum_detected(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(
            "They recently certified as a GAF Master Elite contractor."
        )
        assert result.cert_momentum_detected is True

    def test_all_three_signals_gives_baseline_10(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(
            "They use Owens Corning and are expanding. They recently certified."
        )
        assert result.portfolio_gap_detected is True
        assert result.growth_signal_detected is True
        assert result.cert_momentum_detected is True
        assert result.baseline == 10.0

    def test_portfolio_gap_only_gives_baseline_4(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(
            "They use Owens Corning shingles."
        )
        assert result.portfolio_gap_detected is True
        assert result.growth_signal_detected is False
        assert result.cert_momentum_detected is False
        # 10 * 0.40 = 4.0
        assert result.baseline == 4.0

    def test_growth_only_gives_baseline_4(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline(
            "They are hiring and expanding rapidly."
        )
        # 10 * 0.35 = 3.5 → round(3.5) = 4 (Python banker's rounding)
        assert result.growth_signal_detected is True
        assert result.baseline == 4.0

    def test_baseline_never_below_1(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_convertibility_baseline("No signals here at all.")
        assert result.baseline >= 1.0
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_scorer.py::TestConvertibilityBaseline -v
```

Expected: All tests FAIL — `compute_convertibility_baseline` raises `NotImplementedError`.

- [ ] **Step 3: Implement compute_convertibility_baseline in scorer.py**

Replace the `compute_convertibility_baseline` method in `ScoringService`:

```python
def compute_convertibility_baseline(self, research_text: Optional[str]) -> ConvertibilityComponents:
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
```

- [ ] **Step 4: Run convertibility tests**

```bash
pytest tests/test_scorer.py::TestConvertibilityBaseline -v
```

Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scorer.py backend/tests/test_scorer.py
git commit -m "feat: ScoringService convertibility baseline with signal detection"
```

---

## Task 5: ScoringService — Distance + Priority Index

**Files:**
- Modify: `backend/app/services/scorer.py`
- Modify: `backend/tests/test_scorer.py`

- [ ] **Step 1: Write the failing tests for distance and priority index**

Append to `backend/tests/test_scorer.py`:

```python
class TestDistance:
    def test_missing_contractor_postal_returns_near_band(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_distance(None, "10013")
        assert result.distance_miles is None
        assert result.distance_band == "near"

    def test_missing_search_postal_returns_near_band(self):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_distance("10013", "")
        assert result.distance_miles is None
        assert result.distance_band == "near"

    def test_same_postal_code_gives_near_band(self, mock_pgeocode_same):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_distance("10013", "10013")
        assert result.distance_band == "near"
        assert result.distance_miles == pytest.approx(0.0, abs=1.0)

    def test_near_band_0_to_25_miles(self, mock_pgeocode_near):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_distance("10013", "10001")
        assert result.distance_band == "near"
        assert result.distance_miles is not None
        assert result.distance_miles <= 25.0

    def test_mid_band_26_to_50_miles(self, mock_pgeocode_mid):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_distance("07001", "10013")
        assert result.distance_band == "mid"
        assert 25.0 < result.distance_miles <= 50.0

    def test_far_band_over_50_miles(self, mock_pgeocode_far):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_distance("06001", "10013")
        assert result.distance_band == "far"
        assert result.distance_miles > 50.0

    def test_invalid_postal_returns_near_fallback(self, mock_pgeocode_invalid):
        from app.services.scorer import ScoringService

        svc = ScoringService()
        result = svc.compute_distance("99999", "10013")
        assert result.distance_band == "near"
        assert result.distance_miles is None


class TestPriorityIndex:
    def test_near_band_no_modifier(self):
        from app.services.scorer import compute_priority_index

        result = compute_priority_index(9, 8, "near")
        assert result == pytest.approx(8.5)

    def test_mid_band_applies_0_95_modifier(self):
        from app.services.scorer import compute_priority_index

        result = compute_priority_index(9, 8, "mid")
        assert result == pytest.approx(8.075)

    def test_far_band_applies_0_90_modifier(self):
        from app.services.scorer import compute_priority_index

        result = compute_priority_index(9, 8, "far")
        assert result == pytest.approx(7.65)

    def test_unknown_band_defaults_to_no_modifier(self):
        from app.services.scorer import compute_priority_index

        result = compute_priority_index(8, 6, "unknown")
        assert result == pytest.approx(7.0)
```

- [ ] **Step 2: Add pgeocode fixtures to conftest.py**

Open `backend/tests/conftest.py` and add the following at the bottom:

```python
import pytest
from unittest.mock import MagicMock, patch


def _make_postal_result(lat: float, lon: float):
    """Create a mock pgeocode query result with given lat/lon."""
    result = MagicMock()
    result.latitude = lat
    result.longitude = lon
    return result


@pytest.fixture
def mock_pgeocode_same():
    """Both postal codes map to the same location (0 miles apart)."""
    with patch("app.services.scorer.pgeocode") as mock_pg:
        nomi = MagicMock()
        nomi.query_postal_code.return_value = _make_postal_result(40.7128, -74.0060)
        mock_pg.Nominatim.return_value = nomi
        yield mock_pg


@pytest.fixture
def mock_pgeocode_near():
    """Two postal codes ~1 mile apart — Near band."""
    with patch("app.services.scorer.pgeocode") as mock_pg:
        nomi = MagicMock()
        nomi.query_postal_code.side_effect = [
            _make_postal_result(40.7128, -74.0060),   # contractor
            _make_postal_result(40.7178, -74.0020),   # search origin
        ]
        mock_pg.Nominatim.return_value = nomi
        yield mock_pg


@pytest.fixture
def mock_pgeocode_mid():
    """Two postal codes ~30 miles apart — Mid band."""
    with patch("app.services.scorer.pgeocode") as mock_pg:
        nomi = MagicMock()
        nomi.query_postal_code.side_effect = [
            _make_postal_result(40.4000, -74.4000),   # contractor (~30 mi from NYC)
            _make_postal_result(40.7128, -74.0060),   # search origin (NYC)
        ]
        mock_pg.Nominatim.return_value = nomi
        yield mock_pg


@pytest.fixture
def mock_pgeocode_far():
    """Two postal codes ~100 miles apart — Far band."""
    with patch("app.services.scorer.pgeocode") as mock_pg:
        nomi = MagicMock()
        nomi.query_postal_code.side_effect = [
            _make_postal_result(41.7658, -72.6851),   # contractor (~100 mi away)
            _make_postal_result(40.7128, -74.0060),   # search origin
        ]
        mock_pg.Nominatim.return_value = nomi
        yield mock_pg


@pytest.fixture
def mock_pgeocode_invalid():
    """Postal code lookup returns NaN — should fall back gracefully."""
    import math
    with patch("app.services.scorer.pgeocode") as mock_pg:
        nomi = MagicMock()
        nomi.query_postal_code.side_effect = [
            _make_postal_result(math.nan, math.nan),  # invalid
            _make_postal_result(40.7128, -74.0060),
        ]
        mock_pg.Nominatim.return_value = nomi
        yield mock_pg
```

- [ ] **Step 3: Run to confirm tests fail**

```bash
pytest tests/test_scorer.py::TestDistance tests/test_scorer.py::TestPriorityIndex -v
```

Expected: All fail — `compute_distance` raises `NotImplementedError`.

- [ ] **Step 4: Implement compute_distance in scorer.py**

Add `import pgeocode` at the top of `backend/app/services/scorer.py` (after the existing imports):

```python
import pgeocode
```

Then replace the `compute_distance` method in `ScoringService`:

```python
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
```

- [ ] **Step 5: Run distance and priority index tests**

```bash
pytest tests/test_scorer.py::TestDistance tests/test_scorer.py::TestPriorityIndex -v
```

Expected: All tests PASS.

- [ ] **Step 6: Run full scorer test suite**

```bash
pytest tests/test_scorer.py -v
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/scorer.py backend/tests/test_scorer.py backend/tests/conftest.py
git commit -m "feat: ScoringService distance band, Haversine calculation, priority index"
```

---

## Task 6: Update LeadEnricher

**Files:**
- Modify: `backend/app/services/enricher.py`
- Modify: `backend/tests/test_enricher.py`

- [ ] **Step 1: Update MOCK_JSON and existing tests in test_enricher.py**

Replace the contents of `backend/tests/test_enricher.py` with:

```python
import pytest
from unittest.mock import MagicMock, patch

MOCK_JSON = """{
  "lead_score": 9,
  "score_rationale": "Master Elite certified with strong reviews justifies top-tier score.",
  "convertibility_score": 7,
  "convertibility_rationale": "Competitor brands detected in research, growth signals present.",
  "ai_summary": "Acme Roofing is a top-tier GAF contractor in NYC with 47 5-star reviews. Master Elite status makes them ideal for distributor outreach.",
  "talking_points": [
    "As a Master Elite contractor you qualify for exclusive GAF volume rebates — let's review what's available.",
    "With 47 reviews at 4.8 stars your reputation is a competitive advantage — GAF warranty programs amplify this.",
    "Timberline HDZ demand is strong in NYC — your certification positions you to capture that market."
  ],
  "recommended_approach": "Open with a call to the owner referencing their Master Elite status. Lead with the rebate program then discuss new product availability."
}"""


def _make_enricher_with_mock_claude(mock_json: str, search_postal: str = "10013"):
    """Helper: return an enricher that uses a mock Claude response."""
    from app.services.scorer import (
        LeadScoreComponents, ConvertibilityComponents, DistanceResult
    )

    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=mock_json)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    mock_lead_comps = LeadScoreComponents(
        cert_points=10.0, size_points=5.0,
        rating_points=9.6, review_points=9.4, baseline=8.6,
    )
    mock_conv_comps = ConvertibilityComponents(
        portfolio_gap_detected=True, growth_signal_detected=True,
        cert_momentum_detected=False, baseline=7.5,
    )
    mock_distance = DistanceResult(distance_miles=5.2, distance_band="near")

    with patch("app.services.enricher.Anthropic", return_value=mock_client), \
         patch("app.services.enricher.ScoringService") as mock_scorer_cls:

        mock_scorer = MagicMock()
        mock_scorer_cls.return_value = mock_scorer
        mock_scorer.compute_lead_baseline.return_value = mock_lead_comps
        mock_scorer.compute_convertibility_baseline.return_value = mock_conv_comps
        mock_scorer.compute_distance.return_value = mock_distance

        from app.services.enricher import LeadEnricher
        enricher = LeadEnricher(api_key="test-key")
        return enricher, mock_scorer


def test_enricher_parses_clean_json(sample_contractor):
    from app.services.scorer import (
        LeadScoreComponents, ConvertibilityComponents, DistanceResult
    )
    from app.models.lead import LeadInsight

    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=MOCK_JSON)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    mock_lead_comps = LeadScoreComponents(
        cert_points=10.0, size_points=5.0,
        rating_points=9.6, review_points=9.4, baseline=8.6,
    )
    mock_conv_comps = ConvertibilityComponents(
        portfolio_gap_detected=True, growth_signal_detected=True,
        cert_momentum_detected=False, baseline=7.5,
    )
    mock_distance = DistanceResult(distance_miles=5.2, distance_band="near")

    with patch("app.services.enricher.Anthropic", return_value=mock_client), \
         patch("app.services.enricher.ScoringService") as mock_scorer_cls:

        mock_scorer = MagicMock()
        mock_scorer_cls.return_value = mock_scorer
        mock_scorer.compute_lead_baseline.return_value = mock_lead_comps
        mock_scorer.compute_convertibility_baseline.return_value = mock_conv_comps
        mock_scorer.compute_distance.return_value = mock_distance

        from app.services.enricher import LeadEnricher
        enricher = LeadEnricher(api_key="test-key")
        insight = enricher.enrich(
            sample_contractor,
            {"summary": "Strong. Uses Owens Corning. Expanding.", "sources": []},
            search_postal_code="10013",
        )

    assert isinstance(insight, LeadInsight)
    assert insight.lead_score == 9
    assert insight.convertibility_score == 7
    assert insight.distance_band == "near"
    assert insight.distance_miles == pytest.approx(5.2)
    assert len(insight.talking_points) == 3
    assert insight.priority_index > 0


def test_enricher_strips_markdown_fences(sample_contractor):
    from app.services.scorer import (
        LeadScoreComponents, ConvertibilityComponents, DistanceResult
    )

    fenced = f"```json\n{MOCK_JSON}\n```"
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=fenced)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    mock_lead_comps = LeadScoreComponents(
        cert_points=10.0, size_points=5.0,
        rating_points=9.6, review_points=9.4, baseline=8.6,
    )
    mock_conv_comps = ConvertibilityComponents(
        portfolio_gap_detected=False, growth_signal_detected=False,
        cert_momentum_detected=False, baseline=1.0,
    )
    mock_distance = DistanceResult(distance_miles=None, distance_band="near")

    with patch("app.services.enricher.Anthropic", return_value=mock_client), \
         patch("app.services.enricher.ScoringService") as mock_scorer_cls:

        mock_scorer = MagicMock()
        mock_scorer_cls.return_value = mock_scorer
        mock_scorer.compute_lead_baseline.return_value = mock_lead_comps
        mock_scorer.compute_convertibility_baseline.return_value = mock_conv_comps
        mock_scorer.compute_distance.return_value = mock_distance

        from app.services.enricher import LeadEnricher
        enricher = LeadEnricher(api_key="test-key")
        insight = enricher.enrich(sample_contractor, {"summary": "Strong."}, search_postal_code="10013")

    assert insight.lead_score == 9


def test_enricher_clamps_lead_score_to_baseline_plus_one(sample_contractor):
    """Claude returns lead_score=15 (out of range) — must be clamped to baseline+1."""
    import json
    from app.services.scorer import (
        LeadScoreComponents, ConvertibilityComponents, DistanceResult
    )

    bad = json.dumps({
        "lead_score": 15,
        "score_rationale": "r",
        "convertibility_score": 5,
        "convertibility_rationale": "c",
        "ai_summary": "s",
        "talking_points": ["a", "b", "c"],
        "recommended_approach": "x",
    })
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=bad)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    # baseline=7 → max allowed lead_score = 8
    mock_lead_comps = LeadScoreComponents(
        cert_points=7.0, size_points=5.0,
        rating_points=7.0, review_points=5.0, baseline=7.0,
    )
    mock_conv_comps = ConvertibilityComponents(
        portfolio_gap_detected=False, growth_signal_detected=False,
        cert_momentum_detected=False, baseline=1.0,
    )
    mock_distance = DistanceResult(distance_miles=None, distance_band="near")

    with patch("app.services.enricher.Anthropic", return_value=mock_client), \
         patch("app.services.enricher.ScoringService") as mock_scorer_cls:

        mock_scorer = MagicMock()
        mock_scorer_cls.return_value = mock_scorer
        mock_scorer.compute_lead_baseline.return_value = mock_lead_comps
        mock_scorer.compute_convertibility_baseline.return_value = mock_conv_comps
        mock_scorer.compute_distance.return_value = mock_distance

        from app.services.enricher import LeadEnricher
        enricher = LeadEnricher(api_key="test-key")
        insight = enricher.enrich(sample_contractor, {}, search_postal_code="10013")

    # baseline=7, max allowed = min(10, 7+1)=8
    assert insight.lead_score <= 8
    assert 1 <= insight.lead_score <= 10


def test_enricher_scorer_called_with_correct_args(sample_contractor):
    """Verify ScoringService is called with the right arguments."""
    from app.services.scorer import (
        LeadScoreComponents, ConvertibilityComponents, DistanceResult
    )

    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=MOCK_JSON)]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    mock_lead_comps = LeadScoreComponents(
        cert_points=10.0, size_points=5.0,
        rating_points=9.6, review_points=9.4, baseline=8.6,
    )
    mock_conv_comps = ConvertibilityComponents(
        portfolio_gap_detected=True, growth_signal_detected=True,
        cert_momentum_detected=False, baseline=7.5,
    )
    mock_distance = DistanceResult(distance_miles=5.2, distance_band="near")

    with patch("app.services.enricher.Anthropic", return_value=mock_client), \
         patch("app.services.enricher.ScoringService") as mock_scorer_cls:

        mock_scorer = MagicMock()
        mock_scorer_cls.return_value = mock_scorer
        mock_scorer.compute_lead_baseline.return_value = mock_lead_comps
        mock_scorer.compute_convertibility_baseline.return_value = mock_conv_comps
        mock_scorer.compute_distance.return_value = mock_distance

        from app.services.enricher import LeadEnricher
        enricher = LeadEnricher(api_key="test-key")
        enricher.enrich(
            sample_contractor,
            {"summary": "Research text.", "sources": []},
            search_postal_code="10001",
        )

    mock_scorer.compute_lead_baseline.assert_called_once_with(sample_contractor)
    mock_scorer.compute_convertibility_baseline.assert_called_once_with("Research text.")
    mock_scorer.compute_distance.assert_called_once_with(
        sample_contractor.postal_code, "10001"
    )
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
pytest tests/test_enricher.py -v
```

Expected: Multiple failures — `enrich()` doesn't accept `search_postal_code` yet and `LeadInsight` old construction in tests.

- [ ] **Step 3: Replace enricher.py**

Replace the full contents of `backend/app/services/enricher.py` with:

```python
import json
import re
from anthropic import Anthropic
from app.models.lead import ContractorRecord, LeadInsight
from app.services.scorer import ScoringService, compute_priority_index

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
    return "DETECTED" if detected else "NOT FOUND"


def _prompt(c: ContractorRecord, research: dict, lead_comps, conv_comps) -> str:
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
    def __init__(self, api_key: str):
        self._client = Anthropic(api_key=api_key)
        self._scorer = ScoringService()

    def enrich(
        self,
        contractor: ContractorRecord,
        research: dict,
        search_postal_code: str = "",
    ) -> LeadInsight:
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

        # Clamp each score within ±1 of its Python baseline
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

    @staticmethod
    def _parse(raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
            return json.loads(cleaned)
```

- [ ] **Step 4: Run enricher tests**

```bash
pytest tests/test_enricher.py -v
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/enricher.py backend/tests/test_enricher.py
git commit -m "feat: LeadEnricher uses ScoringService baselines, bounded ±1 Claude adjustment"
```

---

## Task 7: Update Pipeline + Repository

**Files:**
- Modify: `backend/app/services/pipeline.py`
- Modify: `backend/app/repositories/lead_repository.py`
- Modify: `backend/tests/test_pipeline.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Update conftest.py sample_lead_row with new fields**

Open `backend/tests/conftest.py`. Replace the `sample_lead_row` fixture body so it includes the 5 new columns:

```python
@pytest.fixture
def sample_lead_row():
    return {
        "id": str(uuid4()),
        "company_name": "Acme Roofing Inc",
        "city": "New York",
        "state": "NY",
        "postal_code": "10013",
        "country_code": "us",
        "phone": "212-555-0100",
        "website": "https://acmeroofing.com",
        "certifications": ["GAF Master Elite"],
        "rating": 4.8,
        "review_count": 47,
        "lead_score": 9,
        "score_rationale": "Master Elite certified, strong reviews",
        "convertibility_score": 7,
        "convertibility_rationale": "Competitor brands detected, growth signals present.",
        "distance_miles": 5.2,
        "distance_band": "near",
        "priority_index": 8.0,
        "ai_summary": "Acme Roofing is a high-priority lead.",
        "talking_points": ["Point 1", "Point 2", "Point 3"],
        "recommended_approach": "Call the owner directly.",
        "status": "enriched",
        "research_summary": "Strong web presence.",
        "research_sources": [],
        "error_message": None,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
```

- [ ] **Step 2: Update test_pipeline.py**

Replace the contents of `backend/tests/test_pipeline.py` with:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4


@pytest.mark.asyncio
async def test_pipeline_execute_stores_all_enriched_leads(sample_contractor, sample_lead_row):
    from app.services.pipeline import PipelineService
    from app.models.lead import LeadInsight, PipelineRunRequest

    run_id = str(uuid4())
    insight = LeadInsight(
        lead_score=9,
        score_rationale="Master Elite certified, strong reviews.",
        convertibility_score=7,
        convertibility_rationale="Growth signals and competitor brands detected.",
        distance_miles=5.2,
        distance_band="near",
        priority_index=8.0,
        ai_summary="High priority.",
        talking_points=["P1", "P2", "P3"],
        recommended_approach="Call owner.",
    )

    mock_repo = AsyncMock()
    mock_repo.create_pipeline_run.return_value = run_id
    mock_repo.upsert_contractor.return_value = {**sample_lead_row, "id": str(uuid4())}
    mock_repo.update_research = AsyncMock()
    mock_repo.update_enrichment = AsyncMock()
    mock_repo.complete_pipeline_run = AsyncMock()
    mock_repo.update_pipeline_progress = AsyncMock()

    mock_scraper = MagicMock()
    mock_scraper.scrape_contractors.return_value = [sample_contractor]

    mock_researcher = AsyncMock()
    mock_researcher.research_all.return_value = [{"summary": "Good.", "sources": []}]

    mock_enricher = MagicMock()
    mock_enricher.enrich.return_value = insight

    service = PipelineService(
        repo=mock_repo,
        scraper=mock_scraper,
        researcher=mock_researcher,
        enricher=mock_enricher,
    )

    request = MagicMock(postal_code="10013", country_code="us", distance=25, limit=None)
    await service.execute(run_id=run_id, request=request)

    mock_scraper.scrape_contractors.assert_called_once()
    mock_researcher.research_all.assert_called_once()
    mock_enricher.enrich.assert_called_once_with(
        sample_contractor,
        {"summary": "Good.", "sources": []},
        search_postal_code="10013",
    )
    mock_repo.update_enrichment.assert_called_once()
    mock_repo.complete_pipeline_run.assert_called_once_with(run_id, leads_enriched=1)
```

- [ ] **Step 3: Run pipeline test to confirm it fails**

```bash
pytest tests/test_pipeline.py -v
```

Expected: FAIL — `enrich()` is called without `search_postal_code` in the current pipeline code.

- [ ] **Step 4: Update pipeline.py to pass search_postal_code**

Replace the enrichment loop section in `backend/app/services/pipeline.py`. The full updated file:

```python
import logging

from app.config import ScraperConfig
from app.models.lead import PipelineRunRequest
from app.repositories.lead_repository import LeadRepository
from app.services.enricher import LeadEnricher
from app.services.researcher import ContractorResearcher
from app.services.scraper import GafScraper

logger = logging.getLogger(__name__)


class PipelineService:
    def __init__(
        self,
        repo: LeadRepository,
        scraper: GafScraper,
        researcher: ContractorResearcher,
        enricher: LeadEnricher,
    ):
        self._repo = repo
        self._scraper = scraper
        self._researcher = researcher
        self._enricher = enricher

    async def execute(self, run_id: str, request: PipelineRunRequest) -> None:
        try:
            config = ScraperConfig(
                postal_code=request.postal_code,
                country_code=request.country_code,
                distance=request.distance,
                limit=request.limit,
            )

            # Stage 1: Scrape
            contractors = self._scraper.scrape_contractors(config)
            await self._repo.update_pipeline_progress(run_id, leads_scraped=len(contractors))

            lead_rows = [await self._repo.upsert_contractor(c) for c in contractors]

            # Stage 2: Research (concurrent)
            research_results = await self._researcher.research_all(contractors)
            for row, research in zip(lead_rows, research_results):
                await self._repo.update_research(
                    row["id"], research.get("summary", ""), research.get("sources", [])
                )

            # Stage 3: Enrich with Claude + ScoringService
            enriched = 0
            for row, contractor, research in zip(lead_rows, contractors, research_results):
                try:
                    insight = self._enricher.enrich(
                        contractor,
                        research,
                        search_postal_code=request.postal_code,
                    )
                    await self._repo.update_enrichment(row["id"], insight)
                    enriched += 1
                except Exception as exc:
                    logger.exception("Enrichment failed for lead %s", row["id"])
                    await self._repo.mark_lead_failed(row["id"], str(exc))

            await self._repo.complete_pipeline_run(run_id, leads_enriched=enriched)

        except Exception as exc:
            await self._repo.fail_pipeline_run(run_id, str(exc))
            raise
```

- [ ] **Step 5: Run pipeline test**

```bash
pytest tests/test_pipeline.py -v
```

Expected: PASS.

- [ ] **Step 6: Update update_enrichment in lead_repository.py**

Replace the `update_enrichment` method and `get_all_leads` method in `backend/app/repositories/lead_repository.py`:

```python
async def get_all_leads(self) -> list[dict]:
    result = (
        await self._client.table("leads")
        .select("*")
        .order("priority_index", desc=True, nullsfirst=False)
        .execute()
    )
    return result.data or []
```

```python
async def update_enrichment(self, lead_id: str, insight: LeadInsight) -> dict:
    result = (
        await self._client.table("leads")
        .update({
            "lead_score":               insight.lead_score,
            "score_rationale":          insight.score_rationale,
            "convertibility_score":     insight.convertibility_score,
            "convertibility_rationale": insight.convertibility_rationale,
            "distance_miles":           insight.distance_miles,
            "distance_band":            insight.distance_band,
            "priority_index":           insight.priority_index,
            "ai_summary":               insight.ai_summary,
            "talking_points":           insight.talking_points,
            "recommended_approach":     insight.recommended_approach,
            "status":                   "enriched",
            "enriched_at":              datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", lead_id)
        .execute()
    )
    return result.data[0]
```

- [ ] **Step 7: Run the full test suite**

```bash
cd backend
pytest tests/ -v -m "not integration"
```

Expected: All unit tests PASS. Zero failures.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/pipeline.py backend/app/repositories/lead_repository.py backend/tests/test_pipeline.py backend/tests/conftest.py
git commit -m "feat: pipeline passes search_postal_code; repository persists all scoring fields"
```

---

## Task 8: Smoke Test End-to-End

**Files:** No changes — verification only.

- [ ] **Step 1: Start the backend server**

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Expected: Server starts on port 8000 with no import errors.

- [ ] **Step 2: Confirm API responds**

Open a new terminal:

```bash
curl http://localhost:8000/api/leads
```

Expected: JSON array (empty or with existing leads). No 500 errors.

- [ ] **Step 3: Run a pipeline with limit=1**

```bash
curl -X POST http://localhost:8000/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"postal_code":"10013","country_code":"us","distance":25,"limit":1}'
```

Expected: `{"run_id": "...", "status": "running", "message": "..."}` with HTTP 202.

- [ ] **Step 4: Poll status until complete**

```bash
curl http://localhost:8000/api/pipeline/status/<run_id>
```

Expected: Eventually `"status": "completed"` with `leads_enriched: 1`.

- [ ] **Step 5: Verify new fields appear on the lead**

```bash
curl http://localhost:8000/api/leads
```

Expected: Lead JSON includes `convertibility_score`, `convertibility_rationale`, `distance_miles`, `distance_band`, `priority_index` — all non-null.

- [ ] **Step 6: Final commit tag**

```bash
git add -A
git commit -m "feat: scoring redesign complete — lead score, convertibility score, distance band, priority index"
```

---

## Summary of Changes

| What changed | Why |
|---|---|
| `scorer.py` (new) | Isolated, testable Python formula — cert/rating/review weights, signal detection, Haversine distance |
| `enricher.py` | Calls scorer first, passes baselines to Claude, enforces ±1 bound |
| `pipeline.py` | Forwards `search_postal_code` to enricher |
| `lead_repository.py` | Persists 5 new fields; sorts by `priority_index` |
| `models/lead.py` | `LeadInsight` and `LeadResponse` gain convertibility + distance + priority fields |
| `schema.sql` | 5 new columns + index on `priority_index` |
| `requirements.txt` | `pgeocode>=0.5.0` |
