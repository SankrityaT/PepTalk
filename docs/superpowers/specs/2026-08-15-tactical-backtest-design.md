# Tactical Reasoning Backtest — Experiment Design

**Date:** 2026-08-15
**Status:** Design, not yet run
**Owner:** Sankritya Thakur

## Purpose

Answer one question before any other work happens:

> Can a reasoning model derive expert-level tactical interventions from match
> state alone, without knowing which match it is looking at?

This is the fatal risk in the product thesis. Every other layer — computer
vision, the state engine, the archive, the app — is worthless if this answer is
no. It is also the cheapest thing to test: free data, no CV pipeline, no
infrastructure. Weeks, not months.

## Why this first

The original plan spiked pitch homography first, because it is the hard part.
That was the wrong ordering. Homography is the *expensive* risk. This is the
*fatal* one. Test what kills the project, not what costs the most.

## Two claims, two experiments

These are routinely conflated. They are not the same, and they need separate
designs.

| | Sales claim | Scientific claim |
|---|---|---|
| Statement | "It matches what elite managers did" | "It improves win probability" |
| Test | Blind replication on known interventions | Recommendation quality vs outcome across many matches |
| Audience | Phoenix Rising, investors, hackathon judges | A workshop paper, O-1A criterion #6 |
| Failure mode | Data leakage | Survivorship bias |

Experiment A (below) tests the sales claim. Experiment B tests the scientific
one. Run A first — it is smaller and it gates B.

## Data

StatsBomb / Hudl open data (`github.com/statsbomb/open-data`), free, no NDA:

- ~15 UEFA Champions League finals with full event data, **including the 2005
  Istanbul final** (Liverpool 3-0 down at HT, won on penalties)
- All Messi La Liga matches for Barcelona
- World Cups, Euros, NWSL, FA WSL

Event data only — no tracking. That is a real limitation (see Open Questions),
but formations, event locations, and derived positional averages are enough to
describe tactical state at a useful resolution.

## The anonymization protocol

This is the part that determines whether the result is real or a party trick.
Every frontier model has read a thousand articles about Istanbul 2005. Ask it
"Liverpool are 3-0 down to Milan at halftime" and it recites *bring on Hamann,
switch to 3-5-2* from memory. That produces a beautiful demo built on nothing,
and the first sharp buyer who spots it destroys credibility permanently.

### Strip

- Team names, club identifiers, nationalities
- Player names — replace with role-position IDs (`LB`, `CM-1`, `CF-2`)
- Competition, round, season, date, venue
- Any free-text commentary or qualifier that names entities

### Keep

- Formation and shape at kickoff and at halftime
- Per-player average position, touch map, distance-weighted involvement
- Event locations and types with timestamps
- Scoreline and match clock
- Substitutions available (count and positions, not names)
- Derived tactical metrics: defensive line height, team width, compactness,
  vertical/horizontal pass ratio, build-up side bias, press intensity proxies

### Canary check — mandatory, runs before every trial

Ask the model, on the anonymized input: **"What match is this?"**

- If it names the match, competition, or either team → **anonymization failed,
  discard the trial**, tighten the protocol, re-run.
- Log the canary response for every single trial. A result without a passing
  canary is not a result.

Run the canary as a separate session from the recommendation prompt so the
canary attempt cannot prime the recommendation.

## Experiment A — blind replication

### Selection

**Treatment group:** matches where a team trailed by 2+ goals at halftime and
went on to draw or win.

**Control group:** matches where a team trailed by 2+ goals at halftime and did
*not* recover.

The control group is not optional. Without it, "the AI recommended an attacking
change and the team won" proves nothing — the same change was made in a hundred
matches that stayed lost. Selecting only on successful comebacks is survivorship
bias and any competent reviewer will say so immediately.

**Sample size is a known problem.** Two-goal halftime deficits are rare, and the
open dataset is small. Expect single digits in the treatment group. Mitigation:
relax to 1+ goal deficits, which enlarges n substantially at the cost of drama.
Decide the threshold *before* looking at results, and record it here when chosen.

### Procedure

For each match, in a fresh session with no history:

1. Feed anonymized first-half state.
2. Run the canary check. Abort the trial on failure.
3. Prompt: *"Team B trails. Recommend tactical interventions for the second
   half. Be specific about shape, personnel, pressing height, width, and
   tempo."*
4. Capture the recommendation as structured output, not prose.
5. Independently, extract what the trailing team **actually** changed in the
   second half from the event data.
6. Score alignment per dimension.

The model is blind to whether a match is treatment or control.

### Scoring

Structured per-dimension matching, **not** an LLM-as-judge vibe rating — a judge
model is contaminated by the same training data as the subject model.

Dimensions, each scored match / partial / no-match / contradicts:

- Shape change (formation delta)
- Personnel (positions substituted, timing)
- Pressing height (defensive line delta)
- Width (horizontal occupation delta)
- Tempo (directness, pass length delta)

## Pre-registered success criteria

**Fill these in before running anything.** Deciding what counts as success after
seeing results is how people fool themselves.

- Minimum canary pass rate to consider the run valid: `TBD`
- Alignment threshold that counts as "matched": `TBD`
- Required separation between treatment and control alignment rates: `TBD`

The last one is the real test. If the model recommends the same things in
matches that failed as in matches that succeeded, it has learned "attack when
losing" — which is not insight, it is a truism.

## Experiment B — win probability

Only run if A passes.

Widen to all matches with any halftime deficit. Generate a recommendation for
each. Measure whether alignment between recommendation and actual intervention
correlates with second-half outcome. This is the defensible, publishable claim
and the one that fills the empty O-1A criterion.

## Failure modes to design against

1. **Leakage** — handled by the canary. Existential if missed.
2. **Survivorship bias** — handled by the control group.
3. **Post-hoc narrative** — "what they actually did" is partly sportswriting.
   Hamann gets credited because Liverpool won; if they lose 5-0 nobody names
   that substitution. Mitigated by extracting the actual change from *event
   data*, never from match reports.
4. **Truism detection** — handled by treatment/control separation.

## Decision table

| Outcome | Meaning | Next |
|---|---|---|
| Canary fails repeatedly | Cannot test blind at this state resolution | Redesign representation before anything else |
| Alignment high, treatment ≈ control | Model produces truisms | Thesis weakened badly; reconsider |
| Alignment high, treatment > control | Real signal | Build perception layer; this is the demo |
| Alignment low | Reasoning layer insufficient today | Stop. Three weeks spent, not eight months |

## Not in scope

- Any computer vision
- Any app, UI, or infrastructure
- Player-vs-player matchup analysis
- Live/in-match inference

## Open questions

1. **Event data vs tracking.** Open data is event-only. Real product state will
   be tracking-derived and richer. A negative result here may reflect thin state
   rather than a weak reasoning layer — so a failure is not fully conclusive.
   Metrica (3 matches) and SkillCorner (19 matches) have open tracking; consider
   a small tracking-based arm as a check.
2. **Threshold choice** — 2+ goals is dramatic but tiny n; 1+ is testable but
   less compelling as a demo. Possibly run both, report both.
3. **Model choice** — run across at least two frontier models. If results differ
   sharply, that itself is a finding.
