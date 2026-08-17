//created by kinjal
"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PepTalkMark } from "@/components/logo-marks";
import { type AddedGame, activate, added } from "@/lib/games";

/**
 * Which game the interface is showing, and how to change it.
 *
 * A coach who adds a match should land on it, and still be able to get back
 * to anything else they have added — including the built-in World Cup game,
 * which stops being "the app" the moment they have one of their own and
 * becomes one entry in this list.
 *
 * Switching reloads the page on purpose. TypeScript imports are static, so
 * the interface reads one directory, `snapshots/active`, and the server
 * copies the chosen workspace into it. Nothing short of a reload picks that
 * up, and pretending otherwise would show half the old game.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function GameSwitcher({
  team,
  squad = "First team",
}: {
  team: string;
  squad?: string;
}) {
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<AddedGame[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Loaded when the menu opens rather than on mount: the service is optional,
  // and a dashboard reading committed snapshots should not call it just to
  // render a name nobody has clicked on.
  useEffect(() => {
    if (!open) return;
    let live = true;
    added()
      .then((r) => live && setGames(r.games))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [open]);

  // Click-away and Escape, so the menu never strands the coach.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const choose = async (key: string) => {
    setBusy(key);
    setError(null);
    try {
      await activate(key);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-2 flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-[background-color,transform] duration-100 hover:bg-white/[0.05] active:scale-[0.97]"
      >
        <PepTalkMark size={26} className="shrink-0 text-chalk" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[13px] leading-tight text-chalk">
            Pep Talk
          </span>
          <span className="block truncate text-[11px] leading-tight text-muted-2">
            {team} &middot; {squad}
          </span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-muted-2"
        >
          <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: EASE }}
            className="absolute top-full left-0 z-50 w-[17rem] overflow-hidden rounded-xl bg-surface-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.10]"
          >
            <p className="px-3 pt-2.5 pb-1.5 font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
              your games
            </p>

            {error ? (
              <p className="px-3 pb-3 text-[12px] leading-relaxed text-warm-2">
                {error}
              </p>
            ) : games.length === 0 ? (
              <p className="px-3 pb-3 text-[12px] text-muted-2">Looking&hellip;</p>
            ) : (
              <ul className="max-h-[18rem] overflow-y-auto pb-1">
                {games.map((g) => (
                  <li key={g.key}>
                    <button
                      onClick={() => !g.active && choose(g.key)}
                      disabled={Boolean(busy)}
                      className={`flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors ${
                        g.active
                          ? "bg-accent/[0.10]"
                          : "hover:bg-white/[0.05] disabled:opacity-50"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] ${
                            g.active ? "text-chalk" : "text-warm"
                          }`}
                        >
                          {g.team}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-2">
                          {g.label}
                        </span>
                      </span>
                      {busy === g.key ? (
                        <span className="shrink-0 font-mono text-[9px] text-muted-2">
                          &hellip;
                        </span>
                      ) : g.active ? (
                        <span className="shrink-0 font-mono text-[9px] tracking-[0.1em] text-accent uppercase">
                          on
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-white/[0.07] px-3 py-2 text-[11px] leading-relaxed text-muted-2">
              Switching reloads the page.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

