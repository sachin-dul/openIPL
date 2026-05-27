"use client";

import { logoForSeason, teamInfo, teamShort } from "@/lib/teams";
import { useImpliedSeason } from "@/components/season-context";

type LegacySize = "xs" | "sm" | "md";
const LEGACY_TO_PX: Record<LegacySize, number> = { xs: 16, sm: 20, md: 24 };

type Props = {
  /** Canonical team name as it appears in the CSV ("Royal Challengers Bengaluru"). */
  team?: string;
  /** Alias for `team`. */
  code?: string;
  /** Pixel side-length, or one of the legacy "xs" / "sm" / "md" buckets. */
  size?: number | LegacySize;
  /** Rounded square (default is a circle). Only affects the colored-chip fallback. */
  square?: boolean;
  /** Add a white halo + tinted shadow ring — used to flag the selected team. */
  ring?: boolean;
  /**
   * IPL year for context. When set, looks up the era-correct logo for that
   * season (e.g. pre-2019 RR shows the original crest). Omit on
   * career-aggregate surfaces — they keep the current logo.
   */
  season?: number | null;
};

/**
 * Team logo at the requested pixel size. Falls back to a colored short-code
 * chip for teams whose logo PNG isn't on disk (defunct franchises mostly).
 */
export function TeamBadge({ team, code, size = 22, square = false, ring = false, season }: Props) {
  const name = team ?? code ?? "";
  const info = teamInfo(name);
  const px = typeof size === "number" ? size : LEGACY_TO_PX[size];
  const short = teamShort(name);
  // Explicit prop wins; otherwise inherit from <SeasonProvider> if present.
  // Multi-season aggregate views (player career, all-time leaders) pass
  // neither, so they keep the current default logo.
  const impliedSeason = useImpliedSeason();
  const resolvedSeason = season !== undefined ? season : impliedSeason;
  const logo = logoForSeason(name, resolvedSeason) ?? info.logo;

  if (logo) {
    /* eslint-disable @next/next/no-img-element */
    return (
      <img
        src={`/${logo}`}
        alt={short}
        width={px}
        height={px}
        className="object-contain shrink-0"
        style={{
          width: px,
          height: px,
          boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 3px ${info.color}33` : undefined,
          borderRadius: ring ? "9999px" : undefined,
        }}
      />
    );
  }

  const radius = square ? Math.max(4, Math.round(px * 0.18)) : px / 2;
  const fontSize = Math.max(7, Math.round(px * 0.4));
  return (
    <span
      className="inline-flex items-center justify-center font-mono font-bold shrink-0 leading-none tracking-tight"
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        background: info.color,
        color: info.ink,
        fontSize,
        boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 3px ${info.color}33` : undefined,
      }}
    >
      {short}
    </span>
  );
}

export function TeamInline({ team }: { team: string }) {
  return (
    <span className="flex items-center gap-1.5 truncate">
      <TeamBadge team={team} size="xs" />
      <span className="truncate">{team}</span>
    </span>
  );
}
