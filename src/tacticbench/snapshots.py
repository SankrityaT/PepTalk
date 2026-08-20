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

from .workspace import Workspace, snapshot_dir

#: Where cut footage is served from. The interface asks for `/clips/<file>`,
#: so anything written here has to land under `public/`.
ROOT = Path(__file__).resolve().parents[2]
PUBLIC_CLIPS = ROOT / "public" / "clips"


#: Re-exported from `pep`, which owns them, because `roster` imports them from
#: here. One definition rather than two tables that can drift apart — which is
#: what happened before, and it disagreed on exactly the ambiguous case both
#: were written to settle.
from .pep import CONNECTIVES, PARTICLES  # noqa: E402,F401

__all__ = ["CONNECTIVES", "PARTICLES", "surname", "write_all", "activate"]


def surname(name: str) -> str:
    """What a coach would actually call this player.

    One implementation, in `pep.short_name`. This was a second copy of the same
    rules, written before that one existed, and the two disagreed on the case
    they both had to guess at: three tokens with no particle. Mine read the
    middle token as a first surname, which is right for "Jordi Alba Ramos" and
    wrong for "Damián Emiliano Martínez" and "Nicolás Hernán Otamendi" — two
    names in the demo squad against one. Theirs takes the last token there and
    documents why, so theirs is the one that survives.
    """
    from .pep import short_name

    return short_name(name)


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
    """Every snapshot for one game. Returns what was written.

    Into `src/content/snapshots/<key>/`, which is where the interface looks:
    `scripts/use-workspace.mjs` copies the chosen key to `snapshots/active`
    and the session imports from there. Writing anywhere else produces a
    complete, correct report that nothing renders.
    """
    out_dir = snapshot_dir(ws.key)
    written = [
        _write(out_dir / "pep.json", pep),
        _write(out_dir / "pep-wc2022.json", pep),
        _write(
            out_dir / "clip-moments.json",
            clip_moments(ws, pep, clips, tracks or {}),
        ),
        _write(out_dir / "dashboard.json", dashboard(ws, metrics, meta, label, date)),
        _write(out_dir / "meta.json", describe(ws, pep, clips, label, date)),
        _write(out_dir / "knowledge.json", knowledge(ws, metrics)),
    ]
    written += _fill_gaps(out_dir)
    return [p for p in written if p]


#: Snapshots the session imports that this pipeline does not produce. Each is
#: a separate workstream — the squad, the opponent scout, goals conceded — and
#: a missing one is a hard import error rather than an empty panel, so the
#: committed example's copy is used until that workstream runs for this game.
INHERITED = (
    "brief.json",
    "conceded.json",
    "roster.json",
    "player-clips.json",
    "scout.json",
    "wc-tracking.json",
    "tape-reads.json",
    "tracking.json",
    "calibration.json",
    "memory-wc2022.json",
)


def activate(key: str) -> int:
    """Point the interface at this workspace's snapshots.

    The same copy `scripts/use-workspace.mjs` does, from Python, so adding a
    game through the interface does not require dropping to a terminal to see
    it. TypeScript imports are static — the app cannot pick a directory at
    runtime — so `snapshots/active` is the indirection, and it is generated
    and gitignored rather than committed.
    """
    import shutil

    snaps = ROOT / "src" / "content" / "snapshots"
    src, dest = snaps / key, snaps / "active"
    if not src.exists():
        return 0
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(src, dest)
    # Record what `active/` now holds, so the switcher can tick the game the
    # coach is actually looking at. This is a description of the current
    # state, not a preference that outlives it: a restart re-opens the
    # built-in example, which is the front door for everybody.
    (snaps / ".active").write_text(key + "\n")
    return len(list(dest.iterdir()))


def _fill_gaps(out_dir: Path) -> list[Path]:
    """Borrow anything the session needs that this run did not write.

    A static import cannot fail softly: one absent file and the whole report
    stops compiling. Copying the example's version keeps the page rendering
    and is honest as long as nothing claims the borrowed data is this match's
    — which is why `meta.json` records what was actually generated.
    """
    example = ROOT / "src" / "content" / "snapshots" / "wc2022"
    if not example.exists() or example == out_dir:
        return []
    import shutil

    out: list[Path] = []
    for name in INHERITED:
        src, dest = example / name, out_dir / name
        if src.exists() and not dest.exists():
            shutil.copy2(src, dest)
            out.append(dest)
    return out


def _write(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1))
    return path


def knowledge(ws: Workspace, metrics: dict[str, dict]) -> dict:
    """What the graph knows about this team, for the memory cards.

    Read back out of HydraDB rather than computed here, because the whole
    claim those cards make is "this is what was normal for you, and here is
    how many games say so". A number assembled in this file would look
    identical and mean nothing.

    Falls back to the match's own values with no facts behind them when the
    graph is unreachable or the team is below the evidence floor — six
    observations — which is the honest answer for a side nobody has ingested.
    """
    from .temporal import DIMENSIONS

    mine = metrics.get(ws.team, {})
    dims: list[dict] = []
    scale = {"teams": 0, "matches": 0, "facts": 0}

    try:
        from .demo import team_id
        from .graph import Graph

        g = Graph()
        try:
            tid = team_id(ws.team)
            for dim, labels in DIMENSIONS.items():
                rows = g.timeline(tid, dim)
                if not rows:
                    continue
                latest = rows[-1]
                dims.append(
                    {
                        "dimension": dim,
                        "label": dim.replace("_", " ").replace(" pct", ""),
                        "value": round(float(latest.get("median_value") or 0.0), 1),
                        "band": latest.get("band", ""),
                        "obs": int(latest.get("observations") or 0),
                        "percentile": 50,
                        "peers": 0,
                        "median": round(float(latest.get("median_value") or 0.0), 2),
                        "top": [],
                    }
                )
            scale = {
                "teams": g.run("MATCH (t:Team) RETURN count(*) AS n")[0]["n"],
                "matches": g.run("MATCH (m:Match) RETURN count(*) AS n")[0]["n"],
                "facts": g.run("MATCH (f:Fact) RETURN count(*) AS n")[0]["n"],
            }
        finally:
            g.close()
    except Exception:  # noqa: BLE001 - the graph is optional for rendering
        pass

    if not dims:
        # No facts for this side yet. Report the match's own numbers and say
        # so with obs=0, rather than inventing a norm from one game.
        for dim in DIMENSIONS:
            if mine.get(dim) is None:
                continue
            dims.append(
                {
                    "dimension": dim,
                    "label": dim.replace("_", " ").replace(" pct", ""),
                    "value": round(float(mine[dim]), 1),
                    "band": "",
                    "obs": 0,
                    "percentile": 50,
                    "peers": 0,
                    "median": round(float(mine[dim]), 2),
                    "top": [],
                }
            )

    return {
        "team": ws.team,
        "scale": {**scale, "supersessions": 0, "competitions": []},
        "dimensions": dims,
        "source": "tacticbench bootstrap (HydraDB)",
    }


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
            # Always present, even when there is no footage for this moment.
            # A reader asking for `moment.frames.length` should not have to
            # know whether this particular pass happened to fall inside the
            # video somebody uploaded — and on a highlights reel most of them
            # do not, which is the normal case, not the edge one.
            "frames": [],
            "detections": 0,
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
    fh = int(meta.get("home_score") or 0)
    fa = int(meta.get("away_score") or 0)
    at_home = home == ws.team
    mine_goals, theirs_goals = (fh, fa) if at_home else (fa, fh)
    row = {
        "id": ws.match_id,
        "date": date,
        "label": label,
        "comp": meta.get("competition_name") or ws.competition,
        "fh": fh,
        "fa": fa,
        # Halftime is not derived here; the scan pass owns it. Zero rather
        # than a guess, which the interface renders as "no halftime split".
        "hh": 0,
        "ha": 0,
        "poss": round(mine.get("possession_share_pct") or 0.0, 1),
        "press": round(mine.get("press_height") or 0.0, 2),
        "xg": round(mine.get("xg") or 0.0, 3),
        "shots": int(mine.get("shots") or 0),
        "width": round(mine.get("team_width") or 0.0, 2),
        "pfr": round(mine.get("pass_forward_ratio") or 0.0, 3),
        "result": {
            "us": mine_goals,
            "them": theirs_goals,
            "opponent": meta["away_team"]["away_team_name"]
            if at_home
            else meta["home_team"]["home_team_name"],
            "outcome": "W"
            if mine_goals > theirs_goals
            else "L"
            if mine_goals < theirs_goals
            else "D",
            "scoreline": f"{mine_goals}-{theirs_goals}",
            # Shootouts are excluded everywhere in this pipeline: eight
            # penalties would swamp a match's chance count and say nothing
            # about how the side played.
            "went_to_penalties": False,
            "stage": (meta.get("competition_stage") or {}).get("name") or "",
        },
        "home": at_home,
    }
    return {
        "team": ws.team,
        "campaign": f"{ws.competition} {ws.season}".strip(),
        **_xt_grid(),
        "matches": [row],
        "totals": {"matches": 1, "in_graph": 2, "facts": 0},
        "source": "tacticbench bootstrap",
    }


def _xt_grid() -> dict:
    """The expected-threat surface, as the interface draws it.

    Global rather than per match — it is what "dangerous" means, learned
    across every cached game — so it is read from the trained model rather
    than recomputed or, worse, invented per workspace.
    """
    path = ROOT / "results" / "xt_model.json"
    if not path.exists():
        return {"xt_grid": [], "grid_x": 0, "grid_y": 0,
                "xt_trained_on": 0, "xt_actions": 0}
    m = json.loads(path.read_text())
    return {
        "xt_grid": m.get("xt", []),
        "grid_x": m.get("grid_x", 16),
        "grid_y": m.get("grid_y", 12),
        "xt_trained_on": m.get("matches", 0),
        "xt_actions": m.get("actions", 0),
    }


def publish_clips(clips: list[dict], key: str) -> int:
    """Copy cut footage where the web server can serve it.

    Into `public/clips/<workspace>/`, so an added game cannot overwrite the
    committed example's footage. Not redistributed — the directory is
    gitignored — this is a local copy for the running interface.

    Footage from an earlier run of the same workspace is removed rather than
    left in place. Cuts are named for the moment they show, so a rebuild that
    finds a different set of moments leaves the old files behind under names
    the new snapshot never mentions — until some later run keys one of them and
    serves footage cut for a moment that is no longer the one being discussed.
    A published clip should only ever be one this run stands behind.
    """
    import shutil

    if not clips:
        return 0
    dest_dir = PUBLIC_CLIPS / key
    dest_dir.mkdir(parents=True, exist_ok=True)
    keep = {Path(c["file"]).name for c in clips}
    for old_file in dest_dir.glob("*.mp4"):
        if old_file.name not in keep:
            old_file.unlink(missing_ok=True)
    n = 0
    for c in clips:
        src = Path(c["file"])
        if src.exists():
            shutil.copy2(src, dest_dir / src.name)
            n += 1
    return n
