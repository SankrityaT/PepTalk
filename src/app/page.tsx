import { ChalkFilters } from "@/components/chalk-filters";
import { Hero } from "@/components/hero";
import { SectionClaim } from "@/components/section-claim";
import { SectionHowItWorks } from "@/components/section-how-it-works";
import { SectionTimeTravel } from "@/components/section-time-travel";

export default function Home() {
  return (
    <main className="flex-1">
      <ChalkFilters />
      <Hero />
      <SectionClaim />
      <SectionTimeTravel />
      <SectionHowItWorks />
    </main>
  );
}
