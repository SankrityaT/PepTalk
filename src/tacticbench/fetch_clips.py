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


def period_of(minute: int) -> int:
    """Which period a match minute falls in.

    Four, not three. The first version treated everything past 90 as one
    period, which put Di Maria's 115:51 on the period 3 offset and, where that
    was unset, dropped it entirely.
    """
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
        period = period_of(minute)
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


def fetch(w: Window, force: bool = False) -> Path | None:
    """One window, or None if it could not be fetched.

    Returns rather than raises: one flaky window should not cost the other
    seven, and a missing clip is handled downstream by falling back to the
    freeze frame for that moment.
    """
    dest = CLIPS / f"{w.match_id}_{w.key}.mp4"
    if dest.exists() and not force:
        return dest
    CLIPS.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, ATTEMPTS + 1):
        cmd = [
            "yt-dlp",
            "--download-sections", f"*{hhmmss(w.start)}-{hhmmss(w.end)}",
            "-f", "bv*[height<=720][ext=mp4]/bv*[height<=720]",
            "-q", "--no-warnings", "-o", str(dest),
        ]
        # Re-encoding at the cut is what usually fails, so the retry drops it
        # and accepts a slightly loose start instead of no clip at all.
        if attempt == 1:
            cmd.insert(3, "--force-keyframes-at-cuts")
        cmd.append(f"https://www.youtube.com/watch?v={WS.video_for_match(w.match_id)}")

        if subprocess.run(cmd).returncode == 0 and dest.exists():
            return dest
        for stale in CLIPS.glob(f"{w.match_id}_{w.key}.mp4*"):
            stale.unlink(missing_ok=True)
        print(f"    retry {attempt}/{ATTEMPTS}", flush=True)
    return None


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
            if period_of(r["minute"]) not in WS.offsets_for_match(mid):
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
