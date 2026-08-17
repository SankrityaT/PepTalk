"""One workspace: whose team this is, and where the footage comes from.

    uv run python -m tacticbench.workspace              # show the active one
    PEPTALK_WORKSPACE=isl uv run python -m tacticbench.bootstrap

Every pipeline in this repo was written against one match of one team, and the
ids for it leaked into eight modules. That is fine for proving a thing works
and useless for a second team, so the details now live in a config a workspace
owns and the code reads.

**What a new workspace needs.** Three things, and only the third is real work:

1. `team` and `match_id`, both from StatsBomb open data.
2. `video_id` or `video_path`, a recording of that match — a YouTube id, or a
   file already on disk. An upload produces the second.
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

    #: A recording of the match. Anything yt-dlp accepts.
    video_id: str = ""

    #: A recording of the match already on disk, as an absolute path. This is
    #: what an upload produces: a coach has the file, not a YouTube id. Set one
    #: or the other, never both — `source` decides which, and prefers this one
    #: because a local file is cheaper and cannot rot.
    video_path: str = ""

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

    def offset_for(self, minute: int) -> float | None:
        """Video offset for a match minute, or None if that period is unset."""
        period = 1 if minute < 45 else 2 if minute < 90 else 3 if minute < 105 else 4
        return self.period_offset.get(period)

    def video_time(self, minute: int, second: int) -> float | None:
        off = self.offset_for(minute)
        return None if off is None else minute * 60 + second + off

    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"

    @property
    def source(self) -> str:
        """Where the footage comes from: a local path, or a URL.

        Callers that cut frames or clips branch on this rather than reaching for
        `video_id` directly, so an uploaded file and a YouTube id travel the
        same path. A local file wins when both are set: it is already on disk.
        """
        return self.video_path or (self.url if self.video_id else "")

    @property
    def is_local(self) -> bool:
        return bool(self.video_path)

    @property
    def dir(self) -> Path:
        return WORKSPACES / self.key

    @property
    def snapshots(self) -> Path:
        """Where this workspace's generated snapshots land.

        Per workspace rather than the committed `src/content/snapshots/`, so
        adding a game never overwrites the one a fresh clone renders from.
        """
        return self.dir / "snapshots"


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
    # Read off the broadcast overlay: video 12:01 shows 10:25, video 1:02:01
    # shows 52:02. The 503s between the two offsets is the half time break.
    # Extra time has another break and was never measured, so 3 and 4 are
    # absent and extra-time moments are skipped rather than misplaced.
    period_offset={1: 96.0, 2: 599.0},
    tape_window=("00:22:00", "00:23:30"),
    goal_windows={"80:59": {"window": ["01:30:44", "01:31:06"], "goal_at": 13.5}},
    kits=("Argentina", "France"),
)


def main() -> None:
    ws = load()
    print(f"workspace: {ws.key}")
    print(f"  team        {ws.team}")
    print(f"  match       {ws.label}  (statsbomb {ws.match_id})")
    print(f"  competition {ws.competition} {ws.season}")
    print(f"  video       {ws.source or '(none)'}")
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
