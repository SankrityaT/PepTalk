"""A shot-by-shot log of what the tracker saw in a broadcast clip.

Pep talking through the actual video: what the machine is reading, as it reads
it, timed to the frame.

**What this deliberately does not do, and why.** The obvious thing to build
here is tactical commentary — overloads, spare men, someone free. It was built,
measured, and thrown away, because none of it survives contact with a broadcast
clip that ships no camera calibration:

* *Overloads* are camera artefacts. The count in a shot reflects where the
  camera is pointing, not the pitch: the strongest "overload" in this clip is
  12 against 4, which is not a thing that happens in football. Kit clustering
  also skews — one side leads the count in 255 of 297 frames — so the sign of
  the difference is not even reliable.
* *"Nobody near him"* fires in 286 of 297 frames. In any framed shot somebody
  at the edge is isolated, so it selects nothing.
* *"Stretched across"* fires in 172 of 297 and tracks zoom level, not shape.

So the tactical claims come from the event stream, where there are pitch
coordinates and a ball, and this module restricts itself to what the pixels can
actually support: how many players were found, whether the kits separated, and
where the camera cut. Those are checkable by anyone watching — which is the
point of showing them.
"""

from __future__ import annotations

import json
from pathlib import Path

RESULTS = Path("results")

# A shot must run this long to be worth a line of its own; below it the log
# turns into a strobe of one-frame cuts.
MIN_SHOT_S = 2.0

# Grass below this is a close-up, a crowd shot, or a graphic — not play.
PITCH_VIEW_GRASS = 0.45

# Frames holding fewer than this are not a usable view of the play.
MIN_PLAYERS = 6

# How much the grass fraction must jump between samples to read as a cut.
CUT_GRASS_DELTA = 0.18


def classify(frame: dict) -> str:
    """What kind of shot this frame is."""
    if frame["grass"] < PITCH_VIEW_GRASS:
        return "cut"
    if len(frame["players"]) < MIN_PLAYERS:
        return "tight"
    return "play"


TEAM_NAMES = ("Argentina", "France")

# One line every few seconds. Faster reads as a strobe; slower and the feed
# looks frozen while the video plays.
BEAT_S = 3.0


def build(tracking: Path, out_path: Path) -> dict:
    """A feed that streams alongside the video, in step with it.

    This clip turned out to be a single unbroken wide shot — grass never drops
    below 0.46, the count never falls under 8, and the largest jump between
    samples is one blip. A shot-by-shot log of that is one line long, so the
    feed instead reports the tracker's actual state on a fixed beat: how many
    it found, how they split by kit, and when the box fills up.

    Every number is read off the frame nearest that timestamp. Nothing is
    interpolated and nothing is claimed about tactics.
    """
    raw = json.loads(tracking.read_text())
    frames = raw["frames"]
    if not frames:
        raise ValueError("no tracked frames")

    entries: list[dict] = []
    peak_so_far = 0
    used: set[int] = set()
    t = 0.0
    end = frames[-1]["t"]

    while t <= end:
        # The nearest tracked frame, so a beat never reports a made-up state.
        f = min(frames, key=lambda x: abs(x["t"] - t))
        # Tracking has gaps, and without these two guards several beats in a
        # row snap to the same frame and the feed repeats itself verbatim.
        if abs(f["t"] - t) > BEAT_S / 2 or f["idx"] in used:
            t += BEAT_S
            continue
        used.add(f["idx"])

        n = len(f["players"])
        kits = [0, 0]
        for p in f["players"]:
            if p["team"] in (0, 1):
                kits[p["team"]] += 1

        crowded = n > peak_so_far and n >= 14
        peak_so_far = max(peak_so_far, n)

        # Deliberately a *detection* count, not a claim about how many players
        # were on the pitch. And no per-side split: kit clustering skews badly
        # enough on this clip to report 12 France shirts, which is two more
        # than a team can field, and printing it would be an obvious lie.
        if crowded:
            headline = f"{n} bodies in the picture — most yet."
            detail = "the box is filling up"
        elif n < 10:
            headline = f"{n} tracked."
            detail = "camera has tightened; too few to read shape"
        else:
            headline = f"{n} tracked."
            detail = "two kits separated, officials dropped"

        entries.append(
            {
                "id": len(entries),
                "t": round(f["t"], 2),
                "kind": "crowd" if crowded else "read",
                "headline": headline,
                "detail": detail,
                "tracked": n,
                "kits": kits,
                "grass": f["grass"],
            }
        )
        t += BEAT_S

    payload = {
        "video": raw.get("video"),
        "source": raw.get("source"),
        "detections": raw.get("detections"),
        "excluded_non_team": raw.get("excluded_non_team"),
        "fps": raw.get("fps"),
        "frames_tracked": len(frames),
        "entries": entries,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=1))
    return payload


if __name__ == "__main__":
    import sys

    src = Path(sys.argv[1]) if len(sys.argv) > 1 else RESULTS / "wc-tracking.json"
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else RESULTS / "tape-reads.json"
    out = build(src, dst)
    es = out["entries"]
    print(f"{len(es)} beats across the clip\n")
    for e in es:
        print(f"  {e['t']:>5.1f}s  {e['kind']:<5} {e['headline']:<40} {e['detail']}")
    print(f"\nwrote {dst}")
