"""The graph itself, as nodes and edges, for the interface to draw.

Every other snapshot in this project is an answer: a norm, a moment, a squad.
This one is the shape those answers come out of. It exists because "a temporal
graph with supersession chains" is a sentence, and a coach or a judge reading
it has no way to tell whether it is true. Drawing it settles that in a second.

Scoped to the workspace's team rather than the whole store. All 3,961 matches
and 2,096 facts would render as fog: a picture of everything is a picture of
nothing, and the interesting structure is local anyway. What one side's
neighbourhood shows is exactly what the schema claims: matches observed,
players fielded, facts that supersede each other in a chain, and conversations
that cite the facts they were built from.

    uv run python -m tacticbench.knowledge_graph

Edges carry their type so the interface can weight them. `SUPERSEDED_BY` is the
one worth looking at, because it is the relationship a vector index has no way
to represent, and the drawing should make it obvious.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import workspace
from .demo import team_id
from .graph import (
    FACT_ID_BASE,
    MATCH_ID_BASE,
    PLAYER_ID_BASE,
    SESSION_ID_BASE,
    TURN_ID_BASE,
    Graph,
)

ROOT = Path(__file__).resolve().parents[2]
UI = ROOT / "src" / "content" / "snapshots"

#: Evidence edges drawn per fact. A fact can cite twelve matches and the
#: picture only needs to show that citation happens; past three the lines
#: stop reading as evidence and start reading as noise.
EVIDENCE_PER_FACT = 3


def human(o: int | None) -> str:
    import datetime as dt

    if not o:
        return ""
    if o >= 3_652_058:  # OPEN_ENDED
        return "present"
    try:
        return dt.date.fromordinal(int(o)).isoformat()
    except (ValueError, OverflowError):
        return ""


def build(g: Graph, team: str, clips: dict[str, str]) -> dict:
    tid = team_id(team)
    nodes: list[dict] = [{"id": f"t{tid}", "kind": "team", "label": team, "weight": 3.0}]
    edges: list[dict] = []
    seen = {f"t{tid}"}

    def add(node: dict) -> bool:
        if node["id"] in seen:
            return False
        seen.add(node["id"])
        nodes.append(node)
        return True

    # ── matches ──────────────────────────────────────────────────────────
    for r in g.run(
        "MATCH (t:Team {id: $tid})-[:PLAYED]->(m:Match) "
        "RETURN m.statsbomb_id AS sb, m.label AS label, m.date AS date, "
        "m.competition AS comp ORDER BY m.date_ord DESC",
        tid=tid,
    ):
        sb = int(r["sb"] or 0)
        if not sb:
            continue
        mid = f"m{sb}"
        if add(
            {
                "id": mid,
                "kind": "match",
                "label": r["label"] or "",
                "sub": f"{r['date']} · {r['comp']}",
                "weight": 1.4,
                # A match with footage can play it when opened, which is the
                # point of drawing the graph rather than listing it.
                "clip": clips.get(str(sb)),
            }
        ):
            edges.append({"s": f"t{tid}", "t": mid, "kind": "PLAYED"})

    # ── players ──────────────────────────────────────────────────────────
    for p in g.players_for_team(tid):
        pid = f"p{int(p['id']) - PLAYER_ID_BASE}"
        if add(
            {
                "id": pid,
                "kind": "player",
                "label": p.get("nickname") or p.get("name") or "",
                "sub": p.get("position") or "",
                "weight": 1.6,
                "photo": f"/players/{int(p.get('statsbomb_id') or 0)}.jpg",
            }
        ):
            edges.append({"s": f"t{tid}", "t": pid, "kind": "FIELDED"})

    # ── facts, team and player, with their evidence and their chain ──────
    fact_owner: dict[int, str] = {}
    for owner_q, owner_of in (
        ("MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact) ", lambda _r: f"t{tid}"),
        (
            "MATCH (p:Player)-[:HAS_FACT]->(f:Fact) WHERE f.team_id = $tid ",
            lambda r: f"p{int(r['owner']) - PLAYER_ID_BASE}",
        ),
    ):
        rows = g.run(
            owner_q + "RETURN f.id AS id, f.dimension AS dim, f.band AS band, "
            "f.valid_from AS vf, f.valid_to AS vt, f.observations AS obs, "
            "f.median_value AS med, f.player_id AS owner",
            tid=tid,
        )
        for r in rows:
            fid = int(r["id"])
            node_id = f"f{fid}"
            fact_owner[fid] = node_id
            if add(
                {
                    "id": node_id,
                    "kind": "fact",
                    "label": f"{r['dim']} {r['band']}",
                    "sub": f"{human(r['vf'])} to {human(r['vt'])} · {r['obs']} games",
                    "value": r["med"],
                    "weight": 0.8,
                }
            ):
                edges.append({"s": owner_of(r), "t": node_id, "kind": "HAS_FACT"})

    # Evidence, capped, and only to matches already drawn.
    for fid, node_id in fact_owner.items():
        rows = g.run(
            "MATCH (f:Fact {id: $fid})-[:OBSERVED_IN]->(m:Match) "
            "RETURN m.statsbomb_id AS sb LIMIT $cap",
            fid=fid, cap=EVIDENCE_PER_FACT,
        )
        for r in rows:
            mid = f"m{int(r['sb'] or 0)}"
            if mid in seen:
                edges.append({"s": node_id, "t": mid, "kind": "OBSERVED_IN"})

    # The chain. This is the edge the whole project is about.
    for r in g.run(
        "MATCH (a:Fact)-[:SUPERSEDED_BY]->(b:Fact) WHERE a.team_id = $tid "
        "RETURN a.id AS a, b.id AS b",
        tid=tid,
    ):
        a, b = f"f{int(r['a'])}", f"f{int(r['b'])}"
        if a in seen and b in seen:
            edges.append({"s": a, "t": b, "kind": "SUPERSEDED_BY"})

    # ── the conversation, which lives in the same graph ──────────────────
    for s in g.sessions_for(tid, limit=8):
        sid = f"s{s['session_id']}"
        if add(
            {
                "id": sid,
                "kind": "session",
                "label": s["title"][:44],
                "sub": f"{s['turns']} turns",
                "weight": 1.2,
            }
        ):
            edges.append({"s": f"t{tid}", "t": sid, "kind": "HAS_SESSION"})

        for t in g.session_turns(s["session_id"], limit=40):
            turn = f"n{int(t['id']) - TURN_ID_BASE}"
            if add(
                {
                    "id": turn,
                    "kind": "turn",
                    "label": (t["text"] or "")[:70],
                    "sub": t["role"],
                    "weight": 0.6,
                }
            ):
                edges.append({"s": sid, "t": turn, "kind": "HAS_TURN"})
            for c in g.turn_citations(int(t["id"]) - TURN_ID_BASE):
                cited = f"f{int(c['id'])}"
                if cited in seen:
                    edges.append({"s": turn, "t": cited, "kind": "CITES"})

    return {"team": team, "nodes": nodes, "edges": edges}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workspace", default=None)
    args = ap.parse_args()

    ws = workspace.load(args.workspace)
    out = UI / ws.key / "graph.json"

    # Which matches have footage, so the drawing can offer to play it.
    clips: dict[str, str] = {}
    moments = UI / ws.key / "clip-moments.json"
    if moments.exists():
        blob = json.loads(moments.read_text())
        for m in blob.get("moments", []):
            if m.get("clip"):
                clips[str(ws.match_id)] = m["clip"]
                break

    g = Graph()
    try:
        blob = build(g, ws.team, clips)
    finally:
        g.close()

    out.write_text(json.dumps(blob, indent=1))

    kinds: dict[str, int] = {}
    for n in blob["nodes"]:
        kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
    rels: dict[str, int] = {}
    for e in blob["edges"]:
        rels[e["kind"]] = rels.get(e["kind"], 0) + 1

    print(f"{len(blob['nodes'])} nodes, {len(blob['edges'])} edges")
    for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"  {k:9} {v}")
    print()
    for k, v in sorted(rels.items(), key=lambda x: -x[1]):
        print(f"  {k:14} {v}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
