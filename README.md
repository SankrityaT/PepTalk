# Pep Talk

**An assistant coach that remembers.**

**Hack Hydra 2026 · Track 03, Memory + Context Retrieval**

A coach sits down with their match tape. Pep has already watched it, found the
moments worth stopping on, and can answer questions about any of them, grounded
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
| **StatsBomb open data** | 3,961 matches of events: every pass, carry and shot with x/y coordinates | free, public |
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

- **Facts.** Every number, date, norm, comparison and trend must come from that
  list and carry the id it came from. Quote figures exactly; no rounding, no
  arithmetic. Nothing it knows about these players from anywhere else exists.
- **Judgement.** What the facts mean, why it might be happening, and what to do
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
353 teams · 3,961 matches · 44 players
2,096 facts · 651 supersessions · 17,533 evidence edges
```

```
(:Team)-[:PLAYED]->(:Match)
(:Team)-[:FIELDED]->(:Player)
(:Team|:Player)-[:HAS_FACT]->(:Fact {valid_from, valid_to, band, median_value})
(:Fact)-[:OBSERVED_IN]->(:Match)      ← the evidence
(:Fact)-[:SUPERSEDED_BY]->(:Fact)     ← what replaced what
(:Team)-[:HAS_SESSION]->(:Session)-[:HAS_TURN]->(:Turn)
(:Turn)-[:NEXT]->(:Turn)              ← what was said, in order
(:Turn)-[:CITES]->(:Fact)             ← what the answer was built from
```

Three queries carry the product:

| Query | Question it answers |
|---|---|
| `fact_at(id, dim, date)` | What was true of them **on this date**? |
| `timeline(id, dim)` | **When** did it change, and to what? |
| `flat_lookup(id, dim)` | What would a store **without dates** have said? |

That last one is the memory switch. Turning memory off runs `flat_lookup`
instead: the single most-evidenced claim, with no validity window, which is what a
vector index would surface. Argentina and Barcelona come back identical on all
five dimensions.

### The conversation is memory too

The football facts are one half. The other is that a coach's questions and Pep's
answers live in the same graph, on the same clock, and this is the part that
makes it a memory layer rather than a retrieval demo.

Every exchange is written as two turns. Pep's carries `CITES` edges to the exact
`Fact` nodes it quoted. So a week later:

```
ask on Tuesday   →  "his final third entries are fine at 6.8 per 90 [4],
                     but threat left on the table is 0.65 [3]"
                    2 turns written, 6 CITES edges

ask on Friday    →  "We went over him on the 11th. The headline was that
   (new thread)      his final third entries are fine at 6.8 per 90 [4]"

memory off       →  "This is actually the first time we have spoken."
```

Three things are worth pulling out of that.

**The transcript is never sent.** A dozen prior turns come back from the graph
and the facts they cited stay reachable by traversal. That is the difference
between a memory layer and a long context window: the conversation can run for
thirty sessions and the prompt does not grow to match.

**Citations point at the facts as they were then.** A fact superseded next month
does not rewrite what Pep said today. The old turn still points at the old fact,
which is the honest record of what was believed at the time, and it is a
traversal rather than a diff.

**Abstention covers the conversation, not just the football.** With memory off
the recall query does not run, so Pep says he has never met you. That is a
consequence of retrieval not happening, not a line written for the occasion.

Conversations are listed and openable in the interface, so none of the above has
to be taken on trust.

### Does it work on a second team?

Everything above is Argentina, 22 matches. The same code, pointed at Barcelona,
which is 531 matches across fifty years and a competition with no footage
attached at all:

```bash
uv run python -m tacticbench.demo query Barcelona \
  --dimension possession_share_pct --at 2011-06-01 2021-03-01
```

```
--- timeline (each era, as HydraDB stores it) ---
  1974-02-17 -> 2004-12-21  low        (8 matches)
  2004-12-21 -> 2011-03-05  even       (163 matches)
  2011-03-05 -> 2012-01-08  dominant   (27 matches)
  2012-01-08 -> present     even       (333 matches)

--- point-in-time: same question, two dates ---
  2011-06-01: dominant  (valid 2011-03-05 -> 2012-01-08, 27 matches, median 67.0)
       cited: Barcelona 1-0 Real Zaragoza  [La Liga]
  2021-03-01: even      (valid 2012-01-08 -> present, 333 matches, median 63.0)
       cited: Espanyol 1-1 Barcelona  [La Liga]

--- WITHOUT HydraDB (flat lookup, no validity intervals) ---
  'even' - 333 matches, presented with no sense that it ever stopped being true
```

Nothing about that run is configured for Barcelona. It is the same segmentation,
the same banding, the same queries, given a different team's `PLAYED` edges.

Two things worth drawing out. The 27 match window it isolated on its own is
Guardiola's last season, and nobody told it about Guardiola: the input is
possession percentages with dates. And the last block is the argument for the
whole project, because a store without validity intervals has one answer to
give and it is the wrong one on both dates.

What does not carry across is the footage. Barcelona has no broadcast in this
repo, so there are no clips, no tracking and no chalk, and the interface's tape
would be empty. The memory layer generalises; the video half needs a video.

### Constraints we found by probing a live node

HydraDB v0.1.0 speaks a subset of OpenCypher. These shaped the code:

- `CREATE` accepts **relationship paths only**, so every node is born as one
  end of an edge.
- `UNWIND` batches **cannot carry labels**, so writes are one statement per row.
- `IS NULL` is rejected, so an open interval uses an `OPEN_ENDED` sentinel and
  every temporal predicate is `<=` / `>`.
- One statement per request; no multi-stage `WITH` pipelines.
- **Nodes upsert by id but relationships do not.** Found by running an ingest
  three times and getting six turns. `MERGE` on the path fixes it and `CREATE`
  does not, verified against a live node: three `MERGE`s of the same path leave
  one edge, three `CREATE`s leave three.

That last one has a consequence that took a while to see. Because nodes upsert
and edges do not, **an ingest that writes fewer rows than last time is not
idempotent**. Adding one match re-segments a team's whole history, since eras
come from quantiles over every observation, so a re-ingest can produce six eras
where there were eight. The six overwrite the low ids and the last two are
abandoned, still carrying the old validity intervals, still on the supersession
chain. Measured: eight eras re-ingested as six left eight facts standing and
grew the chain from seven edges to twelve, and `fact_at` then matched two facts
for one date and returned whichever the engine reached first.

The fix is to clear before writing, scoped **through the `HAS_FACT` edge** and
not by `f.team_id`. A player's fact carries `team_id` too, so the property alone
reaches 180 facts for Argentina where only 10 belong to the team; the other 170
are the squad's, and `ingest_team` does not write them back. Reachability is the
exact discriminator and id arithmetic is not: `team_id_for` returns up to 90,099
while player facts start at 700,000,000, so a team whose crc32 landed near
60,000 would have collided.

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
threat gap of 0.0085, under one percent of a goal. Telling a coach that a
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
homography, which does not converge for us (21% to 44% of players explained against
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
disappears is the norms, the dates and the peers, and it says so in its own
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
grounded 16/16 · cited 16/16 · supported 16/16
resolution 8/8 · abstention 8/8
```

Eight questions in both memory modes. `resolution` and `abstention` only apply
to one mode each, which is why their denominators are half.

**An eval that passes everything is indistinguishable from one that measures
nothing**, so 26 unit tests feed each check a planted violation and require it to
catch: an invented number, correct-but-forbidden arithmetic, a citation to
nothing, the wrong player, asserted habituality.

`grounded` compares numbers as strings on purpose. A model that computed "5.5
below the norm" from 57.18 and 51.67 has the arithmetic right and still fails,
because a coach cannot check a figure that appears in no fact.

```bash
TACTICBENCH_BACKEND=cli uv run python -m tacticbench.evals
```

---

## Running it

Nothing here is committed that can be rebuilt. `results/` and `.cache/` are
ignored, so a fresh clone starts from an empty graph and builds everything
below from StatsBomb's public data, which downloads itself on first use.

**1. Dependencies**

```bash
uv sync
pnpm install
```

**2. HydraDB, on `bolt://127.0.0.1:7687`**

```bash
mkdir -p hydradb-data/store
docker run --rm --user "$(id -u):$(id -g)" \
  -p 7687:7687 -p 8443:8443 -p 9090:9090 \
  -v "$PWD/hydradb-data:/data" \
  -e CLOUD_PROVIDER=local -e LOCAL_PATH=/data/store \
  -e GRAPH_NAMESPACE=default -e GRAPH_ID=default \
  -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 -e GRAPH_NODE_ID=node-0 \
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 \
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \
  -e GRAPH_DATA_CACHE_DIR=/data/cache \
  -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \
  -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 \
  ghcr.io/hydra-db/hydradb:latest
```

`LOCAL_PATH` has to exist first, and `--user` is required: the image runs as
UID 10001 and cannot otherwise write a host-owned bind mount.

**3. Build the graph.** In this order, because each step reads the last one's
output. The first two are the slow ones: the threat model fits over six million
actions and the series pass walks all 3,961 matches, so between them expect
somewhere around half an hour on a laptop, most of it the first download.

```bash
uv run python -m tacticbench.xt build             # the threat model
uv run python -m tacticbench.ingest_all series    # per-team match histories
uv run python -m tacticbench.ingest_all graph     # teams, matches, team facts
uv run python -m tacticbench.ingest_all enrich    # scorelines and halftime state
uv run python -m tacticbench.players              # player nodes and player facts
uv run python -m tacticbench.roster --matches campaign
uv run python -m tacticbench.scout                # the next fixture
```

Every one of those is idempotent. Running it twice leaves the graph in the
state it would be in had it run once, which is less obvious than it sounds and
is why `clear_team_facts` exists.

**4. Run it**

```bash
TACTICBENCH_BACKEND=cli uv run uvicorn tacticbench.api:app --port 8000
pnpm dev
```

`TACTICBENCH_BACKEND=cli` runs prompts through the Claude CLI, so no API key is
needed. Set `ANTHROPIC_API_KEY` and drop it to use the API instead.

The footage is the one thing that cannot be scripted. Broadcast clips are not
ours to redistribute, so `public/clips/` is ignored and the tape has to be
supplied locally; see **Making it your team** below for the workspace field
that points at it. Everything else on the interface works without it.

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
interface is derived from the data that workspace holds: "7 clips cut from this
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
