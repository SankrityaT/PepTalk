"""Tests for the reasoning layer's pure logic — no graph, no model calls."""

from tacticbench.coach import (
    MIN_EVIDENCE,
    Advice,
    Memory,
    _citation_ids,
    format_advice,
    human_date,
    render_memory,
)
from tacticbench.temporal import OPEN_ENDED


def fact(fid=100, dim="possession_share_pct", band="dominant", obs=27):
    return {
        "fact_id": fid,
        "dimension": dim,
        "label": "possession share",
        "band": band,
        "valid_from": "2011-03-05",
        "valid_to": "2012-01-08",
        "observations": obs,
        "median_value": 67.0,
        "cited_matches": ["Barcelona 1-0 Real Zaragoza"],
    }


class TestHumanDate:
    def test_sentinel_renders_as_present(self):
        assert human_date(OPEN_ENDED) == "present"

    def test_ordinal_round_trips_to_iso(self):
        import datetime as dt

        for iso in ("2011-03-05", "2012-01-08", "1974-02-17"):
            assert human_date(dt.date.fromisoformat(iso).toordinal()) == iso


class TestSufficiency:
    def test_thin_memory_is_insufficient(self):
        m = Memory("Werder Bremen", 2, "2024-01-01", facts=[], total_evidence=4)
        assert not m.sufficient

    def test_evidence_without_facts_is_insufficient(self):
        # Evidence can exist for dimensions that have no fact covering this date.
        m = Memory("X", 3, "1990-01-01", facts=[], total_evidence=500)
        assert not m.sufficient

    def test_facts_plus_evidence_is_sufficient(self):
        m = Memory("Barcelona", 1, "2011-06-01", facts=[fact()], total_evidence=531)
        assert m.sufficient

    def test_threshold_is_inclusive(self):
        m = Memory("X", 4, "2011-06-01", facts=[fact()], total_evidence=MIN_EVIDENCE)
        assert m.sufficient


class TestRenderMemory:
    def test_includes_validity_window_and_fact_id(self):
        out = render_memory(Memory("Barcelona", 1, "2011-06-01", [fact(fid=999)], 531))
        assert "[fact 999]" in out
        assert "2011-03-05" in out and "2012-01-08" in out
        assert "dominant" in out

    def test_includes_evidence_matches(self):
        out = render_memory(Memory("Barcelona", 1, "2011-06-01", [fact()], 531))
        assert "Barcelona 1-0 Real Zaragoza" in out


class TestCitationIds:
    def test_extracts_ids(self):
        assert _citation_ids("see [fact 123] and [fact 456]") == {123, 456}

    def test_empty_on_no_citation(self):
        assert _citation_ids("no references here") == set()

    def test_handles_none(self):
        assert _citation_ids(None) == set()


class TestFormatAdvice:
    def test_abstention_is_explicit(self):
        out = format_advice(Advice(abstained=True, reason="Insufficient history for X"))
        assert "ABSTAIN" in out
        assert "Insufficient history" in out

    def test_renders_recommendations_with_citations(self):
        a = Advice(
            abstained=False,
            payload={
                "summary": "They are pressing lower than usual",
                "recommendations": [
                    {"action": "Push the full-backs higher", "why": "space behind", "citations": ["fact 100"]}
                ],
                "confidence": "medium",
            },
        )
        out = format_advice(a)
        assert "Push the full-backs higher" in out
        assert "fact 100" in out
        assert "confidence: medium" in out

    def test_uncited_claims_surface_as_warning(self):
        a = Advice(
            abstained=False,
            payload={"summary": "s", "recommendations": [], "confidence": "low"},
            uncited_claims=["Invent a press"],
        )
        assert "WARNING" in format_advice(a)
        assert "Invent a press" in format_advice(a)

    def test_missing_citations_render_as_uncited(self):
        a = Advice(
            abstained=False,
            payload={
                "summary": "s",
                "recommendations": [{"action": "Do a thing", "why": "reasons", "citations": []}],
                "confidence": "low",
            },
        )
        assert "UNCITED" in format_advice(a)
