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


class TestShortName:
    """Every name in the demo squad, plus the shapes that broke earlier versions.

    The full names are StatsBomb's, taken from the ingested roster, so these
    are the strings the fallback actually sees rather than invented examples.
    """

    def test_the_squad_as_statsbomb_records_them(self):
        from tacticbench.pep import short_name

        for full, want in [
            # A middle name, not a second surname. The rule that fixed Messi
            # renders these as "Hernán", "Gabriel" and "Emiliano" if it is
            # allowed to reach three-token names.
            ("Nicolás Hernán Otamendi", "Otamendi"),
            ("Cristian Gabriel Romero", "Romero"),
            ("Damián Emiliano Martínez", "Martínez"),
            ("Julián Álvarez", "Álvarez"),
            # Two surnames: the last word is the mother's and nobody says it.
            ("Lionel Andrés Messi Cuccittini", "Messi"),
            # A particle takes what follows it.
            ("Rodrigo De Paul", "De Paul"),
            ("Alexis Mac Allister", "Mac Allister"),
            ("Randal Kolo Muani", "Kolo Muani"),
            ("Ángel Fabián Di María Hernández", "Di María"),
            ("Virgil van Dijk", "van Dijk"),
            # The connective names the word in front of it.
            ("Sergio Busquets i Burgos", "Busquets"),
            # Nothing to shorten.
            ("Ronaldinho", "Ronaldinho"),
            ("Adrien Rabiot", "Rabiot"),
        ]:
            assert short_name(full) == want, f"{full!r} -> {short_name(full)!r}"

    def test_describe_carries_the_second(self):
        """Without it the clip is cut at the top of the minute.

        `fetch_clips.plan` reads the second with a zero default, so a missing
        one does not raise. It just moves the cut, by up to 59 seconds.
        """
        from tacticbench.pep import describe

        leg = {"x": 60.0, "y": 40.0, "xt_gain": 0.01, "completion": 0.9,
               "defenders_in_lane": 0, "distance": 12.0}
        best = {**leg, "x": 95.0, "y": 30.0, "xt_gain": 0.09, "completion": 0.6,
                "defenders_in_lane": 1, "distance": 31.0}
        moment = {"minute": 62, "second": 41, "player": "Rodrigo De Paul",
                  "team": "Argentina", "played": leg, "best": best}

        assert describe(moment)["second"] == 41
        # Absent rather than wrong when the source has none.
        assert describe({k: v for k, v in moment.items() if k != "second"})["second"] == 0
