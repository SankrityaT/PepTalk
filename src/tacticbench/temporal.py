"""Turn a team's per-match metrics into dated tactical facts.

This is the heart of the memory model. A team's tactical identity is not a
constant — "they press high" is true of a side in one season and false two years
later. We model each claim as an interval with an explicit start and end, and
chain consecutive claims with a supersede link.

Two design decisions matter:

**Hysteresis.** A single odd match must not flip a team's identity. Raw metrics
are smoothed with a rolling median before bucketing, and a new band has to
persist for `min_run` matches before it opens a new fact. Without this the graph
churns and every fact lasts one match, which is noise, not memory.

**A sentinel, not null.** HydraDB's Cypher subset rejects `IS NULL`, so an open
interval cannot be expressed as `valid_to IS NULL`. Open facts carry
`valid_to = OPEN_ENDED` and every temporal query uses `<=` and `>`, both of
which are supported.
"""

from __future__ import annotations

import statistics as st
from dataclasses import dataclass, field

OPEN_ENDED = 99_999_999


@dataclass(frozen=True)
class Observation:
    """One match's value for one metric."""

    match_id: int
    date_ord: int
    value: float


@dataclass
class Fact:
    """A tactical claim that was true over a date range."""

    dimension: str
    band: str
    valid_from: int
    valid_to: int
    observations: int
    match_ids: list[int] = field(default_factory=list)
    median_value: float | None = None

    @property
    def is_open(self) -> bool:
        return self.valid_to == OPEN_ENDED


def rolling_median(values: list[float], window: int) -> list[float]:
    """Trailing rolling median, using whatever history exists at the start."""
    if window < 1:
        raise ValueError("window must be >= 1")
    out = []
    for i in range(len(values)):
        lo = max(0, i - window + 1)
        out.append(st.median(values[lo : i + 1]))
    return out


def quantile_thresholds(values: list[float], lower: float = 0.25, upper: float = 0.75) -> tuple[float, float]:
    """Data-driven band edges, so bucketing is not a guess.

    Quartiles rather than terciles, deliberately. Tercile edges land in the
    dense middle of the distribution, so a team hovering near a boundary flips
    band on ordinary match-to-match noise. Pushing the edges out to the
    quartiles puts them where the data is sparse, and the middle band becomes a
    genuine "unremarkable" state instead of a coin flip.
    """
    if not values:
        raise ValueError("no values")
    s = sorted(values)

    def at(q: float) -> float:
        idx = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
        return s[idx]

    return at(lower), at(upper)


def bucket(value: float, edges: tuple[float, float], names: tuple[str, str, str]) -> str:
    low, high = edges
    if value <= low:
        return names[0]
    if value >= high:
        return names[2]
    return names[1]


def build_facts(
    observations: list[Observation],
    dimension: str,
    edges: tuple[float, float],
    names: tuple[str, str, str],
    window: int = 15,
    min_run: int = 8,
) -> list[Fact]:
    """Collapse a chronological metric series into dated facts.

    A band change only opens a new fact once it has persisted for `min_run`
    consecutive matches, which is what stops one outlier from rewriting history.

    Defaults were tuned against Barcelona's real 531-match series, not guessed.
    The original (window=5, min_run=3) produced 54 "eras" across 18 years —
    roughly one per ten matches, which is churn rather than memory. At
    (15, 8) the same series resolves to four eras, and that result is stable at
    windows of 15, 25 and 35, which is the sign it is tracking real structure
    rather than a fitted parameter.
    """
    if not observations:
        return []

    obs = sorted(observations, key=lambda o: (o.date_ord, o.match_id))
    smoothed = rolling_median([o.value for o in obs], window)
    bands = [bucket(v, edges, names) for v in smoothed]

    facts: list[Fact] = []
    current_band = bands[0]
    run_band: str | None = None
    run_len = 0
    start_idx = 0

    def close(end_idx: int, end_date: int) -> None:
        span = obs[start_idx:end_idx]
        if not span:
            return
        facts.append(
            Fact(
                dimension=dimension,
                band=current_band,
                valid_from=obs[start_idx].date_ord,
                valid_to=end_date,
                observations=len(span),
                match_ids=[o.match_id for o in span],
                median_value=round(st.median([o.value for o in span]), 2),
            )
        )

    for i, band in enumerate(bands):
        if band == current_band:
            run_band, run_len = None, 0
            continue
        if band == run_band:
            run_len += 1
        else:
            run_band, run_len = band, 1

        if run_len >= min_run:
            change_idx = i - min_run + 1
            close(change_idx, obs[change_idx].date_ord)
            current_band = band
            start_idx = change_idx
            run_band, run_len = None, 0

    close(len(obs), OPEN_ENDED)
    return facts


def merge_insignificant(facts: list[Fact], spread: float, min_separation: float = 0.35) -> list[Fact]:
    """Collapse adjacent eras whose medians are not meaningfully different.

    Quantile bands know the shape of a distribution but not whether the gap
    between two bands is *worth calling a change*. For a metric with a wide
    range that is fine. For a tight one — Barcelona's directness sits between
    0.58 and 0.64 — the quartile edges land close enough together that ordinary
    match noise crosses them repeatedly, and the timeline fragments.

    So after building, adjacent eras separated by less than `min_separation` of
    the metric's own interquartile spread are merged into whichever had more
    evidence. The surviving era keeps the full date range, so the timeline stays
    contiguous.

    Runs to a fixed point. Merging picks the surviving band by evidence, which
    can leave two same-band eras adjacent — and two consecutive eras carrying
    the same band is not a change at all, just an artefact of the boundary the
    merge itself dissolved. Those are always collapsed, regardless of spread.
    """
    if len(facts) < 2:
        return facts

    threshold = min_separation * spread if spread > 0 else 0.0

    while True:
        merged = [facts[0]]
        for nxt in facts[1:]:
            cur = merged[-1]
            a, b = cur.median_value, nxt.median_value

            same_band = cur.band == nxt.band
            close = (
                a is not None and b is not None and threshold > 0 and abs(a - b) < threshold
            )
            if not (same_band or close):
                merged.append(nxt)
                continue

            keep_band = cur.band if cur.observations >= nxt.observations else nxt.band
            total = cur.observations + nxt.observations
            if a is None or b is None:
                weighted = a if a is not None else b
            else:
                weighted = (a * cur.observations + b * nxt.observations) / total if total else a
            merged[-1] = Fact(
                dimension=cur.dimension,
                band=keep_band,
                valid_from=cur.valid_from,
                valid_to=nxt.valid_to,
                observations=total,
                match_ids=cur.match_ids + nxt.match_ids,
                median_value=round(weighted, 2) if weighted is not None else None,
            )

        if len(merged) == len(facts):
            return merged
        facts = merged


def era_confidence(facts: list[Fact], values: list[float]) -> dict:
    """How much a dimension's era structure is worth believing.

    Era detection will always find *something*: given enough matches, a
    threshold crossing is inevitable. What it cannot tell you is whether the
    gap between two eras is large relative to ordinary match-to-match noise.
    Barcelona's directness splits into eras separated by about 0.02 while the
    raw series has a standard deviation several times that — statistically
    detectable, tactically meaningless.

    Confidence is the mean absolute step between adjacent era medians, divided
    by the spread of the underlying observations. Above ~0.5 the eras are as
    large as the noise; below ~0.25 they are not.

    What this measures, and what it does not
    ----------------------------------------
    This is **statistical robustness only**. Measured on Barcelona, every
    dimension scores 0.69-0.93 — including `pass_forward_ratio`, whose eras are
    separated by 0.024. That is a real result: 0.024 genuinely is large relative
    to that metric's own noise, and the ratio is scale-free so it cannot say
    otherwise.

    But the original worry about `pass_forward_ratio` was never statistical. A
    0.024 shift in forward-pass ratio is not *tactically interesting*, however
    robust it is. That is practical significance, it needs a per-dimension
    domain threshold nobody has set, and this function deliberately does not
    pretend to answer it.

    So callers get both: `confidence` for "is this era structure real", and
    `separation` in the dimension's own units for "is it worth mentioning".
    Possession separates by 5.03 percentage points; directness by 0.024. Those
    are the numbers a human should judge.
    """
    if len(facts) < 2:
        return {"eras": len(facts), "separation": None, "confidence": None, "tier": "single_era"}

    medians = [f.median_value for f in facts if f.median_value is not None]
    if len(medians) < 2:
        return {"eras": len(facts), "separation": None, "confidence": None, "tier": "unknown"}

    steps = [abs(b - a) for a, b in zip(medians, medians[1:])]
    separation = sum(steps) / len(steps)

    noise = st.pstdev(values) if len(values) > 1 else 0.0
    if noise <= 0:
        return {"eras": len(facts), "separation": round(separation, 4), "confidence": None, "tier": "unknown"}

    conf = separation / noise
    tier = "high" if conf >= 0.5 else "medium" if conf >= 0.25 else "low"
    return {
        "eras": len(facts),
        "separation": round(separation, 4),
        "noise": round(noise, 4),
        "confidence": round(conf, 3),
        "tier": tier,
    }


def fact_at(facts: list[Fact], date_ord: int) -> Fact | None:
    """The fact that was true on a given date. The point-in-time query."""
    for f in facts:
        if f.valid_from <= date_ord < f.valid_to:
            return f
    return None


# Metric bands. Names read as a coach would say them.
DIMENSIONS = {
    "press_height": ("deep", "mid", "high"),
    "defensive_action_height": ("deep", "mid", "high"),
    "team_width": ("narrow", "balanced", "wide"),
    "pass_forward_ratio": ("patient", "mixed", "direct"),
    "possession_share_pct": ("low", "even", "dominant"),
}
