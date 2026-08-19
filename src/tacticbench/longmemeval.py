"""LongMemEval against the same memory layer the coach uses.

The track this project is entered in names LongMemEval, and the obvious
objection to running it was that it would measure a different system: our facts
were football measurements and its haystacks are chat logs. That stopped being
true when the conversation half of the graph was wired up. A LongMemEval
haystack is sessions of turns with dates on them, which is the schema Pep
already writes into, so this is a second ingest adapter rather than a second
product.

What it is honest to claim, and what it is not
----------------------------------------------

The interesting number here is not a leaderboard position. It is that **the
model never sees the haystack**. Each question carries a median of 50 sessions
and 492 turns, and the standard way to answer is to put all of it in the
context window, which is where long-context models lose 30 to 60 percent. Here
the turns are written to HydraDB once and a handful come back per question, so
the prompt is a few kilobytes regardless of how long the history is.

That also makes running it cheap, which is the practical reason it is possible
at all: ingestion is pure writes with no model calls, and answering is one call
per question over a small retrieved set.

Retrieval is lexical over a graph-scoped candidate set, and that distinction
matters when describing it. The graph supplies structure: which sessions belong
to this question, what order the turns came in, what date each session carries.
The ranking within that set is term overlap, not embeddings and not a learned
retriever. Calling the whole thing "graph-native retrieval" would be overselling
it; the graph decides *what is reachable*, and lexical scoring decides *what is
relevant*.

Abstention is the case worth watching. Thirty questions have no answer in the
haystack, and the correct response is to say so. It is the failure mode the
track calls out and the one this project already gates on for football.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .graph import SESSION_ID_BASE, TURN_ID_BASE, Graph
from .runner import PROSE_SYSTEM, _ask

#: Haiku, not the Opus the coach's answers use, and not only to be cheap.
#:
#: The claim this benchmark tests is that *retrieval* is doing the work. The
#: model is handed fourteen turns and asked what they say, which is a reading
#: task rather than a reasoning one. A small model scoring well is evidence for
#: the memory layer; a large one scoring well is evidence for the large model,
#: because it is clever enough to paper over retrieval that missed.
#:
#: It is also the difference between a run that costs a few thousand tokens and
#: one that costs a few hundred thousand, which matters when the tokens are
#: someone's own subscription rather than a line item.
BENCH_MODEL = "claude-haiku-4-5-20251001"

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache" / "longmemeval"
RESULTS = ROOT / "results"

#: Team ids for benchmark haystacks. Each question is a separate "coach" so its
#: sessions cannot be reached from another's, which is the isolation the
#: benchmark assumes and our recall query enforces through HAS_SESSION.
BENCH_TEAM_BASE = 880_000_000

#: Session and turn ids are derived from the question index so a re-run
#: overwrites rather than accumulates, for the reason `clear_team_facts`
#: exists. Room for 200 sessions of 400 turns per question.
BENCH_SESSION_STRIDE = 200
BENCH_TURN_STRIDE = 400

SYSTEM = """You are answering a question about your own earlier conversations \
with this user.

You are given the turns retrieved from those conversations, each with the date \
it happened on. Answer from them and from nothing else.

Two rules, and the second is the one that matters:

1. Answer in as few words as possible. A name, a number, a date, a short \
phrase. No preamble, no restating the question, no explanation unless the \
question asks for one.

2. If the retrieved turns do not contain the answer, say exactly: NOT IN \
HISTORY. Do not guess, do not infer from what is likely, and do not answer from \
anything you happen to know about the world. A confident wrong answer is worse \
than an admission, because the person reading it cannot tell the difference.

If several turns disagree because the user changed their mind, the most recent \
one is true and the older ones are what was true before. Answer with the \
current state unless asked about the past."""

STOP = {
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
    "with", "is", "was", "are", "were", "be", "been", "do", "did", "does",
    "what", "when", "where", "which", "who", "how", "why", "my", "me", "i",
    "you", "your", "it", "its", "that", "this", "have", "has", "had", "am",
}


def words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in STOP]


@dataclass
class Question:
    qid: str
    kind: str
    question: str
    answer: str
    asked_on: str
    sessions: list[list[dict]]
    dates: list[str]
    evidence: list[str] = field(default_factory=list)

    @property
    def abstains(self) -> bool:
        """LongMemEval marks the unanswerable ones with an `_abs` id."""
        return self.qid.endswith("_abs")

    @property
    def turns(self) -> int:
        return sum(len(s) for s in self.sessions)


def load(path: Path, limit: int | None = None, seed: int = 7) -> list[Question]:
    raw = json.loads(path.read_text())
    out = [
        Question(
            qid=q["question_id"],
            kind=q["question_type"],
            question=q["question"],
            answer=str(q["answer"]),
            asked_on=q.get("question_date", ""),
            sessions=q["haystack_sessions"],
            dates=q.get("haystack_dates", []),
            evidence=q.get("answer_session_ids", []) or [],
        )
        for q in raw
    ]
    if limit is None or limit >= len(out):
        return out

    # Stratified on (type, answerable), and the second half of that key is the
    # correction. Abstention is *not* a question type in LongMemEval: the 30
    # unanswerable questions are scattered inside the six types, six percent of
    # the set. Round-robin over types alone therefore picks none of them at
    # small n, which is exactly what happened on the first run: the one
    # behaviour this system should be best at went unmeasured while the
    # docstring claimed it was being sampled in proportion.
    rng = random.Random(seed)
    buckets: dict[tuple[str, bool], list[Question]] = {}
    for q in out:
        buckets.setdefault((q.kind, q.abstains), []).append(q)
    for group in buckets.values():
        rng.shuffle(group)

    # Unanswerable buckets first in each pass, so a short run still contains
    # some. Proportional sampling of a 6% stratum needs n above about 30 before
    # it reliably yields one, and a run that never tests abstention is worse
    # than no run.
    keys = sorted(buckets, key=lambda k: (not k[1], k[0]))
    picked: list[Question] = []
    while len(picked) < limit:
        took = False
        for k in keys:
            if buckets[k] and len(picked) < limit:
                picked.append(buckets[k].pop())
                took = True
        if not took:
            break
    return picked


def ord_of(stamp: str) -> int:
    """A date ordinal from LongMemEval's timestamp, on the same clock as the football."""
    for fmt in ("%Y/%m/%d (%a) %H:%M", "%Y/%m/%d", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(stamp.strip(), fmt).date().toordinal()
        except ValueError:
            continue
    return dt.date.today().toordinal()


def ingest(g: Graph, q: Question, index: int) -> int:
    """Write one question's whole history into the graph.

    No model calls: turns are stored as they came. That is the point of the
    exercise, and it is why a 492 turn haystack costs seconds rather than a
    context window.
    """
    team = BENCH_TEAM_BASE + index
    clear(g, index, len(q.sessions))

    written = 0
    for s_i, (session, stamp) in enumerate(zip(q.sessions, q.dates)):
        sid = index * BENCH_SESSION_STRIDE + s_i
        ordinal = ord_of(stamp)
        g.start_session(team, sid, ordinal)

        prev = None
        for t_i, turn in enumerate(session):
            tid = index * BENCH_SESSION_STRIDE * BENCH_TURN_STRIDE + s_i * BENCH_TURN_STRIDE + t_i
            g.add_turn(
                session_id=sid,
                turn_id=tid,
                seq=t_i,
                role=str(turn.get("role", "")),
                text=str(turn.get("content", ""))[:4000],
                ts_ord=ordinal,
                prev_turn_id=prev,
            )
            prev = tid
            written += 1
    return written


def clear(g: Graph, index: int, sessions: int) -> None:
    """Drop a question's haystack, so a re-run replaces rather than appends.

    Deleted one session's worth of turns per statement, which is the middle of
    two failures.

    One `DETACH DELETE` per turn works and is slow: clearing a 550 turn
    haystack took 155 seconds against 33 to write it, so eighty percent of a
    run went on deleting data it had just created. `DETACH DELETE` costs
    roughly ten times what a `MERGE` does here.

    One ranged `DETACH DELETE` for the whole haystack is fast enough to never
    finish: HydraDB caps a query at 30 seconds and 460 turns exceeded it, which
    killed a run at the first cleanup and threw away the model calls already
    spent on it.

    A session is the natural batch. Around ten turns each, fifty statements per
    question rather than five hundred, and every one of them far inside the
    timeout.
    """
    team = BENCH_TEAM_BASE + index
    base = TURN_ID_BASE + index * BENCH_SESSION_STRIDE * BENCH_TURN_STRIDE

    for s_i in range(sessions):
        lo = base + s_i * BENCH_TURN_STRIDE
        g.run(
            "MATCH (t:Turn) WHERE t.id >= $lo AND t.id < $hi DETACH DELETE t",
            lo=lo, hi=lo + BENCH_TURN_STRIDE,
        )

    s_lo = SESSION_ID_BASE + index * BENCH_SESSION_STRIDE
    g.run(
        "MATCH (s:Session) WHERE s.id >= $lo AND s.id < $hi DETACH DELETE s",
        lo=s_lo, hi=s_lo + BENCH_SESSION_STRIDE,
    )
    g.run("MATCH (t:Team) WHERE t.id = $t DETACH DELETE t", t=team)


def retrieve(g: Graph, q: Question, index: int, k: int = 15) -> list[dict]:
    """The turns most likely to bear on the question.

    The graph decides what is reachable: only sessions belonging to this
    question's coach, through HAS_SESSION. Ranking inside that set is term
    overlap, which is a lexical retriever and should be described as one.

    A matched turn brings its neighbour along. Questions here are often about
    something the user said and the assistant confirmed, and half of an
    exchange frequently does not carry the answer on its own.
    """
    team = BENCH_TEAM_BASE + index
    rows = g.run(
        "MATCH (t:Team)-[:HAS_SESSION]->(s:Session)-[:HAS_TURN]->(turn:Turn) "
        "WHERE t.id = $tid "
        "RETURN turn.id AS id, turn.role AS role, turn.text AS text, "
        "turn.ts_ord AS ts_ord, turn.seq AS seq, s.id AS session_id",
        tid=team,
    )

    wanted = set(words(q.question))
    if not wanted:
        return []

    scored = []
    seen: set[int] = set()
    for r in rows:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        have = Counter(words(r["text"]))
        hit = sum(have[w] for w in wanted)
        if not hit:
            continue
        # Longer turns win on raw overlap for no good reason, so normalise.
        score = hit / (1 + len(have) ** 0.5)
        scored.append((score, dict(r)))

    scored.sort(key=lambda x: -x[0])
    top = [r for _, r in scored[:k]]

    keep = {r["id"] for r in top}
    for r in list(top):
        for nb in rows:
            if nb["session_id"] == r["session_id"] and abs(nb["seq"] - r["seq"]) == 1:
                if nb["id"] not in keep:
                    keep.add(nb["id"])
                    top.append(dict(nb))

    top.sort(key=lambda r: (r["ts_ord"], r["session_id"], r["seq"]))
    return top


def ask(q: Question, turns: list[dict], model: str = BENCH_MODEL) -> str:
    if not turns:
        return "NOT IN HISTORY"
    lines = [
        f"[{dt.date.fromordinal(int(t['ts_ord'])).isoformat()}] "
        f"{t['role']}: {t['text'][:500]}"
        for t in turns
    ]
    prompt = (
        f"{SYSTEM}\n\nToday is {q.asked_on or 'unknown'}.\n\n"
        f"Retrieved turns from earlier conversations:\n" + "\n".join(lines) +
        f"\n\nQuestion: {q.question}\nAnswer:"
    )
    return _ask(prompt, {}, model, max_tokens=120, system=PROSE_SYSTEM).strip()


def judge(q: Question, given: str, model: str = BENCH_MODEL) -> bool:
    """Is the answer right?

    Abstention is graded mechanically: the question either has an answer in the
    haystack or it does not, and saying so is not a matter of opinion.

    Everything else needs a judge, because "Business Administration" and "a
    degree in business administration" are the same answer. Substring first,
    since it settles most of them for free and without a model deciding whether
    the model was right.
    """
    said = given.strip()
    refused = "NOT IN HISTORY" in said.upper()

    if q.abstains:
        return refused
    if refused:
        return False

    a, b = q.answer.strip().lower(), said.lower()
    if a and (a in b or b in a):
        return True

    verdict = _ask(
        "Does the given answer say the same thing as the reference? Reply with "
        "one word, YES or NO. Wording, length and formatting do not matter; "
        "only whether the fact is the same.\n\n"
        f"Question: {q.question}\nReference: {q.answer}\nGiven: {said}\n",
        {}, model, max_tokens=6, system=PROSE_SYSTEM,
    )
    return verdict.strip().upper().startswith("YES")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", type=Path, default=CACHE / "s.json")
    ap.add_argument("-n", type=int, default=10, help="questions to run")
    ap.add_argument("--model", default=BENCH_MODEL)
    ap.add_argument("--keep", action="store_true", help="leave haystacks in the graph")
    args = ap.parse_args()

    if not args.file.exists():
        raise SystemExit(
            f"{args.file} is missing. Download it with:\n"
            "  mkdir -p .cache/longmemeval && curl -sL -o .cache/longmemeval/s.json \\\n"
            "    https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_s"
        )

    questions = load(args.file, limit=args.n)
    print(f"{len(questions)} questions, {sum(q.turns for q in questions):,} turns to ingest\n")

    g = Graph()
    rows = []
    try:
        for i, q in enumerate(questions):
            written = ingest(g, q, i)
            turns = retrieve(g, q, i)
            given = ask(q, turns, args.model)
            ok = judge(q, given, args.model)
            rows.append(
                {
                    "qid": q.qid, "kind": q.kind, "abstains": q.abstains,
                    "question": q.question, "reference": q.answer, "given": given,
                    "correct": ok, "turns_ingested": written,
                    "turns_retrieved": len(turns),
                }
            )
            mark = "ok  " if ok else "MISS"
            print(
                f"  {i + 1:>3}/{len(questions)} {mark} {q.kind:26} "
                f"{written:>4} turns in, {len(turns):>2} back  {given[:44]!r}",
                flush=True,
            )
            if not args.keep:
                # Tidiness is not worth losing the run over. The model calls
                # for every question so far are already spent, and an
                # exception here throws all of them away; a haystack left
                # behind is a re-run's problem and it overwrites by id anyway.
                try:
                    clear(g, i, len(q.sessions))
                except Exception as exc:  # noqa: BLE001
                    print(f"       (cleanup failed, leaving haystack: {exc})", flush=True)
    finally:
        g.close()

    print("\n" + "=" * 72)
    by_kind: dict[str, list[bool]] = {}
    for r in rows:
        by_kind.setdefault(r["kind"], []).append(r["correct"])
    for kind in sorted(by_kind):
        hits = by_kind[kind]
        print(f"{kind:28} {sum(hits)}/{len(hits)}  {100 * sum(hits) / len(hits):.0f}%")

    absts = [r["correct"] for r in rows if r["abstains"]]
    if absts:
        print(f"{'abstention (subset)':28} {sum(absts)}/{len(absts)}  "
              f"{100 * sum(absts) / len(absts):.0f}%")

    total = sum(r["correct"] for r in rows)
    print("-" * 72)
    print(f"{'overall':28} {total}/{len(rows)}  {100 * total / len(rows):.0f}%")
    mid = len(rows) // 2
    ret = sorted(r["turns_retrieved"] for r in rows)[mid]
    ing = sorted(r["turns_ingested"] for r in rows)[mid]
    print(f"\nmedian turns retrieved per question: {ret} of {ing} ingested "
          f"({100 * ret / ing:.1f}% of the haystack reaches the model)")

    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / "longmemeval.json"
    out.write_text(json.dumps(rows, indent=1))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
