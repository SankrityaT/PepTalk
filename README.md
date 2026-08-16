# Tactical Memory — an assistant coach with a sense of time

**Hack Hydra 2026 · Track 03 — Memory + Context Retrieval**

A football team is not a fixed thing. "They press high" was true of a side in
March and false in August. A vector store retrieves what is *similar*; it cannot
tell you a fact has **expired**.

> A vector store thinks Barcelona 2011 and Barcelona 2021 are the same team.
> HydraDB doesn't.

This is an assistant coach built on a HydraDB temporal memory graph. It stores
tactical claims as **dated facts** with validity windows and an explicit chain of
overwrites, so asking *"what kind of team is this?"* returns a different — and
correct — answer depending on **when** you ask.

---

## The result we did not expect

We fed it 531 Barcelona matches (1974–2021) as raw event data. No managers, no
seasons, no football history. It found this on its own:

| Era | Possession | Matches |
|---|---|---|
| 1974 → 2004 | low, 55.9% | 8 |
| 2004 → 2011-03 | even, 61.7% | 163 |
| **2011-03-05 → 2012-01-08** | **dominant, 67.0%** | **27** |
| 2012-01 → present | even, 63.0% | 333 |

That isolated 10-month window is Guardiola's peak — it contains the 2011
Champions League final side. The system was never told any of that.

**What a system without temporal memory returns for the same question:**
`"Barcelona: even, 63%, 333 matches"` — a single flat answer that averages the
best club team ever into unremarkability. That comparison is built into the
product as a toggle, not a slide.

### Two levels, and the gap between them

The graph stores what was *normal* (Fact) and what actually *happened* (Match).
The gap is the insight:

> **Barcelona 3-1 Manchester United — Champions League final, Wembley, 2011**
> Normal for that era: **67.0%** possession. That night: **63.7%**, down 3.3.
> Pressed lower, played narrower. Won on 22 shots and 1.93 xG.

They did not need their signature numbers to win the final. That sentence is
only expressible because both levels exist and the graph can traverse between
them.

---

## How HydraDB is used, and what breaks without it

HydraDB is the memory. Everything below is a Cypher query against a live node.

**Schema**

```
(:Team  {id, name})
(:Match {id, statsbomb_id, date, date_ord, competition, season, stage, label,
         ht_home, ht_away, ft_home, ft_away, ht_deficit, recovered,
         possession_share_pct, press_height, defensive_action_height,
         team_width, pass_forward_ratio, shots, xg, source})
(:Fact  {id, team_id, dimension, band, valid_from, valid_to,
         observations, median_value})
(:Highlight {id, kind, minute, label, clip_url, source})

(Team)-[:PLAYED]->(Match)
(Team)-[:HAS_FACT]->(Fact)
(Fact)-[:OBSERVED_IN]->(Match)
(Fact)-[:SUPERSEDED_BY]->(Fact)
(Match)-[:HAS_HIGHLIGHT]->(Highlight)
```

**`SUPERSEDED_BY` is the load-bearing edge.** It is a traversable chain of
overwrites — *this claim replaced that one, on this date*. A vector index cannot
represent it at all, and a relational schema can only fake it with self-joins
that get worse the longer the history.

**Point-in-time retrieval** — the query the whole product rests on:

```cypher
MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact)
WHERE f.dimension = $dim AND f.valid_from <= $at AND f.valid_to > $at
RETURN f.band, f.valid_from, f.valid_to, f.observations, f.median_value
```

**Without HydraDB** the project loses its entire thesis. You can still store
per-match numbers in any database and average them — that is exactly the
`flat_lookup()` baseline we ship as the "without" side of the comparison, and it
confidently reports that Barcelona have always been unremarkable. The temporal
graph is the difference between a statistics table and a memory.

### HydraDB Cypher constraints we found by probing a live node (v0.1.0)

Documented because they shaped the design and are not all obvious from the docs:

| Constraint | Consequence |
|---|---|
| `CREATE` accepts **relationship paths only** | A standalone node cannot be created. Every node is born as one end of an edge. |
| `CREATE` **upserts by id** | Verified: creating an existing id reuses the node and preserves properties. This is what makes two-level ingest possible. |
| `UNWIND` batches **cannot carry labels** | No bulk labelled writes; one statement per row. |
| `IS NULL` is **rejected** | An open interval cannot be `valid_to IS NULL`. We use a sentinel (`99999999`) so every temporal predicate is `<=` / `>`. |
| No `IN`, `CONTAINS`, `ENDS WITH` | Filtering uses `STARTS WITH` and boolean property comparisons only. |
| `WITH` is pass-through only | No multi-stage query pipelines; that logic lives in application code. |
| Anonymous nodes cannot carry labels | `MATCH (:Fact)-[r]->(:Fact)` is rejected; nodes must be named. |

---

## Not hardcoded — and here is how to check

Every match in StatsBomb's open dataset is ingested, and any of them can be
re-ingested live from the UI in about 120ms end to end, with each step timed:

```
POST /api/ingest/match/2302764
  80ms  resolve match
  18ms  fetch events from StatsBomb (4,648 events)
   6ms  derive tactical state
  18ms  write to HydraDB
   2ms  read back from HydraDB
```

Teams below the evidence floor **abstain** rather than guess — and that is not
one contrived example, it is a property of the dataset that appears wherever you
look.

---

## Tactical state from video

The same state, derived from broadcast footage instead of event data. Verified
on Premier League video (Burnley v Arsenal, 2015): 45 calibrated frames, 594
player observations, two teams separated by kit.

```
TEAM A: n=311  line_height=46.91  width=34.56
TEAM B: n=283  line_height=56.26  width=34.07
```

Pipeline: sample calibrated frames → reject non-football frames → YOLO11 person
detection → project feet through the inverted homography into pitch metres →
cluster torso colour into two kits → aggregate. Output lands in the graph as
`Match {source: 'cv'}`, in its own id range because SoccerNet games are not
StatsBomb games.

Three things that had to be got right, each found by rendering frames and
looking at them rather than by reasoning:

1. **The homography is pitch→image and must be inverted.** Un-inverted it
   yields coordinates in the tens of thousands.
2. **Broadcast footage is not all football.** At 10:00 in this match the frame
   is a league-logo wipe carrying high calibration confidence and eighteen
   phantom detections. Frames are now filtered on grass fraction.
3. **The dataset's precomputed MaskRCNN boxes do not align with this video** —
   drawn over frame 1000 every box sits down-and-right of its player. Three
   rounds of colour-sampling fixes failed against it because no sampling
   strategy recovers a box that is not on the player. Running YOLO on the frame
   we actually read removes the class of problem, and kit clustering went from
   91/9 with a grass-green centroid to 52/48 with the correct kits.

Vision dependencies are an optional extra (`pip install -e ".[cv]"`) so the core
install stays light.

## Correct abstention

Track 03's stated hard part is *"knowing when the answer simply isn't in the
history, and saying so instead of inventing one."* Three places it is
first-class here, not an error path:

1. **Team level** — below the evidence threshold the system returns
   `"Insufficient history: 4 observations, threshold is 6"` and never calls a
   model.
2. **Claim level** — the coach must cite a fact id for every recommendation.
   Citations are checked mechanically against the ids actually supplied, so a
   hallucinated citation is detected rather than trusted.
3. **Dimension level** — where the source data does not encode a change, we mark
   it `undetermined` and exclude it from scoring rather than guessing. See the
   shape-change limitation below.

---

## Setup

Requires Docker and Python 3.11+.

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
uv run pytest                      # 98 tests

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

## Honest limitations

- **CV team labels are unlabelled clusters.** K-means separates the two kits
  correctly (52/48, with centroids matching Arsenal's yellow and Burnley's
  claret) but cannot say *which* cluster is which team. Naming them is currently
  a hand assignment with a 50% chance of being backwards, and it needs grounding
  against known kit colours or defending direction.
- **CV runs offline, not live in-match.** It samples calibrated frames at a
  stride rather than processing every frame.
- **Shape changes are under-detected.** StatsBomb does not always log a period-2
  tactical shift even when the shape demonstrably changed — verified on match
  `2302764`, where neither the formation field nor per-event position labels
  reflect Liverpool's switch to three at the back at Istanbul. That dimension is
  marked `undetermined` and excluded from scoring rather than guessed at.
- **`pass_forward_ratio` eras are marginal.** Separations of ~0.02 are
  statistically detectable but probably not tactically meaningful. Per-dimension
  confidence scoring is the right fix and is not done.
- **Evidence edges are capped at 12 per fact.** The true observation count is
  stored on the fact; we simply do not write 2,655 citation edges to display
  five.
- **Event data, not tracking data.** Metrics are derived from event locations,
  which is a coarser signal than true tracking.

---

## Attribution

Match data is **StatsBomb Open Data**
(https://github.com/statsbomb/open-data), used under the StatsBomb Public Data
User Agreement, which permits analysis and research and permits conclusions to
be shared publicly. Per clause 1.4, analysis is accredited to StatsBomb.

<!-- StatsBomb brand logo required by clause 1.4 — add before submission -->

**No StatsBomb data is committed to this repository** (clause 1.2.1 prohibits
redistribution). The code downloads it at runtime into gitignored paths. The
agreement also prohibits commercial exploitation of the data or of analysis
derived from it — this is a research and hackathon project.

Built with **HydraDB** (https://github.com/hydra-db/hydradb), AGPL-3.0,
connected over the Bolt protocol.

Developed with AI coding assistance (Claude), as permitted by the Hack Hydra
rules.

Code in this repository is MIT licensed — see `LICENSE`.
