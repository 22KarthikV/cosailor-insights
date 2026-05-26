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
