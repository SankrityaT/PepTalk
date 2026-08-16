"""Strip identity from match state before it reaches a reasoning model.

Every frontier model has read thousands of articles about famous comebacks. If
the model can recognise the match, its "recommendation" is recall, not
reasoning, and the entire result is worthless.

Two independent defences:

1. ``anonymize`` builds the payload from an allowlist — only named fields are
   copied through, so a new upstream field cannot leak by accident.
2. ``find_leaks`` mechanically scans the serialised payload for any term drawn
   from the match (team names, every player name, competition, season). This
   catches bugs; the model-facing canary in ``canary.py`` catches everything
   else.
"""

from __future__ import annotations

import json
import re
import unicodedata

TEAM_LABELS = {"home": "Team A", "away": "Team B"}

# Metric keys allowed through to the model. Anything not listed is dropped.
ALLOWED_METRICS = {
    "possession_share_pct",
    "passes",
    "pass_forward_ratio",
    "avg_pass_length",
    "final_third_entries",
    "build_up_side_pct",
    "defensive_action_height",
    "press_height",
    "presses_in_opposition_half",
    "team_width",
    "shots",
    "xg",
    "shape_depth",
}

ALLOWED_PLAYER_KEYS = {"position", "avg_x", "avg_y", "touches"}


def anonymize(state: dict, ht_score: tuple[int, int]) -> dict:
    """Allowlist-copy the state into a model-safe payload."""
    out: dict = {
        "pitch": {"length": 120, "width": 80, "attacking_direction": "+x"},
        "period": 1,
        "halftime_score": {
            TEAM_LABELS["home"]: ht_score[0],
            TEAM_LABELS["away"]: ht_score[1],
        },
        "teams": {},
    }

    for side, label in TEAM_LABELS.items():
        team = state.get(side, {})
        out["teams"][label] = {
            "venue": side,
            "formation": team.get("formation"),
            "players": [
                {k: p.get(k) for k in ALLOWED_PLAYER_KEYS} for p in team.get("players", [])
            ],
            "metrics": {
                k: v for k, v in team.get("metrics", {}).items() if k in ALLOWED_METRICS
            },
        }

    return out


def _normalize(s: str) -> str:
    """Fold accents and case so 'Smicer' matches 'Šmicer'."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


# Generic football vocabulary that appears inside competition and club names but
# identifies nothing on its own. Without this, "Champions League" fragments into
# "League", which then matches any guess mentioning any league — discarding valid
# trials as false canary failures. Verified against match 2302764.
STOPWORDS = {
    "league",
    "cup",
    "champions",
    "premier",
    "liga",
    "serie",
    "bundesliga",
    "ligue",
    "division",
    "women",
    "womens",
    "united",
    "city",
    "club",
    "football",
    "national",
    "super",
    "world",
    "euro",
    "america",
    "copa",
    "primera",
    "athletic",
    "atletico",
    "sporting",
    "real",
    "olympique",
    "internacional",
}


def forbidden_terms(
    events: list[dict], home: str, away: str, competition: str, season: str
) -> set[str]:
    """Every string that would identify this match, drawn from the match itself.

    Competition and season are matched only as whole phrases. Team and player
    names are additionally split so a surname or club word alone is caught, with
    generic football vocabulary filtered out.
    """
    whole_only: set[str] = {competition, season}
    splittable: set[str] = {home, away}

    for e in events:
        if (p := e.get("player", {}).get("name")):
            splittable.add(p)
        for key in ("substitution", "bad_behaviour"):
            repl = e.get(key, {}).get("replacement", {}).get("name")
            if repl:
                splittable.add(repl)
        if e.get("type", {}).get("name") == "Starting XI":
            for row in e.get("tactics", {}).get("lineup", []):
                if (n := row.get("player", {}).get("name")):
                    splittable.add(n)

    out: set[str] = {t for t in whole_only if t}
    for t in splittable:
        if not t:
            continue
        out.add(t)
        for part in re.split(r"[\s'’\-]+", t):
            if len(part) > 3 and _normalize(part) not in STOPWORDS:
                out.add(part)

    return out


def find_leaks(payload: dict, terms: set[str]) -> list[str]:
    """Any forbidden term present in the serialised payload."""
    blob = _normalize(json.dumps(payload, ensure_ascii=False))
    hits = []
    for t in terms:
        needle = _normalize(t)
        if not needle:
            continue
        if re.search(rf"\b{re.escape(needle)}\b", blob):
            hits.append(t)
    return sorted(set(hits))


class LeakError(RuntimeError):
    """Raised when an anonymized payload still contains identifying terms."""


def assert_clean(payload: dict, terms: set[str]) -> None:
    leaks = find_leaks(payload, terms)
    if leaks:
        raise LeakError(f"anonymized payload leaked {len(leaks)} term(s): {leaks[:10]}")
