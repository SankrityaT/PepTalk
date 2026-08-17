# Pep Talk — an assistant coach that remembers

**Hack Hydra 2026 · Track 03, Memory + Context Retrieval**

A coach sits down with their match tape. Pep has already watched it, found the
moments worth stopping on, and can answer questions about any of them — grounded
in what this side and these players have actually done across every game it
holds.

The point of the whole thing is one sentence:

> A vector store thinks Barcelona 2011 and Barcelona 2021 are the same team.
> HydraDB doesn't.

Facts here are **dated**. They have a start, an end, and a chain saying what
replaced what. That is a shape a nearest-neighbour lookup cannot represent, and
it is the difference between "they press high" and "they pressed high until
March 2020, and here is what changed".

---

## What we did not expect

We gave it 531 Barcelona matches as raw event data. No managers, no seasons, no
football history. It found this on its own:

| Era | Possession | Matches |
|---|---|---|
| 1974 → 2004 | low, 55.9% | 8 |
| 2004 → 2011-03 | even, 61.7% | 163 |
| **2011-03-05 → 2012-01-08** | **dominant, 67.0%** | **27** |
| 2012-01 → present | even, 63.0% | 333 |

Nobody told it about Guardiola.

---

## The data

| Source | What it gives us | Note |
|---|---|---|
| **StatsBomb open data** | 3,961 matches of events — every pass, carry and shot with x/y coordinates | free, public |
| StatsBomb 360 | freeze frames: where all 22 players stood at an event | Euro 2020 onward only |
| StatsBomb lineups | player ids, shirt numbers, positions | |
| **Broadcast footage** | the 2022 World Cup final, cut into 7 clips | gitignored, never redistributed |
| **Wikimedia Commons** | 12 player photographs | CC BY-SA / CC BY, credited in `public/players/CREDITS.md` |

Everything measured comes from the first three. The footage is what you look at;
it is not where the numbers come from.

---

## The models

Five, and only one of them is a language model.

| Model | Ours? | What it does |
|---|---|---|
| **Expected threat (xT)** | ours | Scores every spot on the pitch. 16×12 grid, trained on **6,082,779 actions**. |
| **Pass completion** | ours | Logistic regression on pass distance and defenders in the lane: how likely is this ball to arrive? |
| **YOLO11m** | off the shelf | Finds players in a video frame. |
| **Kit clustering** | ours | k-means on shirt colour, per frame: which of the two teams is that? |
| **Claude Opus** | off the shelf | Writes the answers. Does no measurement. |

**xT × completion is the engine.** For every pass, compare what was played
against every option that was open: threat gained, weighted by the chance it
arrives. That is what "a better ball was on" means, in numbers.

### What Claude is and is not allowed to do

This is the part worth being precise about, because "AI football analysis" is
usually a model recalling what it knows about famous players.

Claude is given a **numbered list of retrieved facts and nothing else**. Then:

- **Facts** — every number, date, norm, comparison and trend must come from that
  list and carry the id it came from. Quote figures exactly; no rounding, no
  arithmetic. Nothing it knows about these players from anywhere else exists.
- **Judgement** — what the facts mean, why it might be happening, and what to do
  about it on the training pitch is *its job*. It is an assistant coach, not a
  database. Football reasoning about space, pressure and shape is welcome.

The line: **a fact is something a coach could check; judgement is something a
coach could disagree with.** Never dress one as the other.

Real output, memory on:

> Tell him his engine is not the problem. He is getting into the final third at
> 6.8 entries per 90 **[11]** and pressing relentlessly at 13.38 defensive
> actions per 90 **[13]**, so the effort and positioning are there. The issue is
> what happens when he arrives: his threat left on the table sits at 0.65 per 90
> **[10]**, tagged wasteful, higher than what he actually creates at 0.47
> **[9]** … I would show him those sequences, ask him to pick the simpler option
> one beat earlier.

Every bracket is a real HydraDB node id.

---

## How HydraDB is used

Object-store-native graph database, Cypher over Bolt. What we hold:

```
354 teams · 3,961 matches · 24 players
1,973 facts · 631 supersessions · 17,520 evidence edges
```

```
(:Team)-[:PLAYED]->(:Match)
(:Team)-[:FIELDED]->(:Player)
(:Team|:Player)-[:HAS_FACT]->(:Fact {valid_from, valid_to, band, median_value})
(:Fact)-[:OBSERVED_IN]->(:Match)      ← the evidence
(:Fact)-[:SUPERSEDED_BY]->(:Fact)     ← what replaced what
(:Session)-[:HAS_TURN]->(:Turn)-[:CITES]->(:Fact)
```

Three queries carry the product:

| Query | Question it answers |
|---|---|
| `fact_at(id, dim, date)` | What was true of them **on this date**? |
| `timeline(id, dim)` | **When** did it change, and to what? |
| `flat_lookup(id, dim)` | What would a store **without dates** have said? |

That last one is the memory switch. Turning memory off runs `flat_lookup`
instead — the single most-evidenced claim, no validity window — which is what a
vector index would surface. Argentina and Barcelona come back identical on all
five dimensions.

### Constraints we found by probing a live node

HydraDB v0.1.0 speaks a subset of OpenCypher. These shaped the code:

- `CREATE` accepts **relationship paths only** — every node is born as one end
  of an edge.
- `UNWIND` batches **cannot carry labels**, so writes are one statement per row.
- `IS NULL` is rejected — an open interval uses an `OPEN_ENDED` sentinel and
  every temporal predicate is `<=` / `>`.
- One statement per request; no multi-stage `WITH` pipelines.
- **Nodes upsert by id but relationships do not.** Found by running an ingest
  three times and getting six turns. Everything uses `MERGE`.

### The one gap we hit: the footage has nowhere to live

Adding a game is the feature that found this. A coach uploads a recording, the
engine flags the moments, and each one is cut and tracked — which leaves us
holding video. On this machine that is 157MB for two games, and a season of a
real club is tens of gigabytes.

HydraDB holds the *claims* about that footage exactly as it should. A
`Highlight` carries its kind, its minute, its label and a `clip_url`, and it
hangs off the `Match` it belongs to. What it cannot hold is the bytes the URL
points at. So today the graph is authoritative about what happened and a
directory on disk is authoritative about the video, and nothing keeps the two
honest with each other: delete a clip and the node still points at it, move the
checkout and every path breaks.

**What would fix it.** An S3-compatible object store — MinIO is the obvious
one — with the graph holding a content-addressed key instead of a filesystem
path. Upload the clip, put its digest on the `Highlight`, and the pointer stops
being a guess about where a file happens to sit. That is roughly a day of work
and we know how to do it.

**We did not do it, deliberately.** This is a HydraDB project, and bolting a
second datastore onto it to solve a storage problem would make the interesting
part — the temporal graph — share the stage with plumbing. The whole argument
here is that `SUPERSEDED_BY` expresses something no other store can, and we
would rather demonstrate that against one database than hedge across two.

**And we think HydraDB should own this.** A memory graph for anything richer
than text will keep running into the same wall: the facts are small and
relational, the evidence behind them is large and binary, and splitting them
across two systems costs you referential integrity at exactly the moment you
want to trust a citation. A blob field, or a first-class content-addressed
attachment that a node can point at and the database can garbage-collect, would
close it. We would be glad to help build that — the use case is sitting in this
repo, with the file sizes measured and the failure mode written down.

---

## The flows

### 1. Finding the moments

```
every pass  →  what was played vs every option that was open
            →  803 passes where something better existed
            →  materiality gate
            →  8 moments worth stopping the video for
```

The gate matters more than the engine. Without it the median flagged pass has a
threat gap of 0.0085 — under one percent of a goal. Telling a coach that a
sideways ball "should have been played forward" at that magnitude is noise
dressed as insight, and it is wrong about football besides: circulating the ball
is how you move an opponent. **A moment must be a ball that would have made a
real chance.**

### 2. Getting the video to the right second

Broadcast footage does not start when the match does, and breaks are not on the
match clock. So we read the clock off the overlay and measure one offset per
period:

```
period 1  +96s      period 2  +599s      period 4  +1316s
```

Video time → match time. That single measurement is what turned pitch diagrams
into real footage.

### 3. Getting data out of the footage

```
frame  →  YOLO11m finds players  →  k-means on kit colour splits the teams
       →  defensive line, movement arrows, in-space circle drawn from box
          positions alone
```

**What we cannot do: say which box is which player.** That needs a pitch-to-image
homography, which does not converge for us (21–44% of players explained against
a 45% bar). So no name is ever drawn on a box.

Which means the honest description of this system is:

> **Numbers come from event data. Pictures come from the video. The two are
> joined by the clock, not by the pixels.**

### 4. Answering a question

```
question
  → resolve who it is about (longest name match; this squad has three Martínez)
  → pull their dated facts, and the team's, from HydraDB
  → number them
  → Claude sees the list and nothing else
  → answer, with a node id on every claim
```

Memory off skips the fact queries entirely. Everything measured off the match in
front of it still reaches the model, because none of that needed a graph. What
disappears is the norms, the dates and the peers — and it says so in its own
words:

> I can tell you the pressing height sat at 51.67 **[4]**, but I have no
> baseline in front of me, so I honestly cannot say whether that is higher or
> lower than usual.

---

## Are the answers actually right?

Reading a few and being pleased is not verification. Five mechanical checks, run
over eight questions in both memory modes:

| Check | What it catches |
|---|---|
| `grounded` | a number in the answer that appears in no retrieved fact |
| `cited` | a sentence with a number and no id |
| `supported` | a citation to an id that was never retrieved |
| `resolution` | the wrong player being pulled |
| `abstention` | history claimed with memory off |

```
grounded 32/32 · cited 32/32 · supported 32/32
resolution 16/16 · abstention 16/16
```

**An eval that passes everything is indistinguishable from one that measures
nothing**, so 22 unit tests feed each check a planted violation and require it to
catch: an invented number, correct-but-forbidden arithmetic, a citation to
nothing, the wrong player, asserted habituality.

`grounded` compares numbers as strings on purpose. A model that computed "5.5
below the norm" from 57.18 and 51.67 has the arithmetic right and still fails,
because a coach cannot check a figure that appears in no fact.

```bash
TACTICBENCH_BACKEND=cli uv run python -m tacticbench.evals --repeats 3
```

---

## Setup

```bash
# 1. HydraDB
mkdir -p hydradb-data/store hydradb-data/cache
printf '%s\n' 'local-development-token-32-bytes' > hydradb-data/auth-token
docker run -d --name hydradb --user "$(id -u):$(id -g)" \
  -p 7687:7687 -p 8443:8443 -p 9090:9090 -v "$PWD/hydradb-data:/data" \
  -e CLOUD_PROVIDER=local -e LOCAL_PATH=/data/store \
  -e GRAPH_NAMESPACE=default -e GRAPH_ID=default \
  -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 -e GRAPH_NODE_ID=node-0 \
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=0.0.0.0:7687 \
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \
  -e GRAPH_DATA_CACHE_DIR=/data/cache -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \
  -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 \
  ghcr.io/hydra-db/hydradb:latest

# 2. Python
uv venv && uv pip install -e ".[dev]"
uv run pytest                      # 217 tests

# 3. Data -> graph  (downloads ~12GB of StatsBomb events, cached locally)
uv run python -u -m tacticbench.scan 1          # scan all matches
uv run python -u -m tacticbench.ingest_all series
uv run python -u -m tacticbench.ingest_all graph
uv run python -u -m tacticbench.ingest_all enrich

# 4. API
uv run uvicorn tacticbench.api:app --port 8000
```

Try it:

```bash
uv run python -m tacticbench.demo query "Barcelona" \
  --dimension possession_share_pct --at 2011-06-01 2018-06-01
```


### The interface

```bash
pnpm install
uv pip install yt-dlp
uv run python -m tacticbench.bootstrap   # cuts and tracks the footage
pnpm dev            # landing page on /, the coach's dashboard on /dashboard
```

### Adding a game

A coach drops in a recording, names the fixture, lines the clock up, and gets a
report. That needs the analysis service running alongside the interface:

```bash
uv run uvicorn tacticbench.api:app --port 8000   # in one terminal
pnpm dev                                          # in another
```

Then **Add a game** on `/dashboard`. Four screens: the video, which fixture it
is, two clock readings to align it, and the run. Every step in the progress
list is the pipeline's own, reported as it happens.

The game becomes the app. Adding one writes its own workspace, points the
interface at it, and the dashboard, the tape and the memory cards are all that
team from then on — including across restarts, so a coach never has to know a
workspace exists. The built-in World Cup match is only what a fresh clone opens
on before anything has been added.

To check the whole path without clicking through it:

```bash
./scripts/check-add-a-game.sh   # 19 checks, ~3 min, needs HydraDB up
```

It runs a real MLS fixture end to end, confirms a match whose 360 feed does not
join is refused rather than returning an empty report, re-adds the same game to
prove facts are replaced rather than duplicated, and checks the Barcelona result
still holds.

**The video is not the detector, and the interface says so.** Moments come from
StatsBomb 360 freeze frames — where all twenty-two players stood when the ball
was struck — because that is what turns "he was open" into something showable.
The footage is cut afterwards, at the seconds the engine flagged. So the
fixture has to be one StatsBomb covers with 360; the picker offers only those,
and a match without freeze frames is refused up front rather than producing an
empty report. Detecting moments from pixels needs the pitch-to-image
calibration that `calibrate.py` does not yet converge on.

Everything a run produces lands in `workspaces/<key>/`, so adding a game never
touches the committed snapshots a fresh clone renders from. The same work is
available headless:

```bash
PEPTALK_WORKSPACE=<key> uv run python -m tacticbench.bootstrap
```

**Pointing this at another team** is a JSON file, not a patch:
`docs/NEW-WORKSPACE.md`. Nothing is hardcoded to the World Cup; pick a
competition with StatsBomb 360 data, write `workspaces/<key>/workspace.json`,
and run `PEPTALK_WORKSPACE=<key> uv run python -m tacticbench.bootstrap`.

**The repository ships no video.** Broadcast footage is not ours to
redistribute, so `public/clips` and `public/tape` are gitignored and a fresh
clone renders the dashboard with empty players. `bootstrap` rebuilds them from
two public sources: a full match recording and StatsBomb open data. It takes a
few minutes and needs no credentials.

Alignment between video time and match time is read, not guessed. The
broadcast carries a clock in its overlay, so reading it at two known points
gives one offset per period, `+96s` for the first half and `+599s` for the
second, the 503s between them being the half time break. Every cut is checked
afterwards by reading its clock back off the first frame. Extra time has a
second break before it, so that offset does not carry and extra-time moments
are deliberately not cut: better no clip than the wrong passage.

The dashboard opens as a brief rather than a set of tiles: Pep says what he
went through, shows the clips, and asks whether to walk you through the
moments one at a time. The footage on those walkthroughs is cut from a full
match recording, aligned by reading the broadcast clock out of the overlay,
and tracked in its own right, so the boxes and chalk on screen are computed
from the frame rather than drawn over it.

Snapshots under `src/content/snapshots/` are committed so the interface loads
without the graph running. Every one of them is generated output, and the
module that reads it says which command produced it.

---

## Layout

```
src/tacticbench/
  data.py         fetch + cache StatsBomb open data
  scan.py         halftime-deficit detection, treatment/control labelling
  state.py        tactical state from event data
  temporal.py     eras: hysteresis, banding, validity intervals
  graph.py        HydraDB ingest and retrieval
  coach.py        retrieved memory -> cited halftime recommendation
  api.py          HTTP API
  ingest_all.py   full-dataset ingest
  anonymize.py    allowlist redaction + mechanical leak detection
  runner.py       blind-test canary and model calls
  score.py        mechanical scoring of recommendation vs actual
  provenance.py   verifiable source table
  pass_options.py what else was on, and the materiality bar
  xt.py           expected threat, trained on 3,961 matches
  pep.py          computed moments -> what a coach would say
  conceded.py     how the goals went in
  cv.py           player detection over video, calibrated path
  cv_video.py     player detection over arbitrary broadcast clips
  fetch_clips.py  cut the real seconds out of a full match
  build_clips.py  track those cuts and join them to their moments
  calibrate.py    pitch-to-image homography (does not converge yet)
  verify.py       end-to-end checks, exits non-zero

src/
  app/            landing page and /dashboard
  components/     brief, shell, tape, chalk
  content/        typed accessors over the committed snapshots
  lib/            chalk marks and hand-drawn primitives
```

---

## Running it

```bash
# 1. HydraDB on bolt://127.0.0.1:7687
# 2. the graph
uv run python -m tacticbench.ingest_all        # teams, matches, team facts
uv run python -m tacticbench.players           # player nodes and player facts
uv run python -m tacticbench.roster --matches campaign
uv run python -m tacticbench.scout             # the next fixture

# 3. the service that answers questions
TACTICBENCH_BACKEND=cli uv run uvicorn tacticbench.api:app --port 8000

# 4. the interface
pnpm dev
```

`TACTICBENCH_BACKEND=cli` runs prompts through the Claude CLI, so no API key is
needed. Set `ANTHROPIC_API_KEY` and drop it to use the API instead.

**The deployed build cannot answer questions.** Retrieval needs HydraDB and that
runs locally. It says so rather than falling back to something canned.

---

## Making it your team

Nothing above is hardcoded to Argentina. A workspace is one file:

```python
Workspace(
    key="your-team", team="Your Team", match_id=...,
    competition="...", season="...",
    video_id="...", period_offset={1: 96.0, 2: 599.0},
)
```

Select it with `PEPTALK_WORKSPACE=your-team`. Every menu, count and label in the
interface is derived from the data that workspace holds — "7 clips cut from this
game", "531 of theirs in the graph", the squad list, the commands. A second
workspace gets its own by having different data, not by editing components.

---

## What is not solved

Stated plainly, because a demo that hides its edges is worth less than one that
does not.

- **Player identity in video.** Homography does not converge, so a box is never
  named. Everything player-level comes from event data.
- **Footage coverage.** 7 clips cut; of the 12 Argentina cards, 2 have video.
  The rest fall back to the freeze frame, which is real but not moving.
- **Rejected CV experiments.** Kit clustering in RGB failed under floodlights;
  the lighting-invariant colour space is what shipped.
- **Deployment.** The graph is local, so the hosted build is the interface
  without the answers.

---

## Attribution

Data provided by [StatsBomb](https://statsbomb.com/what-we-do/hub/free-data/).
Used under the StatsBomb Public Data User Agreement: not redistributed, and not
used commercially.

<p align="center">
  <img src="https://raw.githubusercontent.com/statsbomb/open-data/master/img/SB%20-%20Icon%20Lockup%20-%20Colour%20positive.png" width="220" alt="StatsBomb">
</p>

Player photographs from Wikimedia Commons under CC BY-SA 4.0 and CC BY 4.0,
credited per player in `public/players/CREDITS.md`.
