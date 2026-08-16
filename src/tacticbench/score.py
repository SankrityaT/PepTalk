"""Mechanical comparison of recommendation against actual intervention.

Deliberately not an LLM judge. A judge model shares training data with the model
under test and would inherit the same recall bias the canary exists to catch.
Every verdict here is a lookup, reproducible and auditable.
"""

from __future__ import annotations

OPPOSITES = {
    ("higher", "lower"),
    ("wider", "narrower"),
    ("more_direct", "more_patient"),
}

DIRECTIONAL = ("pressing_height", "width", "tempo")

MATCH, CONTRADICTS, NO_MATCH, EXCLUDED = "match", "contradicts", "no_match", "excluded"


def _is_opposite(a: str, b: str) -> bool:
    return (a, b) in OPPOSITES or (b, a) in OPPOSITES


def _score_directional(rec: str | None, act: str | None) -> str:
    if act in (None, "unknown") or rec is None:
        return EXCLUDED
    if rec == act:
        return MATCH
    if _is_opposite(rec, act):
        return CONTRADICTS
    return NO_MATCH


def _score_shape(rec: dict | None, act: dict | None) -> str:
    if not act or act.get("status") == "undetermined" or rec is None:
        return EXCLUDED
    recommended = bool(rec.get("recommend"))
    changed = act.get("status") == "changed"
    if recommended == changed:
        return MATCH
    return CONTRADICTS


def _score_personnel(rec: dict | None, act: dict | None) -> str:
    if rec is None or act is None:
        return EXCLUDED
    r = int(rec.get("substitutions_recommended") or 0)
    a = int(act.get("halftime_substitutions") or 0)
    if (r > 0) == (a > 0):
        return MATCH
    return NO_MATCH


def score_trial(recommendation: dict, actual: dict) -> dict:
    """Per-dimension verdicts plus an alignment rate over scorable dimensions."""
    verdicts = {
        "shape_change": _score_shape(
            recommendation.get("shape_change"), actual.get("shape_change")
        ),
        "personnel": _score_personnel(
            recommendation.get("personnel"), actual.get("personnel")
        ),
    }
    for dim in DIRECTIONAL:
        verdicts[dim] = _score_directional(recommendation.get(dim), actual.get(dim))

    scorable = [v for v in verdicts.values() if v != EXCLUDED]
    matches = sum(1 for v in scorable if v == MATCH)

    return {
        "verdicts": verdicts,
        "scorable_dimensions": len(scorable),
        "matches": matches,
        "contradictions": sum(1 for v in scorable if v == CONTRADICTS),
        "alignment": round(matches / len(scorable), 3) if scorable else None,
    }


def aggregate(trials: list[dict]) -> dict:
    """Group-level summary. Treatment vs control separation is the real test.

    If the model recommends the same things in matches that failed as in matches
    that succeeded, it has learned 'attack when losing' — a truism, not insight.
    """
    out: dict = {}
    for group in ("treatment", "control"):
        rows = [t for t in trials if t.get("group") == group and t.get("alignment") is not None]
        if not rows:
            out[group] = {"n": 0, "mean_alignment": None}
            continue
        out[group] = {
            "n": len(rows),
            "mean_alignment": round(sum(r["alignment"] for r in rows) / len(rows), 3),
        }

    t, c = out["treatment"]["mean_alignment"], out["control"]["mean_alignment"]
    out["separation"] = round(t - c, 3) if t is not None and c is not None else None
    return out
