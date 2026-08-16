import { ChalkFilters } from "@/components/chalk-filters";
import { Hero } from "@/components/hero";
import { SectionClaim } from "@/components/section-claim";
import { SectionHowItWorks } from "@/components/section-how-it-works";
import { SectionTimeTravel } from "@/components/section-time-travel";
import { SmoothScroll } from "@/components/smooth-scroll";

export default function Home() {
  return (
    <main className="flex-1">
      <SmoothScroll />
      <ChalkFilters />
      <Hero />
      <SectionClaim />
      <SectionTimeTravel />
      <SectionHowItWorks />
    </main>
  );
}
