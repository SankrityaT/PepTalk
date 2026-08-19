"use client";

import { useRef, useSyncExternalStore } from "react";
import Image from "next/image";
import { motion, useInView } from "motion/react";
import { MomentPitch } from "@/components/report/moment-pitch";
import { XtPitch } from "@/components/dash/xt-pitch";
import { SectionHead } from "@/components/section-head";
import { MOMENTS } from "@/content/pep";

/**
 * Section 05: how the pieces join.
 *
 * The first version was five stages of prose with a monospaced readout panel
 * beside each one, and the panels were the problem. They were styled like
 * interface, so they read as screenshots of a screen that does not exist. On a
 * page whose entire argument is that its pictures are real, inventing UI to
 * illustrate a paragraph was the one unforgivable thing to do.
 *
 * It shows the actual things now. The frame on the left is the running tape
 * with real detections on it. The board on the right is `MomentPitch`, the same
 * component the session draws, handed the same De Paul moment out of the same
 * snapshot. The grid below is `XtPitch`, which is the threat model itself and
 * responds to a cursor.
 *
 * Those two pictures side by side are the project in one line: the same second
 * of football, once as pixels and once as coordinates. Nothing joins them but
 * the clock, and saying that is more honest than drawing an arrow between two
 * boxes labelled CV and graph.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** The ball rolled to the byline eight minutes in, with one into the box on. */
const DE_PAUL = MOMENTS.find((m) => m.minute === 8) ?? MOMENTS[0] ?? null;

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
      initial={{ opacity: 0, y: 22 }}
      animate={seen ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * The board, drawn after hydration rather than during it.
 *
 * `MomentPitch` animates `pathLength` on its arrows, and motion writes the
 * dash attributes that implement that only on the client. The server sends the
 * paths without them, so React reports a hydration mismatch on a component
 * whose markup is in fact correct. It has never come up before because this
 * board only ever rendered inside the session, which the landing page does not
 * server-render.
 *
 * Gating on mount is the honest fix rather than suppressing the warning: the
 * board is an animated illustration, so there is nothing in it that wants to
 * be in the server's HTML. The reserved box stops the section reflowing when
 * it arrives.
 */
const NEVER_CHANGES = () => () => {};

function BoardAfterMount() {
  // The canonical "have we hydrated yet" read. Setting state in an effect does
  // the same job and is a synchronous setState on mount, which is the thing
  // React now asks you not to do; this returns false to the server renderer
  // and true to the browser with no render cascade.
  const ready = useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );

  return (
    <div className="aspect-[120/80] w-full overflow-hidden rounded-xl bg-pitch ring-1 ring-white/[0.08]">
      {ready && <MomentPitch moment={DE_PAUL} />}
    </div>
  );
}

/** A label under a picture, which is all the words a picture should need. */
function Caption({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[13px] leading-relaxed text-muted">
      <span className="text-warm-2">{k}</span> {children}
    </p>
  );
}

export function SectionPipeline() {
  return (
    <section className="relative bg-canvas px-5 py-28 sm:px-8 lg:py-36">
      <div className="mx-auto w-full max-w-6xl">
        <Reveal>
          <SectionHead n="05">One second, in two languages.</SectionHead>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-warm-2">
            Eight minutes into the final, De Paul rolled it to the byline with a
            ball into the box on. Here is that instant as the video sees it, and
            as the graph sees it.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <Reveal>
            {/* Held to the pitch's own 120x80 so the two panels are the same
                height and their captions sit on one line. */}
            <div className="aspect-[120/80] overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.08]">
              <Image
                src="/shots/tracked.webp"
                alt="A frame of the broadcast with every player boxed by the detector, the receiver circled in space and the defensive line drawn across"
                width={1280}
                height={816}
                unoptimized
                className="block h-full w-full object-cover"
              />
            </div>
            <Caption k="In pixels.">
              YOLO11m finds the players. Kit colours are clustered frame by
              frame, because a stadium changes colour as the light goes.
            </Caption>
          </Reveal>

          <Reveal delay={0.08}>
            <BoardAfterMount />
            <Caption k="In coordinates.">
              The ball he played in chalk, the ball that was on in orange. Six
              times the threat, and no less likely to arrive.
            </Caption>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <p className="mt-10 max-w-3xl border-t border-white/[0.07] pt-8 text-[15px] leading-relaxed text-warm-2">
            Nothing joins those two pictures except the clock. A broadcast clock
            does not agree with a match clock, so one offset per period is read
            off the overlay, and that single measurement is what lets a number
            computed from event data point at a second of video.
          </p>
        </Reveal>

        {/* The model that decides "a better ball was on" is a real thing, and
            it responds to a cursor rather than sitting in a caption. */}
        <Reveal delay={0.06} className="mt-12">
          <div className="rounded-xl bg-surface p-5 ring-1 ring-white/[0.06] lg:p-6">
            <XtPitch />
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mt-10 max-w-3xl text-[15px] leading-relaxed text-warm-2">
            Then HydraDB decides whether it matters. One pass is an anecdote, so
            the moment is held against what this player and 352 other sides have
            done, every fact carrying the dates it was true and an edge to
            whatever replaced it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
