"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * The coach's conversations, as things he can open.
 *
 * Cross session continuity that cannot be seen is a claim, not a feature. The
 * session id lived in browser storage and nothing surfaced it, so the only way
 * to start a second conversation was to clear storage by hand, and the only
 * proof that the first one persisted was to query the graph. Both true, neither
 * demonstrable.
 *
 * So: which thread you are in, the ones you are not, and a way to begin
 * another. Opening an old one shows what was said and the facts each answer
 * cited, which is the part worth seeing. Those chips are `CITES` edges, so a
 * line Pep wrote last Tuesday still reaches the dated fact it was written from,
 * and it reaches the fact *as it was then* rather than whatever superseded it.
 */

const KEY = "peptalk.session";

export type ThreadSummary = {
  session_id: number;
  title: string;
  turns: number;
  started_ord: number;
  last_ord: number;
};

type Turn = {
  id: number;
  seq: number;
  role: string;
  text: string;
  ts_ord: number;
  cites: { id: number; dimension: string; band: string }[];
};

/**
 * The same citation shapes the answer view strips: [4], [12][11] and [12, 11].
 *
 * Turns are stored with the markers in, which is right, because the record
 * should be what the model wrote. They come out for display for the same
 * reason they do in the live answer: the chips underneath carry the same
 * information in a form a coach can read, and showing both makes a sentence
 * look like a bibliography.
 */
const CITATION = /\s*(?:\[\s*\d+(?:\s*,\s*\d+)*\s*\])+/g;

function stripIds(text: string): string {
  return text.replace(CITATION, "").replace(/\s+([.,;:])/g, "$1").trim();
}

/** Ordinals are proleptic Gregorian, the same clock the football facts use. */
function human(ord: number): string {
  const d = new Date(Date.UTC(1, 0, 1));
  d.setUTCDate(d.getUTCDate() + (ord - 367));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function currentSession(): number | null {
  try {
    const held = window.localStorage.getItem(KEY);
    return held ? Number(held) : null;
  } catch {
    return null;
  }
}

/**
 * The stored session id, as external state rather than as a copy.
 *
 * Reading it into `useState` inside an effect works and is the wrong shape:
 * it is a synchronous setState on mount, and it goes stale the moment anything
 * else writes the key. `useSyncExternalStore` is what React provides for a
 * value that lives outside it, and the server snapshot returns null so the
 * markup matches before hydration.
 *
 * The `storage` event only fires in *other* tabs, so writers call `announce`
 * to notify this one. That the two tabs then agree is a small bonus of doing
 * it properly.
 */
const listeners = new Set<() => void>();

function announce(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function useSessionId(): number | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
  return raw ? Number(raw) : null;
}

export function ThreadPicker({ onSwitch }: { onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const mine = useSessionId();
  const [reading, setReading] = useState<{ id: number; turns: Turn[] } | null>(null);

  const load = useCallback(() => {
    fetch("/api/sessions")
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((b) => setThreads(b.sessions ?? []))
      .catch(() => setThreads([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reopening the list after asking something should show the turn that was
  // just written, not the list as it was when the page loaded.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const startNew = () => {
    const fresh =
      Math.floor(Date.now() / 86_400_000) * 1000 + Math.floor(Math.random() * 1000);
    try {
      window.localStorage.setItem(KEY, String(fresh));
    } catch {
      /* private window: the session simply will not persist */
    }
    announce();
    setReading(null);
    setOpen(false);
    onSwitch();
  };

  const openThread = (id: number) => {
    fetch(`/api/sessions/${id}`)
      .then((r) => r.json())
      .then((b) => setReading({ id, turns: b.turns ?? [] }))
      .catch(() => {});
  };

  const others = threads.filter((t) => t.session_id !== mine);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[10px] tracking-[0.08em] text-muted-2 uppercase transition-colors hover:bg-white/[0.06] hover:text-warm"
        title="Conversations"
      >
        {threads.length || 0} {threads.length === 1 ? "thread" : "threads"}
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="absolute top-11 right-3 z-40 w-72 overflow-hidden rounded-xl bg-surface-raised shadow-2xl ring-1 ring-white/10"
          >
            <button
              onClick={startNew}
              className="flex w-full items-center gap-2 border-b border-white/[0.07] px-3 py-2.5 text-left text-[12px] text-accent transition-colors hover:bg-white/[0.05]"
            >
              <span className="text-[14px] leading-none">+</span> New conversation
            </button>

            <div className="max-h-64 overflow-y-auto p-1">
              {mine !== null && (
                <p className="px-2 pt-1.5 pb-1 font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                  this one
                </p>
              )}
              {mine !== null && (
                <div className="rounded-lg bg-white/[0.05] px-2 py-1.5">
                  <p className="truncate text-[12px] text-chalk">
                    {threads.find((t) => t.session_id === mine)?.title ??
                      "nothing asked yet"}
                  </p>
                </div>
              )}

              {others.length > 0 && (
                <p className="px-2 pt-3 pb-1 font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                  earlier
                </p>
              )}
              {others.map((t) => (
                <button
                  key={t.session_id}
                  onClick={() => openThread(t.session_id)}
                  className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <p className="truncate text-[12px] text-warm">{t.title}</p>
                  <p className="mt-0.5 font-mono text-[9px] text-muted-2">
                    {human(t.last_ord)} · {t.turns} turns
                  </p>
                </button>
              ))}

              {threads.length === 0 && (
                <p className="px-2 py-3 text-[11px] text-muted-2">
                  Nothing stored yet. Ask something and it will be here
                  tomorrow.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* An earlier conversation, read rather than resumed. Kept separate from
          the live thread so that opening Tuesday cannot be mistaken for having
          switched into it. */}
      <AnimatePresence>
        {reading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col bg-canvas/97 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
                earlier conversation
              </span>
              <button
                onClick={() => setReading(null)}
                className="rounded-md px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:bg-white/[0.06] hover:text-chalk"
              >
                close
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {reading.turns.map((t) => (
                <div key={t.id}>
                  <p className="font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                    {t.role === "coach" ? "you" : "pep"} · {human(t.ts_ord)}
                  </p>
                  <p
                    className={`mt-1 text-[13px] leading-relaxed ${
                      t.role === "coach" ? "text-chalk" : "text-warm"
                    }`}
                  >
                    {stripIds(t.text)}
                  </p>
                  {t.cites?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.cites.map((c) => (
                        <span
                          key={c.id}
                          className="rounded bg-accent/12 px-1.5 py-0.5 font-mono text-[9px] text-accent"
                          title={`HydraDB Fact ${c.id}`}
                        >
                          {c.dimension} {c.band}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {reading.turns.length === 0 && (
                <p className="text-[12px] text-muted-2">This thread is empty.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
