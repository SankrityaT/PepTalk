"""Evaluating the answers, rather than reading a few and being pleased.

An answer generated from retrieved facts fails in ways that look like success.
It can invent a number, attribute one player's norm to another, cite a fact that
does not support the claim, or quietly answer from the model's own knowledge of
football, which for these players is extensive and mostly correct. That last one
is the dangerous case: right for the wrong reason is indistinguishable from
working until the workspace points at a fourth-division side the model has never
heard of, and then everything collapses at once.

Five checks, each mechanical, each able to fail:

    grounded        every number in the answer appears in a retrieved fact
    cited           every sentence carrying a number carries an id
    supported       every cited id was actually retrieved
    resolution      the question about a player retrieves that player
    abstention      with memory off, no answer claims a norm, a date or a trend

`grounded` is the one that catches a model answering from training data, and it
is deliberately strict: numbers are compared as strings against the retrieved
text, so a figure the model computed rather than read fails even when the
arithmetic is right. It should fail. The prompt forbids calculation because a
coach cannot check it.

Run it:

    TACTICBENCH_BACKEND=cli uv run python -m tacticbench.evals
    TACTICBENCH_BACKEND=cli uv run python -m tacticbench.evals --repeats 3
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .ask import answer
from .graph import Graph

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

#: Language that only means something with dated history behind it. With memory
#: off none of it is available, so any of these in an answer is a fabrication.
HISTORY_WORDS = re.compile(
    # "norm" and "baseline" are deliberately absent. They are the vocabulary of
    # the disclaimer, not of the claim: an answer saying "I have no baseline"
    # or "we would need his norm" is doing exactly the right thing, and flagging
    # the noun failed answers whose only fault was naming what they lacked.
    # What is forbidden is asserting habituality, and these words do that.
    r"\b(usual(ly)?|normal(ly)?|typical(ly)?|average|used to|"
    # "has been" as a claim, not "could have been", which is about this match.
    r"(?<!could )(?<!would )(?<!should )(?<!might )(?<!may )(?<!must )has been|"
    r"(?<!could )(?<!would )(?<!should )(?<!might )(?<!may )(?<!must )have been|"
    r"across \d+ games?|compared (to|with)|trend(ing|ed)?|"
    r"more than (he|they|usual)|less than (he|they|usual)|"
    # Temporal "since" only. "since 2018" and "since the semi-final" are
    # claims about history; "since narrow attacks congest lanes" is a
    # conjunction, and flagging it failed a correct answer that had already
    # said outright it had no baselines.
    r"since (19|20)\d{2}|since (the )?(january|february|march|april|may|june|july|"
    r"august|september|october|november|december)|since then)\b",
    re.I,
)

#: Numbers that carry no claim. Years, and scorelines: "Argentina 3-3 France" is
#: the name of a match, not a measurement, and reading its digits as claims
#: failed an answer whose only sin was naming the game it was talking about.
IGNORE_NUMBER = re.compile(r"^(19|20)\d{2}$")
SCORELINE = re.compile(r"\d+\s*-\s*\d+")


@dataclass
class Case:
    question: str
    #: Who retrieval must resolve, or None if the question names nobody.
    expects_player: str | None = None
    #: Modes to run. Every case runs both unless narrowed.
    memory: tuple[bool, ...] = (True, False)


CASES: list[Case] = [
    Case("How has Di Maria changed?", "Ángel Di María"),
    Case("Is Messi still working as hard off the ball?", "Lionel Messi"),
    Case("What should I say to De Paul this week?", "Rodrigo De Paul"),
    Case("How did Emiliano Martinez play?", "Emiliano Martínez"),
    Case("Who should I work with this week?", None),
    Case("Were we pressing as high as we usually do?", None),
    Case("What is the biggest thing to fix before the next game?", None),
    Case("Tell me about Otamendi's passing.", "Nicolás Otamendi"),
]


@dataclass
class Check:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class Outcome:
    question: str
    memory: bool
    answer: str
    checks: list[Check] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(c.passed for c in self.checks)


def numbers_in(text: str) -> list[str]:
    """Every number a reader would take as a claim."""
    text = SCORELINE.sub(" ", text)
    return [raw for raw in re.findall(r"\d+(?:\.\d+)?", text) if not IGNORE_NUMBER.match(raw)]


def grounded(result: dict) -> Check:
    """Does every number in the prose come from a retrieved fact?

    String comparison rather than numeric, on purpose. A model that computed
    "5.5 below" from a 57.18 norm and a 51.67 reading has done arithmetic a
    coach cannot check and the prompt forbids, so it fails here even though the
    subtraction is correct.
    """
    haystack = " ".join(f["text"] for f in result["retrieved"])
    # Emphasis comes off before the numbers are read: "**0.8**" is the same
    # claim as "0.8", and leaving the asterisks on would fail a grounded answer
    # for being formatted.
    prose = re.sub(r"\*\*", "", re.sub(r"\[\d+\]", "", result["answer"]))
    missing = [n for n in numbers_in(prose) if n not in haystack]
    return Check(
        "grounded",
        not missing,
        "" if not missing else f"not in any retrieved fact: {', '.join(sorted(set(missing)))}",
    )


def cited(result: dict) -> Check:
    """Does every sentence carrying a number carry an id?"""
    loose = []
    for sentence in re.split(r"(?<=[.!?])\s+", result["answer"]):
        if not numbers_in(re.sub(r"\[\d+\]", "", sentence)):
            continue
        if not re.search(r"\[\d+\]", sentence):
            loose.append(sentence.strip()[:70])
    return Check("cited", not loose, "; ".join(loose))


def supported(result: dict) -> Check:
    """Every id the answer cites must be an id that was retrieved."""
    have = {f["id"] for f in result["retrieved"]}
    used = {int(m) for m in re.findall(r"\[(\d+)\]", result["answer"])}
    ghosts = sorted(used - have)
    return Check(
        "supported",
        not ghosts,
        "" if not ghosts else f"cited ids that were never retrieved: {ghosts}",
    )


def resolution(result: dict, case: Case) -> Check:
    """Did retrieval find the player the question is about?

    Only meaningful with memory on: retrieval does not run the player queries
    at all when it is off, which is the point of the switch.
    """
    if not result["memory"]:
        return Check("resolution", True, "not applicable with memory off")
    got = result.get("player")
    if case.expects_player is None:
        return Check(
            "resolution",
            got is None,
            "" if got is None else f"resolved {got} from a question naming nobody",
        )
    return Check(
        "resolution",
        got == case.expects_player,
        "" if got == case.expects_player else f"expected {case.expects_player}, got {got}",
    )


def abstention(result: dict) -> Check:
    """With memory off, an answer must not claim history it cannot have.

    The failure this catches is the model filling the gap from what it knows
    about these footballers, which for a World Cup squad is a great deal. An
    answer that says "he usually presses higher" with no dated fact behind it is
    wrong in the only way that matters, however true it happens to be.
    """
    if result["memory"]:
        return Check("abstention", True, "not applicable with memory on")
    # Saying you cannot compare is the correct behaviour and must not be scored
    # as a violation. The negation has to govern the word, which means it has to
    # sit in the same sentence and before it: "I cannot say whether it is usual"
    # is an abstention, while "he usually presses high, but I cannot tell you
    # more" is a claim with a disclaimer stapled on.
    #
    # A fixed character window was the first attempt and was simply wrong, since
    # a negation sixty-one characters back governs the sentence just as much as
    # one sixty back.
    #
    # `whether` governs in the same way, and for the same reason. An embedded
    # question does not assert its content: "if you want a real answer on
    # whether the press was as high as normal, I need the averages" is a
    # refusal, and it contains no negation anywhere. A word after `whether` is
    # by construction being asked about rather than claimed, so this stays a
    # strict rule rather than a lenient one.
    #
    # `if` is deliberately not included, though it opens the same sentence
    # above. It is far too common a word and it does not carry the same
    # guarantee: "if we press higher next week, he usually drops off" asserts
    # the habit outright, and excusing it would be exactly the hole this check
    # exists to close.
    GOVERNS = re.compile(
        r"\b(cannot|can't|could not|couldn't|no|not|without|unable|nothing"
        r"|whether)\b",
        re.I,
    )
    text = result["answer"]
    hits = []
    for m in HISTORY_WORDS.finditer(text):
        start = max(
            (b.end() for b in re.finditer(r"[.!?]\s+", text) if b.end() <= m.start()),
            default=0,
        )
        before = text[start : m.start()]
        if GOVERNS.search(before):
            continue
        hits.append(m.group(0))
    return Check(
        "abstention",
        not hits,
        "" if not hits else f"claimed history with no facts: {', '.join(sorted(set(hits)))}",
    )


def run_case(team: str, case: Case, at: int, match: dict, memory: bool) -> Outcome:
    result = answer(team, case.question, at, memory=memory, match=match)
    out = Outcome(question=case.question, memory=memory, answer=result["answer"])
    out.checks = [
        grounded(result),
        cited(result),
        supported(result),
        resolution(result, case),
        abstention(result),
    ]
    return out


def main() -> None:
    from . import workspace
    from .coach import DIMENSION_LABELS
    from .graph import team_id_for

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--repeats", type=int, default=1, help="runs per case, to see variance")
    ap.add_argument("--out", type=Path, default=RESULTS / "evals.json")
    args = ap.parse_args()

    ws = workspace.load(args.workspace)
    g = Graph()
    try:
        row = g.match(ws.match_id)
        here = g.team_match_metrics(team_id_for(ws.team), ws.match_id) or {}
    finally:
        g.close()

    at = row["date_ord"] if row else dt.date.today().toordinal()
    match = {"the game": row["label"], "played on": row["date"]} if row else {}
    for key, label in DIMENSION_LABELS.items():
        if here.get(key) is not None:
            match[f"{label} in this game"] = round(float(here[key]), 2)

    outcomes: list[Outcome] = []
    total = sum(len(c.memory) for c in CASES) * args.repeats
    n = 0
    for case in CASES:
        for memory in case.memory:
            for _ in range(args.repeats):
                n += 1
                print(f"  {n}/{total}  memory {'on ' if memory else 'off'}  {case.question}", flush=True)
                outcomes.append(run_case(ws.team, case, at, match, memory))

    names = ["grounded", "cited", "supported", "resolution", "abstention"]
    print("\n" + "=" * 72)
    for name in names:
        ran = [o for o in outcomes for c in o.checks if c.name == name and c.detail != f"not applicable with memory {'off' if o.memory else 'on'}"]
        checks = [c for o in outcomes for c in o.checks if c.name == name]
        applicable = [c for c in checks if not c.detail.startswith("not applicable")]
        passed = sum(1 for c in applicable if c.passed)
        pct = 100 * passed / len(applicable) if applicable else 100.0
        print(f"{name:<12} {passed}/{len(applicable)}  {pct:5.1f}%")

    failures = [o for o in outcomes if not o.ok]
    print(f"\n{len(outcomes) - len(failures)}/{len(outcomes)} answers passed every check")

    for o in failures:
        print(f"\n  [memory {'on' if o.memory else 'off'}] {o.question}")
        print(f"    {o.answer[:200]}")
        for c in o.checks:
            if not c.passed:
                print(f"    FAIL {c.name}: {c.detail}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            [
                {
                    "question": o.question,
                    "memory": o.memory,
                    "answer": o.answer,
                    "checks": [{"name": c.name, "passed": c.passed, "detail": c.detail} for c in o.checks],
                }
                for o in outcomes
            ],
            indent=2,
        )
        + "\n"
    )
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
