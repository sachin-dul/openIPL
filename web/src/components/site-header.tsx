import Link from "next/link";
import { SiteNav } from "./site-nav";
import { SearchPill } from "./search-pill";
import { SeasonChip } from "./season-chip";

/**
 * Top-of-page chrome shared by every layout. 52px tall, light surface, single
 * 1px line beneath. Houses brand + BETA pill on the left, the four-item nav
 * just to the right, and the search pill + season chip pinned to the far right.
 */
export function SiteHeader() {
  return (
    <header className="h-[52px] shrink-0 flex items-center gap-5 px-6 bg-ipl-surface border-b border-ipl-line">
      <Link
        href="/"
        className="flex items-center gap-2.5 text-ipl-ink no-underline"
      >
        <Logo />
        <span className="font-semibold text-base tracking-[-0.3px]">openIPL</span>
        <span className="font-mono text-[10px] text-ipl-sub border border-ipl-line rounded px-[5px] py-[1px] leading-[1.4]">
          BETA
        </span>
      </Link>
      <div className="ml-4">
        <SiteNav />
      </div>
      <div className="ml-auto flex items-center gap-2.5">
        <SearchPill />
        <SeasonChip />
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle
        cx="11"
        cy="11"
        r="10"
        stroke="var(--color-ipl-accent2)"
        strokeWidth="1.4"
      />
      <path
        d="M3 11 Q11 4 19 11"
        stroke="var(--color-ipl-accent)"
        strokeWidth="1.4"
        fill="none"
      />
      <path
        d="M3 11 Q11 18 19 11"
        stroke="var(--color-ipl-accent)"
        strokeWidth="1.4"
        fill="none"
      />
      <line
        x1="11"
        y1="1"
        x2="11"
        y2="21"
        stroke="var(--color-ipl-accent2)"
        strokeWidth="1.2"
      />
    </svg>
  );
}
