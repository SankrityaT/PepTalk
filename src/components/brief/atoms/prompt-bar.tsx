"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The composer.
 *
 * A coach must never have to think of a question to get value out of this
 * product, which is what the session above is for. This bar is for the coach
 * who has one anyway, and it stays live while the session is still running so
 * interrupting is always allowed.
 *
 * Four ways in, and all four are real:
 *
 *   +   what Pep can read from, and a file picker that takes actual footage
 *   @   the players and clips in this session, off the snapshot
 *   /   commands, each one something the session can actually do
 *   mic dictation through the browser's own recogniser, hidden where absent
 *
 * The picker on the right is the memory switch rather than a model list. It is
 * the one control that changes the answer you are about to get, so it belongs
 * next to where the question is typed. Turning it on sweeps the composer once:
 * 1,803 dated facts just came back.
 *
 * Nothing in the menus is written here. Sources, mentions and commands all
 * arrive as props built from the workspace's own data, so a second workspace
 * gets its own without touching this file.
 */

const EASE = "cubic-bezier(0.23,1,0.32,1)";

export type Mention = {
  key: string;
  label: string;
  hint?: string;
  /** A face, where we have one. A squad reads faster than a list of surnames. */
  avatar?: string;
};

export type Source = {
  key: string;
  name: string;
  desc: string;
  glyph: "clip" | "tape" | "graph" | "season" | "shield";
  /** Opens the file picker instead of inserting a mention. */
  attach?: boolean;
};

/* ── icons ─────────────────────────────────────────────────────────────── */

function Icon({
  children,
  size = 15,
  strokeWidth = 1.8,
}: {
  children: React.ReactNode;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GLYPHS: Record<Source["glyph"], React.ReactNode> = {
  clip: <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  tape: (
    <g>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </g>
  ),
  graph: (
    <g>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <circle cx="12" cy="6" r="2.5" />
      <path d="M7.6 15.9 10.7 8.2M13.6 8 16.7 14.7M8.4 18.4l7.2-.9" />
    </g>
  ),
  season: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  shield: (
    <g>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v6" />
    </g>
  ),
};

/** The last @word or /word being typed, if the caret is still inside it. */
function parseToken(draft: string): { kind: "@" | "/"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w'-]*)$/.exec(draft);
  if (!match) return null;
  return {
    kind: match[2] as "@" | "/",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

/** Chrome and Safari only, and it is genuinely absent elsewhere. */
type Recogniser = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null;
};

type SpeechWindow = {
  SpeechRecognition?: new () => Recogniser;
  webkitSpeechRecognition?: new () => Recogniser;
};

/* Read through useSyncExternalStore rather than an effect, so the server
   renders no mic and the client picks it up on hydration without a second
   render pass. Both snapshots must be stable values, hence the boolean. */
const NEVER_CHANGES = () => () => {};
const hasSpeech = () =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as SpeechWindow).SpeechRecognition ?? (window as unknown as SpeechWindow).webkitSpeechRecognition);
const noSpeech = () => false;

function recogniser(): Recogniser | null {
  if (!hasSpeech()) return null;
  const w = window as unknown as SpeechWindow;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = false;
  r.interimResults = false;
  r.lang = "en-GB";
  return r;
}

export function PromptBar({
  onSend,
  suggestions = [],
  sources = [],
  mentions = [],
  commands = [],
  onAttach,
  memory,
  onMemory,
  memoryOn,
  memoryOff,
  connected,
  busy = false,
}: {
  onSend: (text: string) => void;
  suggestions?: string[];
  sources?: Source[];
  mentions?: Mention[];
  commands?: Mention[];
  /** Handed the picked files. The bar only shows the chips. */
  onAttach?: (files: File[]) => void;
  memory: boolean;
  onMemory: (next: boolean) => void;
  /** What each state actually buys, in the workspace's own numbers. */
  memoryOn: string;
  memoryOff: string;
  /** False when there is no model key; the bar says so rather than faking. */
  connected: boolean;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [memBox, setMemBox] = useState<{ top: number; height: number } | null>(null);
  const [memHovered, setMemHovered] = useState<number | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const input = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const memRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const speech = useRef<Recogniser | null>(null);

  const canDictate = useSyncExternalStore(NEVER_CHANGES, hasSpeech, noSpeech);

  const token = dismissed ? null : parseToken(draft);
  const menu: "@" | "/" | null = plusOpen ? "@" : (token?.kind ?? null);
  const query = plusOpen ? "" : (token?.query ?? "");

  /* The + button opens the same menu the @ key does, with the file picker at
     the top. One list to learn rather than two. */
  const rows: {
    key: string;
    name: string;
    desc?: string;
    source?: Source;
    avatar?: string;
  }[] =
    menu === "@"
      ? [
          ...sources
            .filter((s) => s.name.toLowerCase().includes(query))
            .map((s) => ({ key: s.key, name: s.name, desc: s.desc, source: s })),
          ...mentions
            .filter((m) => m.label.toLowerCase().includes(query))
            .map((m) => ({ key: m.key, name: m.label, desc: m.hint, avatar: m.avatar })),
        ]
      : menu === "/"
        ? commands
            .filter((c) => c.label.toLowerCase().startsWith(query))
            .map((c) => ({ key: c.key, name: `/${c.label}`, desc: c.hint }))
        : [];

  /* The highlighted row is keyed to the menu and the typed token, so it
     resets when either changes without an effect chasing them. This is the
     adjusting-state-during-render pattern, not a cascade. */
  const key = `${menu ?? ""}:${query}`;
  const [sel, setSel] = useState({ key, at: 0, engaged: false });
  if (sel.key !== key) setSel({ key, at: 0, engaged: false });
  const active = sel.key === key ? sel.at : 0;
  const engaged = sel.key === key ? sel.engaged : false;
  const setActive = (fn: number | ((c: number) => number)) =>
    setSel((p) => ({ ...p, at: typeof fn === "function" ? fn(p.at) : fn }));
  const setEngaged = (on: boolean) => setSel((p) => ({ ...p, engaged: on }));

  /* A single highlight glides to the active row rather than each row toggling
     its own background, so arrowing through the list reads as one movement. */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, rows.length]);

  const memIndex = memory ? 0 : 1;
  useLayoutEffect(() => {
    if (!memoryOpen) return;
    const target = memRefs.current[memHovered ?? memIndex];
    if (target) setMemBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [memoryOpen, memHovered, memIndex]);


  /* The field grows to a compact maximum, then scrolls. This writes a style
     directly rather than setting state, because a height that has to survive a
     render pass would flash at every keystroke.

     The reflow that moves the buttons onto their own row is CSS: the field
     carries a min-width, so when the trailing controls no longer fit beside it
     they wrap. Measuring that in JS, as the reference does, only re-checks when
     the draft changes, which means the layout is wrong for a frame every time
     the window resizes. */
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "0px";
    const content = field.scrollHeight;
    field.style.height = `${Math.min(Math.max(content, 28), 104)}px`;
    field.style.overflowY = content > 104 ? "auto" : "hidden";
  }, [draft]);

  const closeMemory = () => {
    setMemoryOpen(false);
    setMemHovered(null);
  };

  const closeMenus = () => {
    setPlusOpen(false);
    closeMemory();
  };

  const pick = (row: { key: string; name: string; source?: Source }) => {
    if (row.source?.attach) {
      filePicker.current?.click();
      if (token) setDraft(draft.slice(0, token.start));
      setPlusOpen(false);
      return;
    }
    const head = token ? draft.slice(0, token.start) : draft;
    setDraft(menu === "/" ? `${head}${row.name} ` : `${head}@${row.name} `);
    setPlusOpen(false);
    setDismissed(false);
    input.current?.focus();
  };

  const setMemory = (next: boolean) => {
    closeMemory();
    if (next === memory) return;
    onMemory(next);
    // The graph coming back is worth one sweep across the composer. Losing it
    // is not, so this only fires on the way up.
    if (next && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSweeping(true);
      window.setTimeout(() => setSweeping(false), 900);
    }
  };

  const dictate = () => {
    if (listening) {
      speech.current?.stop();
      return;
    }
    const r = recogniser();
    if (!r) return;
    speech.current = r;
    r.onresult = (e) => {
      const said = Array.from(e.results as unknown as { 0: { transcript: string } }[])
        .map((res) => res[0].transcript)
        .join(" ")
        .trim();
      if (said) setDraft((d) => (d ? `${d.trimEnd()} ${said}` : said));
    };
    r.onend = () => {
      setListening(false);
      input.current?.focus();
    };
    r.start();
    setListening(true);
  };

  const canSend = draft.trim().length > 0 || files.length > 0;
  const send = () => {
    if (!canSend || busy) return;
    onSend(draft.trim());
    setDraft("");
    setFiles([]);
    closeMenus();
  };

  return (
    <div className="relative">
      {/* Suggestions scroll sideways on a phone. Stacked, three of these ate
          half the screen and pushed the session itself out of view. */}
      {suggestions.length > 0 && !draft && files.length === 0 && (
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

      {/* ── @ / slash menu ──────────────────────────────────────────────── */}
      {menu && (
        <div
          onMouseLeave={() => setEngaged(false)}
          className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl bg-surface-raised p-1 shadow-2xl ring-1 ring-white/10 [scrollbar-width:thin]"
          style={{ animation: `pop-in 180ms ${EASE} both`, transformOrigin: "bottom center" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 rounded-lg bg-white/[0.07]"
            style={{
              top: rowBox?.top ?? 0,
              height: rowBox?.height ?? 0,
              opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
              transition: `top 220ms ${EASE}, height 220ms ${EASE}, opacity 150ms ease`,
            }}
          />
          {rows.map((row, i) => (
            <button
              key={row.key}
              type="button"
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => {
                setActive(i);
                setEngaged(true);
              }}
              onClick={() => pick(row)}
              className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left"
            >
              {row.source ? (
                <span className="flex size-5 shrink-0 items-center justify-center text-muted">
                  <Icon size={14}>{GLYPHS[row.source.glyph]}</Icon>
                </span>
              ) : row.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.avatar}
                  alt=""
                  className="size-5 shrink-0 rounded-full object-cover object-top ring-1 ring-white/10"
                />
              ) : (
                // Hold the column so names stay in one line whether or not a
                // player has a photograph, which most squads will not.
                <span className="size-5 shrink-0" />
              )}
              <span className="shrink-0 text-[12.5px] font-medium text-chalk">{row.name}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-muted-2">
                {row.desc}
              </span>
            </button>
          ))}
          {rows.length === 0 && (
            <div className="flex h-9 items-center px-2 text-[12px] text-muted-2">
              Nothing matches &ldquo;{query}&rdquo;
            </div>
          )}
          <div className="mt-1 border-t border-white/[0.07] px-2 pt-1.5 pb-1 font-mono text-[10px] text-muted-2">
            {menu === "@" ? "type to search sources, players and clips" : "type to search commands"}
          </div>
        </div>
      )}

      {/* ── memory picker ───────────────────────────────────────────────── */}
      {memoryOpen && (
        <div
          onMouseLeave={() => setMemHovered(null)}
          className="absolute right-0 bottom-full z-30 mb-2 w-72 rounded-xl bg-surface-raised p-1 shadow-2xl ring-1 ring-white/10"
          style={{ animation: `pop-in 180ms ${EASE} both`, transformOrigin: "bottom right" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 rounded-lg bg-white/[0.07]"
            style={{
              top: memBox?.top ?? 0,
              height: memBox?.height ?? 0,
              opacity: memBox && memHovered !== null ? 1 : 0,
              transition: `top 220ms ${EASE}, height 220ms ${EASE}, opacity 150ms ease`,
            }}
          />
          {[
            { on: true, name: "Memory on", tag: memoryOn },
            { on: false, name: "Memory off", tag: memoryOff },
          ].map((m, i) => (
            <button
              key={m.name}
              type="button"
              ref={(el) => {
                memRefs.current[i] = el;
              }}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setMemHovered(i)}
              onClick={() => setMemory(m.on)}
              className="relative z-10 flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-chalk">{m.name}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">{m.tag}</span>
              </span>
              <span className={`mt-0.5 shrink-0 text-accent ${m.on === memory ? "" : "invisible"}`}>
                <Icon size={13} strokeWidth={2.5}>
                  <path d="M20 6L9 17l-5-5" />
                </Icon>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── composer ────────────────────────────────────────────────────── */}
      <div className="relative isolate flex flex-col gap-1.5 overflow-hidden rounded-2xl bg-surface p-1.5 ring-1 ring-white/[0.08] transition-[box-shadow] focus-within:ring-white/[0.16]">
        {/* One sweep when the graph comes back. */}
        {sweeping && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -z-10 w-1/2"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-accent-dim) 35%, rgba(255,87,26,0.24) 50%, var(--color-accent-dim) 65%, transparent)",
              animation: `mem-sweep 900ms ${EASE} both`,
            }}
          />
        )}


        <input
          ref={filePicker}
          type="file"
          accept="video/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (!picked.length) return;
            setFiles((c) => [...c, ...picked.map((f) => f.name)]);
            onAttach?.(picked);
            e.target.value = "";
            input.current?.focus();
          }}
        />

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
            {files.map((file, i) => (
              <span
                key={`${file}-${i}`}
                className="flex h-6.5 items-center gap-1.5 rounded-lg bg-white/[0.06] py-1 pr-1 pl-1.5 text-[11.5px] text-warm"
                style={{ animation: `pop-in 200ms ${EASE} both` }}
              >
                <Icon size={12}>{GLYPHS.tape}</Icon>
                <span className="max-w-36 truncate">{file}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file}`}
                  onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}
                  className="flex size-4 items-center justify-center rounded text-muted-2 transition-colors hover:bg-white/10 hover:text-chalk"
                >
                  <Icon size={10} strokeWidth={2.5}>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </Icon>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* One wrapping row. The field carries a min-width, so the trailing
            controls drop to their own line the moment they stop fitting beside
            it, at any window width, with no measurement. */}
        <div className="flex flex-wrap items-end gap-1">
          <button
            type="button"
            aria-label="Add footage and sources"
            aria-expanded={plusOpen}
            onClick={() => {
              closeMemory();
              setDismissed(false);
              setPlusOpen((c) => !c);
              input.current?.focus();
            }}
            className={`flex size-7 shrink-0 items-center justify-center justify-self-start rounded-lg text-muted transition-[background-color,color,transform] duration-150 hover:bg-white/[0.08] hover:text-chalk active:scale-[0.94] ${
              plusOpen ? "bg-white/[0.08] text-chalk" : ""
            }`}
          >
            <Icon size={16} strokeWidth={2}>
              <path d="M12 5v14M5 12h14" />
            </Icon>
          </button>

          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder={listening ? "Listening…" : "Ask about any player, any clip…"}
            aria-label="Prompt"
            onChange={(e) => {
              setDraft(e.target.value);
              setDismissed(false);
              setPlusOpen(false);
            }}
            onKeyDown={(e) => {
              if (menu && rows.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setEngaged(true);
                  setActive((c) => (c + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                  return;
                }
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                  e.preventDefault();
                  pick(rows[active]);
                  return;
                }
              }
              if (e.key === "Escape") {
                setDismissed(true);
                closeMenus();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="min-h-7 w-[12rem] min-w-0 flex-1 resize-none bg-transparent px-1 py-[5px] text-[13.5px] leading-[18px] text-chalk outline-none [overflow-wrap:anywhere] placeholder:text-muted-2"
          />

          <button
            type="button"
            aria-expanded={memoryOpen}
            aria-label="Memory"
            onClick={() => {
              setPlusOpen(false);
              if (memoryOpen) closeMemory();
              else setMemoryOpen(true);
            }}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 font-mono text-[11px] transition-colors duration-150 hover:bg-white/[0.08] ${
              memory ? "text-warm hover:text-chalk" : "text-muted-2 hover:text-muted"
            } ml-auto`}
          >
            <span
              className={`size-1.5 rounded-full transition-colors ${memory ? "bg-accent" : "bg-white/25"}`}
            />
            memory {memory ? "on" : "off"}
            <span className="text-muted-2">
              <Icon size={10} strokeWidth={2.4}>
                <path d="M6 9l6 6 6-6" />
              </Icon>
            </span>
          </button>

          {canDictate && (
            <button
              type="button"
              aria-label={listening ? "Stop dictation" : "Start dictation"}
              aria-pressed={listening}
              onClick={dictate}
              className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition-[background-color,color,transform] duration-150 active:scale-[0.94] ${
                listening
                  ? "bg-accent-dim text-accent"
                  : "text-muted hover:bg-white/[0.08] hover:text-chalk"
              }`}
            >
              {listening ? (
                <span className="flex h-3.5 items-center gap-[2.5px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-[2.5px] rounded-full bg-current"
                      style={{ height: "100%", animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite` }}
                    />
                  ))}
                </span>
              ) : (
                <Icon size={15} strokeWidth={2}>
                  <g>
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
                  </g>
                </Icon>
              )}
            </button>
          )}

          <button
            type="button"
            aria-label="Send"
            disabled={!canSend || busy}
            onClick={send}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg transition-[background-color,color,transform] duration-200 enabled:bg-accent enabled:text-canvas enabled:active:scale-[0.94] enabled:hover:brightness-110 disabled:bg-white/[0.07] disabled:text-muted-2"
          >
            <Icon size={16} strokeWidth={2.4}>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </Icon>
          </button>
        </div>
      </div>

      <p className="mt-2 font-mono text-[10px] text-muted-2">
        {connected ? (
          <>
            <span className="text-muted">+</span> footage and sources &middot;{" "}
            <span className="text-muted">@</span> a player or clip &middot;{" "}
            <span className="text-muted">/</span> for commands
          </>
        ) : (
          // Same admission the tape makes, worded the same way on purpose.
          // Retrieval needs a HydraDB node and that runs on localhost, so a
          // deployed build cannot answer a new question and says so rather
          // than serving something canned that reads like a real answer.
          "answers run locally. this build has no graph behind it, so what you see is the snapshot the session was built on"
        )}
      </p>
    </div>
  );
}
