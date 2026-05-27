import { SiteHeader } from "@/components/site-header";
import { LandingContent } from "./landing-content";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="w-full">
        <LandingContent />
      </main>
    </>
  );
}
