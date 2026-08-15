import { ChalkFilters } from "@/components/chalk-filters";
import { Hero } from "@/components/hero";
import { ProvenanceNotice } from "@/components/provenance-notice";
import { SectionClaim } from "@/components/section-claim";

export default function Home() {
  return (
    <main className="flex-1">
      <ChalkFilters />
      <Hero />
      <SectionClaim />
      {/* Section 03 onward lands here. */}
      <div className="h-screen" />
      <ProvenanceNotice />
    </main>
  );
}
