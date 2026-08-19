import { ChalkFilters } from "@/components/chalk-filters";
import { Hero } from "@/components/hero";
import { SectionClaim } from "@/components/section-claim";
import { SectionClose } from "@/components/section-close";
import { SectionMemory, SectionProduct } from "@/components/section-product";
import { SectionPipeline } from "@/components/section-pipeline";
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
      <SectionPipeline />
      <SectionClose />
    </main>
  );
}
