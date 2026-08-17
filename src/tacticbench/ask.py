"""Answering a coach's question: retrieve from HydraDB, then ask the model.

This is the part the whole graph exists to serve, and it is deliberately split
in two so that the two halves can be judged separately.

**Retrieval** is code. It resolves whoever the question is about, pulls their
dated facts and the team's, and returns a numbered list. Every line the model is
allowed to use has an id, and every id is a node in the graph.

**Generation** is a model call with that list and nothing else. The prompt
forbids arithmetic and forbids any claim without an id beside it, so a
hallucinated norm has nowhere to come from: the model is writing sentences
around retrieved numbers rather than recalling football.

The memory switch is implemented here rather than in the interface, which is
the only place it can honestly live. With memory off the retrieval simply does
not run the fact queries — the model still gets everything measured off the
match in front of it, and still answers, but it has no norms, no dates and no
peers. Same model, same question, same match. The difference on screen is the
difference the graph makes, not a different prompt pretending to be one.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from dataclasses import dataclass, field

from .coach import DIMENSION_LABELS
from .graph import Graph, PLAYER_ID_BASE, team_id_for
from .players import PLAYER_DIMENSIONS
from .runner import DEFAULT_MODEL, PROSE_SYSTEM, _ask
from .temporal import OPEN_ENDED

#: What a player measure is called in a sentence.
PLAYER_LABELS = {
    "xt_created": "threat created per 90",
    "xt_left": "threat left on the table per 90",
    "final_third_entries": "final third entries per 90",
    "progressive_ratio": "share of passes that go forward",
    "defensive_actions": "defensive actions in the opponent half per 90",
    "turnover_rate": "turnovers per 100 touches",
}

SYSTEM = """You are Pep, an assistant coach going through match tape with the coach.

You are given a numbered list of retrieved facts. There are two different things
you are allowed to say, and the difference between them is the whole job.

FACTS. Every number, date, norm, comparison and trend must come from the list,
and must carry the id it came from, written as [id]. This includes counts of
games and appearances, not only measurements.

Quote a figure exactly as it is written. Do not round it, do not turn 53.8 into
"nearly 54", do not convert it into anything. A coach checking 54 against the
graph finds 53.8 and stops trusting the rest.

Do not calculate. If a comparison is not in the list, say you cannot make it.

Do not use anything you know about these players or teams from anywhere else. If
you happen to know something that is not in the list, it does not exist.

JUDGEMENT. What those facts mean, why they might be happening, and what to do
about it on the training pitch is yours to give, and the coach wants it. You are
an assistant coach, not a database. Reading that a midfielder's final third
entries have halved and saying he needs to get on the ball higher up is your
job. Football reasoning about space, pressure and shape is allowed and welcome.

The line between them: a fact is something a coach could check, and judgement is
something a coach could disagree with. Never dress one as the other.

Also:
- If the list has no norms, say plainly that you can describe this match but not
  whether any of it is usual. Then answer the parts you can answer.
- Two to four sentences. A coach is standing up. No preamble, no bullet points.
- Never use an em dash or an en dash.
"""

def human(o: int) -> str:
    return "present" if o >= OPEN_ENDED else dt.date.fromordinal(o).isoformat()


@dataclass
class Retrieved:
    """What the graph returned, and what the model is allowed to say."""

    facts: list[dict] = field(default_factory=list)
    player: dict | None = None
    memory: bool = True

    def numbered(self) -> list[dict]:
        return self.facts

    def payload(self) -> dict:
        return {"facts": self.facts}


def resolve_player(g: Graph, team_id: int, question: str) -> dict | None:
    """Whoever the question is about, if anyone.

    Matched on the longest name that appears in the question, so "Martinez"
    does not beat "Emiliano Martinez" and hand a goalkeeper's question to a
    centre forward. Accents are stripped on both sides because nobody types
    them.
    """

    def flatten(s: str) -> str:
        import unicodedata

        return "".join(
            c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c)
        )

    asked = flatten(question)
    best: tuple[int, dict] | None = None
    for p in g.players_for_team(team_id):
        for candidate in filter(None, [p["nickname"], p["name"]]):
            flat = flatten(candidate)
            # Also try the surname alone, which is what a coach types.
            for form in {flat, flat.split()[-1]}:
                if len(form) < 4 or form not in asked:
                    continue
                if best is None or len(form) > best[0]:
                    best = (len(form), p)
    return best[1] if best else None


def retrieve(
    g: Graph,
    team: str,
    question: str,
    at: int,
    memory: bool = True,
    match: dict | None = None,
) -> Retrieved:
    """Everything the model is allowed to know, as a numbered list.

    `match` is what was measured off the game in front of the coach. It goes in
    whether or not memory is on, because measuring this match never needed a
    graph, and pretending otherwise makes the switch look like an on/off for the
    whole assistant rather than for its memory.
    """
    out = Retrieved(memory=memory)
    n = 1

    for key, value in (match or {}).items():
        out.facts.append({"id": n, "kind": "this match", "text": f"{key}: {value}"})
        n += 1

    if not memory:
        return out

    tid = team_id_for(team)
    player = resolve_player(g, tid, question)
    out.player = player

    if not player:
        # No name in the question. A coach asking "who should I work with" is
        # asking about players all the same, so the squad is retrieved ranked on
        # the measure that names something to train: threat left on the table.
        for row in g.player_ranking(tid, "xt_left", at):
            out.facts.append(
                {
                    "id": n,
                    "kind": "squad ranking",
                    "text": f"{row['player']} ({row['position']}) leaves "
                    f"{row['median_value']} threat on the table per 90 ({row['band']}), "
                    f"holding since {human(row['valid_from'])} across "
                    f"{row['observations']} games",
                    "node": row["id"],
                    "dimension": "xt_left",
                }
            )
            n += 1

    if player:
        out.facts.append(
            {
                "id": n,
                "kind": "player",
                "text": f"{player['nickname']} is a {player['position']} "
                f"with {player['appearances']} appearances and "
                f"{round(player['minutes'])} minutes in the graph",
                "node": player["id"],
            }
        )
        n += 1
        for dim in PLAYER_DIMENSIONS:
            now = g.player_fact_at(player["id"], dim, at)
            if not now:
                continue
            out.facts.append(
                {
                    "id": n,
                    "kind": "player norm",
                    "text": f"{player['nickname']} {PLAYER_LABELS[dim]}: {now['median_value']} "
                    f"({now['band']}), holding since {human(now['valid_from'])} "
                    f"across {now['observations']} games",
                    "node": now["id"],
                    "dimension": dim,
                }
            )
            n += 1
            # The chain is the point. Only report it when it actually moved.
            timeline = g.player_timeline(player["id"], dim)
            if len(timeline) > 1:
                before = [f for f in timeline if f["valid_to"] <= now["valid_from"]]
                if before:
                    was = before[-1]
                    out.facts.append(
                        {
                            "id": n,
                            "kind": "player change",
                            "text": f"before {human(now['valid_from'])} his "
                            f"{PLAYER_LABELS[dim]} was {was['median_value']} "
                            f"({was['band']}) across {was['observations']} games, "
                            f"so it changed on that date",
                            "node": was["id"],
                            "dimension": dim,
                        }
                    )
                    n += 1

    for dim, label in DIMENSION_LABELS.items():
        now = g.fact_at(tid, dim, at)
        if not now:
            continue
        out.facts.append(
            {
                "id": n,
                "kind": "team norm",
                "text": f"{team} {label}: {now['median_value']} ({now['band']}), "
                f"holding since {human(now['valid_from'])} across "
                f"{now['observations']} games",
                "node": now["id"],
                "dimension": dim,
            }
        )
        n += 1

    return out


def answer(
    team: str,
    question: str,
    at: int,
    memory: bool = True,
    match: dict | None = None,
    model: str = DEFAULT_MODEL,
) -> dict:
    """Retrieve, then generate. Returns the answer and what it was allowed to use."""
    g = Graph()
    try:
        got = retrieve(g, team, question, at, memory=memory, match=match)
    finally:
        g.close()

    prompt = (
        f"{SYSTEM}\n\nThe coach asked: {question!r}\n\n"
        f"{'Retrieved facts' if got.memory else 'Retrieved facts (memory is off, so no history was retrieved)'}:\n"
    )
    text = _ask(prompt, got.payload(), model, max_tokens=400, system=PROSE_SYSTEM)

    used = sorted({int(m) for m in re.findall(r"\[(\d+)\]", text)})
    return {
        "question": question,
        "answer": text.strip(),
        "memory": memory,
        "retrieved": got.facts,
        "cited": [f for f in got.facts if f["id"] in used],
        "player": got.player["nickname"] if got.player else None,
    }


def main() -> None:
    from . import workspace

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("question")
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--no-memory", action="store_true")
    ap.add_argument("--both", action="store_true", help="ask twice, memory on and off")
    args = ap.parse_args()

    ws = workspace.load(args.workspace)
    g = Graph()
    try:
        row = g.match(ws.match_id)
        here = g.team_match_metrics(team_id_for(ws.team), ws.match_id) or {}
    finally:
        g.close()
    at = row["date_ord"] if row else dt.date.today().toordinal()

    # What the match itself measured. This goes in whether memory is on or off,
    # because none of it needed a graph, and an assistant that answers "I have
    # nothing" about a game it just watched is describing a bug rather than the
    # absence of memory.
    match = {"the game": row["label"], "played on": row["date"]} if row else {}
    for key, label in DIMENSION_LABELS.items():
        if here.get(key) is not None:
            match[f"{label} in this game"] = round(float(here[key]), 2)

    modes = [True, False] if args.both else [not args.no_memory]
    for memory in modes:
        got = answer(ws.team, args.question, at, memory=memory, match=match)
        print(f"\n=== memory {'on' if memory else 'off'} ===")
        print(got["answer"])
        print(f"\n  {len(got['retrieved'])} facts retrieved, {len(got['cited'])} cited")
        for f in got["cited"]:
            print(f"    [{f['id']}] {f['text']}")


if __name__ == "__main__":
    main()
