import { notFound } from "next/navigation";
import Link from "next/link";
import { isValidSeason, SEASONS, SEASON_TABS } from "@/lib/seasons";
import { SeasonPicker } from "./_components/season-picker";
import { PageTabs } from "./_components/page-tabs";

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
    <>
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
          <Link
            href={`/season/${year}/overview`}
            className="font-bold tracking-tight text-lg text-zinc-900"
          >
            openIPL
          </Link>

          <PageTabs year={year} tabs={SEASON_TABS} />

          <SeasonPicker current={year} seasons={SEASONS} />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </>
  );
}
