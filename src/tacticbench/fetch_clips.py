"""Pull footage for the moments the engine actually flagged.

    uv run python -m tacticbench.fetch_clips

The problem this solves: the analysed moments are spread across a two hour
match, and a ninety second clip from minute twenty contains none of them. So
the walkthrough either shows a diagram, which a coach does not accept, or it
shows unrelated footage, which is worse. Neither is acceptable, so we go and
get the right seconds.

**Aligning video time to match time.** The broadcast carries a clock in its
overlay, so the offset is read rather than guessed: a frame at video 12:01
shows 10:25, and a frame at video 1:02:01 shows 52:02. That gives one offset
per period, since the half time break is not in the match clock:

    period 1   video = match + 96s
    period 2   video = match + 599s

The 503 second difference is the half time break, which is the right order for
a broadcast. Each downloaded window is checked by reading its clock back, so a
wrong offset shows up immediately rather than silently misaligning the demo.

Footage is not redistributed: everything lands in a gitignored directory and
only the derived tracking JSON is committed.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import workspace

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
CLIPS = ROOT / ".cache" / "clips"

#: Read from the active workspace rather than baked in, so a second team is a
#: config file rather than a patch across eight modules.
#:
#: These remain module-level for the CLI, which analyses whatever workspace is
#: selected. Every function below takes the workspace as an argument and
#: defaults to this one, because an upload runs a workspace that did not exist
#: when this module was imported.
WS = workspace.load()
PERIOD_OFFSET = WS.period_offset
URL = WS.url

#: Seconds of run-in before the pass, so a coach sees the ball arrive, and a
#: short tail after so the pause does not land on the very last frame.
LEAD_S = 6.0
TAIL_S = 4.0


@dataclass
class Window:
    key: str
    period: int
    match_s: float
    video_s: float
    start: float
    end: float
    #: Which match this came from. A workspace can hold footage for several,
    #: and a clip named only by its clock collides across them: 47:23 exists in
    #: every game.
    match_id: int = 0
    player: str = ""


def period_of(minute: int, period: int | None = None) -> int:
    """Which period a match minute falls in.

    Prefer the period the event carries. Inferring it from the clock is wrong
    wherever stoppage time overlaps the next half: Tagliafico's 45:45 pass
    against Saudi Arabia is in period 1, which ran to minute 51, and reading it
    as period 2 would cut the clip ten minutes from the play.

    The fallback is four periods, not three. An earlier version treated
    everything past 90 as period 3, which put Di Maria's 115:51 on an unset
    offset and dropped it entirely.
    """
    if period:
        return int(period)
    return 1 if minute < 45 else 2 if minute < 90 else 3 if minute < 105 else 4


def video_time(period: int, minute: int, second: int, match_id: int | None = None) -> float | None:
    """Where in the recording a match-clock moment sits.

    Returns None for a period with no measured offset. Every break shifts the
    two clocks apart again, so an offset from another period, or another
    broadcast, places the window minutes from the play it claims to show.
    Better to fetch nothing than the wrong passage.
    """
    off = WS.offsets_for_match(match_id).get(period)
    if off is None:
        return None
    return minute * 60 + second + off


def hhmmss(t: float) -> str:
    t = max(0, int(t))
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def plan(moments: list[dict], match_id: int | None = None) -> list[Window]:
    """One window per moment, merging any that overlap.

    Two of the flagged passes are two seconds apart, and downloading that
    stretch twice would be both slower and confusing to show.
    """
    out: list[Window] = []
    # Sorted by time first. `analyse` returns them ranked by how much was
    # missed, and merging "overlapping" windows against the previous entry in
    # that order folded five separate passages into two unrelated ones.
    ordered = sorted(moments, key=lambda m: (m["minute"], m.get("second") or 0))
    for m in ordered:
        minute, second = m["minute"], m.get("second") or 0
        # Whichever periods the workspace measured; the rest are skipped.
        period = period_of(minute, m.get("period"))
        v = video_time(period, minute, second, match_id)
        if v is None:
            continue
        w = Window(
            key=f"{minute:03d}_{second:02d}",
            period=period,
            match_s=minute * 60 + second,
            video_s=v,
            start=v - LEAD_S,
            end=v + TAIL_S,
            match_id=match_id or WS.match_id,
            player=m.get("player") or "",
        )
        if out and w.start <= out[-1].end:
            out[-1].end = max(out[-1].end, w.end)
            continue
        out.append(w)
    return out


#: Section downloads reach into the middle of a stream and ffmpeg exits 8 on
#: a bad read often enough to matter over eight windows.
ATTEMPTS = 3


def cut_window(
    source: str, start: float, end: float, dest: Path, force: bool = False
) -> Path | None:
    """Seconds `start`-`end` of `source`, written to `dest`, or None.

    Two sources, one contract. A local path is cut with ffmpeg; anything else
    is treated as a URL and pulled with yt-dlp. An uploaded file takes the
    first branch, which is the faster and more reliable of the two: the bytes
    are already here, so there is no stream to seek into and nothing to retry.

    Returns rather than raises. One flaky window should not cost the other
    seven, and a missing clip is handled downstream by falling back to that
    moment's freeze frame.
    """
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)

    # A window can fall partly or wholly outside the recording: a moment early
    # in the match minus the six second run-in goes negative, and an offset
    # that does not match the footage puts it nowhere at all. Clamping only the
    # start produced `-to value smaller than -ss` and an ffmpeg abort, so both
    # ends are clamped and an empty window is refused outright.
    start = max(0.0, start)
    end = max(0.0, end)
    if end <= start:
        print(f"    window [{start:.1f}, {end:.1f}] is empty, skipping")
        return None

    if _is_local(source):
        src = Path(source)
        if not src.exists():
            print(f"    no such file: {src}")
            return None

        # Asking for seconds a file does not contain yields a zero-byte clip
        # that plays as a broken element rather than failing. Checked here so
        # the moment falls back to its freeze frame instead.
        dur = _duration(src)
        if dur is not None and start >= dur:
            print(f"    window starts at {start:.0f}s, past the end ({dur:.0f}s)")
            return None
        # -ss before -i seeks by keyframe index rather than decoding up to the
        # cut, which matters when the file is two hours long and we want four
        # seconds from the middle of it.
        cmd = [
            "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
            "-ss", f"{max(0.0, start):.2f}", "-to", f"{max(0.0, end):.2f}",
            "-i", str(src),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-an", str(dest),
        ]
        if subprocess.run(cmd).returncode == 0 and dest.exists():
            return dest
        dest.unlink(missing_ok=True)
        return None

    for attempt in range(1, ATTEMPTS + 1):
        cmd = [
            "yt-dlp",
            "--download-sections", f"*{hhmmss(start)}-{hhmmss(end)}",
            "-f", "bv*[height<=720][ext=mp4]/bv*[height<=720]",
            "-q", "--no-warnings", "-o", str(dest),
        ]
        # Re-encoding at the cut is what usually fails, so the retry drops it
        # and accepts a slightly loose start instead of no clip at all.
        if attempt == 1:
            cmd.insert(3, "--force-keyframes-at-cuts")
        cmd.append(source)

        if subprocess.run(cmd).returncode == 0 and dest.exists():
            return dest
        for stale in dest.parent.glob(f"{dest.stem}.mp4*"):
            stale.unlink(missing_ok=True)
        print(f"    retry {attempt}/{ATTEMPTS}", flush=True)
    return None


def _is_local(source: str) -> bool:
    """A path on disk, rather than something to download."""
    return bool(source) and "://" not in source


def _duration(path: Path) -> float | None:
    """Seconds of footage, or None if ffprobe cannot say."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return float(out.stdout.strip())
    except (ValueError, OSError, subprocess.SubprocessError):
        return None


def source_for(match_id: int | None = None) -> str:
    """Where this match's footage comes from: a local file, or a URL.

    An uploaded recording only ever belongs to the workspace match, so the
    local path wins there and the other matches fall back to their `sources`
    entry. Returning a full URL rather than a bare id keeps `cut_window`'s
    "local path or URL" contract the only thing callers have to know.
    """
    if match_id is None or match_id == WS.match_id:
        return WS.source
    vid = WS.video_for_match(match_id)
    return f"https://www.youtube.com/watch?v={vid}" if vid else ""


def fetch(w: Window, force: bool = False, source: str | None = None) -> Path | None:
    """One window of footage, from whichever match the window belongs to.

    Clips are named by match as well as key: a squad pass covers several
    fixtures, and two of them can easily hold a moment at the same clock.
    """
    return cut_window(
        source_for(w.match_id) if source is None else source,
        w.start,
        w.end,
        CLIPS / f"{w.match_id}_{w.key}.mp4",
        force,
    )


def squad_windows() -> list[Window]:
    """One window per player: their costliest ball, from a match we can show.

    The old selection was the eight material moments of a single match, which
    gave two players footage. Widening to every match the workspace holds
    footage for, and taking each player's best rather than the match's best,
    covers the squad instead of the scoreline.

    A player only appears if his moment clears the same materiality gate as
    everywhere else. Showing a coach a 0.04 threat gap and calling it his
    costliest ball is the "that pass was unnecessary" mistake in a new place.
    """
    from .pass_options import analyse, is_material

    best: dict[str, tuple[float, dict, int]] = {}
    for mid in [WS.match_id, *WS.sources]:
        if not WS.has_footage(mid):
            continue
        try:
            found = analyse(mid)
        except Exception as exc:  # noqa: BLE001
            print(f"  {mid}: no analysis ({type(exc).__name__})")
            continue
        for r in found["all_options"]:
            if r.get("team") != WS.team or not r.get("player") or not is_material(r):
                continue
            if period_of(r["minute"], r.get("period")) not in WS.offsets_for_match(mid):
                continue  # no measured offset for that period, so unshowable
            got = best.get(r["player"])
            if got is None or r["missed"] > got[0]:
                best[r["player"]] = (r["missed"], r, mid)

    out: list[Window] = []
    for _, row, mid in best.values():
        out += plan([row], mid)
    return out


def main() -> None:
    import argparse

    from .pass_options import analyse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--squad", action="store_true",
                    help="one clip per player across every match with footage")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.squad:
        windows = squad_windows()
        print(f"{len(windows)} players with a showable moment\n")
    else:
        out = analyse(WS.match_id)
        windows = plan(out["top_missed"], WS.match_id)
        print(f"{len(out['top_missed'])} moments -> {len(windows)} windows\n")

    manifest = []
    for w in windows:
        if w.period not in WS.offsets_for_match(w.match_id):
            print(f"  skip {w.key}: no offset for period {w.period}")
            continue
        who = f"{w.player.split()[-1]:<12}" if w.player else " " * 12
        print(f"  {who} {w.match_id} {w.key}  match {hhmmss(w.match_s)}  "
              f"video {hhmmss(w.video_s)}", flush=True)
        path = fetch(w, force=args.force)
        if path is None:
            print("    could not fetch, skipping")
            continue
        manifest.append(
            {
                "key": w.key,
                "match_id": w.match_id,
                "player": w.player,
                "period": w.period,
                "match_s": w.match_s,
                "video_s": w.video_s,
                "start": w.start,
                "end": w.end,
                # Where the pass falls inside the downloaded window.
                "offset_in_clip": round(w.video_s - w.start, 2),
                "file": str(path),
            }
        )

    RESULTS.mkdir(exist_ok=True)
    name = "squad_manifest.json" if args.squad else "clip_manifest.json"
    (RESULTS / name).write_text(json.dumps(manifest, indent=1))
    print(f"\n{len(manifest)} clips -> {RESULTS / name}")


if __name__ == "__main__":
    main()
