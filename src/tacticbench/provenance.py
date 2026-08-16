"""Build a verifiable provenance table for every match we make claims about.

The point is falsifiability. Each row carries the StatsBomb match id, the real
teams, the competition and date, the halftime and full-time scores we computed
ourselves from the event feed, and a public URL to the raw JSON those numbers
came from. Anyone can open the URL and check the arithmetic.

Nothing here is hand-entered. Scores are derived by `scan.extract_goals` from
the same event feed the URL points at.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from . import data

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

EVENTS_URL = "https://github.com/statsbomb/open-data/blob/master/data/events/{}.json"
MATCHES_URL = (
    "https://github.com/statsbomb/open-data/blob/master/data/matches/{}/{}.json"
)


def _match_index(client: httpx.Client) -> dict[int, dict]:
    """match_id -> raw match record, for dates and competition ids."""
    idx = {}
    for comp in data.competitions(client):
        for m in data.matches(client, comp["competition_id"], comp["season_id"]):
            m["_competition_id"] = comp["competition_id"]
            m["_season_id"] = comp["season_id"]
            idx[m["match_id"]] = m
    return idx


def build(limit: int | None = None) -> dict:
    scan = json.loads((RESULTS / "ht_deficits.json").read_text())
    rows = scan["matches"]
    if limit:
        rows = rows[:limit]

    with httpx.Client(timeout=60.0) as client:
        idx = _match_index(client)

    out = []
    for r in rows:
        meta = idx.get(r["match_id"], {})
        trailing = r["home"] if r["trailing_side"] == "home" else r["away"]
        out.append(
            {
                "match_id": r["match_id"],
                "date": meta.get("match_date"),
                "competition": r["competition"],
                "season": r["season"],
                "stage": (meta.get("competition_stage") or {}).get("name"),
                "home": r["home"],
                "away": r["away"],
                "halftime": f"{r['ht'][0]}-{r['ht'][1]}",
                "fulltime": f"{r['ft'][0]}-{r['ft'][1]}",
                "trailing_team": trailing,
                "ht_deficit": r["ht_deficit"],
                "recovered": r["recovered"],
                "group": r["group"],
                "goals": [
                    {
                        "period": g["period"],
                        "minute": g["minute"],
                        "team": g["team"],
                    }
                    for g in r["goals"]
                ],
                "source_events": EVENTS_URL.format(r["match_id"]),
                "source_matches": MATCHES_URL.format(
                    meta.get("_competition_id"), meta.get("_season_id")
                ),
            }
        )

    out.sort(key=lambda r: (-r["ht_deficit"], r["date"] or ""))
    payload = {
        "dataset": "StatsBomb Open Data (repo now hosted at hudl/open-data)",
        "dataset_url": "https://github.com/statsbomb/open-data",
        "dataset_license": "StatsBomb Public Data User Agreement (custom, not OSI)",
        "license_constraints": {
            "permitted": (
                "Analysis and research. Conclusions derived from the data may be "
                "shared publicly (agreement preamble, clause 1.1)."
            ),
            "no_redistribution": (
                "Clause 1.2.1 forbids reproducing or distributing the data to third "
                "parties. This repository therefore ships code and match IDs only; "
                "raw and derived event data stay gitignored and are fetched at runtime."
            ),
            "no_commercial_use": (
                "Clause 1.2.2 forbids commercially exploiting the data OR any analysis "
                "derived from it. Research and hackathon use only. A commercial product "
                "requires a different data source or a StatsBomb licence."
            ),
            "attribution_required": (
                "Clause 1.4 requires published analysis to be accredited with the "
                "StatsBomb brand logo."
            ),
            "ip": "Clause 7: all data remains the property of StatsBomb.",
            "registration": "https://statsbomb.com/resource-centre",
        },
        "method": (
            "Halftime scores are not published in the dataset. They are computed "
            "from period-1 goal events (Shot with outcome Goal, plus Own Goal For) "
            "by tacticbench.scan.extract_goals. Full-time scores come from the "
            "match record and act as an independent cross-check."
        ),
        "matches_scanned": scan["scanned"],
        "scan_errors": scan["errors"],
        "matches_with_ht_deficit": scan["selected"],
        "rows": out,
    }

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "provenance.json").write_text(json.dumps(payload, indent=2))
    return payload


def demo_candidates(payload: dict, n: int = 12) -> list[dict]:
    """Recognisable, externally verifiable comebacks for the demo picker.

    Preference order: bigger deficit first, then well-known competitions, since a
    judge is more likely to be able to sanity-check a Champions League or World
    Cup match from memory.
    """
    known = {
        "Champions League": 0,
        "FIFA World Cup": 1,
        "UEFA Euro": 2,
        "Premier League": 3,
        "La Liga": 4,
        "Serie A": 5,
        "Ligue 1": 6,
        "1. Bundesliga": 7,
    }
    rows = [r for r in payload["rows"] if r["recovered"]]
    rows.sort(key=lambda r: (-r["ht_deficit"], known.get(r["competition"], 99)))
    return rows[:n]


if __name__ == "__main__":
    p = build()
    print(
        f"provenance: {len(p['rows'])} rows from {p['matches_scanned']} matches "
        f"({p['scan_errors']} errors)"
    )
    print("\nDEMO CANDIDATES (verifiable comebacks):")
    for r in demo_candidates(p):
        print(
            f"  [{r['ht_deficit']}] {r['date']}  {r['competition'][:20]:<20} "
            f"{r['home'][:20]:<20} {r['halftime']} -> {r['fulltime']}  {r['away'][:20]}"
        )
