"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * The escape hatch, not the path.
 *
 * A coach must never have to think of a question to get value out of this
 * product — that is what the brief above is for. This bar is for the coach who
 * has one anyway, and it stays live while the brief is still streaming so
 * interrupting is always allowed.
 *
 * `@` opens players and games, `/` opens commands. Both are drawn from real
 * data passed in, so the menu can never offer something that does not exist.
 *
 * When the model is not connected the bar says so and offers the canned
 * questions instead of pretending to think. Silently degrading to a fake
 * answer is the one behaviour that would poison everything else on the page.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export type Mention = { key: string; label: string; hint?: string };

export function PromptBar({
  onSend,
  suggestions = [],
  mentions = [],
  commands = [],
  connected,
  busy = false,
}: {
  onSend: (text: string) => void;
  suggestions?: string[];
  mentions?: Mention[];
  commands?: Mention[];
  /** False when there is no model key; the bar says so rather than faking. */
  connected: boolean;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  const [menu, setMenu] = useState<"@" | "/" | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const list = menu === "@" ? mentions : menu === "/" ? commands : [];
  const token = (() => {
    if (!menu) return "";
    const i = value.lastIndexOf(menu);
    return i < 0 ? "" : value.slice(i + 1).toLowerCase();
  })();
  const filtered = list.filter((m) => m.label.toLowerCase().includes(token));

  // The highlighted row is keyed to the current query, so it resets when the
  // menu or the typed token changes without needing an effect to chase it.
  const [sel, setSel] = useState({ key: "", at: 0 });
  const key = `${menu ?? ""}:${token}`;
  if (sel.key !== key) setSel({ key, at: 0 });
  const cursor = sel.key === key ? sel.at : 0;
  const setCursor = (fn: (c: number) => number) =>
    setSel((p) => ({ key: p.key, at: fn(p.at) }));

  const pick = (m: Mention) => {
    const i = value.lastIndexOf(menu ?? "");
    setValue(`${value.slice(0, i)}${menu}${m.label} `);
    setMenu(null);
    input.current?.focus();
  };

  const submit = () => {
    const t = value.trim();
    if (!t || busy) return;
    onSend(t);
    setValue("");
    setMenu(null);
  };

  return (
    <div className="relative">
      <AnimatePresence>
        {menu && filtered.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="absolute bottom-full left-0 z-30 mb-2 max-h-56 w-72 overflow-y-auto rounded-xl bg-surface-raised p-1.5 shadow-xl ring-1 ring-white/10"
          >
            {filtered.map((m, i) => (
              <li key={m.key}>
                <button
                  onMouseEnter={() => setCursor(() => i)}
                  onClick={() => pick(m)}
                  className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left ${
                    i === cursor ? "bg-white/[0.08]" : ""
                  }`}
                >
                  <span className="text-[13px] text-warm">{m.label}</span>
                  {m.hint && (
                    <span className="font-mono text-[10px] text-muted-2">
                      {m.hint}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Suggestions scroll sideways on a phone. Stacked, three of these ate
          half the screen and pushed the brief itself out of view. */}
      {suggestions.length > 0 && !value && (
        <div className="mb-2.5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSend(s)}
              disabled={busy}
              className="shrink-0 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] whitespace-nowrap text-warm-2 transition-colors hover:bg-white/[0.1] hover:text-chalk disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl bg-surface p-2 ring-1 ring-white/[0.08] focus-within:ring-white/[0.16]">
        <textarea
          ref={input}
          rows={1}
          value={value}
          placeholder="Ask about any player, any clip…"
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            const last = v.slice(-1);
            if (last === "@" || last === "/") setMenu(last);
            else if (last === " " || v === "") setMenu(null);
          }}
          onKeyDown={(e) => {
            if (menu && filtered.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => (c + 1) % filtered.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => (c - 1 + filtered.length) % filtered.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(filtered[cursor]);
                return;
              }
              if (e.key === "Escape") return setMenu(null);
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed text-chalk placeholder:text-muted-2 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={!value.trim() || busy}
          aria-label="Send"
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-canvas transition-all enabled:hover:brightness-110 disabled:bg-white/[0.07] disabled:text-muted-2"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      <p className="mt-2 font-mono text-[10px] text-muted-2">
        {connected ? (
          <>
            <span className="text-muted">@</span> a player or game &middot;{" "}
            <span className="text-muted">/</span> for commands &middot; answers
            cite the graph
          </>
        ) : (
          "model not connected in this build — the questions above are answered from the snapshot"
        )}
      </p>
    </div>
  );
}
