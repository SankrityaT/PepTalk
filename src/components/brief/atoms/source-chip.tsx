"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * An inline citation.
 *
 * The important property is that a chip carries a **graph node id**, not a
 * label. `Fact 100000042` is a thing that can be looked up, superseded, and
 * dated; "our analysis" is not. Every claim in the brief that came out of
 * HydraDB gets one, and hovering shows what it resolves to.
 *
 * This is the difference between a product that cites and a product that
 * gestures at citing. If a chip cannot name the node behind it, the claim
 * should not be on the page.
 */

export type Source = {
  /** Node id in HydraDB. */
  id: number;
  kind: "fact" | "match" | "moment" | "model";
  label: string;
  /** What it resolves to, shown on hover. */
  detail?: string;
};

const KIND_MARK: Record<Source["kind"], string> = {
  fact: "F",
  match: "M",
  moment: "•",
  model: "χ",
};

export function SourceChip({
  source,
  onOpen,
}: {
  source: Source;
  onOpen?: (s: Source) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <span className="relative inline-flex align-baseline">
      <button
        onMouseEnter={() => setOver(true)}
        onMouseLeave={() => setOver(false)}
        onFocus={() => setOver(true)}
        onBlur={() => setOver(false)}
        onClick={() => onOpen?.(source)}
        className="mx-0.5 inline-flex items-center gap-1 rounded border border-white/12 bg-white/[0.04] px-1.5 py-[1px] align-baseline font-mono text-[10px] text-muted transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
      >
        <span className="text-[9px] opacity-70">{KIND_MARK[source.kind]}</span>
        {source.label}
      </button>

      <AnimatePresence>
        {over && source.detail && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 w-max max-w-[18rem] rounded-lg bg-surface-raised px-2.5 py-2 text-[11px] leading-relaxed text-warm-2 shadow-lg ring-1 ring-white/10"
          >
            {source.detail}
            <span className="mt-1 block font-mono text-[10px] text-muted-2">
              {source.kind} id {source.id}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
