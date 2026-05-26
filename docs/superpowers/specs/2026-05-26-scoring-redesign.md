# Scoring System Redesign
**Date:** 2026-05-26  
**Status:** Approved  
**Scope:** Backend scoring pipeline + DB schema + model updates

---

## Problem

The current `lead_score` (1–10) is computed entirely by Claude's qualitative judgment guided by a prompt rubric. It is:
- Non-deterministic — the same lead can score differently across runs
- Opaque — no audit trail for why a score moved
- Single-dimensional — no signal for *conversion readiness*, only lead quality
- Distance-unaware — the contractor's distance from the search origin is never stored or used

---

## Goals

1. Replace the black-box score with a **hybrid formula**: Python computes a weighted baseline, Claude adjusts ±1 and generates all narrative.
2. Introduce a **second independent score** — `convertibility_score` — measuring how likely the contractor is to switch suppliers or buy now.
3. Compute and persist **distance from the search origin** as a labelled band.
4. Expose a **priority index** — a single sortable number combining both scores and distance band — for dashboard default ordering.

---

## Non-Goals

- No changes to the scraper or researcher services.
- No changes to the frontend in this phase (columns are additive; existing UI continues to work).
- No geocoding API calls — distance is computed offline using `pgeocode` (bundled dataset).

---

## Score Definitions

### Lead Score — "Quality of the contractor"
Answers: *Is this contractor worth a sales rep's time?*

### Convertibility Score — "Readiness to switch/buy now"
Answers: *Can we win this contractor right now?*

### Distance Band — "Cost of pursuit"
Not a score input. A contextual label the sales rep uses to weigh logistics.

### Priority Index — "Who to call first"
Blends both scores and distance into a single sortable float for dashboard ordering.

---

## Lead Score Formula

| Signal | Source | Weight | Mapping |
|---|---|---|---|
| GAF Certification Tier | Scraper (structured) | 40% | Master Elite → 10, Certified → 7, None → 2 |
| Company Size / Revenue | Perplexity (free text) | 25% | Python defaults to 5.0 (neutral); Claude adjusts ±1 final |
| Star Rating | Scraper (structured) | 25% | `rating × 2` (5 stars → 10 pts) |
| Review Count | Scraper (structured) | 10% | `min(review_count / 50 × 10, 10)` — 50+ reviews = full score |

```
baseline_lead_score = (
    cert_points   × 0.40 +
    size_points   × 0.25 +   # Python default 5.0; Claude can adjust final score ±1
    rating_points × 0.25 +
    review_points × 0.10
)
# clamp: max(1, min(10, round(baseline_lead_score)))
```

**Certification point mapping:**
```python
CERT_POINTS = {
    "master elite": 10,
    "certified":     7,
    "":              2,   # no certification
}
# Case-insensitive match; partial match on "master elite" and "certified"
```

---

## Convertibility Score Formula

| Signal | Source | Weight | Python Detection |
|---|---|---|---|
| Portfolio gaps | Perplexity (free text) | 40% | Competitor brand names found (Owens Corning, CertainTeed, IKO, TAMKO, Atlas, Malarkey) without "exclusive GAF" language |
| Growth signals | Perplexity (free text) | 35% | Keywords: "hiring", "expanding", "new location", "new market", "growing", "opened" |
| Recent certification momentum | Perplexity + Scraper | 25% | Research mentions "recently certified", "just became", "newly certified", OR certifications non-empty + research confirms recency |

```
convertibility_baseline = (
    portfolio_gap_detected   × 10 × 0.40 +   # max 4.0 pts
    growth_signal_detected   × 10 × 0.35 +   # max 3.5 pts
    cert_momentum_detected   × 10 × 0.25     # max 2.5 pts
)
# clamp: max(1, round(convertibility_baseline))
```

**Score band intuition:**
- 0 signals → 1 (cold lead)
- 1 signal (portfolio gap only) → 4 (worth a note)
- 2 signals (portfolio + growth) → 8 (strong opportunity)
- All 3 signals → 10 (act now)

---

## Distance Band

Computed from contractor `postal_code` vs. the pipeline run's `search_postal_code`.  
Uses `pgeocode` — offline bundled dataset, no API calls.

| Band | Range | Label | UI hint |
|---|---|---|---|
| Near | 0–25 mi | `"near"` | 🟢 |
| Mid | 26–50 mi | `"mid"` | 🟡 |
| Far | 51–100 mi | `"far"` | 🔴 |

Bands mirror GAF's own search distance options (25 / 50 / 100 mi).

If either postal code is missing or lookup fails, `distance_miles` is `null` and `distance_band` defaults to `"near"` (no penalty applied).

If `research_text` is empty or `None`, all three convertibility signals default to `False` and baseline is clamped to `1`.

---

## Priority Index

```
DISTANCE_MODIFIER = {"near": 1.00, "mid": 0.95, "far": 0.90}

priority_index = round(
    ((lead_score + convertibility_score) / 2) × DISTANCE_MODIFIER[distance_band],
    2
)
```

The 10% Far penalty gently nudges sort order without burying strong distant leads.

---

## Architecture

### New file: `backend/app/services/scorer.py`

`ScoringService` — pure Python, no I/O, fully unit-testable.

```python
class ScoringService:
    def compute_lead_baseline(contractor: ContractorRecord) -> LeadScoreComponents
    def compute_convertibility_baseline(research_text: str) -> ConvertibilityComponents
    def compute_distance(contractor_postal: str, search_postal: str) -> DistanceResult
```

**`LeadScoreComponents`:**
```python
@dataclass
class LeadScoreComponents:
    cert_points:    float
    size_points:    float   # always 5.0 from Python; Claude adjusts
    rating_points:  float
    review_points:  float
    baseline:       float   # weighted sum, clamped 1–10
```

**`ConvertibilityComponents`:**
```python
@dataclass
class ConvertibilityComponents:
    portfolio_gap_detected:  bool
    growth_signal_detected:  bool
    cert_momentum_detected:  bool
    baseline:                float   # weighted sum, clamped 1–10
```

**`DistanceResult`:**
```python
@dataclass
class DistanceResult:
    distance_miles: float | None
    distance_band:  str   # 'near' | 'mid' | 'far'
```

---

### Updated: `backend/app/services/enricher.py`

New signature:
```python
def enrich(
    contractor: ContractorRecord,
    research: dict,
    search_postal_code: str,
) -> LeadInsight
```

Internal flow:
```
1. scorer.compute_lead_baseline(contractor)
2. scorer.compute_convertibility_baseline(research['summary'])
3. scorer.compute_distance(contractor.postal_code, search_postal_code)
4. build prompt with baselines + components
5. call Claude (haiku-4-5) → returns ±1 adjusted scores + narrative
6. compute priority_index from final scores + distance_band
7. return LeadInsight
```

---

### Updated Claude Prompt Structure

Claude receives the component breakdown explicitly:

```
=== SCORING BASELINES ===
Lead score baseline: 7.4
  - Certification:  10.0 pts (weight 40%) → Master Elite
  - Size/Revenue:    5.0 pts (weight 25%) → unknown, use research context
  - Star Rating:     8.4 pts (weight 25%) → 4.2 stars
  - Review Count:    4.0 pts (weight 10%) → 20 reviews

Convertibility baseline: 7.5
  - Portfolio gap:      DETECTED   (40%) → competitor brands in research
  - Growth signals:     DETECTED   (35%) → hiring/expansion language found
  - Cert momentum:      NOT FOUND  (25%)

RULES:
- You may adjust lead_score by ±1 from its baseline (7) based on research context.
- You may adjust convertibility_score by ±1 from its baseline (8) based on research context.
- Do not exceed these bounds under any circumstances.
- Return both scores as integers.
```

**Updated `LeadInsight` keys:**
```
lead_score              (integer, baseline ±1)
score_rationale         (string, 1 sentence)
convertibility_score    (integer, baseline ±1)
convertibility_rationale (string, 1 sentence)
ai_summary              (string, 2-3 sentences)
talking_points          (array of exactly 3 strings)
recommended_approach    (string, 1-2 sentences)
```

---

### Updated: `backend/app/services/pipeline.py`

Pass `search_postal_code` into each `enrich()` call:

```python
insight = self._enricher.enrich(
    contractor,
    research,
    search_postal_code=request.postal_code,   # ← new
)
```

---

## Database Migration

```sql
ALTER TABLE leads
  ADD COLUMN convertibility_score     INTEGER CHECK (convertibility_score BETWEEN 1 AND 10),
  ADD COLUMN convertibility_rationale TEXT,
  ADD COLUMN distance_miles           NUMERIC(6,2),
  ADD COLUMN distance_band            TEXT CHECK (distance_band IN ('near','mid','far')),
  ADD COLUMN priority_index           NUMERIC(4,2);

CREATE INDEX idx_leads_priority_index ON leads (priority_index DESC NULLS LAST);
```

---

## Model Changes

### `LeadInsight` (backend/app/models/lead.py)
Add fields:
```python
convertibility_score:     int   = Field(..., ge=1, le=10)
convertibility_rationale: str
distance_miles:           Optional[float] = None
distance_band:            str             = "near"
priority_index:           float
```

### `LeadResponse` (backend/app/models/lead.py)
Add same five fields (all Optional with sensible defaults for backward compat).

---

## Repository Changes

### `update_enrichment` (backend/app/repositories/lead_repository.py)
Extend the upsert payload to include all five new fields from `LeadInsight`.

---

## New Dependency

```
pgeocode>=0.5.0
```

Add to `backend/requirements.txt`.

---

## Testing Plan

| Test | Type | What it covers |
|---|---|---|
| `test_scorer_lead_baseline` | Unit | Each certification tier, rating edge cases, review count cap |
| `test_scorer_convertibility_baseline` | Unit | Signal detection: each keyword variant, combined signals |
| `test_scorer_distance` | Unit | Near/mid/far band assignment, missing postal code fallback |
| `test_enricher_baseline_passed_to_claude` | Unit (mock Claude) | Prompt includes baseline values; Claude ±1 bound enforced |
| `test_priority_index_calculation` | Unit | All distance modifier combinations |
| `test_repository_update_enrichment` | Integration | All 5 new fields persisted correctly |

---

## Open Questions

None — all design decisions resolved during brainstorm session.
