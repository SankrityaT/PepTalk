import { ChalkFilters } from "@/components/chalk-filters";
import { Hero } from "@/components/hero";
import { ProvenanceNotice } from "@/components/provenance-notice";

export default function Home() {
  return (
    <main className="flex-1">
      <ChalkFilters />
      <Hero />
      {/* Section 02 onward lands here. Spacer keeps the hero's sticky
          release visible while the rest is built out. */}
      <div className="h-screen border-t border-rule" />
      <ProvenanceNotice />
    </main>
  );
}
