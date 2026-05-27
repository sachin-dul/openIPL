import { notFound } from "next/navigation";
import { isValidSeason } from "@/lib/seasons";
import { SiteHeader } from "@/components/site-header";
import { SeasonSubNav } from "@/components/season-sub-nav";
import { SeasonProvider } from "@/components/season-context";

export default async function SeasonLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ year: string }>;
}) {
  const { year: yearStr } = await params;
  const year = Number(yearStr);
  if (!Number.isFinite(year) || !isValidSeason(year)) {
    notFound();
  }

  return (
    <SeasonProvider season={year}>
      <SiteHeader />
      <main className="max-w-[1320px] mx-auto px-6 py-5 w-full">
        <SeasonSubNav year={year} />
        {children}
      </main>
    </SeasonProvider>
  );
}
