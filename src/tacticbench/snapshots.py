"""Writing the JSON the interface reads.

Snapshots were captured by hand — an API response saved out of a browser, a
module's output copied across — which worked while there was one match and
stopped working the moment a coach could add their own. This writes them, into
the workspace that produced them.

    workspaces/<key>/snapshots/pep.json
    workspaces/<key>/snapshots/clip-moments.json
    workspaces/<key>/snapshots/dashboard.json

Per workspace rather than into `src/content/snapshots/`, so adding a game never
overwrites the committed set a fresh clone renders from. The interface asks for
a workspace's snapshots and falls back to the committed ones.

Shapes are matched exactly to what the TypeScript already expects
(`src/content/pep.ts`, `clip.ts`, `dashboard.ts`); this module is the producer
those files' docstrings have always named. Every file carries a `source` saying
what made it, which is the convention the existing snapshots set and the reason
a reader can tell computed output from a placeholder.
"""

from __future__ import annotations

import json
from pathlib import Path

from .workspace import Workspace

#: Where cut footage is served from. The interface asks for `/clips/<file>`,
#: so anything written here has to land under `public/`.
ROOT = Path(__file__).resolve().parents[2]
PUBLIC_CLIPS = ROOT / "public" / "clips"


#: Words that belong to the name after them rather than standing alone.
#: "De Paul" shortened to "Paul", or "Kolo Muani" to "Muani", is the most
#: visible mistake this page can make, so the particle is named explicitly
#: rather than guessed from length — "Alba" is also four letters and is a
#: surname in its own right.
PARTICLES = {
    "de", "del", "de la", "da", "das", "do", "dos", "van", "van der", "van den",
    "von", "der", "den", "di", "du", "le", "la", "el", "al", "bin", "ben",
    "mac", "mc", "o", "st", "ter", "ten", "kolo",
}

#: Connectives inside a Catalan or Spanish full name: "Busquets i Burgos".
CONNECTIVES = {"i", "y", "e"}


def surname(name: str) -> str:
    """What a coach would actually call this player.

    Two conventions collide here. A particle binds forward ("De Paul", "Van
    Dijk"), while a Spanish or Portuguese full name carries both parents'
    surnames, so the *last* word is the mother's and not what anyone says:
    "Lionel Andrés Messi Cuccittini" is Messi, "Jordi Alba Ramos" is Alba.

    StatsBomb's `player_nickname` settles this wherever it is populated; this
    is the fallback for the competitions where it is not.
    """
    parts = (name or "").split()
    if len(parts) < 2:
        return name.strip() if name else ""

    lower = [p.lower() for p in parts]

    # "Busquets i Burgos" — the connective marks the preceding word as the name.
    for i, w in enumerate(lower[1:-1], start=1):
        if w in CONNECTIVES:
            return parts[i - 1]

    # A particle binds to what follows it: "De Paul", "Kolo Muani".
    if len(parts) >= 3 and lower[-2] in PARTICLES:
        return f"{parts[-2]} {parts[-1]}"
    if len(parts) >= 4 and lower[-3] in PARTICLES:
        return f"{parts[-3]} {parts[-2]}"

    # Four or more parts and no particle: a double surname, so the first of
    # the two is the one that is used.
    if len(parts) >= 4:
        return parts[-2]

    # Three parts is ambiguous ("Jordi Alba Ramos" vs "Robert Lewandowski").
    # Spanish double surnames dominate the competitions this falls back on.
    if len(parts) == 3:
        return parts[-2]

    return parts[-1]


def write_all(
    ws: Workspace,
    *,
    pep: dict,
    clips: list[dict],
    metrics: dict[str, dict],
    meta: dict,
    label: str,
    date: str,
    tracks: dict[str, dict] | None = None,
) -> list[Path]:
    """Every snapshot for one game. Returns what was written."""
    ws.snapshots.mkdir(parents=True, exist_ok=True)
    written = [
        _write(ws.snapshots / "pep.json", pep),
        _write(
            ws.snapshots / "clip-moments.json",
            clip_moments(ws, pep, clips, tracks or {}),
        ),
        _write(ws.snapshots / "dashboard.json", dashboard(ws, metrics, meta, label, date)),
        _write(ws.snapshots / "meta.json", describe(ws, pep, clips, label, date)),
    ]
    return written


def _write(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1))
    return path


def describe(ws: Workspace, pep: dict, clips: list[dict], label: str, date: str) -> dict:
    """What this game is, for the interface's header and the games list.

    `written_by` travels with it because a report whose prose came from the
    fallback rather than the model is still honest output and should say which
    it was, rather than letting a reader assume.
    """
    return {
        "key": ws.key,
        "team": ws.team,
        "label": label,
        "date": date,
        "match_id": ws.match_id,
        "competition": ws.competition,
        "season": ws.season,
        "moments_found": pep.get("moments_found", 0),
        "clips": len(clips),
        "written_by": pep.get("written_by", "numbers"),
        "has_footage": bool(clips),
        "source": "tacticbench bootstrap",
    }


def clip_moments(
    ws: Workspace,
    pep: dict,
    clips: list[dict],
    tracks: dict[str, dict] | None = None,
) -> dict:
    """Moments joined to the footage they happened in.

    A moment without a clip is kept rather than dropped: the freeze frame still
    shows who was where, which is the argument, and the interface already falls
    back to drawing it. Losing the moment entirely because a download failed
    would be the worse trade.
    """
    by_key = {c["key"]: c for c in clips}
    out = []
    for i, m in enumerate(pep.get("moments", [])):
        minute = m.get("minute") or 0
        second = m.get("second") or 0
        key = f"{minute:03d}_{second:02d}"
        # Windows merge when they overlap, so a moment can sit inside a clip
        # cut for an earlier one. Find whichever window contains it.
        clip = by_key.get(key) or _containing(clips, ws, minute, second)
        row = {
            **m,
            "id": m.get("id", i),
            "key": key,
            "name": surname(m.get("player", "")),
            "surname": surname(m.get("player", "")),
            "match_clock": f"{minute}:{second:02d}",
        }
        if clip:
            # Namespaced by workspace. The committed example owns
            # `/clips/008_25.mp4` and friends; an added game writing a file of
            # the same name into the same directory would replace the demo's
            # footage with its own.
            row["clip"] = f"/clips/{ws.key}/{Path(clip['file']).name}"
            # Where the pass falls inside this clip, which is what the player
            # seeks to. Recomputed per moment because a merged window holds
            # more than one.
            video_s = _video_time(ws, minute, second)
            row["pass_at"] = (
                round(video_s - clip["start"], 2)
                if video_s is not None and not clip.get("excerpt")
                else clip.get("offset_in_clip", 0)
            )
            # An excerpt is footage from this match but not from this moment.
            # Carried so the interface can say which it is showing rather than
            # letting a coach assume it is watching the pass being discussed.
            if clip.get("excerpt"):
                row["excerpt"] = True

            # The tracker's own reading of this clip: every box is a player it
            # found in that frame. Without it the clip is just footage; with
            # it, the interface can show what the machine saw.
            t = (tracks or {}).get(clip["key"])
            if t:
                row["frames"] = t.get("frames", [])
                row["detections"] = t.get("detections", 0)
                row["excluded_non_team"] = t.get("excluded_non_team", 0)
                # What the tracker saw, as a feed that streams beside the
                # video. Every number is read off the frame nearest that beat;
                # nothing is interpolated and nothing is claimed about tactics.
                try:
                    from .tape_reads import entries_for

                    row["reads"] = entries_for(t).get("entries", [])
                except Exception:  # noqa: BLE001 - the feed is a nicety
                    row["reads"] = []
        out.append(row)
    return {
        "match_id": ws.match_id,
        "source": "broadcast clock read off the overlay; one offset per period",
        "moments": out,
    }


def _video_time(ws: Workspace, minute: int, second: int) -> float | None:
    period = 1 if minute < 45 else 2 if minute < 90 else 3
    off = ws.period_offset.get(period)
    return None if off is None else minute * 60 + second + off


def _containing(clips: list[dict], ws: Workspace, minute: int, second: int) -> dict | None:
    v = _video_time(ws, minute, second)
    if v is None:
        return None
    for c in clips:
        if c["start"] <= v <= c["end"]:
            return c
    return None


def dashboard(
    ws: Workspace, metrics: dict[str, dict], meta: dict, label: str, date: str
) -> dict:
    """The numbers behind the dashboard's cards.

    `xt_grid` is deliberately absent here: the expected-threat model is global,
    trained across 3,961 matches, and does not change when one game is added.
    The interface keeps reading it from the committed snapshot.
    """
    mine = metrics.get(ws.team, {})
    home = meta["home_team"]["home_team_name"]
    row = {
        "id": ws.match_id,
        "date": date,
        "label": label,
        "comp": meta.get("competition_name") or ws.competition,
        "fh": int(meta.get("home_score") or 0),
        "fa": int(meta.get("away_score") or 0),
        "poss": round(mine.get("possession_share_pct") or 0.0, 1),
        "press": round(mine.get("press_height") or 0.0, 2),
        "xg": round(mine.get("xg") or 0.0, 3),
        "shots": int(mine.get("shots") or 0),
        "width": round(mine.get("team_width") or 0.0, 2),
        "pfr": round(mine.get("pass_forward_ratio") or 0.0, 3),
        "home": home == ws.team,
    }
    return {
        "team": ws.team,
        "campaign": f"{ws.competition} {ws.season}".strip(),
        "matches": [row],
        "totals": {"matches": 1, "in_graph": 2, "facts": 0},
        "source": "tacticbench bootstrap",
    }


def publish_clips(clips: list[dict], key: str) -> int:
    """Copy cut footage where the web server can serve it.

    Into `public/clips/<workspace>/`, so an added game cannot overwrite the
    committed example's footage. Not redistributed — the directory is
    gitignored — this is a local copy for the running interface.
    """
    import shutil

    if not clips:
        return 0
    dest_dir = PUBLIC_CLIPS / key
    dest_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for c in clips:
        src = Path(c["file"])
        if src.exists():
            shutil.copy2(src, dest_dir / src.name)
            n += 1
    return n
