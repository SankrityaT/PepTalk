"""Turn retrieved memory into a halftime recommendation.

The rule that makes this different from a chatbot with a football prompt: every
claim must cite a fact id that came out of the graph. A recommendation with no
citations is not grounded, and the caller can detect that mechanically rather
than having to trust the prose.

Abstention is decided *before* the model is called. If the graph does not hold
enough history, there is nothing to reason over, so we say so and spend nothing.
That is cheaper and more honest than asking a model to admit ignorance.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field

from .graph import Graph
from .runner import DEFAULT_MODEL, _ask, _parse_json
from .temporal import OPEN_ENDED

DIMENSION_LABELS = {
    "possession_share_pct": "possession share",
    "press_height": "pressing height",
    "defensive_action_height": "defensive line height",
    "team_width": "attacking width",
    "pass_forward_ratio": "directness",
}

MIN_EVIDENCE = 6


def human_date(o: int) -> str:
    return "present" if o >= OPEN_ENDED else dt.date.fromordinal(o).isoformat()


@dataclass
class Memory:
    """What the graph knows about one team as of one date."""

    team: str
    team_id: int
    as_of: str
    facts: list[dict] = field(default_factory=list)
    total_evidence: int = 0

    @property
    def sufficient(self) -> bool:
        return self.total_evidence >= MIN_EVIDENCE and bool(self.facts)


def recall(g: Graph, team: str, team_id: int, as_of: str) -> Memory:
    """Point-in-time retrieval across every tracked dimension."""
    at = dt.date.fromisoformat(as_of).toordinal()
    mem = Memory(team=team, team_id=team_id, as_of=as_of)

    for dim in DIMENSION_LABELS:
        evidence = g.evidence(team_id, dim)
        mem.total_evidence += evidence
        f = g.fact_at(team_id, dim, at)
        if not f:
            continue
        mem.facts.append(
            {
                "fact_id": f["id"],
                "dimension": dim,
                "label": DIMENSION_LABELS[dim],
                "band": f["band"],
                "valid_from": human_date(f["valid_from"]),
                "valid_to": human_date(f["valid_to"]),
                "observations": f["observations"],
                "median_value": f["median_value"],
                "cited_matches": [m["label"] for m in g.cited_matches(f["id"], limit=3)],
            }
        )
    return mem


def render_memory(mem: Memory) -> str:
    """The memory block exactly as the model sees it."""
    lines = [f"OPPONENT MEMORY for {mem.team}, as of {mem.as_of}:"]
    for f in mem.facts:
        lines.append(
            f"  [fact {f['fact_id']}] {f['label']}: \"{f['band']}\" "
            f"(true from {f['valid_from']} to {f['valid_to']}; "
            f"{f['observations']} matches; median {f['median_value']})"
        )
        for m in f["cited_matches"]:
            lines.append(f"      evidence: {m}")
    return "\n".join(lines)


PROMPT = """You are a tactical analyst advising a coach at halftime.

You are given (a) what a temporal memory graph knows about the opposition, and
(b) the state of the current first half.

Each memory fact carries a validity window. A fact that ended is history, not
current truth — treat it that way and say so if it matters.

Rules:
- Every tactical claim must cite a fact id in square brackets, e.g. [fact 12345].
- Do not invent facts. If the memory does not support a claim, leave it out.
- Be specific and short. A coach has three minutes.

{memory}

CURRENT FIRST HALF:
{state}

Respond as JSON only:
{{
  "summary": "<=40 words, what is happening and how it differs from their norm",
  "recommendations": [
    {{"action": "<one specific intervention>", "why": "<=25 words", "citations": ["fact <id>"]}}
  ],
  "confidence": "high"|"medium"|"low",
  "memory_gaps": "<what you would want to know but the graph does not hold>"
}}
"""


@dataclass
class Advice:
    abstained: bool
    reason: str | None = None
    payload: dict | None = None
    memory: Memory | None = None
    uncited_claims: list[str] = field(default_factory=list)


def _citation_ids(text: str) -> set[int]:
    return {int(m) for m in re.findall(r"fact\s+(\d+)", text or "")}


def advise(
    g: Graph,
    team: str,
    team_id: int,
    as_of: str,
    state: dict,
    model: str = DEFAULT_MODEL,
) -> Advice:
    """Recommend interventions, or abstain if memory is too thin."""
    mem = recall(g, team, team_id, as_of)

    if not mem.sufficient:
        return Advice(
            abstained=True,
            memory=mem,
            reason=(
                f"Insufficient history for {team}: {mem.total_evidence} observations "
                f"across {len(mem.facts)} facts, threshold is {MIN_EVIDENCE}. "
                "No recommendation offered."
            ),
        )

    prompt = PROMPT.format(memory=render_memory(mem), state="")
    raw = _ask(prompt, state, model)
    payload = _parse_json(raw)

    # Mechanical grounding check: a recommendation citing a fact id we never
    # supplied is a hallucinated citation, which is worse than none.
    valid = {f["fact_id"] for f in mem.facts}
    uncited = []
    for rec in payload.get("recommendations", []):
        cited = _citation_ids(" ".join(rec.get("citations", []) or []))
        if not cited or not (cited & valid):
            uncited.append(rec.get("action", "<unnamed>"))

    return Advice(abstained=False, payload=payload, memory=mem, uncited_claims=uncited)


def format_advice(a: Advice) -> str:
    if a.abstained:
        return f"ABSTAIN\n  {a.reason}"

    p = a.payload or {}
    out = [f"SUMMARY: {p.get('summary','')}", ""]
    for r in p.get("recommendations", []):
        cites = ", ".join(r.get("citations", []) or []) or "UNCITED"
        out.append(f"  - {r.get('action','')}")
        out.append(f"      why: {r.get('why','')}")
        out.append(f"      from memory: {cites}")
    out.append("")
    out.append(f"confidence: {p.get('confidence','?')}")
    if p.get("memory_gaps"):
        out.append(f"gaps: {p['memory_gaps']}")
    if a.uncited_claims:
        out.append(f"\nWARNING: {len(a.uncited_claims)} uncited claim(s): {a.uncited_claims}")
    return "\n".join(out)
