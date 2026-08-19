"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useInView } from "motion/react";

/**
 * Sections 03 and 04: the product, shown.
 *
 * What was here before was two sections of explanation: a time-travel query
 * rendered as a schema browser, and a pipeline described in four stages of
 * prose. Both were the page telling a judge how the thing works instead of
 * letting them look at it, which was defensible when there was not much to
 * look at. There is now.
 *
 * So the pictures are real. Every screenshot is the running product against
 * the 2022 World Cup final, captured from the same build this page links to,
 * and every number quoted beside them is one the interface actually shows.
 * Nothing here is a mock, which is the whole argument: a landing page for a
 * tool that claims to refuse invented numbers cannot itself invent its
 * screenshots.
 *
 * The shape follows what good product pages do now. One wide frame that
 * carries the idea, then cards that are windows onto real interface rather
 * than icons with captions.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-12% 0px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={seen ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A screenshot, framed like a window rather than dropped on the page. */
function Frame({
  src,
  alt,
  width,
  height,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={`relative block overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.08] ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        // next/image re-encodes at quality 75 by default, which is a lossy
        // pass over a screenshot that was already captured at two times device
        // pixels and written as webp at 92. That second compression is what
        // made every one of these look soft. These files are already the size
        // they are served at, so they are served byte for byte.
        unoptimized
        className="block w-full"
      />
      {/* The bottom of a screenshot is the least interesting part of it, and
          fading it stops the card ending on a hard cut. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-canvas/80 to-transparent" />
    </span>
  );
}

const CARDS: {
  eyebrow: string;
  title: string;
  body: string;
  shot: string;
  w: number;
  h: number;
}[] = [
  {
    eyebrow: "the squad",
    title: "Every player, against his own norm",
    body: "Not a league average. His threat created, his threat left on the table, and what that measure has been across every game the graph holds.",
    shot: "/shots/roster.webp",
    w: 2040,
    h: 1240,
  },
  {
    eyebrow: "one player",
    title: "His footage, and what to do about it",
    body: "The ball he did not play, cut from the broadcast and tracked. Beside it, this game against his norm, and a line about what to work on.",
    shot: "/shots/player.webp",
    w: 2048,
    h: 1240,
  },
];

export function SectionProduct() {
  return (
    <section id="the-session" className="relative scroll-mt-20 bg-canvas px-5 py-28 sm:px-8 lg:py-40">
      <div className="mx-auto w-full max-w-6xl">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.16em] text-accent uppercase">
            03 — the session
          </p>
          <h2 className="mt-4 max-w-3xl text-[34px] leading-[1.08] font-medium tracking-[-0.02em] text-chalk sm:text-[46px]">
            A coach sits down. The tape is already read.
          </h2>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-warm-2">
            Not an upload form. Pep has been through the match, found the
            moments worth stopping on, and cut them from the broadcast. The
            video stays pinned and he works down the side of it, one moment at
            a time, the way a coach goes through tape with an assistant.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-12">
          <Frame
            src="/shots/session.webp"
            alt="The session: the tape pinned on the left with tracking and chalk, Pep working down the right"
            width={2132}
            height={1600}
            priority
          />
        </Reveal>

        <Reveal delay={0.12}>
          <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-white/[0.07] pt-8 sm:grid-cols-3">
            {[
              ["803 → 8", "passes with a better option, down to the ones that would have made a chance"],
              ["one offset per period", "the broadcast clock read off the overlay, so a clip lands on the right second"],
              ["2,096 dated facts", "every claim carries the node it came from"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[13px] text-accent">{k}</dt>
                <dd className="mt-1.5 text-[13px] leading-relaxed text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        {/* ── the cards ──────────────────────────────────────────────── */}
        <div className="mt-24 grid gap-5 lg:mt-32 lg:grid-cols-2">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} delay={0.06 * i}>
              <article className="flex h-full flex-col overflow-hidden rounded-2xl bg-surface p-6 ring-1 ring-white/[0.07] transition-colors hover:ring-white/[0.14]">
                <p className="font-mono text-[10px] tracking-[0.14em] text-muted-2 uppercase">
                  {c.eyebrow}
                </p>
                <h3 className="mt-3 text-[21px] leading-tight font-medium text-chalk">
                  {c.title}
                </h3>
                <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted">
                  {c.body}
                </p>
                <span className="mt-6 -mb-10 block">
                  <Frame src={c.shot} alt={c.title} width={c.w} height={c.h} />
                </span>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Section 04: the memory, which is the argument.
 *
 * One switch, two answers to the same question, from the same model on the
 * same match. This is the only place the page makes a claim about HydraDB,
 * and it makes it by showing what disappears rather than by describing a
 * schema.
 */
export function SectionMemory() {
  return (
    <section className="relative bg-canvas px-5 pt-28 pb-10 sm:px-8 lg:pt-40 lg:pb-16">
      <div className="mx-auto w-full max-w-6xl">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.16em] text-accent uppercase">
            04 — the memory
          </p>
          <h2 className="mt-4 max-w-3xl text-[34px] leading-[1.08] font-medium tracking-[-0.02em] text-chalk sm:text-[46px]">
            Turn it off and watch what he loses.
          </h2>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-warm-2">
            The same question, the same model, the same match. With the graph
            connected he answers from 2,096 dated facts across 353 sides. Without
            it he can still read the game in front of him, and that is the point:
            what goes is not his eyesight, it is his memory.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {[
            {
              on: true,
              label: "memory on",
              shot: "/shots/answer-on.webp",
              foot: "17 facts retrieved from HydraDB, 5 used",
            },
            {
              on: false,
              label: "memory off",
              shot: "/shots/answer-off.webp",
              foot: "7 measurements retrieved, 0 dated",
            },
          ].map((c, i) => (
            <Reveal key={c.label} delay={0.06 * i}>
              <div
                className={`flex h-full flex-col rounded-2xl bg-surface p-5 ring-1 ${
                  c.on ? "ring-accent/25" : "ring-white/[0.07]"
                }`}
              >
                <span
                  className={`inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase ${
                    c.on ? "text-accent" : "text-muted-2"
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${c.on ? "bg-accent" : "bg-white/25"}`}
                  />
                  {c.label}
                </span>

                {/* The screen itself. Quoting the answer as body copy made this
                    section two paragraphs of prose, which is the one thing a
                    page about a visual product should not be. */}
                <span className="relative mt-4 block overflow-hidden rounded-xl ring-1 ring-white/[0.06]">
                  <Image
                    src={c.shot}
                    alt={`The same question answered with ${c.label}`}
                    width={1076}
                    height={834}
                    unoptimized
                    className="block w-full"
                  />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-surface via-surface/70 to-transparent" />
                </span>

                <p className="mt-4 font-mono text-[10px] text-muted-2">{c.foot}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <p className="mt-8 max-w-3xl border-t border-white/[0.07] pt-8 text-[14px] leading-relaxed text-muted">
            Neither answer is written anywhere. The switch is implemented in
            retrieval, which is the only honest place for it: with memory off the
            fact queries do not run, and everything measured off the match still
            reaches the model.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
