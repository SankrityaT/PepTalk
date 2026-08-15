"use client";

import { AnimatePresence, motion, type MotionValue } from "motion/react";
import { TACTICAL_STATES } from "@/content/hero";
import { useEraIndex } from "@/lib/use-era-index";

/**
 * The memory readout.
 *
 * Shows the fact the graph returns for the currently-scrubbed date, its
 * validity interval, and the position of that fact in the SUPERSEDED_BY
 * chain. The chain is the point: the older claim is not deleted when a new
 * one arrives, it is dated and kept, which is the structure a vector index
 * cannot represent.
 */

function CornerTicks() {
  // HydraDB brackets their stat cards with orange crop marks. Reused here
  // so the panel reads as part of their visual family.
  const tick = "absolute h-2.5 w-2.5 border-accent";
  return (
    <>
      <span className={`${tick} -top-px -left-px border-t border-l`} />
      <span className={`${tick} -top-px -right-px border-t border-r`} />
      <span className={`${tick} -bottom-px -left-px border-b border-l`} />
      <span className={`${tick} -bottom-px -right-px border-b border-r`} />
    </>
  );
}

/**
 * The supersession chain, as a strip of era chips.
 *
 * Past nodes are struck through, the active node is bracketed in accent,
 * future nodes are dimmed to near-invisible. Walking the scrub forward
 * walks the chain.
 */
function SupersededChain({ index }: { index: number }) {
  return (
    <div className="flex items-stretch gap-0">
      {TACTICAL_STATES.map((state, i) => {
        const isPast = i < index;
        const isActive = i === index;

        return (
          <div key={state.year} className="flex items-center">
            {i > 0 && (
              <span
                className={`mx-1.5 font-mono text-[11px] leading-none transition-colors duration-300 ease-[var(--ease-ui)] ${
                  i <= index ? "text-accent/70" : "text-muted-2/40"
                }`}
              >
                {">"}
              </span>
            )}
            <div
              className={`relative border px-2 py-1 transition-all duration-300 ease-[var(--ease-ui)] ${
                isActive
                  ? "border-accent/70 bg-accent/10"
                  : "border-rule bg-transparent"
              }`}
            >
              <span
                className={`block font-mono text-[11px] leading-none tabular-nums transition-colors duration-300 ${
                  isActive
                    ? "text-accent"
                    : isPast
                      ? "text-muted-2 line-through decoration-muted-2/70"
                      : "text-muted-2/45"
                }`}
              >
                {state.year}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MemoryReadout({ progress }: { progress: MotionValue<number> }) {
  const index = useEraIndex(progress);
  const state = TACTICAL_STATES[index];
  const superseded = index > 0 ? TACTICAL_STATES[index - 1] : null;

  return (
    // Deliberately translucent. The card sits on top of the board, and an
    // opaque panel punches a dead rectangle through the drawing at exactly
    // the moment the drawing is doing the arguing. Blur keeps the type
    // legible without hiding what is underneath.
    <div className="relative w-full max-w-md border border-rule bg-canvas/55 p-4 backdrop-blur-md sm:p-5">
      <CornerTicks />

      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          Retrieved fact
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-accent tabular-nums">
          as_of {state.year}
        </span>
      </div>

      {/* The claim. Sized to three lines so the card height is stable across
          eras without needing a min-height full of nothing. */}
      <div className="mt-3 min-h-[3.5rem] sm:mt-3.5 sm:min-h-[4.5rem]">
        <AnimatePresence mode="wait">
          <motion.p
            key={state.year}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
            className="text-[13.5px] leading-snug text-chalk-2 sm:text-[15px]"
          >
            {state.claim}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* What this claim replaced, retained rather than deleted.
          Hidden on mobile: the chain below carries the same idea in a
          fraction of the height, and at 390px the card has to fit the
          viewport alongside the headline. */}
      <div className="mt-2.5 hidden min-h-[2rem] border-l border-accent/30 pl-3 sm:mt-3 sm:block sm:min-h-[2.25rem]">
        <AnimatePresence mode="wait">
          {superseded ? (
            <motion.div
              key={superseded.year}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2">
                superseded {superseded.year}
              </span>
              <p className="mt-1 font-mono text-[11px] leading-snug text-muted-2 line-through decoration-accent/50">
                {superseded.claim}
              </p>
            </motion.div>
          ) : (
            <motion.span
              key="origin"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2"
            >
              Oldest claim on record
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 border-t border-rule pt-3 sm:mt-5 sm:pt-4">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2">
          superseded_by chain
        </span>
        <div className="mt-2">
          <SupersededChain index={index} />
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-rule pt-3 font-mono text-[11px] sm:mt-5 sm:gap-y-3 sm:pt-4">
        <Row label="valid_from" value={state.validFrom} />
        <Row label="valid_to" value={state.validTo ?? "current"} />
        <Row label="formation" value={state.formation} />
        <Row label="press_height" value={`${state.pressHeight} m`} accent />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
        {label}
      </dt>
      <dd className={`tabular-nums ${accent ? "text-accent" : "text-chalk-3"}`}>
        <AnimatePresence mode="wait">
          <motion.span
            key={value}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="inline-block"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </dd>
    </div>
  );
}
