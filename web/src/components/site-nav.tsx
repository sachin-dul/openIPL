"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LATEST_SEASON } from "@/lib/seasons";

/**
 * Top-level navigation, four items. The season tabs (Overview / Batting / …)
 * moved to <SeasonSubNav> which only renders inside season pages.
 *
 * The "Seasons" item is path-aware: when the user is already on a season page,
 * it preserves the year; everywhere else it sends them to the latest season's
 * overview.
 */
export function SiteNav() {
  const pathname = usePathname();
  const seasonMatch = pathname.match(/^\/season\/(\d+)/);
  const year = seasonMatch ? Number(seasonMatch[1]) : LATEST_SEASON;

  const items = [
    {
      label: "Seasons",
      href: `/season/${year}/overview`,
      active: pathname.startsWith("/season/") || pathname.startsWith("/match/"),
    },
    { label: "Players", href: "/players", active: pathname.startsWith("/players") || pathname.startsWith("/player/") },
    { label: "Matchup", href: "/matchup", active: pathname.startsWith("/matchup") },
    { label: "H2H", href: "/h2h", active: pathname.startsWith("/h2h") },
  ];

  return (
    <nav className="flex items-center gap-1">
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          className={
            "px-2.5 py-1.5 rounded-md text-[13px] transition-colors " +
            (it.active
              ? "text-ipl-ink font-semibold bg-ipl-line2"
              : "text-ipl-sub font-medium hover:text-ipl-ink hover:bg-ipl-line2/60")
          }
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
