# Hack Hydra submission

Track 03, Memory and context retrieval. Due **August 20, 11:59 PM PT**.

Draft answers for the form, and a plan for the video. Numbers here are live as
of the last ingest; re-check them against `/api/health` before submitting rather
than trusting this file.

---

## Form answers

### Project name

Pep Talk

### Short project description

A temporal memory layer for AI agents, built on HydraDB, demonstrated as an
assistant coach that goes through match tape with you and remembers every
conversation you have had about it.

### Problem being addressed

An agent that cannot remember is a stranger every morning, and the usual fix
makes it worse. Stuffing the history into the context window is where long
context models lose accuracy, and a vector store cannot represent the one thing
that matters most about a memory: that it stopped being true.

"They press high" is not a fact, it is a fact with dates on it. A nearest
neighbour lookup has nowhere to put those dates, so it averages the eras and
describes neither. Ask it about Barcelona and it blends 2011 with 2021 into a
team that never existed.

The second failure is worse because it is invisible. When the answer is not in
the history at all, a model will produce one anyway, fluently, and the person
reading it cannot tell the difference between a recalled fact and an invented
one.

### What you built

A memory layer where every fact carries the interval it was true for and an
edge to whatever replaced it, plus the product that proves it works.

The graph holds 2,096 dated facts across 353 sides and 3,961 matches, with 651
supersession edges and 17,533 citations back to the matches each claim was
observed in. Facts are not written by a language model: they are segmented out
of raw event data by quantile banding with hysteresis, so a single odd match
cannot flip a team's identity.

On top of it, an interface where a coach watches clips cut from the actual
broadcast and asks questions in plain language. Every answer cites the graph
node ids it was built from. The conversation is stored in the same graph on the
same clock, so a question on Friday can reach what was said on Tuesday without
replaying the transcript.

There is a memory switch. Turn it off and the fact queries stop running:
everything measured off the match in front of you still reaches the model, so
it still answers, but it has no norms, no dates and no peers, and it says so.
Same model, same question, same match. The difference on screen is the
difference the graph makes.

Five mechanical checks score the answers: grounded, cited, supported,
resolution, abstention. 16 of 16 on the current run. 26 unit tests feed each
check a planted violation and require it to catch, because an eval that passes
everything is indistinguishable from one that measures nothing.

### How the project uses the HydraDB Open Source Repo

HydraDB is the memory. Removing it does not degrade the product, it removes it.

**The data model.** Facts are nodes with `valid_from`, `valid_to`, `band` and
`median_value`, chained by `SUPERSEDED_BY` and evidenced by `OBSERVED_IN`. A
conversation is `(:Team)-[:HAS_SESSION]->(:Session)-[:HAS_TURN]->(:Turn)`, with
`NEXT` for order and `CITES` from a turn to the facts that answer was built
from. Football and conversation share one clock, so "you asked about pressing
last week" is a traversal rather than a string search.

**The queries that carry the product.** `fact_at(id, dim, date)` answers what
was true on a date. `timeline(id, dim)` answers when it changed and to what.
`flat_lookup(id, dim)` is the memory switch: the single most evidenced claim
with no validity window, which is what a store without dates would return.
Argentina and Barcelona come back identical on all five dimensions under it.

**What it cost us to learn.** The Cypher subset shaped the schema rather than
the other way round. `CREATE` takes relationship paths only, so every node is
born as one end of an edge. `UNWIND` cannot carry labels, so writes are one
statement per row. `IS NULL` is rejected, so an open interval uses an
`OPEN_ENDED` sentinel and every temporal predicate is `<=` or `>`. Nodes upsert
by id and relationships do not, which has a consequence worth stating: an
ingest that writes fewer rows than last time is not idempotent, and we measured
eight eras re-ingested as six leaving eight facts standing with the
supersession chain grown from seven edges to twelve. All of this is written up
in the README with the fixes.

### Tech stack used

HydraDB (Bolt, OpenCypher subset) · Python · FastAPI · Next.js · React ·
Tailwind · Motion · Claude · YOLO11m · scikit-learn · OpenCV · StatsBomb open
data

### Team members and individual contributions

To fill in. Kinjal Chatterjee contributed the add-a-game pipeline and found the
re-ingest write bug.

### Deployed project link

https://peptalk-steel.vercel.app

State plainly that the deployed build cannot answer questions, because
retrieval needs a HydraDB node and that runs locally. It says so itself rather
than falling back to something canned, which is the same honesty the rest of
the project is built on.

### GitHub repository link

https://github.com/SankrityaT/PepTalk

---

## The video, 3 minutes

Anything past three minutes may not be reviewed, so the last beat has to land by
2:50. Four things must appear: the problem, what was built, a demo of it
working, and how HydraDB was used and why it matters.

Record the product running locally with the graph up. Do not narrate the
architecture over a static diagram; the pipeline section of the landing page
exists for anyone who wants that.

| Time | On screen | Say |
|---|---|---|
| 0:00 | The session, tape playing, tracking on | "This is the World Cup final. Pep has already watched it and found the eight passes worth stopping on." |
| 0:20 | Advance a beat, clip swaps, pitch diagram draws | "Every clip is cut on the broadcast clock. The diagram is the ball he played against the ball that was on." |
| 0:40 | Ask about De Paul, answer streams with chips | "Ask it anything. Every number carries the graph node it came from." |
| 1:05 | **Flip memory off. Ask the same question.** | "Same model, same match. Memory off, and the fact queries do not run. It can still read the game. It has lost the history, and it says so." |
| 1:30 | Open the thread picker, start a new conversation | "This is a different session. Nothing in the browser carries over." |
| 1:45 | **Ask what we talked about. It recalls Tuesday and re-cites the ids.** | "The transcript was never sent. Twelve turns came back out of the graph, and the facts they cited are still reachable from them." |
| 2:05 | Open the earlier thread, show CITES chips | "A line written last Tuesday still reaches the fact it was written from, as it was then." |
| 2:20 | Terminal: the eval run, 16/16 | "Five checks. Twenty six tests plant violations so the checks cannot pass by measuring nothing." |
| 2:35 | The schema, briefly | "Facts with dates, an edge to what replaced them, and the conversation on the same clock. That is HydraDB doing the work a vector index cannot." |
| 2:50 | End | |

The 1:05 and 1:45 beats are the submission. Everything else is context for
them. If time is short, cut the tape walkthrough, not those.

---

## Before submitting

- [ ] Open the repo link, the deploy link and the video link yourself, signed
      out. Broken links are the commonest way to lose.
- [ ] Re-run `uv run pytest -q` and the evals; put the real numbers in the form
- [ ] Confirm the licence still reads as MIT on the GitHub sidebar
- [ ] `peptalk-ai.vercel.app` is a pinned alias and goes stale on every push.
      Submit `peptalk-steel.vercel.app`, which follows production, or promote
      the other to a project domain first.
- [ ] Team members and contributions filled in
