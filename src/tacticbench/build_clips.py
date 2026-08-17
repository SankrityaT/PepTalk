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


def build_squad() -> None:
    """Track the per-player clips and write what the roster needs.

    Kept separate from the session's moments on purpose. The session is a
    narrative through one match and its four clips are chosen for that; a
    player card wants that player's own ball, which may be from any game the
    workspace can show. Writing both into one file would mean one of them
    reordering the other.
    """
    from .cv_video import track
    from .pass_options import analyse
    from .pep import describe
    from .roster import display_surname

    manifest = json.loads((RESULTS / "squad_manifest.json").read_text())
    PUBLIC.mkdir(parents=True, exist_ok=True)

    def nicknames(match_id: int) -> dict[str, str]:
        """Full name -> the lineup's nickname, straight from the feed.

        Not via pep.display_names, which rejects a nickname whenever it
        disagrees with the full name. That rule is right for its own purpose
        and wrong here: it turns Nahuel Molina Lucero into "Lucero" and Angel
        Di Maria Hernandez into "Hernandez", because it reads the last word of
        a Spanish full name as the surname. Those clips then joined to no
        player card at all.
        """
        import httpx

        from . import data

        with httpx.Client(timeout=120) as c:
            sides = data.lineups(c, match_id)
        out = {}
        for side in sides:
            for p in side.get("lineup", []):
                if p.get("player_name"):
                    out[p["player_name"]] = p.get("player_nickname") or ""
        return out

    rows, names_cache, options_cache = [], {}, {}
    for w in sorted(manifest, key=lambda w: (w["match_id"], w["key"])):
        src = Path(w["file"])
        if not src.exists():
            print(f"  {w['key']}: file missing, skipping")
            continue
        mid = w["match_id"]
        if mid not in options_cache:
            options_cache[mid] = analyse(mid)["all_options"]
            names_cache[mid] = nicknames(mid)

        # The row this clip was cut for, matched on clock and player.
        minute, second = divmod(int(w["match_s"]), 60)
        row = next(
            (r for r in options_cache[mid]
             if r["minute"] == minute and (r.get("second") or 0) == second
             and r.get("player") == w["player"]),
            None,
        )
        if row is None:
            print(f"  {w['key']}: no matching pass, skipping")
            continue

        print(f"  tracking {mid} {w['key']} ({w['player'].split()[-1]}) ...", flush=True)
        t = track(src, every_n=EVERY_N, max_frames=200, device="mps")
        if not t.get("frames"):
            print("    no usable frames, skipping")
            continue

        key = f"{mid}_{w['key']}"
        (PUBLIC / f"{key}.mp4").write_bytes(src.read_bytes())

        full = row.get("player") or ""
        nick = names_cache[mid].get(full) or None
        surname = display_surname(full, nick)
        row["player"] = nick or full
        f = describe(row)
        f.update({
            "key": key,
            "match_id": mid,
            "clip": f"/clips/{key}.mp4",
            "pass_at": w["offset_in_clip"],
            "match_clock": f"{minute}:{second:02d}",
            "from": row["from"],
            "played_to": [round(row["played"]["x"], 1), round(row["played"]["y"], 1)],
            "best_to": [round(row["best"]["x"], 1), round(row["best"]["y"], 1)],
            "freeze": row.get("freeze", []),
            "missed": row["missed"],
            "frames": t["frames"],
            "detections": t.get("detections", 0),
            # Where the broadcast is actually on the pitch. A window is cut six
            # seconds before the pass and the director is sometimes still on a
            # close-up for the first few of them: Messi's opens on two shirts
            # filling the frame. The moment itself is always covered, so this
            # only moves the poster frame off the replay and onto the football.
            "pitch_from": round(min((f["t"] for f in t["frames"]), default=0.0), 1),
            # Same rule the roster files players under, so the two join.
            "surname": surname,
        })
        rows.append(f)
        print(f"    {len(t['frames'])} frames, {t.get('detections', 0)} detections")

    for i, r in enumerate(rows):
        r["id"] = 1000 + i

    dest = workspace.snapshot_dir() / "player-clips.json"
    dest.write_text(json.dumps({"team": WS.team, "clips": rows}))
    print(f"\n{len(rows)} player clips -> {dest}")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--squad", action="store_true", help="build the per-player clips")
    args = ap.parse_args()
    if args.squad:
        build_squad()
        return

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
    # Namespaced by workspace: two teams used to write this same file.
    dest = workspace.snapshot_dir() / "clip-moments.json"
    dest.write_text(json.dumps(payload))
    print(f"\n{len(moments)} moments with footage -> {dest}")


if __name__ == "__main__":
    main()
