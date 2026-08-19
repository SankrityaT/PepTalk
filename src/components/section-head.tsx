"use client";

/**
 * A section heading, without the small grey line above it.
 *
 * Every section opened with the same thing: ten-pixel mono, uppercase, letter
 * spaced, "03 — THE SESSION". It is the default kicker on every landing page
 * shipped in the last four years, it says nothing the heading beneath it does
 * not, and having four of them in a row makes a page look generated rather
 * than designed.
 *
 * The number is worth keeping, because a long page reads better when you know
 * where you are in it. So it stays and gets bigger: set in the pixel face the
 * wordmark uses, sized like a chapter mark, and dropped to a whisper of
 * opacity so it is texture rather than text. It sits behind the top-left of
 * the heading and bleeds past it, which is why it reads as a mark on the page
 * instead of a label attached to a paragraph.
 *
 * The words that used to sit next to the number are gone entirely. "03 — the
 * session" above a heading that reads "A coach sits down. The tape is already
 * read." was saying the same thing twice, once badly.
 */

import type { ReactNode } from "react";

export function SectionHead({
  n,
  children,
  tone = "chalk",
  className = "",
}: {
  /** The chapter number, as it should read. */
  n: string;
  children: ReactNode;
  /** `ink` for the orange section, where the page inverts. */
  tone?: "chalk" | "ink";
  className?: string;
}) {
  const ghost = tone === "ink" ? "text-canvas/[0.14]" : "text-chalk/[0.06]";
  const type = tone === "ink" ? "text-canvas" : "text-chalk";

  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden
        // Big enough to read as a mark on the page rather than a character
        // behind the text. The first attempt sat at roughly twice the
        // heading's size and collided with its first word, which looked like a
        // rendering fault; at four times the size and bled off to the left it
        // is unmistakably deliberate. The pixel face wants the room, since its
        // whole character is in the corners.
        className={`pointer-events-none absolute -top-[0.30em] -left-[0.30em] z-0 hidden select-none font-display leading-none tracking-[-0.05em] sm:block sm:text-[190px] lg:-left-[0.42em] lg:text-[240px] ${ghost}`}
      >
        {n}
      </span>
      <h2
        className={`relative z-10 max-w-3xl text-[34px] leading-[1.08] font-medium tracking-[-0.02em] sm:text-[46px] ${type}`}
      >
        {children}
      </h2>
    </div>
  );
}
