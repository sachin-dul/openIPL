"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SEASON_TABS } from "@/lib/seasons";

/**
 * Sub-navigation for the four season views (Overview / Batting / Bowling /
 * Analysis). Renders as a tab strip that "punches through" the 1px line under
 * the page header — the active tab carries a 2px accent border-bottom and
 * sits one pixel below the strip's own underline so the lines overlap cleanly.
 */
export function SeasonSubNav({ year }: { year: number }) {
  const pathname = usePathname();
  return (
    <div className="flex border-b border-ipl-line mb-4">
      {SEASON_TABS.map((tab) => {
        const href = `/season/${year}/${tab.slug}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={tab.slug}
            href={href}
            className={
              "text-[13px] px-3.5 py-2.5 -mb-px border-b-2 transition-colors " +
              (active
                ? "text-ipl-ink font-semibold border-ipl-accent"
                : "text-ipl-sub font-medium border-transparent hover:text-ipl-ink")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
