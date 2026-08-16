"""Find every match in the open dataset with a halftime deficit.

Selection for the backtest happens here. The pure functions are separated from
the I/O so the scoring logic can be unit tested without the network.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

from . import data

OUT = Path(__file__).resolve().parents[2] / "results" / "ht_deficits.json"


@dataclass(frozen=True)
class Goal:
    period: int
    minute: int
    second: int
    team: str


def extract_goals(events: list[dict]) -> list[Goal]:
    """All goals in a match, credited to the team that benefits.

    StatsBomb records an own goal as a pair of events: ``Own Goal Against`` for
    the team that put it in their own net, and ``Own Goal For`` for the team
    that benefits. Counting only ``Own Goal For`` credits the right team and
    avoids double counting.
    """
    goals: list[Goal] = []
    for e in events:
        etype = e.get("type", {}).get("name")
        scored = etype == "Own Goal For" or (
            etype == "Shot"
            and e.get("shot", {}).get("outcome", {}).get("name") == "Goal"
        )
        if scored:
            goals.append(
                Goal(
                    period=e["period"],
                    minute=e["minute"],
                    second=e.get("second", 0),
                    team=e["team"]["name"],
                )
            )
    return sorted(goals, key=lambda g: (g.period, g.minute, g.second))


def score_at_halftime(goals: list[Goal], home: str, away: str) -> tuple[int, int]:
    """Goals scored in the first period only."""
    h = sum(1 for g in goals if g.period == 1 and g.team == home)
    a = sum(1 for g in goals if g.period == 1 and g.team == away)
    return h, a


def classify(
    ht: tuple[int, int], ft: tuple[int, int], min_deficit: int
) -> dict | None:
    """Label a match by what the trailing side did after the break.

    ``recovered`` means the trailing team drew level or won by full time — the
    treatment group. Matches that stayed lost are the control group. Returns
    ``None`` when nobody trailed by ``min_deficit`` at the break.
    """
    h_ht, a_ht = ht
    margin = abs(h_ht - a_ht)
    if margin < min_deficit:
        return None

    trailing_is_home = h_ht < a_ht
    h_ft, a_ft = ft
    if trailing_is_home:
        final_margin = h_ft - a_ft
    else:
        final_margin = a_ft - h_ft

    return {
        "trailing_side": "home" if trailing_is_home else "away",
        "ht_deficit": margin,
        "final_margin": final_margin,
        "recovered": final_margin >= 0,
        "group": "treatment" if final_margin >= 0 else "control",
    }


def _scan_one(client: httpx.Client, match: dict) -> dict | None:
    try:
        ev = data.events(client, match["match_id"], cache=False)
    except Exception as exc:  # noqa: BLE001 - network failures are expected
        return {"match_id": match["match_id"], "error": str(exc)}

    home = match["home_team"]["home_team_name"]
    away = match["away_team"]["away_team_name"]
    goals = extract_goals(ev)
    ht = score_at_halftime(goals, home, away)
    ft = (match["home_score"], match["away_score"])

    return {
        "match_id": match["match_id"],
        "competition": match["competition_name"],
        "season": match["season_name"],
        "home": home,
        "away": away,
        "ht": list(ht),
        "ft": list(ft),
        "goals": [asdict(g) for g in goals],
    }


def scan(min_deficit: int = 1, workers: int = 16, limit: int | None = None) -> dict:
    """Scan every match, returning those with a halftime deficit."""
    with httpx.Client(timeout=60.0) as client:
        all_m = data.all_matches(client)
        if limit:
            all_m = all_m[:limit]
        print(f"scanning {len(all_m)} matches with {workers} workers...")

        rows, errors = [], []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_scan_one, client, m): m for m in all_m}
            for i, fut in enumerate(as_completed(futures), 1):
                r = fut.result()
                if r is None:
                    continue
                if "error" in r:
                    errors.append(r)
                else:
                    rows.append(r)
                if i % 250 == 0:
                    print(f"  {i}/{len(all_m)} ({len(errors)} errors)")

    selected = []
    for r in rows:
        label = classify(tuple(r["ht"]), tuple(r["ft"]), min_deficit)
        if label:
            selected.append({**r, **label})

    selected.sort(key=lambda r: (-r["ht_deficit"], r["match_id"]))
    payload = {
        "min_deficit": min_deficit,
        "scanned": len(rows),
        "errors": len(errors),
        "selected": len(selected),
        "treatment": sum(1 for r in selected if r["group"] == "treatment"),
        "control": sum(1 for r in selected if r["group"] == "control"),
        "matches": selected,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2))
    return payload


if __name__ == "__main__":
    import sys

    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    out = scan(min_deficit=n)
    print(
        f"\nscanned={out['scanned']} errors={out['errors']} "
        f"selected={out['selected']} treatment={out['treatment']} control={out['control']}"
    )
