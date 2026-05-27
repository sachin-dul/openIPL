/**
 * Seasons covered by the Parquet layer.
 */
export const SEASONS = Array.from({ length: 2026 - 2008 + 1 }, (_, i) => 2008 + i);
export const LATEST_SEASON = SEASONS[SEASONS.length - 1];

export function isValidSeason(year: number): boolean {
  return SEASONS.includes(year);
}

/** Page tabs under /season/[year]/ */
export const SEASON_TABS = [
  { slug: "overview", label: "Overview" },
  { slug: "batting", label: "Batting" },
  { slug: "bowling", label: "Bowling" },
  { slug: "analysis", label: "Analysis" },
] as const;

export type SeasonTab = (typeof SEASON_TABS)[number]["slug"];
