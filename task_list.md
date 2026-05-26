# Task List — Instalily Cosailor Insights

## Current Focus
**Scoring System Redesign** — Implementation phase

---

## Active: Scoring Redesign

**Spec:** `docs/superpowers/specs/2026-05-26-scoring-redesign.md`  
**Plan:** `docs/superpowers/plans/2026-05-26-scoring-redesign.md`  
**Status:** Ready to implement — all design decisions finalised

### What we're building
Replacing the black-box Claude score with a hybrid weighted system:
- `lead_score` — weighted Python baseline (cert 40%, size 25%, rating 25%, reviews 10%) + Claude ±1 adjustment
- `convertibility_score` — signal detection baseline (portfolio gaps 40%, growth 35%, cert momentum 25%) + Claude ±1 adjustment  
- `distance_band` — Near/Mid/Far label computed via Haversine (pgeocode, offline)
- `priority_index` — `(lead_score + convertibility_score) / 2 × distance_modifier` for dashboard sort

### Task checklist
- [ ] Task 1: pgeocode dependency + DB migration SQL
- [ ] Task 2: Update LeadInsight + LeadResponse models
- [ ] Task 3: ScoringService — lead baseline
- [ ] Task 4: ScoringService — convertibility baseline
- [ ] Task 5: ScoringService — distance + priority index
- [ ] Task 6: Update LeadEnricher (new signature, updated prompt, ±1 clamping)
- [ ] Task 7: Update pipeline.py + lead_repository.py + all test fixtures
- [ ] Task 8: End-to-end smoke test

### How to start the new session
1. Open this project in a fresh Claude Code session
2. Say: "Let's implement the scoring redesign using subagent-driven development"
3. Claude will invoke `superpowers:subagent-driven-development` with the plan at `docs/superpowers/plans/2026-05-26-scoring-redesign.md`

---

## Backlog

- Phase 4: Lead Detail page (full detail view for individual contractors)
- Frontend: expose `convertibility_score`, `distance_band`, `priority_index` on dashboard cards
  (these are additive DB columns — backend is backward-compatible, frontend can be updated post-implementation)
