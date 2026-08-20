"""Pep — turning computed moments into something a coach would actually say.

    uv run python -m tacticbench.pep 3869685 --out <path>

`pass_options.py` produces the arithmetic: this pass was worth 0.023, that one
0.150, and here is how likely each was to arrive. None of that is a sentence a
lower-division coach wants to read. This turns each moment into one.

Voice, which is the whole job
-----------------------------
* **Second person.** "You had him free", never "the player had an option".
* **No jargon in the sentence.** "Worth five times as much" carries the same
  meaning as "xT +0.150 vs +0.023" to someone who has never read an analytics
  blog. The real numbers travel alongside, for the disclosure the UI folds them
  into — not in the prose.
* **Never scold.** "That ball was on" rather than "you made the wrong choice".
  A coach who feels judged stops uploading.
* **Say when it was hard.** If the better option was 48% to arrive through three
  defenders, say so. Volunteering the difficulty is what makes the easy cases
  believable, and it is what the completion model bought us.
* **Refuse rather than pad.** Fewer, better moments beat a full page of weak
  ones.

Positional language is computed here rather than left to the model, so it cannot
invent a location that contradicts the coordinates.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import httpx

from .pass_options import analyse
from .runner import DEFAULT_MODEL, _ask, _parse_json

LINEUPS = "https://raw.githubusercontent.com/statsbomb/open-data/master/data/lineups/{}.json"


def display_names(match_id: int) -> dict[str, str]:
    """Full name -> broadcast name, EXCLUDING names whose surname it damages.

    StatsBomb's `player_nickname` looks like the obvious source for a display
    name, and for most players it is. But it is unreliable exactly where it
    matters: Randal Kolo Muani is recorded as "Randal Kolo" and Alexis Mac
    Allister as "Alexis MacAllister". Preferring it wholesale replaced two
    correct full names with broken ones.

    So a nickname is only accepted when `short_name` reads the same surname out
    of it as out of the full name. Where they disagree the full name wins,
    because the heuristic handles compound surnames and the nickname evidently
    does not.
    """
    try:
        teams = httpx.get(LINEUPS.format(match_id), timeout=60).raise_for_status().json()
    except Exception:
        return {}
    out: dict[str, str] = {}
    for team in teams:
        for p in team.get("lineup", []):
            full = p.get("player_name")
            if not full:
                continue
            nick = p.get("player_nickname")
            out[full] = nick if nick and short_name(nick) == short_name(full) else full
    return out

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

PITCH_X = 120.0
PITCH_Y = 80.0


#: Tokens that bind forward into the surname: "De Paul", "Van Dijk", "Mac
#: Allister", "Kolo Muani". Listed rather than inferred from length, which is
#: what the first version of this did and what got it wrong.
PARTICLES = {
    "de", "del", "da", "das", "do", "dos", "van", "von", "der", "den",
    "di", "du", "le", "la", "el", "al", "bin", "ben", "mac", "mc", "o",
    "st", "ter", "ten", "kolo",
}

#: The connective in a Catalan or Spanish full name: "Busquets i Burgos".
#: Whatever sits in front of it is the name that gets used.
CONNECTIVES = {"i", "y", "e"}


def short_name(full: str) -> str:
    """The name a coach would say out loud.

    Two naming conventions collide here and they pull in opposite directions.
    A particle binds *forward*, so the surname runs to the end of the string:
    Rodrigo De Paul is De Paul. A Spanish or Portuguese full name carries both
    parents' surnames, so the last word is the mother's and nobody says it:
    Lionel Andrés Messi Cuccittini is Messi, Jordi Alba Ramos is Alba.

    This used to be a single rule on token length, which read anything short in
    the second-to-last slot as part of the surname. That got the World Cup
    squad right, because their broadcast names are short, and it was wrong the
    moment it saw a full name: Messi came out as "Cuccittini" and Busquets as
    "i Burgos". Nothing in the demo shows it today, since every flagged moment
    happens to belong to a player StatsBomb gives a nickname for. Adding a game
    from a league without those nicknames is what surfaces it.

    A nickname settles the question wherever StatsBomb populates one, and
    `roster.display_surname` prefers it. This is the fallback for where it
    does not.
    """
    parts = full.strip().split()
    if len(parts) < 2:
        return full.strip()

    lower = [p.lower() for p in parts]

    # The connective marks the word in front of it as the name.
    for i, word in enumerate(lower[1:-1], start=1):
        if word in CONNECTIVES:
            return parts[i - 1]

    # A particle takes everything after it with it.
    if len(parts) >= 3 and lower[-2] in PARTICLES:
        return f"{parts[-2]} {parts[-1]}"
    if len(parts) >= 4 and lower[-3] in PARTICLES:
        return f"{parts[-3]} {parts[-2]}"

    # Four or more tokens with no particle is a given name, a middle name and
    # two surnames, so the first of the pair is the one used: "Lionel Andrés
    # Messi Cuccittini" is Messi.
    #
    # Three is deliberately not treated the same way, though it is the same
    # shape one token shorter. It is ambiguous between a double surname
    # ("Jordi Alba Ramos" is Alba) and an ordinary middle name ("Damián
    # Emiliano Martínez" is Martínez), and in this squad the middle name wins
    # three to nothing: reading the second-to-last token would render Otamendi
    # as "Hernán", Romero as "Gabriel" and Martínez as "Emiliano".
    #
    # The rule is Spanish. Portuguese orders the two surnames the other way
    # round, so "Carlos Alberto Santos Silva" is Silva and this returns Santos.
    # Left as it is because the nickname covers the leagues where that matters
    # and guessing per-name nationality to fix it would be worse.
    if len(parts) >= 4:
        return parts[-2]

    return parts[-1]


def zone(x: float, y: float) -> str:
    """Plain-English pitch location. Verified convention: low y is the left."""
    if x >= 102:
        third = "in the box" if 18 <= y <= 62 else "by the byline"
    elif x >= 80:
        third = "in the final third"
    elif x >= 40:
        third = "in midfield"
    else:
        third = "in your own half"

    if y < 27:
        side = "left"
    elif y > 53:
        side = "right"
    else:
        side = "central"

    return f"{side}, {third}" if side != "central" else third


def difficulty(completion: float, lane: int) -> str:
    if completion >= 0.75:
        return "straightforward"
    if completion >= 0.5:
        return "tight"
    return "hard"


def describe(moment: dict) -> dict:
    """Structured facts for one moment, with nothing left for a model to guess."""
    p, b = moment["played"], moment["best"]
    ratio = (b["xt_gain"] / p["xt_gain"]) if p["xt_gain"] > 0.001 else None
    return {
        "minute": moment["minute"],
        # Carried through because the clip window is cut from it. `fetch_clips`
        # reads it as `m.get("second") or 0`, which tolerates absence rather
        # than failing on it, so dropping it here does not error: it silently
        # rounds every moment to the top of its minute and cuts the tape up to
        # 59 seconds from the pass it claims to show. That is the exact failure
        # the broadcast-clock offsets exist to prevent.
        "second": moment.get("second") or 0,
        "player": moment["player"],
        "name": short_name(moment["player"] or ""),
        "team": moment["team"],
        "played_zone": zone(p["x"], p["y"]),
        "best_zone": zone(b["x"], b["y"]),
        "played_value": round(p["xt_gain"], 3),
        "best_value": round(b["xt_gain"], 3),
        "played_backwards": p["xt_gain"] < 0,
        "times_better": round(ratio, 1) if ratio else None,
        "best_completion": round(b["completion"], 2),
        "played_completion": round(p["completion"], 2),
        "best_defenders": b["defenders_in_lane"],
        "best_distance": round(b["distance"]),
        "difficulty": difficulty(b["completion"], b["defenders_in_lane"]),
        # The strongest cases: the better ball was no less likely to arrive.
        "no_riskier": b["completion"] >= p["completion"] - 0.05,
    }


#: The coach's own side. Everything is written from their bench.
def side_of(moment: dict, team: str) -> str:
    """Attacking if our player had the ball, defending if theirs did."""
    return "attacking" if moment.get("team") == team else "defending"


def defensive_line(f: dict) -> str:
    """What a moment means when the opponent had the ball.

    Half the flagged moments in a match belong to the other side, and reading
    them out as "you had this on" to the wrong bench is nonsense. From this
    bench they are the chances that were there and did not arrive, which is the
    defensive half of the report and the thing a coach is most exposed by.

    `best_defenders` counts bodies in the passing lane, and when the opponent
    is passing those bodies are ours. That makes it the one genuinely
    defensive number the engine already produces, so the line leads with it.
    """
    where = f["best_zone"]
    bodies = f["best_defenders"]
    if bodies >= 3:
        cover = f"{bodies} of yours were in the lane, which is why it did not get played"
    elif bodies == 0:
        cover = "nobody was in the lane; that one was open"
    else:
        cover = f"only {bodies} of yours in the lane"
    odds = f"{f['best_completion']:.0%} to arrive"
    return f"They had the ball {where} on there. {cover[0].upper()}{cover[1:]}, {odds}."


PROMPT = """You are Pep, an assistant coach reviewing match video with a
lower-division manager who has no analyst and no time.

For each moment below, write ONE short line — at most 25 words — telling the
coach what was on.

Rules:
- Second person. "You had him free", never "the player".
- No analytics vocabulary. Never write xT, expected threat, probability, or a
  decimal. Say "worth five times as much", "twice as dangerous".
- Never scold. State what was available, not what was wrong.
- If `difficulty` is "hard" or "tight", say so in the line — a coach must know
  when you are asking for something difficult.
- If `no_riskier` is true, that is the point of the line: the better ball was no
  more likely to be cut out.
- If `played_backwards` is true, you may note the ball went backwards or square.
- NEVER write the player's name. The interface prints it beside your line, so
  a name in the sentence is both redundant and the one thing you reliably get
  wrong: asked for surnames, models turn "Kolo Muani" into "Kolo" and
  "Mac Allister" into "MacAllister". Start with the action ("You had the
  cutback...", "Square ball there...") and let the code supply who.

Return JSON only, one entry per moment, echoing its id:
{{"lines": [{{"id": <int>, "minute": <int>, "line": "<the sentence>"}}, ...]}}

Distances are in yards.

Moments:
{moments}
"""


def write_lines(moments: list[dict], model: str = DEFAULT_MODEL) -> list[dict]:
    facts = [describe(m) for m in moments]
    # Indexed, not keyed on minute. Two chances can fall in the same minute —
    # Kolo Muani had two in the 57th — and keying on minute silently gives them
    # the same sentence, which will then contradict one of their number rows.
    for i, f in enumerate(facts):
        f["id"] = i

    raw = _ask(PROMPT.format(moments=""), {"moments": facts}, model, max_tokens=2000)
    parsed = _parse_json(raw)
    by_id = {int(l["id"]): l["line"] for l in parsed.get("lines", []) if "id" in l}

    out = []
    for m, f in zip(moments, facts):
        line = by_id.get(f["id"])
        if not line:
            continue
        out.append(
            {
                **f,
                "line": line,
                # The disclosure the UI folds the maths into. Distances are in
                # yards: StatsBomb's 120x80 pitch is the yards convention, not
                # metres, and mislabelling it is the kind of thing a football
                # person spots instantly.
                "numbers": (
                    f"threat {f['played_value']:+.3f} → {f['best_value']:+.3f} · "
                    f"{int(f['best_completion'] * 100)}% likely to arrive · "
                    f"{f['best_defenders']} in the lane · {f['best_distance']} yds"
                ),
                "from": m.get("from", [0, 0]),
                "played_to": [round(m["played"]["x"], 1), round(m["played"]["y"], 1)],
                "best_to": [round(m["best"]["x"], 1), round(m["best"]["y"], 1)],
                # Carried through so the interface can draw the moment rather
                # than describe it.
                "freeze": m.get("freeze", []),
                "missed": round(m["missed"], 4),
            }
        )
    return out


def computed_lines(moments: list[dict]) -> list[dict]:
    """The same rows, worded from the arithmetic rather than by the model.

    `write_lines` needs ANTHROPIC_API_KEY. Without it the moments are still
    real — every number here is computed locally — so rather than hand the
    interface rows with no sentence in them, the sentence is assembled from
    the figures. Flatter than Pep's voice, and it says so in the report.

    Deliberately plain and never scolding, for the same reason the model is
    told not to be: a coach who feels judged stops uploading.
    """
    out = []
    for i, m in enumerate(moments):
        f = describe(m)
        f["id"] = i
        times = f.get("times_better")
        worth = (
            f"worth {times:.0f} times more" if times and times >= 1.5 else "worth more"
        )
        # Volunteering the difficulty is what makes the easy cases believable.
        # "Straightforward" is the strongest case, not a caveat, so it must not
        # be introduced with "though" — that reads as an excuse for the player.
        if f.get("no_riskier"):
            caveat = " and no more likely to be cut out"
        elif f["difficulty"] == "straightforward":
            caveat = ", and it was there to be played"
        else:
            caveat = f" though it was a {f['difficulty']} ball"
        out.append(
            {
                **f,
                "line": (
                    f"You had the ball {f['best_zone']} on, {worth} than the "
                    f"one you played{caveat}."
                ),
                "numbers": (
                    f"threat {f['played_value']:+.3f} → {f['best_value']:+.3f} · "
                    f"{int(f['best_completion'] * 100)}% likely to arrive · "
                    f"{f['best_defenders']} in the lane · {f['best_distance']} yds"
                ),
                "from": m.get("from", [0, 0]),
                "played_to": [round(m["played"]["x"], 1), round(m["played"]["y"], 1)],
                "best_to": [round(m["best"]["x"], 1), round(m["best"]["y"], 1)],
                "freeze": m.get("freeze", []),
                "missed": round(m["missed"], 4),
            }
        )
    return out


def build(match_id: int, top: int, out_path: Path, model: str) -> dict:
    analysis = analyse(match_id, top=top)
    moments = analysis["top_missed"]

    names = display_names(match_id)
    for m in moments:
        if m.get("player") in names:
            m["player"] = names[m["player"]]
    if not moments:
        payload = {"match_id": match_id, "moments": [], "note": "nothing stood out"}
    else:
        lines = write_lines(moments, model=model)
        themes = training_themes(lines, model=model)
        payload = {
            "match_id": match_id,
            "source": "tacticbench pass_options + xt (3,961 matches)",
            "themes": themes,
            "completion_model": analysis["completion_model"],
            "moments_found": analysis["moments_found"],
            "passes_with_an_option": analysis["passes_with_an_option"],
            "moments": lines,
        }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=1))
    return payload




THEMES_PROMPT = """You are Pep, writing the three things a lower-division coach
should actually work on at training this week, based on the moments below from
their last game.

Rules:
- THREE themes, no more. A coach can hold three things; a list of eight is a
  list of nothing.
- BE BRUTALLY SHORT. This is read on a phone between sessions, not studied.
  A coach who has to read a paragraph reads nothing.
- `title`: 3-5 words, imperative, what to practise.
- `saw`: what went wrong, MAXIMUM 10 WORDS. A fragment, not a sentence.
  Good: "Ball went backwards with the box open."
  Bad: "Six times you turned back or played square in the final third when
  the ball forward was on."
- `drill`: the actual exercise to run on Tuesday, MAXIMUM 12 WORDS. Name a
  shape and a constraint so a coach can set it up without thinking.
  Good: "4v2 in the corner. Two touches max, must finish first time."
  Bad: "Work on timing runs and being more decisive in the final third."
- Second person. No analytics vocabulary, no decimals, no player names. The
  interface prints those separately.
- NEVER use an em dash or an en dash. Use a comma, a full stop, or a colon.
  A coach reads this on a phone and dashes make it scan as an essay.
- Order them by what would win the most points, not by what is easiest.
- If several moments share a cause, that is one theme, not three.

Return JSON only. NOTE: single braces — this prompt is not passed through
str.format(), so doubled braces would reach you literally.

{"themes": [{"title": "<3-5 words>", "saw": "<max 10 words>",
             "drill": "<max 12 words>", "moment_ids": [<ids this draws on>]}]}

Moments:
"""


def training_themes(moments: list[dict], model: str = DEFAULT_MODEL) -> list[dict]:
    """The three things to take to training.

    A report that ends in observations ends nowhere. This is the part a coach
    acts on, so it leads the page rather than closing it.
    """
    facts = []
    for i, m in enumerate(moments):
        facts.append(
            {
                "id": m.get("id", i),
                "minute": m["minute"],
                "played_zone": m["played_zone"],
                "best_zone": m["best_zone"],
                "played_backwards": m["played_backwards"],
                "difficulty": m["difficulty"],
                "no_riskier": m["no_riskier"],
                "line": m["line"],
            }
        )
    raw = _ask(THEMES_PROMPT, {"moments": facts}, model, max_tokens=1200)
    return _parse_json(raw).get("themes", [])

def main() -> None:
    ap = argparse.ArgumentParser(prog="tacticbench.pep")
    ap.add_argument("match_id", nargs="?", type=int, default=3869685)
    ap.add_argument("--top", type=int, default=8)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--out", default=str(RESULTS / "pep.json"))
    args = ap.parse_args()

    payload = build(args.match_id, args.top, Path(args.out), args.model)
    print(f"moments found: {payload.get('moments_found')}")
    print(f"lines written: {len(payload.get('moments', []))}\n")
    for m in payload.get("moments", []):
        print(f"  {m['minute']:>3}'  {m['line']}")
        print(f"        {m['numbers']}")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
