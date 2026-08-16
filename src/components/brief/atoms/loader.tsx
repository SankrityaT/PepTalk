"use client";

import { useEffect, useState } from "react";

/**
 * The agent is working.
 *
 * A pixel grid with a chevron wavefront driving right, a shimmering label, and
 * a live elapsed timer in mono tabular figures. The cycle is deliberately
 * shorter than the sweep so two fronts are always in flight — a single front
 * reads as a stutter.
 *
 * The timer matters more than the grid. A spinner with no elapsed time tells a
 * coach nothing about whether to wait; a number climbing tells them it is
 * alive and roughly how long this usually takes.
 *
 * Reduced motion freezes the grid to its dim state via the global rule in
 * globals.css. The timer still ticks, because that is information, not motion.
 */

const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const CYCLE_MS = 650;

function useElapsed(): string {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export function Loader({ label = "Working" }: { label?: string }) {
  const elapsed = useElapsed();

  return (
    <div className="flex w-fit items-center gap-2.5">
      <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {CHEVRON.map((d, i) => (
          <span
            key={i}
            className="size-[4px] rounded-[1px] bg-warm"
            style={{
              opacity: 0.15,
              animation: `pixel-on ${CYCLE_MS}ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>

      <span
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--color-muted-2) 35%, var(--color-chalk) 50%, var(--color-muted-2) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>

      <span className="font-mono text-[12px] tabular-nums text-muted-2">
        {elapsed}
      </span>
    </div>
  );
}
