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

EARLIER IN THIS CONVERSATION. You may also be given what the two of you have
already said, across this session and previous ones. Use it the way a coach
expects an assistant to: do not re-explain something you covered last time, and
say "you asked about this on Tuesday" when it is genuinely the same question
coming back.

It is a record of what was said, not a source of facts. A number is quotable
only from the numbered list, even if you can see yourself saying it earlier.
If a figure has moved since you last gave it, the list is right and the old
turn is what you believed then.

If there are no earlier turns, this is the first time you have spoken. Do not
imply otherwise, and do not refer to conversations that are not in front of you.

Also:
- If the list has no norms, say plainly that you can describe this match but not
  whether any of it is usual. Then answer the parts you can answer.
- Two to four sentences. A coach is standing up. No preamble, no bullet points.
- Bold the two or three things that matter most with **double asterisks**: the
  name to act on, the figure that makes the case. Bold sparingly. If half the
  answer is bold then none of it is, and a coach skimming learns nothing.
- No other formatting. No headings, no lists, no code fences.
- Never use an em dash or an en dash.
"""

#: A citation, in either shape the model writes them.
#:
#: The prompt asks for [4], and it mostly complies, but when two facts support
#: one clause it reaches for [12, 11] instead of [12][11]. That was silently
#: fatal rather than cosmetic: every reader of these ids used `\[(\d+)\]`,
#: which does not match a grouped bracket at all, so an answer in that form
#: parsed as having cited nothing. The eval failed it for quoting figures with
#: no id, and worse, the turn written to the graph carried no CITES edges, so
#: the answer looked ungrounded to everything downstream.
#:
#: Accepting both is better than insisting on one. The model is being asked to
#: write like a coach, and punctuation inside a citation is not the place to
#: hold the line.
CITATION = re.compile(r"\[\s*\d+(?:\s*,\s*\d+)*\s*\]")


def cited_ids(text: str) -> set[int]:
    """Every fact id the answer points at, however it grouped them."""
    out: set[int] = set()
    for group in CITATION.findall(text):
        out.update(int(n) for n in re.findall(r"\d+", group))
    return out


def strip_citations(text: str) -> str:
    """The prose without the brackets, for reading the numbers in it."""
    return CITATION.sub("", text)


def shorten(key: str) -> str:
    """Trim the phrasing retrieval uses into something that fits on a chip."""
    for tail in (" in this game", " in this match", " per 90"):
        key = key.replace(tail, "")
    return key


def human(o: int) -> str:
    return "present" if o >= OPEN_ENDED else dt.date.fromordinal(o).isoformat()


def spoken_on(o: int) -> str:
    """A prior turn's date, with the weekday already worked out.

    Handed a bare "2026-08-17" the model says "you asked me that on Tuesday",
    because a coach talks in weekdays and it will convert rather than decline.
    It converted wrongly: that date was a Monday, and Tuesday was the day of
    the conversation it was having. A small enough slip to miss and exactly the
    kind a coach checks, since he knows what day he was in.

    Consistent with the rule the rest of the prompt is built on, which is that
    the model does not calculate. Give it the weekday and there is nothing to
    get wrong.
    """
    d = dt.date.fromordinal(o)
    return f"{d.strftime('%A')} {d.isoformat()}"


@dataclass
class Retrieved:
    """What the graph returned, and what the model is allowed to say."""

    facts: list[dict] = field(default_factory=list)
    player: dict | None = None
    memory: bool = True
    #: Earlier turns with this coach, oldest first. Empty with memory off, and
    #: empty on the first question of the first session.
    conversation: list[dict] = field(default_factory=list)

    def numbered(self) -> list[dict]:
        return self.facts

    def payload(self) -> dict:
        out: dict = {"facts": self.facts}
        if self.conversation:
            out["earlier_in_this_conversation"] = self.conversation
        return out


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
    session_id: int | None = None,
) -> Retrieved:
    """Everything the model is allowed to know, as a numbered list.

    `match` is what was measured off the game in front of the coach. It goes in
    whether or not memory is on, because measuring this match never needed a
    graph, and pretending otherwise makes the switch look like an on/off for the
    whole assistant rather than for its memory.

    Earlier turns are retrieved rather than replayed. The transcript is not
    sent: a dozen prior exchanges come back from the graph, and the facts they
    cited are still reachable by traversal from those turns. That is the
    difference between a memory layer and a long context window, and it is the
    reason a conversation can run for thirty sessions without the prompt
    growing to match.
    """
    out = Retrieved(memory=memory)
    n = 1

    # Conversation memory is memory. Turning the switch off has to lose the
    # thread as well as the norms, or the demo overstates what the graph is
    # responsible for.
    if memory and session_id is not None:
        out.conversation = [
            {"role": t["role"], "text": t["text"], "when": spoken_on(int(t["ts_ord"]))}
            for t in g.recall(team_id_for(team))
        ]

    for key, value in (match or {}).items():
        out.facts.append(
            {
                "id": n,
                "kind": "this match",
                # A short form for the chip. Three chips all reading "this
                # match" name nothing, and the point of showing them is that a
                # claim can be traced to the thing behind it.
                "label": f"{shorten(key)} {value}",
                "text": f"{key}: {value}",
            }
        )
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
                    "label": f"{row['player'].split()[-1]} leaves {row['median_value']}",
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
                "label": f"{player['nickname']}, {player['appearances']} games",
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
                    "label": f"{PLAYER_LABELS[dim].replace(' per 90', '')} {now['median_value']}",
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
                            "label": f"{PLAYER_LABELS[dim].replace(' per 90', '')} was {was['median_value']}",
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
                "label": f"{label} {now['median_value']}",
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
    session_id: int | None = None,
    when: int | None = None,
) -> dict:
    """Retrieve, then generate. Returns the answer and what it was allowed to use.

    With a `session_id` the exchange is written back to the graph, which is
    what makes the next session able to start where this one stopped. Both
    turns go in, and Pep's carries `CITES` edges to the exact `Fact` nodes it
    quoted, so "you asked about his final third entries last week, and here is
    the number I gave you" is a traversal rather than a string search.

    The citations point at the facts as they were *then*. A fact superseded
    next month does not rewrite what Pep said today; the old turn still points
    at the old fact, which is the honest record of what was believed at the
    time.

    `at` and `when` are different dates and conflating them was a bug. `at` is
    the date the question is *about*, which for a session is the match on
    screen, and it decides which facts were valid. `when` is the date the
    conversation happened. Timestamping turns with `at` filed every exchange
    under the 18th of December 2022, so the thread list offered a coach three
    conversations he had apparently held during the World Cup final, and "you
    asked about this on Tuesday" could never be true. `when` defaults to today,
    which is right for anyone actually talking to it.
    """
    g = Graph()
    try:
        got = retrieve(
            g, team, question, at, memory=memory, match=match, session_id=session_id
        )
    finally:
        g.close()

    prompt = (
        f"{SYSTEM}\n\nThe coach asked: {question!r}\n\n"
        f"{'Retrieved facts' if got.memory else 'Retrieved facts (memory is off, so no history was retrieved)'}:\n"
    )
    text = _ask(prompt, got.payload(), model, max_tokens=400, system=PROSE_SYSTEM)

    used = sorted(cited_ids(text))
    cited = [f for f in got.facts if f["id"] in used]

    if session_id is not None:
        # Only facts that came out of the graph carry a node id. Anything
        # measured off the match in front of the coach has none, and citing a
        # node that does not exist would make the chip a decoration.
        nodes = tuple(int(f["node"]) for f in cited if f.get("node") is not None)
        g = Graph()
        try:
            spoken = when if when is not None else dt.date.today().toordinal()
            g.append_turn(team_id_for(team), session_id, "coach", question, spoken)
            g.append_turn(
                team_id_for(team), session_id, "pep", text.strip(), spoken, cites=nodes
            )
        finally:
            g.close()

    return {
        "question": question,
        "answer": text.strip(),
        "memory": memory,
        "retrieved": got.facts,
        "cited": cited,
        "player": got.player["nickname"] if got.player else None,
        "remembered": session_id is not None,
        "recalled": len(got.conversation),
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
