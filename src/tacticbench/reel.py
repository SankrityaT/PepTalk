"""Locating match moments inside a highlights package.

    uv run python -m tacticbench.reel <video> --match 3877090

A full broadcast is continuous, so two clock readings give one offset per half
and every moment can be placed by arithmetic. That is what `find_offsets` and
`fetch_clips` do, and it is why the World Cup clips land on the right pass.

A highlights package is not continuous. It jumps: the LAFC reel runs 08:12,
then 51:04, then 93:07 inside four and a half minutes. No single offset
describes it, and spreading moments evenly across it — which this repo did for
one afternoon — puts a wide establishing shot under a first-half moment.

What a package does still carry is the broadcast clock, in almost every shot.
So the reel is *read* rather than guessed at: sample it, OCR the overlay, keep
only the readings that survive a sanity check, and use them to map match time
onto reel time. A moment whose passage is not in the package gets no clip,
which is the honest answer and the same rule the rest of the pipeline follows.

**On OCR, which `find_offsets` deliberately refuses to do.** That module is
right that a misread digit is worth sixty seconds of silent misalignment. The
difference here is that nothing is taken on trust: a reading is discarded
unless it parses as a plausible match clock and agrees with its neighbours, and
every cut is verified afterwards by reading the clock back off its own first
frame. A misread produces a missing clip, never a wrong one.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

#: Where OCR crops are staged. Under the repo rather than a temp directory
#: because tesseract cannot read every sandboxed path.
SCRATCH = ROOT / ".cache" / "ocr"

#: The scoreboard clock sits top-left in every broadcast this has been run
#: against. Expressed as fractions so it survives a change of resolution.
CLOCK_CROP = "crop=iw*0.115:ih*0.055:iw*0.035:ih*0.055"

#: Upscaled, greyed and inverted: tesseract wants dark text on light, and the
#: overlay is the other way round.
CLOCK_PREP = f"{CLOCK_CROP},scale=iw*8:ih*8,format=gray,negate"

#: How often to sample. Two seconds is dense enough to catch a four second
#: shot and cheap enough to cross a seven minute package in about a minute.
SAMPLE_S = 2.0

#: A reading further than this from both neighbours is dropped as a misread.
#: Broadcast clocks advance a second per second, so a genuine reading inside a
#: shot cannot differ from its neighbour by more than the sampling gap.
MAX_DRIFT_S = 90.0


@dataclass
class Reading:
    """One clock reading: where in the reel, and what the overlay said."""

    reel_s: float
    match_s: float


def _clock_at(video: Path, at: float) -> float | None:
    """The match clock in the frame at `at` seconds, or None if unreadable."""
    SCRATCH.mkdir(parents=True, exist_ok=True)
    crop = SCRATCH / "frame.png"
    ok = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{at:.2f}", "-i", str(video),
         "-update", "1", "-frames:v", "1", "-vf", CLOCK_PREP, "-y", str(crop)],
        capture_output=True,
    )
    if ok.returncode != 0 or not crop.exists():
        return None

    out = subprocess.run(
        ["tesseract", str(crop), "stdout", "--psm", "7",
         "-c", "tessedit_char_whitelist=0123456789:"],
        capture_output=True, text=True,
    )
    return parse_clock(out.stdout)


def parse_clock(text: str) -> float | None:
    """Match seconds from a raw OCR string, or None if it is not a clock.

    Deliberately strict. OCR on a broadcast overlay returns "608121" and
    "93:0746" as often as it returns "10:28", and a lenient parser turns those
    into confident wrong timestamps. Anything that is not `MM:SS` with sane
    values is thrown away; there are plenty of other samples.
    """
    m = re.search(r"\b(\d{1,3}):([0-5]\d)\b", text or "")
    if not m:
        return None
    minute, second = int(m.group(1)), int(m.group(2))
    # Extra time runs past 120 in principle; beyond that it is a misread.
    if minute > 130:
        return None
    return minute * 60.0 + second


def read_clocks(video: Path, duration: float, every: float = SAMPLE_S) -> list[Reading]:
    """Every clock reading the package will give up, in reel order."""
    out: list[Reading] = []
    t = 0.0
    while t < duration:
        got = _clock_at(video, t)
        if got is not None:
            out.append(Reading(reel_s=t, match_s=got))
        t += every
    return out


def drop_outliers(readings: list[Reading]) -> list[Reading]:
    """Discard readings that agree with neither neighbour.

    A misread digit moves the clock by minutes while the frames either side of
    it are seconds apart, so disagreement with *both* neighbours is the signal.
    A reading at the edge of a shot legitimately disagrees with one of them,
    which is why both have to reject it.
    """
    if len(readings) < 3:
        return readings
    kept = [readings[0]]
    for prev, cur, nxt in zip(readings, readings[1:], readings[2:]):
        near_prev = abs(cur.match_s - prev.match_s) <= MAX_DRIFT_S
        near_next = abs(nxt.match_s - cur.match_s) <= MAX_DRIFT_S
        if near_prev or near_next:
            kept.append(cur)
    kept.append(readings[-1])
    return kept


def locate(readings: list[Reading], match_s: float, tolerance: float = 30.0) -> float | None:
    """Where in the reel a match-clock moment appears, or None if it does not.

    Interpolates between the two readings that bracket it, but only inside a
    single shot: two readings on either side of a cut describe different parts
    of the match, and interpolating across that gap is exactly the error this
    module exists to avoid. Where no shot contains the moment, the answer is
    None and the caller cuts nothing.
    """
    if not readings:
        return None

    for a, b in zip(readings, readings[1:]):
        # A cut, not a continuous run: the clock jumped further than the
        # sampling gap can explain.
        if b.match_s < a.match_s or (b.match_s - a.match_s) > MAX_DRIFT_S:
            continue
        if a.match_s <= match_s <= b.match_s:
            span = b.match_s - a.match_s
            if span <= 0:
                return a.reel_s
            frac = (match_s - a.match_s) / span
            return a.reel_s + frac * (b.reel_s - a.reel_s)

    # Not inside any run, but perhaps within tolerance of a single sample.
    best = min(readings, key=lambda r: abs(r.match_s - match_s))
    if abs(best.match_s - match_s) <= tolerance:
        return best.reel_s
    return None


def verify(
    video: Path, reel_s: float, expect_match_s: float, tolerance: float = 45.0
) -> bool:
    """Read the clock back around a cut point and check it says what we claimed.

    The whole safeguard. Every window is checked against the overlay it was
    derived from, so a misread that survived the sanity checks still cannot
    reach a coach: the clip is dropped instead.

    Sampled across a few frames rather than demanding one, because the overlay
    is not legible in every frame — it fades on replays and washes out against
    a light shirt. One unreadable frame is not evidence the cut is wrong, and
    treating it as such threw away correct clips.
    """
    for offset in (0.0, 2.0, -2.0, 4.0, -4.0):
        got = _clock_at(video, max(0.0, reel_s + offset))
        if got is None:
            continue
        # The clock advances with the reel, so compare like with like.
        if abs(got - (expect_match_s + offset)) <= tolerance:
            return True
        # A readable clock that disagrees is a real mismatch, not a gap.
        return False
    # Nothing readable anywhere near it: cannot confirm, so do not claim it.
    return False
