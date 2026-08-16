"use client";

import { motion } from "motion/react";

/**
 * The shell.
 *
 * A sidebar rather than a top bar because this is a place a coach comes back
 * to, not a page they land on once. The sections are nouns from their world —
 * their brief, their squad, their games — with the model kept last, since it
 * is the thing a judge wants and a coach never opens.
 *
 * Collapses to a bottom bar on a phone, which is where a coach will actually
 * read this on a Sunday night.
 */

export type Section = "brief" | "roster" | "games" | "model";

const NAV: { key: Section; label: string; hint: string; soon?: boolean }[] = [
  { key: "brief", label: "Brief", hint: "what Pep found" },
  { key: "roster", label: "Roster", hint: "your players", soon: true },
  { key: "games", label: "Games", hint: "the season" },
  { key: "model", label: "Model", hint: "how it judges" },
];

const EASE = [0.4, 0, 0.2, 1] as const;

export function Sidebar({
  active,
  onSelect,
  team,
  badge,
}: {
  active: Section;
  onSelect: (s: Section) => void;
  team: string;
  /** Unread count on the brief. */
  badge?: number;
}) {
  return (
    <>
      {/* ── Desktop rail ────────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-white/[0.07] px-4 py-6 lg:flex">
        <div className="px-2">
          <span className="font-display text-[16px] text-chalk">Pep Talk</span>
          <p className="mt-1 text-[12px] text-muted-2">{team}</p>
        </div>

        <nav className="mt-8 flex flex-col gap-0.5">
          {NAV.map((n) => {
            const on = active === n.key;
            return (
              <button
                key={n.key}
                onClick={() => onSelect(n.key)}
                className={`group relative flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ease-[var(--ease-ui)] ${
                  on ? "text-chalk" : "text-warm-2 hover:bg-white/[0.04] hover:text-chalk"
                }`}
              >
                {on && (
                  <motion.span
                    layoutId="nav-active"
                    transition={{ duration: 0.25, ease: EASE }}
                    className="absolute inset-0 -z-10 rounded-lg bg-white/[0.07]"
                  />
                )}
                <span className="flex flex-col">
                  <span className="text-[14px]">{n.label}</span>
                  <span className="text-[11px] text-muted-2">{n.hint}</span>
                </span>
                {n.key === "brief" && badge ? (
                  <span className="rounded-full bg-accent px-1.5 py-[1px] font-mono text-[10px] tabular-nums text-canvas">
                    {badge}
                  </span>
                ) : n.soon ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                    soon
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto px-3">
          <p className="font-mono text-[10px] leading-relaxed text-muted-2">
            memory on HydraDB
          </p>
        </div>
      </aside>

      {/* ── Phone bar ───────────────────────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/[0.08] bg-canvas/95 backdrop-blur-sm lg:hidden">
        {NAV.map((n) => {
          const on = active === n.key;
          return (
            <button
              key={n.key}
              onClick={() => onSelect(n.key)}
              className={`flex-1 py-3 text-[12px] transition-colors ${
                on ? "text-accent" : "text-muted"
              }`}
            >
              {n.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
