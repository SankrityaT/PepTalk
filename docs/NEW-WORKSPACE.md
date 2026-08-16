# Standing up a new workspace

For whoever, or whatever, is pointing this at a second team. Read the whole
thing before starting; two of the notes below cost a day each to learn.

Nothing in the pipeline is hardcoded to the World Cup any more. A workspace is
a JSON file, and the code reads it:

```bash
uv run python -m tacticbench.workspace          # what is active
PEPTALK_WORKSPACE=mls23 uv run python -m tacticbench.bootstrap
```

---

## Pick a competition that has 360 data

This is the first decision and the one that constrains everything.

`pass_options` answers "what else was on", which is a claim about where every
teammate was standing when the ball was struck. That comes from **StatsBomb 360
freeze frames**. A competition without 360 can still be ingested, still build a
memory graph, still produce norms and deviations. It **cannot** produce moments,
which means no walkthrough, no attacking or defensive reads, no chalk.

At the time of writing, the open competitions with 360 are:

| Competition | Season | Why it might suit |
|---|---|---|
| Major League Soccer | 2023 | A real league, not elite, full season of fixtures |
| 1. Bundesliga | 2023/2024 | Elite, but a full season |
| Ligue 1 | 2021/22, 2022/23 | Elite, two seasons |
| La Liga | 2020/2021 | Elite |
| African Cup of Nations | 2023 | Sides that genuinely lack analysts |
| UEFA Women's Euro | 2022, 2025 | Women's football is badly under-served |
| Women's World Cup | 2023 | Same, with more matches |
| UEFA Euro | 2020, 2024 | Elite tournament |

Check for yourself rather than trusting this table:

```bash
uv run python -c "
import httpx
for c in httpx.get('https://raw.githubusercontent.com/statsbomb/open-data/master/data/competitions.json').json():
    if c.get('match_available_360'):
        print(c['country_name'], c['competition_name'], c['season_name'])
"
```

**There is no free event data for a genuinely lower-division team.** If the goal
is a fourth-tier side, you have video and nothing else, and that is the frontier
described at the bottom of this document, not a config change. To prove the
pipeline works end to end, pick from the table. MLS 2023 and the women's
competitions are the strongest "this coach has no analyst" stories that also
have the data.

---

## Write the workspace

```bash
mkdir -p workspaces/mls23
cp workspaces/wc2022/workspace.json workspaces/mls23/workspace.json
```

```jsonc
{
  "key": "mls23",
  "team": "Atlanta United",        // the bench you are writing from
  "label": "Atlanta United v Inter Miami",
  "match_id": 3894123,             // StatsBomb match id
  "competition": "Major League Soccer",
  "season": "2023",
  "video_id": "…",                 // a recording of THAT match
  "period_offset": { "1": 0, "2": 0 },   // see below. Do not guess these.
  "tape_window": ["00:22:00", "00:23:30"],
  "goal_windows": {},
  "kits": ["Atlanta United", "Inter Miami"]   // lighter kit first
}
```

`team` matters more than it looks. Half the flagged moments in any match belong
to the other side, and the interface reads them completely differently: yours
are chances missed, theirs are chances survived. Get it wrong and every
defensive moment is addressed to the wrong bench.

Find match ids with:

```bash
uv run python -m tacticbench.demo browse --competition "Major League Soccer"
```

---

## Find the period offsets

**The one step nobody can derive for you, and the one that ruins a demo
silently.** Get it wrong and every clip lands somewhere plausible and shows
the wrong passage, with nothing on screen to reveal it.

Do not compute it from kickoff. Read it off the broadcast clock:

```bash
uv run python -m tacticbench.find_offsets --video <id> --at 00:12:00 --at 01:02:00
```

That cuts a scoreboard frame at each timestamp. Open them, read the match
clock, and subtract:

```
offset = video_seconds_of_the_frame - match_seconds_on_the_clock
```

Worked example from the built-in workspace:

- video `00:12:00` (721s) showed `10:25` (625s) → first-half offset **96s**
- video `01:02:01` (3721s) showed `52:02` (3122s) → second-half offset **599s**

**Sample once inside each half.** The half time break is not on the match
clock, so the first-half offset is wrong in the second half by the length of
the break. The two offsets should differ by roughly 8 to 15 minutes; if they
do not, one reading is wrong.

Extra time needs a third offset for the same reason. If you leave periods 3 and
4 unset, extra-time moments are **skipped rather than misplaced**, which is
deliberate. A window minutes away from the play it claims to show is worse than
no window.

---

## Run it

```bash
uv pip install yt-dlp                       # once
PEPTALK_WORKSPACE=mls23 uv run python -m tacticbench.bootstrap
pnpm dev                                    # /dashboard
```

`bootstrap` cuts the tape window, cuts a clip per flagged moment, tracks each
one, and writes the snapshots the interface reads. Every cut is verified by
reading its clock back off the first frame, so a bad offset fails loudly here
rather than in the demo.

Then confirm nothing regressed:

```bash
uv run pytest -q                            # 156
uv run python -m tacticbench.verify         # exits non-zero on failure
```

---

## Five things that will bite you

Each of these was a real bug, and four of them looked like working code.

**1. Do not report every pass with a better option.** The engine finds 803 in
one match; the median has a threat gap of 0.0085, under one percent of a goal.
Telling a coach that a sideways ball in midfield was a mistake at that
magnitude is noise dressed as insight, and it is wrong about football:
circulating the ball is how a side moves a defence. `is_material()` requires
the option to have been a genuine chance (`best xT >= 0.10`) **and** the gap to
be worth saying (`>= 0.05`). That takes 803 to 8. If a new competition produces
hundreds of "moments", the bar is not being applied.

**2. Half the moments belong to the other team.** Six of the eight in the World
Cup final are France's. `side_of()` splits them and `defensive_line()` rewrites
the opposition ones. Reading them out as "you had this on" describes the wrong
team's game.

**3. The freeze frame is recorded from the actor's point of view.** `teammate`
means a teammate *of the player on the ball*. When you are analysing a goal you
conceded, that flag has to be inverted or the whole picture is the wrong way
round.

**4. Chalk on video does not need a homography.** The defensive line, movement
arrows and in-space circle are all computed in the tracker's own normalised box
space, straight off the detections. I spent a long time trying to project pitch
coordinates into the frame before noticing. Drawing the *pass* arrows on video
does need the projection, and that is unfinished.

**5. Kit clustering skews.** On one clip it reports twelve France shirts, which
is two more than a side can field. Never publish a per-side count as fact.
Detection counts are fine; team splits are not.

---

## What is unfinished

Told plainly so nobody rediscovers it the hard way.

**Pitch-to-image calibration.** `calibrate.py` fits a homography from freeze
frame players against tracked boxes using RANSAC under a camera prior. It
scores 21 to 44% against a 45% bar, so it does not converge and the module says
so rather than shipping a plausible-looking wrong answer. Two bugs are already
fixed in it and documented: scoring used to reward a degenerate fit that
scattered points (one put the passer at `-2160, -311` and scored 64%), and the
sanity check used to demand the whole pitch be inside the frame, which rejects
every correct fit because a camera zoomed into the box never shows a whole
pitch. The reliable fallback is manual: four pitch landmarks per clip, by eye.

**The video-only path.** For a team with footage and no event data, everything
downstream of tracking needs pitch coordinates, so calibration is the blocker
for that entire branch. This is the real product frontier and the thing worth
solving.

**Roster.** Needs stable identity across footage, meaning persistent track ids
rather than the per-frame detection running now. Ultralytics `model.track()`
gives them cheaply. The page is deliberately empty rather than showing invented
players.

**Extra time.** No offset measured, so those moments have no footage.

**Model-written copy.** `pep.py` needs `ANTHROPIC_API_KEY`. Without it the
interface falls back to lines computed from the same numbers, which is honest
but flatter. Set the key and re-run `tacticbench.pep`.
