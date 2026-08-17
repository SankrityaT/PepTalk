import { ChalkFilters } from "@/components/chalk-filters";
import { Hero } from "@/components/hero";
import { SectionClaim } from "@/components/section-claim";
import { SectionMemory, SectionProduct } from "@/components/section-product";
import { SmoothScroll } from "@/components/smooth-scroll";

export default function Home() {
  return (
    <main className="flex-1">
      <SmoothScroll />
      <ChalkFilters />
      <Hero />
      <SectionClaim />
      <SectionProduct />
      <SectionMemory />
    </main>
  );
}
