import { ChalkFilters } from "@/components/chalk-filters";
import { MemoryScrubber } from "@/components/memory-scrubber";

export default function ScrubPage() {
  return (
    <main className="min-h-screen px-5 py-16 sm:px-10">
      <ChalkFilters />
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-8">
          <div className="mb-3 h-px w-10 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            05 / The interface
          </span>
          <h1 className="mt-3 font-display text-[32px] leading-tight text-chalk sm:text-[44px]">
            Drag through a team&rsquo;s memory.
          </h1>
        </div>
        <MemoryScrubber />
      </div>
    </main>
  );
}
