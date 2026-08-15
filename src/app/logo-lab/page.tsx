import { PepTalkMark } from "@/components/logo-marks";

/**
 * Scratch route for checking the mark at every size and tier it has to
 * survive. Delete before the submission build.
 */

const TIERS = [
  { detail: "full" as const, label: "Full / 64px and up", sizes: [64, 96, 160] },
  { detail: "medium" as const, label: "Medium / 22 to 48px", sizes: [22, 26, 32, 48] },
  { detail: "compact" as const, label: "Compact / 16 to 22px", sizes: [16, 18, 20, 22] },
];

export default function LogoLab() {
  return (
    <main className="min-h-screen bg-canvas px-10 py-14">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
        Logo lab
      </p>
      <h1 className="mt-3 font-display text-3xl text-chalk">The mark</h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        One mark, three tiers. Size picks the tier automatically, so the page
        can never show a different mark than the one signed off, only a
        different amount of it.
      </p>

      {TIERS.map(({ detail, label, sizes }) => (
        <section key={detail} className="mt-12 border-t border-rule pt-8">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            {label}
          </h2>
          <div className="mt-8 flex flex-wrap items-end gap-12">
            {sizes.map((size) => (
              <div key={size} className="flex flex-col items-center gap-3">
                <PepTalkMark size={size} detail={detail} className="text-chalk" />
                <span className="font-mono text-[9px] text-muted-2">{size}px</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* ── The nav lockup, at true size ─────────────────────────── */}
      <section className="mt-12 border-t border-rule pt-8">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          In situ / exactly what the nav renders
        </h2>
        <div className="mt-8 flex flex-wrap items-center gap-8">
          <div className="flex items-center gap-2.5 border border-rule px-4 py-3">
            <PepTalkMark size={26} className="text-chalk" />
            <span className="font-display text-sm text-chalk">Pep Talk</span>
            <span className="ml-1.5 border border-rule px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2">
              Built on HydraDB
            </span>
          </div>
          <div className="flex items-center gap-2.5 bg-chalk px-4 py-3">
            <PepTalkMark size={26} className="text-canvas" />
            <span className="font-display text-sm text-canvas">Pep Talk</span>
          </div>
          {/* On accent the accent elements must go monochrome. */}
          <div className="flex items-center gap-2.5 bg-accent px-4 py-3">
            <PepTalkMark size={26} className="text-canvas" monochrome />
            <span className="font-display text-sm text-canvas">Pep Talk</span>
          </div>
        </div>
      </section>

      {/* ── Motion ───────────────────────────────────────────────── */}
      <section className="mt-12 border-t border-rule pt-8">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          Motion / reload the page to replay the assemble
        </h2>
        <div className="mt-8 flex flex-wrap items-center gap-14">
          <div className="flex flex-col items-center gap-3">
            <PepTalkMark size={96} className="text-chalk" draw />
            <span className="font-mono text-[9px] text-muted-2">
              assemble on mount
            </span>
          </div>

          <div className="flex flex-col items-center gap-3">
            <PepTalkMark size={96} className="text-chalk" scanning />
            <span className="font-mono text-[9px] text-muted-2">
              scanning loop
            </span>
          </div>

          <div className="flex flex-col items-center gap-3">
            {/* group is required for lock-on: the brackets react to hover on
                the wrapper, not on the svg. */}
            <div className="group cursor-pointer p-2">
              <PepTalkMark size={96} className="text-chalk" interactive />
            </div>
            <span className="font-mono text-[9px] text-muted-2">
              lock-on, hover me
            </span>
          </div>

          <div className="flex items-center gap-3 border border-rule px-5 py-4">
            <PepTalkMark size={26} className="text-chalk" scanning />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              Retrieving as_of 2011
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
