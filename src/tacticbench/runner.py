"""Model-facing steps: the canary check and the tactical recommendation.

The canary never asks the model to self-report whether it recognises the match —
a model can be primed and still answer "no". Instead it is asked to *guess*, and
the guess is run through the same mechanical leak detector used on the payload.
If the guess contains any term drawn from the real match, the trial is discarded.

Canary and recommendation run in separate API calls with no shared history, so
the act of trying to identify the match cannot prime the recommendation.
"""

from __future__ import annotations

import json
import os
import threading
import time

from .anonymize import find_leaks

DEFAULT_MODEL = "claude-opus-4-6"

CANARY_PROMPT = """You are shown anonymized first-half data from a football match.

Identify the match if you can. Name the competition, season, and both teams.
If you are unsure, still give your single best guess — do not refuse.

Respond as JSON only:
{"guess": "<competition, season, team vs team, or 'unknown'>", "confidence": 0.0-1.0}

Data:
"""

RECOMMEND_PROMPT = """You are a senior football tactical analyst at halftime.

You are shown anonymized first-half data. Coordinates use a 120x80 pitch. Each
team's events are recorded in that team's own attacking frame: x=120 is the goal
they attack, and y=0 is their own left touchline. So a low `press_height` means
that team pressed deep in their own half.

{trailing_label} is losing. Recommend second-half interventions for them.

Base every judgement on the data provided. Do not speculate about which real
match this is.

Respond as JSON only, no prose:
{{
  "shape_change": {{"recommend": true|false, "to_formation": "<e.g. 3-5-2>|null"}},
  "personnel": {{"substitutions_recommended": <int 0-3>,
                 "positions_to_replace": ["<position name>", ...]}},
  "pressing_height": "higher"|"lower"|"unchanged",
  "width": "wider"|"narrower"|"unchanged",
  "tempo": "more_direct"|"more_patient"|"unchanged",
  "rationale": "<=60 words, referencing specific numbers>"
}}

Data:
"""


class MissingKeyError(RuntimeError):
    pass


def _client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise MissingKeyError(
            "ANTHROPIC_API_KEY is not set. Export it before running trials."
        )
    from anthropic import Anthropic

    return Anthropic()


CLI_SYSTEM = "You are a football tactical analyst. Answer only with JSON."

#: Callers that want prose rather than a JSON body pass their own. The backtest
#: path wants JSON it can score; a coach reading an answer on screen does not,
#: and the shared prompt was wrapping every reply in a fenced object.
PROSE_SYSTEM = "You are a football assistant talking to a coach. Answer in plain prose, never JSON, never markdown fences."


def _ask_api(
    prompt: str, payload: dict, model: str, max_tokens: int = 1024, system: str = CLI_SYSTEM
) -> str:
    msg = _client().messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[
            {"role": "user", "content": prompt + json.dumps(payload, indent=1)}
        ],
    )
    return "".join(b.text for b in msg.content if b.type == "text")


#: One CLI call at a time, and a few goes at it.
#:
#: Each call is a subprocess, and several at once is how a coach opening three
#: player cards gets a segfault instead of an answer: the runtime came back
#: with signal 11 and a crash dump where the prose should be. A lock costs a
#: little latency when questions overlap and removes the failure entirely.
#: The retry is for the crash that happens anyway, which is transient by
#: nature: the same prompt on a fresh process answers.
_CLI_LOCK = threading.Lock()
CLI_ATTEMPTS = 3


def _ask_cli(
    prompt: str, payload: dict, model: str, max_tokens: int = 1024, system: str = CLI_SYSTEM
) -> str:
    """Run one prompt through the Claude CLI in a fresh subprocess.

    Each invocation is a separate process with no shared conversation history,
    which gives the same isolation between canary and recommendation that
    separate API calls would.

    The default coding-agent system prompt is replaced and tools are disabled,
    so the model answers as a plain completion rather than as an agent.
    """
    import subprocess

    cmd = [
        "claude", "-p",
        "--system-prompt", system,
        "--disallowed-tools", "*",
        "--exclude-dynamic-system-prompt-sections",
        "--model", model,
        prompt + json.dumps(payload, indent=1),
    ]
    last = ""
    for attempt in range(1, CLI_ATTEMPTS + 1):
        with _CLI_LOCK:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=300
            )
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout.strip()
        # A crash dump is not a diagnosis. Keep the signal and the first line.
        last = (proc.stderr or "").strip().splitlines()
        last = last[0][:160] if last else f"exit {proc.returncode}"
        if attempt < CLI_ATTEMPTS:
            time.sleep(0.6 * attempt)
    raise RuntimeError(
        f"the model did not answer after {CLI_ATTEMPTS} attempts ({last})"
    )


# Backend is selected once per process via TACTICBENCH_BACKEND=api|cli.
def _ask(
    prompt: str, payload: dict, model: str, max_tokens: int = 1024, system: str = CLI_SYSTEM
) -> str:
    backend = os.environ.get("TACTICBENCH_BACKEND", "api").lower()
    fn = _ask_cli if backend == "cli" else _ask_api
    return fn(prompt, payload, model, max_tokens, system)


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        text = text[4:] if text.lower().startswith("json") else text
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in response: {text[:200]}")
    return json.loads(text[start : end + 1])


def canary(payload: dict, terms: set[str], model: str = DEFAULT_MODEL) -> dict:
    """Ask the model to identify the match; fail the trial if it can.

    Returns a record with ``passed=False`` when the guess names any real entity
    from the match.
    """
    raw = _ask(CANARY_PROMPT, payload, model, max_tokens=300)
    try:
        parsed = _parse_json(raw)
    except (ValueError, json.JSONDecodeError):
        parsed = {"guess": raw[:400], "confidence": None}

    leaked = find_leaks({"guess": parsed.get("guess", "")}, terms)
    return {
        "guess": parsed.get("guess"),
        "confidence": parsed.get("confidence"),
        "identified_terms": leaked,
        "passed": not leaked,
        "raw": raw[:1000],
    }


def recommend(
    payload: dict, trailing_label: str, model: str = DEFAULT_MODEL
) -> dict:
    """Generate structured second-half recommendations for the trailing team."""
    prompt = RECOMMEND_PROMPT.format(trailing_label=trailing_label)
    raw = _ask(prompt, payload, model)
    rec = _parse_json(raw)
    rec["_raw"] = raw[:2000]
    return rec
