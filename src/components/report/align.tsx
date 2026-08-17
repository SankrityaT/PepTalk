//created by kinjal
"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { frameAt, offsets } from "@/lib/games";

/**
 * Screen 3: lining the footage up with the match clock.
 *
 * The one number nobody can derive, and the one that ruins a report silently.
 * Get it wrong and every clip lands somewhere plausible and shows the wrong
 * passage, with nothing on screen to reveal it.
 *
 * So it is read rather than guessed, exactly as `find_offsets` does from the
 * terminal: take a frame, read the clock off the broadcast overlay, subtract.
 * Deliberately not OCR'd — overlays differ per competition, per broadcaster
 * and per year, and a misread digit is worth sixty seconds of misalignment.
 * A person reading two numbers is both more reliable and faster.
 *
 * Twice, because the half time break is not on the match clock, so the
 * first-half offset is wrong in the second half by the length of the break.
 * The gap between the two is then the only available check on either.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

//: Where we sample. Inside each half, comfortably clear of the break.
const FIRST_AT = "00:12:00";
const SECOND_AT = "01:02:00";

type Reading = { mm: string; ss: string };

export function Align({
  video,
  onDone,
  onSkip,
  onBack,
  onUseAnyway,
}: {
  video: string;
  onDone: (first: number, second: number) => void;
  onSkip: () => void;
  onBack: () => void;
  /** Use the footage without aligning it — excerpts rather than nothing. */
  onUseAnyway?: () => void;
}) {
  // Both frames failing means the recording does not reach those timestamps,
  // which almost always means it is not a full match. Rather than leave a
  // coach staring at two grey boxes asking them to read a clock that is not
  // there, say so and offer the two things that actually work.
  const [broken, setBroken] = useState(0);
  const [first, setFirst] = useState<Reading>({ mm: "", ss: "" });
  const [second, setSecond] = useState<Reading>({ mm: "", ss: "" });
  // Keyed by the exact readings it describes, so a stale answer can never be
  // shown against a number the coach has since corrected.
  const [checked, setChecked] = useState<{
    for: string;
    one: number;
    two: number;
    warning: string | null;
    error: string | null;
  } | null>(null);

  const ready = complete(first) && complete(second);
  const key = ready ? `${clock(first)}|${clock(second)}` : "";
  const current = ready && checked?.for === key ? checked : null;
  const checking = ready && !current;
  const result = current && !current.error ? current : null;
  const error = current?.error ?? null;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    offsets({
      firstAt: FIRST_AT,
      firstClock: clock(first),
      secondAt: SECOND_AT,
      secondClock: clock(second),
    })
      .then((r) => {
        if (!live) return;
        setChecked({
          for: key,
          one: r.period_offset["1"],
          two: r.period_offset["2"],
          warning: r.warning,
          error: null,
        });
      })
      .catch((e: Error) => {
        if (!live) return;
        setChecked({ for: key, one: 0, two: 0, warning: null, error: e.message });
      });
    return () => {
      live = false;
    };
  }, [first, second, ready, key]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mx-auto w-full max-w-2xl"
    >
      <h1 className="text-[32px] leading-tight font-medium text-chalk sm:text-[40px]">
        Line up the footage.
      </h1>
      <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-warm-2">
        Recordings start before kickoff, so Pep needs to know how far in the
        match actually begins. Read the clock in each frame and type what you
        see.
      </p>

      {broken >= 2 && (
        <div className="mt-8 rounded-xl bg-surface px-5 py-5 ring-1 ring-white/[0.07]">
          <p className="text-[15px] leading-relaxed text-warm">
            This recording does not reach those points, so there is no match
            clock to line up. That usually means it is a highlights reel or a
            single passage rather than a full game.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {onUseAnyway && (
              <button
                onClick={onUseAnyway}
                className="rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-canvas transition-all duration-150 ease-[var(--ease-ui)] hover:brightness-110"
              >
                Use it anyway
              </button>
            )}
            <button
              onClick={onSkip}
              className="text-[14px] text-warm-2 underline decoration-white/20 underline-offset-4 transition-colors hover:text-chalk hover:decoration-white/50"
            >
              Analyse without footage
            </button>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-2">
            Either way the numbers are the same. &ldquo;Use it anyway&rdquo;
            shows passages from your footage beside each moment, labelled as
            excerpts rather than as the pass itself.
          </p>
        </div>
      )}

      <div className="mt-10 flex flex-col gap-9">
        <Half
          label="First half"
          video={video}
          at={FIRST_AT}
          value={first}
          onChange={setFirst}
          onFail={() => setBroken((n) => n + 1)}
        />
        <Half
          label="Second half"
          video={video}
          at={SECOND_AT}
          value={second}
          onChange={setSecond}
          onFail={() => setBroken((n) => n + 1)}
        />
      </div>

      {/* ── What that gives us ──────────────────────────────────────── */}
      {(result || error) && (
        <div className="mt-8 rounded-xl bg-surface px-5 py-4 ring-1 ring-white/[0.07]">
          {error ? (
            <p className="text-[14px] text-warm-2">{error}</p>
          ) : result ? (
            <>
              <p className="font-mono text-[12px] tabular-nums text-muted">
                first half +{Math.round(result.one)}s &middot; second half +
                {Math.round(result.two)}s &middot; break{" "}
                {Math.round((result.two - result.one) / 60)} min
              </p>
              {result.warning && (
                <p className="mt-2.5 text-[14px] leading-relaxed text-accent">
                  {result.warning}
                </p>
              )}
            </>
          ) : null}
        </div>
      )}

      <div className="mt-9 flex flex-wrap items-center gap-5">
        <button
          onClick={() => result && onDone(result.one, result.two)}
          disabled={!result || checking || !!result?.warning}
          className="rounded-lg bg-accent px-6 py-3 text-[15px] font-medium text-canvas transition-all duration-150 ease-[var(--ease-ui)] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-muted-2"
        >
          {checking ? "Checking…" : "Watch my game"}
        </button>
        <button
          onClick={onSkip}
          className="text-[15px] text-warm-2 underline decoration-white/20 underline-offset-4 transition-colors hover:text-chalk hover:decoration-white/50"
        >
          Skip &mdash; analyse without clips
        </button>
        <button
          onClick={onBack}
          className="text-[15px] text-muted-2 transition-colors hover:text-warm-2"
        >
          Back
        </button>
      </div>

      <p className="mt-8 max-w-xl text-[13px] leading-relaxed text-muted-2">
        Skipping is a real option: the report still has every moment, the chalk
        and the numbers. It just describes them rather than showing them.
      </p>
    </motion.div>
  );
}

/** One frame, and the two boxes for what its clock says. */
function Half({
  label,
  video,
  at,
  value,
  onChange,
  onFail,
}: {
  label: string;
  video: string;
  at: string;
  value: Reading;
  onChange: (r: Reading) => void;
  onFail?: () => void;
}) {
  const [frame, setFrame] = useState<{ src: string | null; failed: string | null }>(
    { src: null, failed: null },
  );
  const { src, failed } = frame;

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    frameAt(video, at)
      .then((u) => {
        if (!live) {
          URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setFrame({ src: u, failed: null });
      })
      .catch((e: Error) => {
        if (!live) return;
        setFrame({ src: null, failed: e.message });
        onFail?.();
      });
    return () => {
      live = false;
      // The blob is this component's to release; leaking one per frame adds up
      // when a coach steps back and forth through the wizard.
      if (url) URL.revokeObjectURL(url);
    };
  }, [video, at]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[15px] font-medium text-chalk">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted-2">
          {at} into the recording
        </span>
      </div>

      <div className="mt-3.5 overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.07]">
        {failed ? (
          <p className="px-5 py-10 text-center text-[14px] text-muted">
            {failed}
          </p>
        ) : src ? (
          <img
            src={src}
            alt={`The recording at ${at}`}
            className="block max-h-[300px] w-full object-contain"
          />
        ) : (
          <p className="px-5 py-16 text-center text-[14px] text-muted-2">
            Pulling the frame&hellip;
          </p>
        )}
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <span className="text-[14px] text-warm-2">The clock reads</span>
        <Box
          value={value.mm}
          onChange={(mm) => onChange({ ...value, mm })}
          placeholder="10"
          max={130}
        />
        <span className="text-[16px] text-muted">:</span>
        <Box
          value={value.ss}
          onChange={(ss) => onChange({ ...value, ss })}
          placeholder="25"
          max={59}
        />
      </div>
    </div>
  );
}

function Box({
  value,
  onChange,
  placeholder,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  max: number;
}) {
  return (
    <input
      inputMode="numeric"
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
        if (digits === "" || Number(digits) <= max) onChange(digits);
      }}
      className="w-16 rounded-lg bg-surface px-3 py-2 text-center font-mono text-[15px] tabular-nums text-chalk ring-1 ring-white/[0.07] transition-colors placeholder:text-muted-2 focus:bg-surface-2 focus:ring-white/[0.14] focus:outline-none"
    />
  );
}

const complete = (r: Reading) => r.mm !== "" && r.ss !== "";
const clock = (r: Reading) => `${r.mm.padStart(2, "0")}:${r.ss.padStart(2, "0")}`;
