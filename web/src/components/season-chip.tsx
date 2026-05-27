"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LATEST_SEASON, SEASONS } from "@/lib/seasons";

/**
 * The "IPL 2026 ▾" chip in the top bar. Disclosure widget — clicking opens a
 * dropdown of every season. Selecting a season keeps the user on the same
 * sub-page when one applies (e.g. /season/2024/batting → /season/2023/batting).
 *
 * Uses native <details>/<summary> so it works without an external popover lib
 * and remains keyboard-accessible by default. Default-marker styling is reset
 * in globals.css.
 */
export function SeasonChip() {
  const pathname = usePathname();
  const seasonMatch = pathname.match(/^\/season\/(\d+)/);
  const currentYear = seasonMatch ? Number(seasonMatch[1]) : LATEST_SEASON;

  function hrefFor(year: number): string {
    if (seasonMatch) {
      return pathname.replace(/^\/season\/\d+/, `/season/${year}`);
    }
    return `/season/${year}/overview`;
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer select-none flex items-center gap-1.5 font-mono text-[12px] font-semibold text-ipl-ink border border-ipl-line bg-ipl-surface rounded-[7px] px-2.5 py-[5px]">
        <span className="w-1.5 h-1.5 rounded-full bg-ipl-accent" />
        IPL {currentYear}
        <Chevron />
      </summary>
      <div className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[110px] max-h-[300px] overflow-y-auto border border-ipl-line rounded-[7px] bg-ipl-surface py-1 shadow-[0_8px_24px_-12px_rgba(15,17,26,0.18)]">
        {[...SEASONS].reverse().map((y) => {
          const active = y === currentYear;
          return (
            <Link
              key={y}
              href={hrefFor(y)}
              className={
                "block font-mono text-[12px] px-3 py-1.5 " +
                (active
                  ? "text-ipl-ink bg-ipl-line2 font-semibold"
                  : "text-ipl-sub hover:text-ipl-ink hover:bg-ipl-line2")
              }
            >
              IPL {y}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" className="ml-0.5" aria-hidden>
      <path
        d="M1 3 L4.5 6.5 L8 3"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
