"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Workspace navigation.
 *
 * Built the way a tool a coach opens every week should be: a club row at the
 * top, search with a keyboard hint, the one action they take most as the
 * accent, then grouped sections. Grouping is what stops five flat items
 * reading as a pile.
 *
 * The hover and selection state is a single sliding block measured off the
 * live DOM rather than a background on each row. Fifteen rows lighting up
 * independently reads as noise; one block that travels reads as a cursor, and
 * it means hover and selection cannot disagree about where you are.
 */

export type Section =
  | "brief"
  | "watch"
  | "next"
  | "roster"
  | "games"
  | "knows"
  | "model";

type Item = {
  key: Section;
  label: string;
  group: string;
  count?: boolean;
  plus?: boolean;
  soon?: boolean;
};

// Review, Goals against and Tape were three rows that all meant "watch the
// footage", and a coach could not tell them apart. One row, tabs inside it.
const ITEMS: Item[] = [
  { key: "brief", label: "Brief", group: "Today", count: true },
  { key: "watch", label: "Watch the game", group: "Today" },
  // The job a coach is actually paid for: the week before the next one.
  { key: "next", label: "Next match", group: "Today" },
  { key: "roster", label: "Players", group: "Squad", plus: true, soon: true },
  { key: "games", label: "Your season", group: "Season" },
  { key: "knows", label: "What Pep knows", group: "Season" },
  { key: "model", label: "Threat map", group: "Season" },
];

const GROUPS = ["Today", "Squad", "Season"];

function Icon({ kind }: { kind: Section }) {
  const paths: Record<Section, React.ReactNode> = {
    next: (
      <g>
        <path d="M4 12h14M13 6l6 6-6 6" />
        <path d="M4 5v14" />
      </g>
    ),
    watch: (
      <g>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M10 9.5l5 2.5-5 2.5z" />
      </g>
    ),
    brief: (
      <g>
        <path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z" />
        <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <path d="M8 12h8M8 16h5" />
      </g>
    ),
    roster: (
      <g>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 5.6a3.2 3.2 0 0 1 0 4.8M18.2 20a6.4 6.4 0 0 0-2.4-5" />
      </g>
    ),
    games: (
      <g>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </g>
    ),
    knows: (
      <g>
        <path d="M12 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
        <rect x="7" y="4" width="10" height="16" rx="2" />
      </g>
    ),
    model: (
      <g>
        <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
        <path d="M12 5v14M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3" />
      </g>
    ),
  };
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[kind]}
    </svg>
  );
}

export function Sidebar({
  active,
  onSelect,
  team,
  squad = "First team",
  badge,
  onAddGame,
}: {
  active: Section;
  onSelect: (s: Section) => void;
  team: string;
  squad?: string;
  badge?: number;
  onAddGame?: () => void;
}) {
  const [hovered, setHovered] = useState<Section | null>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [query, setQuery] = useState("");

  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const search = useRef<HTMLInputElement>(null);

  // Measured after layout, so the block is never a frame behind the row it is
  // supposed to be sitting on.
  useLayoutEffect(() => {
    const container = navRef.current;
    const target = itemRefs.current[hovered ?? active];
    if (!container || !target) return;
    const c = container.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    setBox({ top: t.top - c.top, height: t.height });
  }, [hovered, active, query]);

  const shown = ITEMS.filter((i) =>
    i.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      {/* ── Desktop rail ────────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/[0.07] p-2.5 lg:flex">
        {/* Club */}
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-[background-color,transform] duration-100 hover:bg-white/[0.05] active:scale-[0.97]"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-[13px] font-semibold text-canvas">
            {team.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-medium text-chalk">
              {team}
            </span>
            <span className="block truncate text-[11px] leading-tight text-muted-2">
              {squad}
            </span>
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-2">
            <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
          </svg>
        </button>

        {/* Search */}
        <label className="mb-1.5 flex h-8 items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 ring-1 ring-white/[0.05] focus-within:ring-white/[0.12]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted-2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a player or game"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-chalk outline-none placeholder:text-muted-2"
          />
          <kbd className="flex size-4.5 items-center justify-center rounded bg-white/[0.06] font-mono text-[10px] text-muted-2">
            /
          </kbd>
        </label>

        {/* The thing a coach does most */}
        <button
          type="button"
          onClick={onAddGame}
          className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent transition-[background-color,transform] duration-100 hover:bg-accent/10 active:scale-[0.97]"
        >
          <span className="min-w-0 flex-1 truncate text-left">Add a game</span>
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-canvas">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </button>

        {/* Sections */}
        <div
          ref={navRef}
          onMouseLeave={() => setHovered(null)}
          className="relative flex flex-col gap-1.5"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-lg bg-white/[0.07]"
            style={{
              top: box?.top ?? 0,
              height: box?.height ?? 0,
              opacity: box ? 1 : 0,
              transition:
                "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
            }}
          />

          {GROUPS.map((group) => {
            const rows = shown.filter((i) => i.group === group);
            if (!rows.length) return null;
            return (
              <div key={group}>
                <div className="px-2 pt-1 pb-1 font-mono text-[10px] font-medium tracking-[0.1em] text-muted-2 uppercase">
                  {group}
                </div>
                <div className="flex flex-col gap-px">
                  {rows.map((item) => {
                    const on = item.key === active;
                    return (
                      <button
                        key={item.key}
                        ref={(el) => {
                          itemRefs.current[item.key] = el;
                        }}
                        type="button"
                        onMouseEnter={() => setHovered(item.key)}
                        onFocus={() => setHovered(item.key)}
                        onBlur={() => setHovered(null)}
                        onClick={() => onSelect(item.key)}
                        aria-current={on ? "page" : undefined}
                        className="group relative z-10 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-[color,transform] duration-150 active:scale-[0.97]"
                      >
                        <span className={on ? "text-accent" : "text-muted-2"}>
                          <Icon kind={item.key} />
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[13px] transition-colors duration-150 ${
                            on ? "font-medium text-chalk" : "text-warm-2"
                          }`}
                        >
                          {item.label}
                        </span>

                        {item.count && badge ? (
                          <span
                            className={`flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold tabular-nums ${
                              on
                                ? "bg-white/[0.09] text-chalk"
                                : "bg-accent/15 text-accent"
                            }`}
                          >
                            {badge}
                          </span>
                        ) : null}

                        {item.soon && (
                          <span className="font-mono text-[9px] tracking-[0.08em] text-muted-2 uppercase">
                            soon
                          </span>
                        )}

                        {item.plus && !item.soon && (
                          <span className="flex size-4.5 items-center justify-center rounded text-muted-2 opacity-0 transition-[background-color,color,opacity] duration-100 group-hover:opacity-100 hover:bg-white/10 hover:text-chalk">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {shown.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-muted-2">
              Nothing matches that.
            </p>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2 px-2 pb-1">
          <span className="size-1.5 rounded-full bg-accent" />
          <span className="font-mono text-[10px] text-muted-2">
            memory on HydraDB
          </span>
        </div>
      </aside>

      {/* ── Phone bar ───────────────────────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/[0.08] bg-canvas/95 backdrop-blur-sm lg:hidden">
        {ITEMS.filter((i) => !i.soon).map((item) => {
          const on = item.key === active;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
                on ? "text-accent" : "text-muted-2"
              }`}
            >
              <Icon kind={item.key} />
              <span className="text-[10px]">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
