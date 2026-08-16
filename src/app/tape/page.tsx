import { ChalkFilters } from "@/components/chalk-filters";
import { Tape } from "@/components/tape";

export default function TapePage() {
  return (
    <main className="min-h-screen px-5 py-14 sm:px-10">
      <ChalkFilters />
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8">
          <div className="mb-3 h-px w-10 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            The interface
          </span>
          <h1 className="mt-3 font-display text-[32px] leading-tight text-chalk sm:text-[44px]">
            It watches the tape.
          </h1>
        </div>
        <Tape />
      </div>
    </main>
  );
}
