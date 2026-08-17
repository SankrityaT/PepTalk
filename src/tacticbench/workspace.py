"""One workspace: whose team this is, and where the footage comes from.

    uv run python -m tacticbench.workspace              # show the active one
    PEPTALK_WORKSPACE=isl uv run python -m tacticbench.bootstrap

Every pipeline in this repo was written against one match of one team, and the
ids for it leaked into eight modules. That is fine for proving a thing works
and useless for a second team, so the details now live in a config a workspace
owns and the code reads.

**What a new workspace needs.** Three things, and only the third is real work:

1. `team` and `match_id`, both from StatsBomb open data.
2. `video_id`, a recording of that match.
3. `period_offset`, the seconds between video time and match time, one per
   period. This is the only piece nobody can derive for you.

**How to find the offsets, since it is the step people get wrong.** Do not
guess from kickoff. Take a frame from somewhere in the first half, read the
match clock off the broadcast overlay, and subtract:

    offset = video_seconds_of_that_frame - match_seconds_shown

Repeat inside the second half, because the half time break is not on the match
clock and the first-half offset will be wrong by the length of it. Extra time
needs a third, for the same reason. `verify_offsets` cuts a frame per period
and prints what it finds so a wrong number is caught before it silently
misaligns a whole demo.

**On competitions.** `pass_options` needs StatsBomb 360 freeze frames, because
"what else was on" is a claim about where every teammate stood. A competition
without 360 can still be ingested for the memory graph and the norms, but it
cannot produce moments. Check before committing to a league.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKSPACES = ROOT / "workspaces"

#: Which workspace to load. A directory name under `workspaces/`.
ENV_VAR = "PEPTALK_WORKSPACE"
DEFAULT = "wc2022"


@dataclass
class Workspace:
    """Everything that changes between one team's setup and another's."""

    #: Short slug; also the directory name.
    key: str

    #: The side whose bench this is. Everything is written from here: a moment
    #: belonging to the other team is a chance survived, not a chance missed.
    team: str

    #: Human label for the interface.
    label: str

    #: StatsBomb match to analyse.
    match_id: int

    #: Competition and season, for the graph and the brief's header.
    competition: str = ""
    season: str = ""

    #: A recording of the workspace match. Anything yt-dlp accepts.
    video_id: str = ""

    #: Recordings of the side's other matches, keyed by StatsBomb match id, as
    #: {"video_id": ..., "period_offset": {1: 96.0, 2: 599.0}}.
    #:
    #: One match is not enough to give a squad footage. Measured across the
    #: whole campaign, ten of twelve players have a moment worth stopping the
    #: video for; measured on the final alone, two do. The engine was never the
    #: limit, the tape was.
    sources: dict[int, dict] = field(default_factory=dict)

    #: Video seconds minus match seconds, per period. Read off the broadcast
    #: clock; see the module docstring. Periods with no entry are skipped
    #: rather than guessed.
    period_offset: dict[int, float] = field(default_factory=dict)

    #: A continuous passage to play on the Tape tab, as video timestamps.
    tape_window: tuple[str, str] | None = None

    #: Goals worth cutting, keyed by match clock, with where the ball crosses
    #: the line inside the resulting clip.
    goal_windows: dict[str, dict] = field(default_factory=dict)

    #: Lighter kit first. Used to colour the boxes and name the sides.
    kits: tuple[str, str] = ("", "")

    def offset_for(self, minute: int, match_id: int | None = None) -> float | None:
        """Video offset for a match minute, or None if that period is unset.

        Per match, because the break between halves differs every broadcast and
        an offset borrowed from another game lands the clip minutes away from
        the play it claims to show.
        """
        period = 1 if minute < 45 else 2 if minute < 90 else 3 if minute < 105 else 4
        offsets = self.offsets_for_match(match_id)
        return offsets.get(period)

    def offsets_for_match(self, match_id: int | None = None) -> dict[int, float]:
        if match_id is None or match_id == self.match_id:
            return self.period_offset
        src = self.sources.get(match_id) or {}
        return {int(k): float(v) for k, v in (src.get("period_offset") or {}).items()}

    def video_for_match(self, match_id: int | None = None) -> str:
        if match_id is None or match_id == self.match_id:
            return self.video_id
        return (self.sources.get(match_id) or {}).get("video_id", "")

    def has_footage(self, match_id: int) -> bool:
        """Whether a clip can be cut from this match at all."""
        return bool(self.video_for_match(match_id)) and bool(self.offsets_for_match(match_id))

    def video_time(self, minute: int, second: int) -> float | None:
        off = self.offset_for(minute)
        return None if off is None else minute * 60 + second + off

    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"

    @property
    def dir(self) -> Path:
        return WORKSPACES / self.key


def load(key: str | None = None) -> Workspace:
    """The active workspace.

    Falls back to the built-in one so a fresh clone runs without configuration,
    which is the difference between a demo somebody can try and a demo they
    have to be talked through.
    """
    key = key or os.environ.get(ENV_VAR) or DEFAULT
    path = WORKSPACES / key / "workspace.json"
    if not path.exists():
        if key == DEFAULT:
            return BUILT_IN
        raise SystemExit(
            f"No workspace at {path}.\n"
            f"  Available: {', '.join(available()) or '(none)'}\n"
            f"  Copy workspaces/{DEFAULT}/workspace.json and edit it."
        )
    raw = json.loads(path.read_text())
    raw["period_offset"] = {int(k): float(v) for k, v in raw.get("period_offset", {}).items()}
    # JSON keys are strings, and a match id that stays a string silently matches
    # nothing: every lookup misses and every clip is quietly skipped.
    raw["sources"] = {
        int(mid): {
            **src,
            "period_offset": {int(k): float(v) for k, v in (src.get("period_offset") or {}).items()},
        }
        for mid, src in (raw.get("sources") or {}).items()
    }
    if raw.get("tape_window"):
        raw["tape_window"] = tuple(raw["tape_window"])
    if raw.get("kits"):
        raw["kits"] = tuple(raw["kits"])
    return Workspace(**raw)


def available() -> list[str]:
    if not WORKSPACES.exists():
        return []
    return sorted(p.name for p in WORKSPACES.iterdir() if (p / "workspace.json").exists())


def save(ws: Workspace) -> Path:
    ws.dir.mkdir(parents=True, exist_ok=True)
    path = ws.dir / "workspace.json"
    d = asdict(ws)
    d["period_offset"] = {str(k): v for k, v in ws.period_offset.items()}
    path.write_text(json.dumps(d, indent=1))
    return path


#: The World Cup final. Kept in code so a fresh clone has something that runs.
BUILT_IN = Workspace(
    key="wc2022",
    team="Argentina",
    label="Argentina 3-3 France",
    match_id=3869685,
    competition="FIFA World Cup",
    season="2022",
    video_id="RgqKdplLIk4",
    # Read off the broadcast overlay, one probe per period: video 12:01 shows
    # 10:25, video 1:02:01 shows 52:02, video 2:20:01 shows 118:05. The gaps
    # between offsets are the breaks, which is why one number cannot cover the
    # whole match. Period 3 was never needed and is absent rather than guessed.
    period_offset={1: 96.0, 2: 599.0, 4: 1316.0},
    # The quarter-final, because one match does not give a squad footage.
    # Across the campaign ten of twelve players have a moment worth stopping
    # for; on the final alone, two do, and six of the ten have their best ball
    # in this game. Offsets read off this broadcast's own overlay: video 12:01
    # shows 09:26, video 1:15:01 shows 64:31, video 2:12:01 shows 106:38.
    # Nothing flagged falls in period 3, so it is absent rather than guessed.
    sources={
        3869321: {
            "video_id": "QIpZ1pad73w",
            "period_offset": {1: 155.0, 2: 630.0, 4: 1523.0},
        },
    },
    tape_window=("00:22:00", "00:23:30"),
    goal_windows={
        "79:24": {"window": ["01:29:00", "01:29:32"], "goal_at": 23.0},
        "80:59": {"window": ["01:30:44", "01:31:06"], "goal_at": 13.5},
        "117:05": {"window": ["02:18:36", "02:19:10"], "goal_at": 25.0},
    },
    kits=("Argentina", "France"),
)


def main() -> None:
    ws = load()
    print(f"workspace: {ws.key}")
    print(f"  team        {ws.team}")
    print(f"  match       {ws.label}  (statsbomb {ws.match_id})")
    print(f"  competition {ws.competition} {ws.season}")
    print(f"  video       {ws.url or '(none)'}")
    print(f"  offsets     {ws.period_offset or '(none set)'}")
    missing = [p for p in (1, 2) if p not in ws.period_offset]
    if missing:
        print(f"  ! no offset for period {missing}; those moments will be skipped")
    others = available()
    if others:
        print(f"\navailable: {', '.join(others)}")
    print(f"\nselect with {ENV_VAR}=<key>")


if __name__ == "__main__":
    main()


def snapshot_dir(key: str | None = None) -> Path:
    """Where this workspace's snapshots belong.

    Namespaced by key because they used not to be. Every workspace wrote the
    same twelve filenames, so a second one overwrote the first, and since the
    files are committed, every merge between two people collided on all twelve.
    The interface copies the selected directory to `snapshots/active`, which is
    generated and gitignored, so nothing shared is ever written by two hands.
    """
    ws = load(key)
    out = ROOT / "src" / "content" / "snapshots" / ws.key
    out.mkdir(parents=True, exist_ok=True)
    return out
