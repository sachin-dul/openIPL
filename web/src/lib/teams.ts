/**
 * Team metadata: short code, brand color, logo path.
 *
 * Covers all team names that have appeared across IPL 2008-2025, including
 * defunct franchises (Deccan Chargers, Pune Warriors, etc.) and historical
 * names (Delhi Daredevils → Delhi Capitals, Royal Challengers Bangalore →
 * Royal Challengers Bengaluru, etc.).
 *
 * Logo files only exist for the 10 current teams. For defunct/historical
 * names without a logo we render a colored badge with the short code.
 */
type TeamInfo = {
  short: string;
  color: string;
  /** Foreground color for use on top of `color` (badge text, hero text). */
  ink: string;
  logo?: string; // path under /logos/, undefined if no logo asset
};

const TEAMS: Record<string, TeamInfo> = {
  // Current 10 teams
  "Chennai Super Kings":         { short: "CSK",  color: "#FFDC00", ink: "#1a1a1a", logo: "logos/CSK.png" },
  "Mumbai Indians":              { short: "MI",   color: "#004BA0", ink: "#ffffff", logo: "logos/MI.png" },
  "Royal Challengers Bengaluru": { short: "RCB",  color: "#D4171E", ink: "#ffffff", logo: "logos/RCB.png" },
  "Kolkata Knight Riders":       { short: "KKR",  color: "#3A225D", ink: "#ffffff", logo: "logos/KKR.png" },
  "Rajasthan Royals":            { short: "RR",   color: "#EA1A85", ink: "#ffffff", logo: "logos/RR.png" },
  "Sunrisers Hyderabad":         { short: "SRH",  color: "#FF822A", ink: "#1a1a1a", logo: "logos/SRH.png" },
  "Delhi Capitals":              { short: "DC",   color: "#004C93", ink: "#ffffff", logo: "logos/DC.png" },
  "Punjab Kings":                { short: "PBKS", color: "#ED1B24", ink: "#ffffff", logo: "logos/PBKS.png" },
  "Gujarat Titans":              { short: "GT",   color: "#1C1C1C", ink: "#ffffff", logo: "logos/GT.png" },
  "Lucknow Super Giants":        { short: "LSG",  color: "#A72056", ink: "#ffffff", logo: "logos/LSG.png" },

  // Historical names that map to the current 10 (logo reused)
  "Royal Challengers Bangalore": { short: "RCB",  color: "#D4171E", ink: "#ffffff", logo: "logos/RCB.png" },
  "Delhi Daredevils":            { short: "DD",   color: "#004C93", ink: "#ffffff", logo: "logos/DD.png" }, // pre-2018 name
  "Kings XI Punjab":             { short: "KXIP", color: "#ED1B24", ink: "#ffffff", logo: "logos/KXIP.png" }, // pre-2021 name

  // Defunct franchises
  "Deccan Chargers":             { short: "DC*",  color: "#221F1F", ink: "#ffffff", logo: "logos/DC_old.png" }, // 2008–2012
  "Kochi Tuskers Kerala":        { short: "KTK",  color: "#cf6e1c", ink: "#ffffff", logo: "logos/KTK.png" }, // 2011 only
  "Pune Warriors":               { short: "PW",   color: "#1f3b73", ink: "#ffffff", logo: "logos/PW.png" }, // 2011–2013
  "Gujarat Lions":               { short: "GL",   color: "#f8bf2c", ink: "#1a1a1a", logo: "logos/GL.png" }, // 2016–2017
  "Rising Pune Supergiant":      { short: "RPS",  color: "#5a1a8b", ink: "#ffffff", logo: "logos/RPS.png" }, // 2017
  "Rising Pune Supergiants":     { short: "RPS",  color: "#5a1a8b", ink: "#ffffff", logo: "logos/RPS.png" }, // 2016 — extra 's'
};

const DEFAULT: TeamInfo = { short: "?", color: "#71717a", ink: "#ffffff" };

/**
 * Cricsheet sometimes uses different strings for the same franchise across
 * seasons (typos or rebrands). Each inner array lists names that should be
 * treated as the same team. The first entry is the canonical name returned
 * by `canonicalTeam()`.
 *
 * Note: this only groups names the user considers identity-preserving.
 * "Delhi Daredevils" → "Delhi Capitals" and "Kings XI Punjab" → "Punjab Kings"
 * are intentionally NOT grouped — they have different short codes in TEAMS
 * and are treated as distinct franchise eras.
 */
const TEAM_ALIASES: readonly (readonly string[])[] = [
  ["Rising Pune Supergiant", "Rising Pune Supergiants"], // 2017 vs 2016, trailing 's'
  ["Royal Challengers Bengaluru", "Royal Challengers Bangalore"], // 2024+ vs pre-2024
];

const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const group of TEAM_ALIASES) {
    const canonical = group[0];
    for (const name of group) m[name] = canonical;
  }
  return m;
})();

/** Map a team name to its canonical form, collapsing known aliases. */
export function canonicalTeam(name: string): string {
  return ALIAS_TO_CANONICAL[name] ?? name;
}

/**
 * Return every alias of a team name (including the input itself). Used to
 * widen SQL filters so e.g. picking "Royal Challengers Bengaluru" also
 * matches rows tagged "Royal Challengers Bangalore".
 */
export function teamAliases(name: string): string[] {
  const canonical = canonicalTeam(name);
  for (const group of TEAM_ALIASES) {
    if (group[0] === canonical) return [...group];
  }
  return [name];
}

export function teamInfo(name: string | undefined | null): TeamInfo {
  if (!name) return DEFAULT;
  return TEAMS[name] ?? { short: abbreviate(name), color: "#71717a", ink: "#ffffff" };
}

export function teamInk(name: string | undefined | null): string {
  return teamInfo(name).ink;
}

export function teamShort(name: string | undefined | null): string {
  return teamInfo(name).short;
}

export function teamColor(name: string | undefined | null): string {
  return teamInfo(name).color;
}

export function teamLogo(name: string | undefined | null): string | undefined {
  return teamInfo(name).logo;
}

/**
 * Per-team logo era overrides. Each entry replaces the default logo for
 * seasons up to and including `until`. Order doesn't matter — the lookup
 * picks the lowest-bound era whose `until` covers the given season.
 *
 * Used by `TeamBadge` when called with `season={year}` from match/season
 * surfaces. Career-aggregate views (the player page, all-time leaders, etc.)
 * pass no season and continue to show the current logo.
 */
const LOGO_ERAS: Record<string, { until: number; logo: string }[]> = {
  "Rajasthan Royals": [{ until: 2018, logo: "logos/RR_pre2019.png" }],
};

/**
 * Return the era-correct logo path for `name` in `season`. Falls back to the
 * current default logo when no era override matches (or when season is null).
 */
export function logoForSeason(
  name: string | undefined | null,
  season?: number | null,
): string | undefined {
  const info = teamInfo(name);
  if (!name || season == null) return info.logo;
  const canonical = canonicalTeam(name);
  const eras =
    LOGO_ERAS[name] ?? (canonical !== name ? LOGO_ERAS[canonical] : undefined);
  if (!eras) return info.logo;
  const match = eras
    .filter((e) => season <= e.until)
    .sort((a, b) => a.until - b.until)[0];
  return match ? match.logo : info.logo;
}

function abbreviate(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);
}
