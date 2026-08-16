"""Track the fetched windows and emit the walkthrough snapshot.

    uv run python -m tacticbench.build_clips

Runs detection over each clip from `fetch_clips`, joins it to the moment the
clip was fetched for, and writes one JSON the interface can render without any
further work.

The join is by match clock, which is checkable: each window was cut at a known
video offset, verified by reading the broadcast clock back off the frame. A
clip whose clock disagrees with its moment would be a silent lie in the demo,
so the alignment is stated in the output rather than assumed.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import workspace

WS = workspace.load()
ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
CLIPS = ROOT / ".cache" / "clips"
PUBLIC = Path("/tmp/peptalk-ui/public/clips")

#: Sample every Nth frame. The windows are ten seconds, so this is cheap, and
#: denser sampling keeps the overlay from lagging the players it belongs to.
EVERY_N = 3


def main() -> None:
    from .cv_video import track
    from .pass_options import analyse
    from .pep import describe, display_names, short_name

    manifest = json.loads((RESULTS / "clip_manifest.json").read_text())
    by_key = {w["key"]: w for w in manifest}

    out = analyse(WS.match_id)
    names = display_names(WS.match_id)

    PUBLIC.mkdir(parents=True, exist_ok=True)
    moments = []

    for m in sorted(out["top_missed"], key=lambda r: (r["minute"], r.get("second") or 0)):
        key = f"{m['minute']:03d}_{m.get('second') or 0:02d}"
        w = by_key.get(key)
        if not w:
            continue
        src = Path(w["file"])
        if not src.exists():
            continue

        print(f"  tracking {key} ...", flush=True)
        t = track(src, every_n=EVERY_N, max_frames=200, device="mps")
        if not t.get("frames"):
            print("    no usable frames, skipping")
            continue

        # The clip ships alongside the page; the source stays out of the repo.
        dest = PUBLIC / f"{key}.mp4"
        dest.write_bytes(src.read_bytes())

        full = m.get("player") or ""
        m["player"] = names.get(full, full)
        f = describe(m)
        f.update(
            {
                "key": key,
                "clip": f"/clips/{key}.mp4",
                "pass_at": w["offset_in_clip"],
                "match_clock": f"{m['minute']}:{(m.get('second') or 0):02d}",
                "from": m["from"],
                "played_to": [round(m["played"]["x"], 1), round(m["played"]["y"], 1)],
                "best_to": [round(m["best"]["x"], 1), round(m["best"]["y"], 1)],
                "freeze": m.get("freeze", []),
                "missed": m["missed"],
                "frames": t["frames"],
                "detections": t.get("detections", 0),
                "surname": short_name(m["player"] or ""),
            }
        )
        moments.append(f)
        print(f"    {len(t['frames'])} frames, {t.get('detections', 0)} detections")

    for i, mm in enumerate(moments):
        mm["id"] = i

    payload = {
        "match_id": WS.match_id,
        "source": "broadcast clock read off the overlay; one offset per period",
        "moments": moments,
    }
    dest = Path("/tmp/peptalk-ui/src/content/snapshots/clip-moments.json")
    dest.write_text(json.dumps(payload))
    print(f"\n{len(moments)} moments with footage -> {dest}")


if __name__ == "__main__":
    main()
