"""Adding a game: the endpoints behind the upload flow.

    POST /api/fixtures            fixtures with 360, for the picker
    POST /api/games/upload        the video file, stored
    POST /api/games/{id}/frame    a frame to read the clock off
    POST /api/games               start the run
    GET  /api/games/{id}          how far it has got
    GET  /api/games               what has been added

Analysis takes minutes — events to download, a completion model to fit, footage
to cut — so it cannot be one request. The upload starts a job and the interface
polls it, which is also what turns the progress list from a timer into a report
of what is actually happening.

**Why a fixture picker rather than reading the video.** Moments come from
StatsBomb 360 freeze frames; the footage is cut afterwards to show them. So the
one thing that cannot be derived from the file is which match it is, and asking
is both instant and certain, where guessing is neither. See `bootstrap.py`.

Jobs live in memory and die with the process. That is the right trade for a
single-machine tool: a finished game is on disk as a workspace, so what is lost
on restart is a progress bar, not work.
"""

from __future__ import annotations

import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import bootstrap, data, workspace
from .workspace import Workspace

router = APIRouter()

ROOT = Path(__file__).resolve().parents[2]
UPLOADS = ROOT / ".cache" / "uploads"

#: Refuse a file this large rather than filling the disk. A full match at a
#: sane bitrate is comfortably under this; anything above it is a mistake.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024

#: What `run` reports, in the order it reports it. Held here so the interface
#: can draw the whole list greyed out before the job has reached any of it,
#: which is what makes it a plan rather than a spinner.
STEPS = [
    "resolving the fixture",
    "reading the match",
    "checking for freeze frames",
    "working out how they played",
    "loading the threat model",
    "finding the moments",
    "writing to the memory graph",
    "cutting the footage",
    "watching the footage",
    "writing the report",
]

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


# ── fixtures ─────────────────────────────────────────────────────────────

_fixtures_cache: list[dict] | None = None
_360_cache: set[int] | None = None

#: The three-sixty directory, listed rather than probed. 477 HEAD requests to
#: find the ~426 that exist is a minute of round trips; one listing is a
#: second.
THREE_SIXTY_INDEX = (
    "https://api.github.com/repos/statsbomb/open-data/contents/data/three-sixty"
)


def _matches_with_360() -> set[int]:
    """Match ids that genuinely have a freeze-frame file.

    Empty on any failure, which the caller reads as "cannot tell" and falls
    back to the competition flag. Better to offer a fixture that turns out
    unusable — `bootstrap` refuses it with a clear message — than to offer
    nothing because GitHub was briefly unreachable.
    """
    global _360_cache
    if _360_cache is not None:
        return _360_cache
    try:
        r = httpx.get(THREE_SIXTY_INDEX, timeout=60, follow_redirects=True)
        r.raise_for_status()
        _360_cache = {
            int(f["name"].removesuffix(".json"))
            for f in r.json()
            if f.get("name", "").endswith(".json")
        }
    except Exception:  # noqa: BLE001 - unreachable index is not fatal
        _360_cache = set()
    return _360_cache


def _fixtures() -> list[dict]:
    """Every open-data fixture that has 360, newest first.

    Filtered on the 360 files that actually exist, not on the competition's
    `match_available_360` flag. The flag is set per competition and is not true
    of every match in it: the Africa Cup of Nations carries it, and roughly
    half its fixtures 404 on the three-sixty feed. Offering one of those means
    a coach picks a game, waits, and is told it cannot be analysed — the guard
    in `bootstrap` catches it cleanly, but the right place to catch it is
    before they choose.
    """
    global _fixtures_cache
    if _fixtures_cache is not None:
        return _fixtures_cache

    have_360 = _matches_with_360()
    out: list[dict] = []
    with httpx.Client(timeout=90.0) as c:
        for comp in data.competitions(c):
            if not comp.get("match_available_360"):
                continue
            for m in data.matches(c, comp["competition_id"], comp["season_id"]):
                # The flag got us to the right competitions; this is the
                # per-match truth. Falls back to the flag alone if the listing
                # is unreachable, so an offline run still offers something.
                if have_360 and m["match_id"] not in have_360:
                    continue
                home = m["home_team"]["home_team_name"]
                away = m["away_team"]["away_team_name"]
                out.append(
                    {
                        "match_id": m["match_id"],
                        "date": m["match_date"][:10],
                        "home": home,
                        "away": away,
                        "label": f"{home} {m['home_score']}-{m['away_score']} {away}",
                        "competition": comp["competition_name"],
                        "season": comp["season_name"],
                    }
                )
    out.sort(key=lambda r: r["date"], reverse=True)
    _fixtures_cache = out
    return out


@router.get("/api/fixtures")
def fixtures(q: str = "", competition: str = "", limit: int = 40):
    """Fixtures a coach can actually get a report for."""
    rows = _fixtures()
    if competition:
        rows = [r for r in rows if r["competition"] == competition]
    if q:
        needle = q.lower()
        rows = [
            r
            for r in rows
            if needle in r["home"].lower()
            or needle in r["away"].lower()
            or needle in r["competition"].lower()
        ]
    comps = sorted({r["competition"] for r in _fixtures()})
    return {
        "competitions": comps,
        "total": len(rows),
        "fixtures": rows[: max(1, min(limit, 100))],
    }


# ── upload ───────────────────────────────────────────────────────────────


@router.post("/api/games/upload")
async def upload(video: UploadFile = File(...)):
    """Store the coach's footage and hand back a handle to it.

    Streamed to disk in chunks rather than read into memory: these files are
    gigabytes, and reading one whole would take the process with it.
    """
    UPLOADS.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex[:12]
    suffix = Path(video.filename or "match.mp4").suffix or ".mp4"
    dest = UPLOADS / f"{token}{suffix}"

    size = 0
    with dest.open("wb") as fh:
        while chunk := await video.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "That file is larger than 8GB.")
            fh.write(chunk)

    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "That file was empty.")

    return {
        "video": token,
        "path": str(dest),
        "filename": video.filename,
        "bytes": size,
        **_shape(dest),
    }


def _shape(path: Path) -> dict:
    """How long the footage is, and therefore what can be done with it.

    The alignment step only means something for a continuous recording. Asking
    a coach to read the match clock at 12:00 and 1:02:00 of a five minute reel
    is asking them to read frames that do not exist — which is exactly what it
    did, twice, before this told the interface not to.
    """
    from .bootstrap import REEL_MAX_S
    from .fetch_clips import _duration

    dur = _duration(path)
    if dur is None:
        # Unreadable duration is not fatal: offer alignment and let the frame
        # step fail visibly rather than silently skipping it.
        return {"duration": None, "alignable": True, "reel": False}
    return {
        "duration": round(dur, 1),
        "alignable": dur >= REEL_MAX_S,
        "reel": dur < REEL_MAX_S,
    }


def _upload_path(token: str) -> Path:
    for p in UPLOADS.glob(f"{token}.*"):
        return p
    raise HTTPException(404, "No upload with that id; it may have been cleared.")


@router.post("/api/games/{token}/frame")
def frame(token: str, at: str = Form(...)):
    """A frame from the upload, for the coach to read the clock off.

    Uncropped on purpose. `find_offsets` crops to the scoreboard because it is
    aimed at someone who knows where it is; a coach needs the whole frame to
    orient by, and broadcasts do not agree on where the clock sits.
    """
    from .find_offsets import grab

    src = _upload_path(token)
    out = UPLOADS / f"{token}_{at.replace(':', '')}.png"
    got = grab(str(src), at, out, crop=False)
    if got is None:
        raise HTTPException(422, f"Could not read a frame at {at}.")
    return FileResponse(got, media_type="image/png")


@router.post("/api/games/offsets")
def offsets(
    first_at: str = Form(...),
    first_clock: str = Form(...),
    second_at: str = Form(...),
    second_clock: str = Form(...),
):
    """Turn two clock readings into two offsets, and say if they look wrong."""
    from .find_offsets import check_offsets, offset_from

    one = offset_from(first_at, first_clock)
    two = offset_from(second_at, second_clock)
    return {
        "period_offset": {"1": one, "2": two},
        "break_s": two - one,
        "warning": check_offsets(one, two),
    }


# ── the job ──────────────────────────────────────────────────────────────


@router.post("/api/games")
def create(
    match_id: int = Form(...),
    team: str = Form(...),
    video: str = Form(""),
    first_offset: float = Form(0.0),
    second_offset: float = Form(0.0),
    key: str = Form(""),
):
    """Write the workspace and start the run."""
    fixture = next((f for f in _fixtures() if f["match_id"] == match_id), None)
    if fixture is None:
        raise HTTPException(
            404,
            f"No fixture {match_id} with 360 data. Moments need freeze frames, "
            "so only competitions that publish them can be added.",
        )
    if team not in (fixture["home"], fixture["away"]):
        raise HTTPException(
            400,
            f"{team!r} did not play in {fixture['label']}. Every moment is "
            "written from that bench, so the wrong side reads as nonsense.",
        )

    path = ""
    if video:
        path = str(_upload_path(video))

    slug = key or f"{_slug(team)}-{match_id}"
    ws = Workspace(
        key=slug,
        team=team,
        label=fixture["label"],
        match_id=match_id,
        competition=fixture["competition"],
        season=fixture["season"],
        video_path=path,
        period_offset=(
            {1: float(first_offset), 2: float(second_offset)}
            if path and (first_offset or second_offset)
            else {}
        ),
        kits=(fixture["home"], fixture["away"]),
    )
    workspace.save(ws)

    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "key": slug,
            "label": fixture["label"],
            "team": team,
            "steps": [{"step": s, "status": "waiting"} for s in STEPS],
            "started": time.time(),
            "error": None,
        }

    threading.Thread(target=_run, args=(job_id, ws), daemon=True).start()
    return {"job": job_id, "key": slug, "label": fixture["label"], "steps": STEPS}


def _slug(s: str) -> str:
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")[:32]


def _run(job_id: str, ws: Workspace) -> None:
    def on_step(name: str, status: str, detail: dict[str, Any]) -> None:
        with _lock:
            job = _jobs.get(job_id)
            if not job:
                return
            job["status"] = "running"
            for s in job["steps"]:
                if s["step"] == name:
                    s["status"] = {"start": "running", "ok": "done"}.get(status, status)
                    if detail:
                        s["detail"] = {k: v for k, v in detail.items() if k != "ms"}
                        if "ms" in detail:
                            s["ms"] = detail["ms"]
                    break

    try:
        out = bootstrap.run(ws, on_step=on_step)
        with _lock:
            _jobs[job_id].update(status="ready", result=out)
    except bootstrap.BootstrapError as exc:
        with _lock:
            _jobs[job_id].update(status="failed", error=str(exc))
    except Exception as exc:  # noqa: BLE001 - surfaced to the coach, not swallowed
        with _lock:
            _jobs[job_id].update(status="failed", error=f"{type(exc).__name__}: {exc}")


@router.get("/api/games/{job_id}")
def status(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "No such job; it may have died with the server.")
        done = sum(1 for s in job["steps"] if s["status"] == "done")
        return {**job, "done": done, "total": len(job["steps"])}


@router.get("/api/games")
def added():
    """Every game on disk, and which one the interface is showing.

    Read from `src/content/snapshots/<key>/`, which is where the report
    actually lives — an earlier version looked under `workspaces/` and listed
    nothing once the pipeline started writing where the app reads.

    The committed example is included rather than filtered out: after adding a
    game a coach's own match leads, and Argentina becomes one of the options
    rather than the thing they are stuck with.
    """
    import json

    snaps = ROOT / "src" / "content" / "snapshots"
    current = active_key()
    out = []
    for key in workspace.available():
        meta = snaps / key / "meta.json"
        if meta.exists():
            row = json.loads(meta.read_text())
        elif (snaps / key).exists():
            # The example ships snapshots without a meta.json, since it was
            # assembled before this pipeline existed.
            ws = workspace.load(key)
            row = {
                "key": key,
                "team": ws.team,
                "label": ws.label,
                "date": "",
                "competition": ws.competition,
                "season": ws.season,
                "moments_found": 0,
                "clips": 0,
                "has_footage": True,
            }
        else:
            continue
        out.append({**row, "active": key == current})
    # Newest first, then the active one lifted to the top. A coach opening the
    # switcher is looking at where they are before where else they could go.
    out.sort(key=lambda r: r.get("date") or "", reverse=True)
    out.sort(key=lambda r: not r.get("active"))
    return {"games": out, "active": current}


def active_key() -> str:
    """Which workspace the interface is currently showing."""
    pointer = ROOT / "src" / "content" / "snapshots" / ".active"
    try:
        key = pointer.read_text().strip()
    except OSError:
        return workspace.DEFAULT
    return key or workspace.DEFAULT


@router.post("/api/games/{key}/activate")
def switch(key: str):
    """Point the interface at a different game.

    Copies that workspace's snapshots into `active/` and records the choice,
    so the switch survives the next restart. The page reloads afterwards
    because the imports are static — the app cannot pick a directory at
    runtime, which is the whole reason `active/` exists.
    """
    from . import snapshots as snaps

    if key not in workspace.available():
        raise HTTPException(404, f"no workspace {key}")
    n = snaps.activate(key)
    if not n:
        raise HTTPException(
            409,
            f"{key} has no snapshots yet. Run the pipeline for it first.",
        )
    return {"active": key, "files": n}


@router.get("/api/games/{key}/snapshot/{name}")
def snapshot(key: str, name: str):
    """One of a finished game's snapshots."""
    if not name.replace("-", "").isalnum():
        raise HTTPException(400, "bad snapshot name")
    path = workspace.WORKSPACES / key / "snapshots" / f"{name}.json"
    if not path.exists():
        raise HTTPException(404, f"no {name} for {key}")
    return FileResponse(path, media_type="application/json")


@router.delete("/api/games/{key}")
def remove(key: str):
    """Drop an added game. The built-in one stays."""
    if key == workspace.DEFAULT:
        raise HTTPException(400, "The built-in workspace cannot be removed.")
    d = workspace.WORKSPACES / key
    if not d.exists():
        raise HTTPException(404, f"no workspace {key}")
    shutil.rmtree(d)
    return {"removed": key}
