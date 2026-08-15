import { PepTalkMark } from "./logo-marks";

/**
 * Minimal top nav.
 *
 * PlayVision's hero works because almost nothing competes with the image:
 * a wordmark, two links, and that is the entire chrome. Same discipline
 * here. This is also where the real logo lands once it exists.
 */
export function SiteNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-5 sm:px-10 sm:py-7">
      <a href="#hero" className="group flex items-center gap-2.5">
        {/* Medium tier: keeps the detection brackets and the graph nodes,
            drops only the lane grid. At the old 18px compact size the nav
            was showing a visibly different mark from the one in the lab. */}
        <PepTalkMark size={26} className="text-chalk" interactive />
        <span className="font-display text-sm tracking-[-0.01em] text-chalk">
          Pep Talk
        </span>
        {/* Credibility chip, in PlayVision's "Backed by Y Combinator"
            position. Moved here so the hero eyebrow is free for the hook. */}
        <span className="ml-1.5 hidden border border-rule px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2 sm:inline-block">
          Built on HydraDB
        </span>
      </a>

      <nav className="flex items-center gap-2">
        <a
          href="#time-travel"
          className="hidden px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted transition-colors duration-150 ease-[var(--ease-ui)] hover:text-chalk sm:block"
        >
          The demo
        </a>
        <a
          href="https://github.com"
          className="border border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-chalk transition-colors duration-150 ease-[var(--ease-ui)] hover:bg-white/5"
        >
          GitHub
        </a>
      </nav>
    </header>
  );
}
