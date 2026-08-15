import { ALL_STATES_VERIFIED, TACTICAL_STATES } from "@/content/hero";

/**
 * Dev-only guard against shipping placeholder numbers.
 *
 * The page's credibility argument is that every figure regenerates from the
 * harness. Placeholder geometry that looks plausible is the most dangerous
 * kind, because nothing about the rendered page reveals it. This makes it
 * loud in development and stays out of the production bundle.
 */
export function ProvenanceNotice() {
  if (process.env.NODE_ENV === "production" || ALL_STATES_VERIFIED) return null;

  const unverified = TACTICAL_STATES.filter((s) => !s.verified);

  return (
    // Top-right: the bottom of the hero is where the headline and the
    // scrub indicator live, and this was covering both.
    <div className="fixed top-20 right-3 z-50 hidden max-w-[15rem] border border-accent/40 bg-canvas/95 p-3 font-mono text-[10px] leading-relaxed text-accent backdrop-blur sm:block">
      <strong className="block uppercase tracking-[0.14em]">
        Unverified data
      </strong>
      <span className="mt-1 block text-muted">
        {unverified.length} of {TACTICAL_STATES.length} tactical states are
        placeholder geometry. Replace from results/provenance.json and set
        verified: true before shipping.
      </span>
    </div>
  );
}
