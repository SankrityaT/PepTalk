"""Run one game end to end: data, moments, graph, footage, snapshots.

    PEPTALK_WORKSPACE=mls23 uv run python -m tacticbench.bootstrap

The single command behind "add a game". Everything it does already existed in
pieces; what was missing was the thing that runs them in order and reports
which step it is on, so the same path serves a coach watching a progress list
and a terminal rebuilding footage from scratch.

**What it is not.** The moments do not come from the video. They come from
StatsBomb 360 freeze frames, which record where all twenty-two players stood at
the instant the ball was struck — that is what turns "he was open" from an
assertion into something showable. The footage is cut afterwards, at the
seconds the engine flagged, so a coach watches the passage rather than reading
about it. Detecting moments from pixels needs pitch-to-image calibration, and
`calibrate.py` does not converge; see `docs/NEW-WORKSPACE.md`.

That makes 360 a hard requirement rather than a nice-to-have, so `run` checks
for it first and refuses early. A competition without it produces a report with
no moments in it, which looks like a bug and is really a missing feed.

**Steps are reported, not printed.** `run` takes an `on_step` callback and
calls it as each stage starts and finishes, which is what lets the interface
show real progress instead of a timer. The CLI passes a callback that prints.
"""

from __future__ import annotations

import json
import math
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from . import data, fetch_clips, snapshots, workspace
from .graph import Graph, MatchMetrics, date_ord, facts_for_team, load_series, save_series
from .state import _team_metrics
from .workspace import Workspace

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

#: Called with (name, status, detail) as each step starts and ends. Status is
#: "start" | "ok" | "skip" | "fail".
StepFn = Callable[[str, str, dict], None]


def _noop(name: str, status: str, detail: dict) -> None:
    return None


class BootstrapError(RuntimeError):
    """A stop that is worth explaining rather than a traceback."""


def has_360(match_id: int) -> bool:
    """Whether StatsBomb publishes freeze frames for this match.

    Asked by HEAD rather than by downloading: the file is megabytes and the
    only question here is whether it exists.
    """
    url = f"https://raw.githubusercontent.com/statsbomb/open-data/master/data/three-sixty/{match_id}.json"
    try:
        r = httpx.head(url, timeout=30, follow_redirects=True)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


#: Below this share of passes carrying a freeze frame, the 360 feed is not
#: describing the same events as the match feed and no moment can be trusted.
#: A healthy match sits far above it — the World Cup final matches 79% of its
#: passes — so the bar is set low enough that only a genuine mismatch trips it.
MIN_FRAME_COVERAGE = 0.20


def check_360(match_id: int, events: list[dict]) -> dict:
    """That freeze frames exist *and* describe these events.

    Two different failures, and the second is the nasty one. A competition can
    publish a 360 file whose `event_uuid`s do not correspond to any event in
    the match feed — every lookup misses, every pass is skipped, and the run
    finishes cleanly with zero moments. That looks like "a quiet game" and is
    really a broken join, so it is caught here rather than discovered by a
    coach reading an empty report.
    """
    from .pass_options import load_360

    if not has_360(match_id):
        raise BootstrapError(
            "StatsBomb publishes no 360 data for this match.\n"
            "Moments are found from freeze frames — where every player stood "
            "when the ball was struck — so without them this match can be "
            "ingested for norms but cannot produce a report.\n"
            "Pick a competition with 360; see docs/NEW-WORKSPACE.md."
        )

    frames = load_360(match_id)
    passes = [e for e in events if e.get("type", {}).get("name") == "Pass"]
    matched = sum(1 for e in passes if e.get("id") in frames)
    coverage = matched / len(passes) if passes else 0.0

    if coverage < MIN_FRAME_COVERAGE:
        raise BootstrapError(
            f"This match has a 360 feed, but it does not line up with its "
            f"events: {matched} of {len(passes)} passes carry a freeze frame "
            f"({coverage:.0%}).\n"
            "That is an upstream data problem rather than something this "
            "pipeline can work around — without a frame there is no record of "
            "who was open, which is the entire claim a moment makes.\n"
            "Try another fixture; most in the same competition are fine."
        )

    return {
        "frames": len(frames),
        "coverage": round(coverage, 2),
        "passes": len(passes),
    }


def resolve(match_id: int) -> dict:
    """StatsBomb metadata for one match."""
    with httpx.Client(timeout=90.0) as c:
        for m in data.all_matches(c):
            if m["match_id"] == match_id:
                return m
    raise BootstrapError(f"No StatsBomb match with id {match_id}.")


def run(
    ws: Workspace | None = None,
    *,
    on_step: StepFn = _noop,
    cut_footage: bool = True,
    top: int = 8,
) -> dict:
    """Everything for one game, in order.

    Returns a summary of what was written. Raises `BootstrapError` for the
    stops worth explaining — a match nobody has 360 for, a video that cannot be
    read — and lets anything else surface as itself.
    """
    ws = ws or workspace.load()
    started = time.time()
    steps: list[dict] = []

    def step(name: str):
        """Time one stage and report it either way."""

        class _Step:
            def __enter__(self):
                on_step(name, "start", {})
                self.t0 = time.time()
                return self

            def __exit__(self, exc_type, exc, tb):
                ms = round((time.time() - self.t0) * 1000)
                detail = getattr(self, "detail", {})
                if exc_type is None:
                    steps.append({"step": name, "ms": ms, **detail})
                    on_step(name, "ok", {"ms": ms, **detail})
                else:
                    on_step(name, "fail", {"ms": ms, "error": str(exc)})
                return False

        return _Step()

    # ── The fixture ──────────────────────────────────────────────────────
    with step("resolving the fixture") as s:
        meta = resolve(ws.match_id)
        home = meta["home_team"]["home_team_name"]
        away = meta["away_team"]["away_team_name"]
        label = f"{home} {meta['home_score']}-{meta['away_score']} {away}"
        date = meta["match_date"][:10]
        if ws.team not in (home, away):
            raise BootstrapError(
                f"{ws.team!r} did not play in {label}. The workspace's `team` "
                f"must be one of {home!r} or {away!r} — every moment is written "
                "from that bench, so the wrong one addresses the wrong side."
            )
        s.detail = {"label": label, "date": date}

    # ── Events ───────────────────────────────────────────────────────────
    with step("reading the match") as s:
        with httpx.Client(timeout=120.0) as c:
            events = data.events(c, ws.match_id)
        s.detail = {"events": len(events)}

    # ── 360, the hard requirement ────────────────────────────────────────
    with step("checking for freeze frames") as s:
        s.detail = check_360(ws.match_id, events)

    # ── Per-team state ───────────────────────────────────────────────────
    with step("working out how they played") as s:
        total = len(events)
        metrics = {
            side: _team_metrics(events, side, total) for side in (home, away)
        }
        s.detail = {
            "possession": round(metrics[ws.team].get("possession_share_pct") or 0.0, 1)
        }

    # ── The threat model ─────────────────────────────────────────────────
    # Global, not per match: it is what "dangerous" means, learned across
    # every cached match, and adding one game does not move it. Built here
    # only when it is missing, which is the state of a fresh clone.
    with step("loading the threat model") as s:
        s.detail = _ensure_xt()

    # ── Moments ──────────────────────────────────────────────────────────
    with step("finding the moments") as s:
        out_path = ws.snapshots / "pep.json"
        pep_payload = _write_pep(ws, top, out_path)
        found = pep_payload.get("moments_found", 0)
        s.detail = {
            "found": found,
            "considered": pep_payload.get("passes_with_an_option", 0),
        }

    # ── Graph ────────────────────────────────────────────────────────────
    with step("writing to the memory graph") as s:
        s.detail = _write_graph(ws, meta, metrics, date, label)

    # ── Footage ──────────────────────────────────────────────────────────
    clips: list[dict] = []
    if cut_footage and ws.source:
        with step("cutting the footage") as s:
            clips = cut_clips(ws, pep_payload.get("moments", []))
            published = snapshots.publish_clips(clips, ws.key)
            s.detail = {"clips": len(clips), "published": published}
    else:
        on_step("cutting the footage", "skip", {"reason": "no video for this workspace"})

    # ── Tracking ─────────────────────────────────────────────────────────
    # What makes the footage worth showing rather than just playing: every box
    # is a player the tracker actually found in that frame, so the overlay is
    # a reading of the video rather than a drawing over it.
    tracks: dict[str, dict] = {}
    if clips:
        with step("watching the footage") as s:
            tracks = track_clips(clips)
            s.detail = {
                "tracked": len(tracks),
                "detections": sum(t.get("detections", 0) for t in tracks.values()),
            }

    # ── Snapshots ────────────────────────────────────────────────────────
    with step("writing the report") as s:
        written = snapshots.write_all(
            ws,
            pep=pep_payload,
            clips=clips,
            tracks=tracks,
            metrics=metrics,
            meta=meta,
            label=label,
            date=date,
        )
        # And point the interface at them, so a coach who just added a game
        # sees it rather than being told to run a script.
        active = snapshots.activate(ws.key)
        s.detail = {"files": len(written), "active": active}

    return {
        "workspace": ws.key,
        "match": label,
        "date": date,
        "moments_found": pep_payload.get("moments_found", 0),
        "clips": len(clips),
        "steps": steps,
        "total_ms": round((time.time() - started) * 1000),
        "snapshots": str(workspace.snapshot_dir(ws.key)),
    }


def _ensure_xt() -> dict:
    """The expected-threat grid, trained if it is not already on disk.

    `pass_options` reads `results/xt_model.json` directly and a fresh clone has
    no such file, which surfaced as a bare FileNotFoundError three steps into a
    run. Training is a pass over the cached events, so it costs whatever has
    been downloaded so far and nothing over the network.
    """
    from .xt import RESULTS as XT_RESULTS
    from .xt import build

    path = XT_RESULTS / "xt_model.json"
    if path.exists():
        model = json.loads(path.read_text())
        return {"trained_on": model.get("matches", 0), "built": False}

    model = build()
    return {"trained_on": model.get("matches", 0), "built": True}


#: How much of the report belongs to the coach's own side.
#:
#: Not all of it. Half the flagged moments in any match are the opponent's, and
#: those are the chances that were there against you — the defensive half of
#: the report, and the part a coach is most exposed by. But a report that opens
#: with six of the opponent's moments is a report about the opponent, which is
#: exactly what "I picked LAFC and got Inter Miami's game" felt like.
OURS_SHARE = 0.625


def _for_bench(moments: list[dict], team: str, top: int) -> list[dict]:
    """The `top` moments worth showing *this* bench.

    Ranked by value within each side, then filled so the coach's own side
    leads. Selecting purely on value hands the report to whichever team had
    the louder game, which for a side that lost 1-3 is the other one.

    Holds for any team in any fixture, including the awkward shapes:

    * a side with more moments than the report has room for
    * a side with none at all, where the report is entirely defensive
    * a small `top`, where a naive ratio rounds our share down to parity —
      `round(4 * 0.625)` is 2, which split a four-moment report evenly and
      was the bug this docstring used to describe as fixed
    * more moments wanted than exist, where the report is simply shorter
    """
    ours = [m for m in moments if m.get("team") == team]
    theirs = [m for m in moments if m.get("team") != team]

    # Ceil, not round: at top=4 a rounded share gives 2 of ours and 2 of
    # theirs, which is not "your game with their chances against you", it is
    # a joint report. Ceil keeps ours ahead at every size.
    # Ours first, up to the share, then theirs, then give whichever side has
    # anything left the remaining slots. Both quotas are computed against what
    # actually exists, so no side is capped below what it could fill and the
    # report is never shorter than the moments available.
    want_ours = min(len(ours), max(1, math.ceil(top * OURS_SHARE)))
    want_theirs = min(len(theirs), top - want_ours)
    # Spare capacity goes back to whoever can use it.
    spare = top - want_ours - want_theirs
    if spare > 0:
        want_ours = min(len(ours), want_ours + spare)
        want_theirs = min(len(theirs), top - want_ours)

    picked = ours[:want_ours] + theirs[:want_theirs]
    return sorted(picked, key=lambda m: -m.get("missed", 0))


def _write_sides(lines: list[dict], team: str) -> list[dict]:
    """Tag each moment with whose it is, and reword the opponent's.

    `side_of` and `defensive_line` have existed since the World Cup build and
    were never called from here, so every moment read as "you had this on" —
    including the six of eight that belonged to the other team.
    """
    from .pep import defensive_line, side_of

    out = []
    for m in lines:
        side = side_of(m, team)
        row = {**m, "side": side}
        if side == "defending":
            row["line"] = defensive_line(m)
        out.append(row)
    return out


def _write_pep(ws: Workspace, top: int, out_path: Path) -> dict:
    """Pep's lines for this match, or the computed moments without them.

    `pep.build` needs ANTHROPIC_API_KEY to write prose. Without it the moments
    are still real — the arithmetic is local — so we fall back to them rather
    than failing the whole run, and record which happened so the interface can
    say so.
    """
    from .pass_options import analyse

    try:
        from .pep import build

        payload = build(ws.match_id, top, out_path, model=_model())
        # Same split as the fallback below: the model writes every line in the
        # second person, so an untagged opponent moment reads as "you had this
        # on" to the wrong bench.
        payload["moments"] = _write_sides(payload.get("moments", []), ws.team)
        payload["written_by"] = "model"
        out_path.write_text(json.dumps(payload, indent=1))
        return payload
    except Exception as exc:  # noqa: BLE001 - any failure falls back to numbers
        from .pep import computed_lines, display_names

        # Ask for every material moment, not the top `top`, because which ones
        # matter depends on whose bench this is and that is decided below. Cut
        # first and a coach whose side had the quieter game is handed a report
        # about the opponent.
        analysis = analyse(ws.match_id, top=10_000)
        moments = _for_bench(analysis["top_missed"], ws.team, top)
        try:
            names = display_names(ws.match_id)
            for m in moments:
                if m.get("player") in names:
                    m["player"] = names[m["player"]]
        except Exception:  # noqa: BLE001 - broadcast names are a nicety
            pass
        payload = {
            "match_id": ws.match_id,
            "source": "tacticbench pass_options + xt (3,961 matches)",
            "themes": [],
            "completion_model": analysis["completion_model"],
            "moments_found": analysis["moments_found"],
            "passes_with_an_option": analysis["passes_with_an_option"],
            "moments": _write_sides(computed_lines(moments), ws.team),
            "written_by": "numbers",
            "note": f"model copy unavailable ({type(exc).__name__}); "
            "lines are computed from the same figures",
        }
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=1))
        return payload


def _model() -> str:
    from .runner import DEFAULT_MODEL

    return DEFAULT_MODEL


def _write_graph(
    ws: Workspace, meta: dict, metrics: dict[str, dict], date: str, label: str
) -> dict:
    """The match, and the eras it belongs to, for both sides.

    Both teams are written because the graph's value is comparative: a coach
    asking what was unusual today is asking against the opponent's norms as
    well as their own.

    Segmentation is whole-series by construction — quantile edges span every
    observation and the hysteresis needs eight consecutive matches to open an
    era — so a new match cannot be appended to a fact. The team's series is
    reloaded, extended, and re-segmented, and `ingest_team` clears the old
    facts first so this is a replace rather than a second chain.
    """
    from .demo import team_id

    g = Graph()
    written = {}
    try:
        for side in (meta["home_team"]["home_team_name"], meta["away_team"]["away_team_name"]):
            row = MatchMetrics(
                match_id=ws.match_id,
                date=date,
                competition=meta.get("competition_name") or ws.competition,
                label=label,
                metrics=metrics[side],
            )
            series = [m for m in load_series(side) if m.match_id != ws.match_id]
            series.append(row)
            series.sort(key=lambda m: m.date)
            save_series(side, series)

            tid = team_id(side)
            facts = facts_for_team(series)
            out = g.ingest_team(side, tid, series, facts)
            written[side] = {
                "matches": out["matches"],
                "facts": out["facts"],
                "supersedes": out["supersedes"],
            }

        ht = _halftime(ws.match_id)
        g.enrich_match(ws.match_id, meta, ht)
    finally:
        g.close()
    return written


def _halftime(match_id: int) -> tuple[int, int]:
    """Halftime score, so the added match is visible to `/api/browse`."""
    try:
        from .scan import extract_goals, score_at_halftime

        with httpx.Client(timeout=120.0) as c:
            events = data.events(c, match_id)
        meta = resolve(match_id)
        return score_at_halftime(
            extract_goals(events),
            meta["home_team"]["home_team_name"],
            meta["away_team"]["away_team_name"],
        )
    except Exception:  # noqa: BLE001 - a missing halftime score is not fatal
        return (0, 0)


#: A full match runs ~2 hours of recording. Anything under this is not a
#: broadcast; it is a highlights reel or a single passage, and the offset model
#: does not describe it — highlights jump, so no constant maps match time into
#: them.
REEL_MAX_S = 45 * 60


def cut_reel(ws: Workspace, moments: list[dict], duration: float) -> list[dict]:
    """Clips from a short reel, when there is no match clock to align to.

    A highlights package is still footage of this match, and a coach wants to
    see it next to the analysis. What it is not is a continuous recording, so
    a moment at match-minute 77 cannot be located in it.

    So the claim is weakened rather than faked. The reel is divided evenly and
    each moment gets a window, in order, with the pass placed at the centre.
    The interface labels these as an excerpt rather than as the moment itself,
    because that is what they are. Better an honest excerpt beside the numbers
    than a diagram alone — and far better than a confident cut that is really
    a different passage.
    """
    ordered = sorted(moments, key=lambda m: (m["minute"], m.get("second") or 0))
    if not ordered or duration <= 0:
        return []

    # One window per moment, evenly spaced, capped so a reel with many moments
    # still yields watchable clips rather than one-second flickers.
    span = duration / len(ordered)
    length = max(4.0, min(fetch_clips.LEAD_S + fetch_clips.TAIL_S, span))

    dest_dir = ws.dir / "clips"
    out: list[dict] = []
    for i, m in enumerate(ordered):
        centre = span * i + span / 2
        start = max(0.0, centre - length / 2)
        end = min(duration, start + length)
        if end - start < 2.0:
            continue
        minute, second = m["minute"], m.get("second") or 0
        key = f"{minute:03d}_{second:02d}"
        dest = dest_dir / f"{ws.key}_{key}.mp4"
        if fetch_clips.cut_window(ws.source, start, end, dest) is None:
            continue
        out.append(
            {
                "key": key,
                "period": 1 if minute < 45 else 2,
                "match_s": minute * 60 + second,
                "video_s": centre,
                "start": start,
                "end": end,
                "offset_in_clip": round(centre - start, 2),
                "file": str(dest),
                # The honest part. The interface reads this and says so.
                "excerpt": True,
            }
        )
    return out


#: How densely a clip is sampled. Every 6th frame at ~25fps is roughly four
#: readings a second, which is dense enough that boxes track the play rather
#: than jumping, and sparse enough that ten seconds is a few seconds of work.
TRACK_EVERY_N = 6
TRACK_MAX_FRAMES = 60


def track_clips(clips: list[dict], device: str = "mps") -> dict[str, dict]:
    """Run the tracker over each cut clip.

    This is what turns footage into evidence: every box is a player the model
    found in that frame, after kit clustering and an officials filter, so the
    overlay is a reading of the video rather than a drawing over it.

    Failure is per clip and never fatal. The vision extras are optional
    (`uv pip install -e ".[cv]"` pulls ~2GB of torch), and a report with plain
    footage is much better than no report at all — the interface simply draws
    no boxes where there is no tracking.
    """
    try:
        from .cv_video import track
    except ImportError as exc:
        print(f"    tracking unavailable ({exc}); clips will play without boxes")
        return {}

    out: dict[str, dict] = {}
    for c in clips:
        path = Path(c["file"])
        if not path.exists():
            continue
        try:
            t = track(
                path,
                every_n=TRACK_EVERY_N,
                max_frames=TRACK_MAX_FRAMES,
                device=device,
            )
        except Exception as exc:  # noqa: BLE001 - one bad clip is not the run
            print(f"    could not track {path.name}: {type(exc).__name__}")
            continue
        out[c["key"]] = t
    return out


def cut_clips(ws: Workspace, moments: list[dict]) -> list[dict]:
    """A clip per flagged moment, cut from this workspace's footage.

    Windows are planned against the workspace's own offsets and merged where
    they overlap, then each is cut and its clock read back. A period with no
    measured offset is skipped rather than guessed: a window minutes away from
    the play it claims to show is worse than no window at all.
    """
    if not ws.source:
        return []

    # A short file is a reel, not a broadcast. Aligning it by the match clock
    # produces nothing at all — every window falls past the end — so it gets
    # excerpts instead, labelled as such.
    if ws.is_local:
        dur = fetch_clips._duration(Path(ws.source))
        if dur is not None and dur < REEL_MAX_S:
            return cut_reel(ws, moments, dur)

    windows = fetch_clips.plan(moments, ws.period_offset)
    dest_dir = ws.dir / "clips"
    out: list[dict] = []
    for w in windows:
        if w.period not in ws.period_offset:
            continue
        dest = dest_dir / f"{ws.key}_{w.key}.mp4"
        path = fetch_clips.cut_window(ws.source, w.start, w.end, dest)
        if path is None:
            continue
        out.append(
            {
                "key": w.key,
                "period": w.period,
                "match_s": w.match_s,
                "video_s": w.video_s,
                "start": w.start,
                "end": w.end,
                "offset_in_clip": round(w.video_s - w.start, 2),
                "file": str(path),
            }
        )
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "clip_manifest.json").write_text(json.dumps(out, indent=1))
    return out


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(
        prog="tacticbench.bootstrap",
        description="Run one game end to end: data, moments, graph, footage, snapshots.",
    )
    ap.add_argument("--workspace", default=None, help=f"a key under workspaces/ (or ${workspace.ENV_VAR})")
    ap.add_argument("--no-footage", action="store_true", help="skip cutting clips")
    ap.add_argument("--top", type=int, default=8, help="how many moments to write up")
    args = ap.parse_args()

    ws = workspace.load(args.workspace)
    print(f"workspace {ws.key}: {ws.label}  (statsbomb {ws.match_id})")
    print(f"  footage {ws.source or '(none)'}\n")

    def echo(name: str, status: str, detail: dict) -> None:
        if status == "start":
            print(f"  {name} ...", end="", flush=True)
        elif status == "ok":
            extra = " ".join(f"{k}={v}" for k, v in detail.items() if k != "ms")
            print(f"\r  {name}  {detail.get('ms', 0)}ms  {extra}")
        elif status == "skip":
            print(f"\r  {name}  skipped ({detail.get('reason', '')})")
        else:
            print(f"\r  {name}  FAILED: {detail.get('error', '')}")

    try:
        out = run(ws, on_step=echo, cut_footage=not args.no_footage, top=args.top)
    except BootstrapError as exc:
        raise SystemExit(f"\n{exc}")

    print(f"\n{out['match']}  {out['date']}")
    print(f"  {out['moments_found']} moments, {out['clips']} clips")
    print(f"  wrote {out['snapshots']}")
    print(f"  {out['total_ms']}ms total")


if __name__ == "__main__":
    main()
