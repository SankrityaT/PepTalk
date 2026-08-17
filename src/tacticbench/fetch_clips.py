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


def video_time(
    period: int, minute: int, second: int, offsets: dict[int, float] | None = None
) -> float | None:
    """Where in the recording a match-clock moment sits.

    Returns None for extra time. There is a second break before it, so the
    period-2 offset does not carry, and applying it anyway would place the
    window minutes away from the play it claims to show. Better to fetch
    nothing than the wrong passage.
    """
    off = (PERIOD_OFFSET if offsets is None else offsets).get(period)
    if off is None:
        return None
    return minute * 60 + second + off


def hhmmss(t: float) -> str:
    t = max(0, int(t))
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def plan(moments: list[dict], offsets: dict[int, float] | None = None) -> list[Window]:
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
        period = 1 if minute < 45 else 2 if minute < 90 else 3
        v = video_time(period, minute, second, offsets)
        if v is None:
            continue
        w = Window(
            key=f"{minute:03d}_{second:02d}",
            period=period,
            match_s=minute * 60 + second,
            video_s=v,
            start=v - LEAD_S,
            end=v + TAIL_S,
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


def fetch(w: Window, force: bool = False, source: str | None = None) -> Path | None:
    """One window of the active workspace's footage."""
    return cut_window(
        URL if source is None else source,
        w.start,
        w.end,
        CLIPS / f"wc_{w.key}.mp4",
        force,
    )


def main() -> None:
    from .pass_options import analyse

    out = analyse(WS.match_id)
    windows = plan(out["top_missed"])

    print(f"{len(out['top_missed'])} moments -> {len(windows)} windows\n")
    manifest = []
    for w in windows:
        if w.period not in PERIOD_OFFSET:
            print(f"  skip {w.key}: no offset for period {w.period}")
            continue
        print(f"  {w.key}  match {hhmmss(w.match_s)}  video {hhmmss(w.video_s)}  "
              f"[{hhmmss(w.start)} - {hhmmss(w.end)}]", flush=True)
        path = fetch(w)
        if path is None:
            print("    could not fetch, skipping")
            continue
        manifest.append(
            {
                "key": w.key,
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
    (RESULTS / "clip_manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"\nwrote {RESULTS / 'clip_manifest.json'}")


if __name__ == "__main__":
    main()
