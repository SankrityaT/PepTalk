//created by kinjal
"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { MATCH, ROSTER } from "@/content/pep";

/**
 * Screen 1, and the front door.
 *
 * This is the screen that decides whether a coach feels welcome, so it gets the
 * warm treatment rather than the landing page's developer-facing chrome: sans
 * for reading, raised surfaces, real breathing room, and copy that instructs
 * rather than markets.
 *
 * Two inputs and nothing else. The roster box is the cheap trick that makes the
 * whole report feel personal — the difference between "player 7" and "De Paul"
 * — and it costs the coach one paste.
 *
 * The file now leaves this screen. It used to be discarded here, which made
 * every report the example match wearing someone else's filename.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function Upload({
  onStart,
  onExample,
  busy = false,
  progress = 0,
  error,
}: {
  onStart: (file: File, roster: string[]) => void;
  onExample: (roster: string[]) => void;
  busy?: boolean;
  /** 0-1 while the file is being sent. */
  progress?: number;
  error?: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [roster, setRoster] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const names = roster
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  const useExample = () => {
    const squad = [...ROSTER.Argentina, ...ROSTER.France];
    setRoster(squad.join("\n"));
    onExample(squad);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="mx-auto w-full max-w-2xl"
    >
      <h1 className="text-[32px] leading-tight font-medium text-chalk sm:text-[42px]">
        Drop in a game.
      </h1>
      <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-warm-2">
        Pep watches the whole thing and tells you what you missed: which balls
        were on, who kept turning back, and the three things to work on at
        training this week.
      </p>

      <div className="mt-12 flex flex-col gap-6">
        {/* ── Video ─────────────────────────────────────────────────── */}
        <div>
          <label className="text-[15px] font-medium text-chalk">
            Your match
          </label>
          <p className="mt-1 text-[14px] text-muted">
            A full game, highlights, or a phone recording from the touchline.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            onClick={() => input.current?.click()}
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl px-6 py-14 ring-1 transition-all duration-200 ease-[var(--ease-ui)] ${
              over
                ? "bg-accent/[0.07] ring-accent/60"
                : "bg-surface ring-white/[0.06] hover:bg-surface-2 hover:ring-white/[0.12]"
            }`}
          >
            <input
              ref={input}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <span className="text-[16px] text-chalk">{file.name}</span>
                <span className="mt-1.5 font-mono text-[12px] tabular-nums text-muted">
                  {(file.size / 1048576).toFixed(0)} MB
                </span>
              </>
            ) : (
              <>
                <span className="text-[16px] text-warm">
                  Drag a video here
                </span>
                <span className="mt-1.5 text-[14px] text-muted-2">
                  or click to choose one
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── Roster ────────────────────────────────────────────────── */}
        <div>
          <label className="text-[15px] font-medium text-chalk">
            Who played
          </label>
          <p className="mt-1 text-[14px] text-muted">
            One name per line, so Pep can tell you who to talk to.
          </p>
          <textarea
            value={roster}
            onChange={(e) => setRoster(e.target.value)}
            rows={5}
            placeholder={"Marcus Reid\nDanny Okafor\n…"}
            className="mt-4 w-full resize-y rounded-xl bg-surface px-5 py-4 text-[15px] leading-relaxed text-chalk ring-1 ring-white/[0.06] transition-colors placeholder:text-muted-2 focus:bg-surface-2 focus:ring-white/[0.14] focus:outline-none"
          />
          {names.length > 0 && (
            <span className="mt-2 block text-[13px] text-muted-2">
              {names.length} {names.length === 1 ? "player" : "players"}
            </span>
          )}
        </div>
      </div>

      {/* ── Sending ─────────────────────────────────────────────────── */}
      {busy && (
        <div className="mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[14px] text-warm-2">Sending your footage</span>
            <span className="font-mono text-[12px] tabular-nums text-muted">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.07]">
            {/* Width, not scaleX: a scaled bar rounds its own caps mid-transition. */}
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease-ui)]"
              style={{ width: `${Math.max(2, progress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-8 rounded-xl bg-surface px-5 py-4 text-[14px] leading-relaxed text-warm ring-1 ring-white/[0.06]">
          {error}
        </p>
      )}

      {/* ── Go ──────────────────────────────────────────────────────── */}
      <div className="mt-10 flex flex-wrap items-center gap-5">
        <button
          onClick={() => file && onStart(file, names)}
          disabled={!file || busy}
          className="rounded-lg bg-accent px-6 py-3 text-[15px] font-medium text-canvas transition-all duration-150 ease-[var(--ease-ui)] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-muted-2"
        >
          {busy ? "Sending…" : "Watch my game"}
        </button>
        <button
          onClick={useExample}
          disabled={busy}
          className="text-[15px] text-warm-2 underline decoration-white/20 underline-offset-4 transition-colors hover:text-chalk hover:decoration-white/50 disabled:text-muted-2"
        >
          Don&rsquo;t have one? See it on the World Cup final
        </button>
      </div>

      {/* Said plainly, rather than discovered by a coach whose match is not
          covered. The restriction is real and it is not a bug: without freeze
          frames there is no evidence for "he was open". */}
      <p className="mt-8 max-w-xl text-[13px] leading-relaxed text-muted-2">
        Pep reads your footage alongside the match data, so the fixture has to
        be one StatsBomb covers &mdash; Euro 2020 and 2024, both Women&rsquo;s
        Euros, the Women&rsquo;s World Cup, MLS 2023, La Liga 2020/21, Ligue 1,
        the Bundesliga, AFCON 2023 or the {MATCH.competition}. You pick the
        fixture on the next screen. Everything you see afterwards is computed
        from that data and your own tape.
      </p>
    </motion.div>
  );
}
