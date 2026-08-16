"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MomentFrame } from "@/components/report/moment-frame";
import { MOMENTS, Moment, THEMES } from "@/content/pep";

/**
 * This week. The top of the report, and the reason it exists.
 *
 * This used to be three paragraphs. A coach does not read three paragraphs
 * between sessions, and a paragraph asks them to take the claim on trust —
 * so the card now leads with the frozen moment itself. You can see the man
 * who was open, and the two balls drawn over the top of him, before you have
 * read a word.
 *
 * The order is deliberate: SHOW the moment, NAME what went wrong in a handful
 * of words, then GIVE the drill. Everything longer than that is folded away.
 *
 * Three because a coach can hold three. A list of eight is a list of nothing.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

/**
 * The compact read, counted off the moments the theme actually cites rather
 * than written — short by construction and true by construction.
 *
 * Deliberately a stat strip rather than a sentence. An earlier version tried
 * to phrase this and every theme came out identical, because the moments
 * genuinely are alike: almost all of them are "ball went backwards with the
 * box open". What separates the three themes is meaning, not measurement, so
 * measurement should stop pretending to supply it.
 */
function facts(clips: Moment[]): string[] {
  if (!clips.length) return [];
  const lead = clips[0];
  const out = [`${clips.length} ${clips.length === 1 ? "moment" : "moments"}`];
  if (lead.times_better) out.push(`worth ${Math.round(lead.times_better)}× more`);
  const free = clips.filter((c) => c.no_riskier).length;
  if (free) out.push(free === clips.length ? "none harder" : `${free} no harder`);
  return out;
}

/**
 * Pull the instruction out of a long-form `why`.
 *
 * The themes were written as "here is what happened, SO here is what to do",
 * and the half after the "so" is the only half a coach acts on. Splitting it
 * out roughly halves the reading and puts the verb first.
 *
 * This is a bridge, not the destination: the generator now emits a dedicated
 * `drill` field, and once a snapshot carries one this function is never
 * reached. It is string surgery on prose, so it fails safe — no match, and the
 * original sentence is returned untouched.
 */
function action(why: string | undefined): string | null {
  if (!why) return null;
  // The pivot is written variously as ", so", " — so", or " – so".
  const matches = [...why.matchAll(/[,—–-]\s*so\s+/gi)];
  const last = matches[matches.length - 1];
  if (!last?.index) return null;
  const tail = why.slice(last.index + last[0].length).trim();
  if (tail.length < 12) return null;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

export function ThisWeek({ onSelect }: { onSelect: (m: Moment) => void }) {
  const [why, setWhy] = useState<string | null>(null);
  if (!THEMES.length) return null;

  /** Moments already used as a card's lead image, so no frame repeats. */
  const leads = new Set<number>();

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium text-chalk">
          Three things for Tuesday
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
          white = yours &middot; hollow = theirs
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {THEMES.map((t, i) => {
          const clips = t.moment_ids
            .map((id) => MOMENTS.find((m) => m.id === id))
            .filter(Boolean) as Moment[];
          // Themes overlap — several cite the same moment, and taking each
          // card's first clip drew the same frame three times. Prefer a moment
          // no earlier card has already shown, so the row reads as three
          // different problems rather than one picture repeated.
          const lead = clips.find((c) => !leads.has(c.id)) ?? clips[0];
          if (lead) leads.add(lead.id);
          const showing = why === t.title;

          return (
            <motion.article
              key={t.title}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.09, ease: EASE }}
              className="flex flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]"
            >
              {/* ── The moment, before any words ────────────────────── */}
              {lead && (
                <button
                  onClick={() => onSelect(lead)}
                  className="group relative block w-full text-left"
                >
                  <MomentFrame moment={lead} compact />
                  <span className="absolute left-3 top-3 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-chalk backdrop-blur-sm">
                    {lead.minute}&rsquo;
                  </span>
                  <span className="absolute bottom-3 right-3 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-muted opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    play it &rarr;
                  </span>
                </button>
              )}

              <div className="flex flex-1 flex-col p-4">
                <h3 className="text-[17px] leading-snug font-medium text-chalk">
                  {t.title}
                </h3>

                {/* What went wrong, in a handful of words. */}
                {t.saw ? (
                  <p className="mt-1.5 text-[13px] leading-snug text-muted">
                    {t.saw}
                  </p>
                ) : (
                  <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-muted">
                    {facts(clips).map((f, k) => (
                      <span key={f} className="flex items-center gap-2">
                        {k > 0 && <span className="text-muted-2">·</span>}
                        {f}
                      </span>
                    ))}
                  </p>
                )}

                {/* ── The drill ───────────────────────────────────────────
                    Only rendered when a real one exists. The fallback used to
                    be the long-form `why`, which put a paragraph inside a box
                    labelled DO THIS and made the problem worse rather than
                    better. */}
                {(() => {
                  const drill = t.drill ?? action(t.why);
                  if (!drill) {
                    return (
                      <p className="mt-3 text-[13px] leading-relaxed text-warm-2">
                        {t.why}
                      </p>
                    );
                  }
                  return (
                    <div className="mt-3.5 rounded-lg bg-accent/[0.07] px-3.5 py-3 ring-1 ring-accent/20">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
                        do this
                      </span>
                      <p className="mt-1.5 text-[14px] leading-snug text-warm">
                        {drill}
                      </p>
                    </div>
                  );
                })()}

                {/* ── The rest, folded away ───────────────────────────── */}
                <div className="mt-auto pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => setWhy(showing ? null : t.title)}
                      className="font-mono text-[10px] text-muted-2 transition-colors hover:text-muted"
                      aria-expanded={showing}
                    >
                      {showing ? "▴" : "▾"} why
                    </button>
                    <span className="flex gap-1.5">
                      {clips.slice(0, 5).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => onSelect(c)}
                          className="rounded bg-white/[0.05] px-2 py-1 font-mono text-[10px] tabular-nums text-muted transition-colors hover:bg-accent/25 hover:text-chalk"
                        >
                          {c.minute}&rsquo;
                        </button>
                      ))}
                    </span>
                  </div>

                  <AnimatePresence initial={false}>
                    {showing && t.why && (
                      <motion.p
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: EASE }}
                        className="overflow-hidden text-[13px] leading-relaxed text-warm-2"
                      >
                        <span className="block pt-2.5">{t.why}</span>
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
