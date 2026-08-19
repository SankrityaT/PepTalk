"""Everything the graph holds on this team, for the interface to show.

The season screen said "22 games on record" above seven cards, because the
snapshot carried the campaign and a count. A number a visitor cannot click is a
claim, and the deployed build has no HydraDB behind it to go and check, so the
history has to be in the file or it does not exist.

This writes it. One row per `PLAYED` edge, oldest last, with the per-team
metrics that live on the edge rather than on the `Match` node. Which is the
whole reason those metrics are on the edge: a match is one node with two teams
pointing at it, and possession has to sum to 100 across the pair.

    uv run python -m tacticbench.season

The campaign stays a separate list. Seven of these games were taken apart
properly, with footage cut and moments flagged, and the other fifteen are
history the norms are built from. Showing them as one undifferentiated grid
would imply we have tape for all 22.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import workspace
from .demo import team_id
from .graph import Graph

ROOT = Path(__file__).resolve().parents[2]
UI = ROOT / "src" / "content" / "snapshots"


def history(g: Graph, team: str) -> list[dict]:
    """Every match this team has in the graph, newest first.

    Read through the edge rather than off the node. `m.possession_share_pct`
    exists too and is whichever team was ingested first, which is how Argentina
    and France once both reported 46.2% in the same match.
    """
    rows = g.run(
        "MATCH (t:Team {id: $tid})-[r:PLAYED]->(m:Match) "
        "RETURN m.statsbomb_id AS id, m.date AS date, m.label AS label, "
        "m.competition AS comp, m.stage AS stage, m.season AS season, "
        "m.ft_home AS fh, m.ft_away AS fa, "
        "r.possession_share_pct AS poss, r.press_height AS press, "
        "r.xg AS xg, r.shots AS shots, r.team_width AS width, "
        "r.pass_forward_ratio AS pfr "
        "ORDER BY m.date_ord DESC",
        tid=team_id(team),
    )

    seen: set[int] = set()
    out: list[dict] = []
    for r in rows:
        sb = int(r["id"] or 0)
        # One row per fixture. Duplicate PLAYED edges are fixed at the write
        # now, but a snapshot that silently doubles a season is a bad thing to
        # find out about from a screenshot.
        if not sb or sb in seen:
            continue
        seen.add(sb)
        out.append(
            {
                "id": sb,
                "date": r["date"] or "",
                "label": r["label"] or "",
                "comp": r["comp"] or "",
                "stage": r["stage"] or "",
                "season": str(r["season"] or ""),
                "poss": round(float(r["poss"] or 0.0), 1),
                "press": round(float(r["press"] or 0.0), 2),
                "xg": round(float(r["xg"] or 0.0), 3),
                "shots": int(r["shots"] or 0),
                "width": round(float(r["width"] or 0.0), 2),
                "pfr": round(float(r["pfr"] or 0.0), 3),
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workspace", default=None)
    args = ap.parse_args()

    ws = workspace.load(args.workspace)
    snap = UI / ws.key / "dashboard.json"
    if not snap.exists():
        raise SystemExit(f"{snap} is missing; nothing to extend")

    g = Graph()
    try:
        rows = history(g, ws.team)
    finally:
        g.close()

    blob = json.loads(snap.read_text())
    campaign = {int(m["id"]) for m in blob.get("matches", [])}

    for r in rows:
        # Marked rather than filtered, so the interface can show the whole
        # record and still say which ones it has tape for.
        r["analysed"] = r["id"] in campaign

    blob["history"] = rows
    blob.setdefault("totals", {})["in_graph"] = len(rows)
    snap.write_text(json.dumps(blob, indent=1))

    done = sum(1 for r in rows if r["analysed"])
    print(f"{ws.team}: {len(rows)} matches in the graph, {done} analysed end to end")
    print(f"  {rows[-1]['date']} -> {rows[0]['date']}")
    print(f"wrote {snap}")


if __name__ == "__main__":
    main()
