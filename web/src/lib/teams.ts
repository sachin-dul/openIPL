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
  logo?: string; // path under /logos/, undefined if no logo asset
};

const TEAMS: Record<string, TeamInfo> = {
  // Current 10 teams
  "Chennai Super Kings": { short: "CSK", color: "#FFDC00", logo: "logos/CSK.png" },
  "Mumbai Indians": { short: "MI", color: "#004BA0", logo: "logos/MI.png" },
  "Royal Challengers Bengaluru": { short: "RCB", color: "#D4171E", logo: "logos/RCB.png" },
  "Kolkata Knight Riders": { short: "KKR", color: "#3A225D", logo: "logos/KKR.png" },
  "Rajasthan Royals": { short: "RR", color: "#EA1A85", logo: "logos/RR.png" },
  "Sunrisers Hyderabad": { short: "SRH", color: "#FF822A", logo: "logos/SRH.png" },
  "Delhi Capitals": { short: "DC", color: "#004C93", logo: "logos/DC.png" },
  "Punjab Kings": { short: "PBKS", color: "#ED1B24", logo: "logos/PBKS.png" },
  "Gujarat Titans": { short: "GT", color: "#1C1C1C", logo: "logos/GT.png" },
  "Lucknow Super Giants": { short: "LSG", color: "#A72056", logo: "logos/LSG.png" },

  // Historical names that map to the current 10 (logo reused)
  "Royal Challengers Bangalore": { short: "RCB", color: "#D4171E", logo: "logos/RCB.png" },
  "Delhi Daredevils": { short: "DD", color: "#004C93", logo: "logos/DD.png" }, // pre-2018 name
  "Kings XI Punjab": { short: "KXIP", color: "#ED1B24", logo: "logos/KXIP.png" }, // pre-2021 name

  // Defunct franchises
  "Deccan Chargers": { short: "DC*", color: "#221F1F", logo: "logos/DC_old.png" }, // 2008–2012
  "Kochi Tuskers Kerala": { short: "KTK", color: "#cf6e1c", logo: "logos/KTK.png" }, // 2011 only
  "Pune Warriors": { short: "PW", color: "#1f3b73", logo: "logos/PW.png" }, // 2011–2013
  "Gujarat Lions": { short: "GL", color: "#f8bf2c", logo: "logos/GL.png" }, // 2016–2017
  "Rising Pune Supergiant": { short: "RPS", color: "#5a1a8b", logo: "logos/RPS.png" }, // 2017
  "Rising Pune Supergiants": { short: "RPS", color: "#5a1a8b", logo: "logos/RPS.png" }, // 2016 — extra 's'
};

const DEFAULT: TeamInfo = { short: "?", color: "#71717a" };

export function teamInfo(name: string | undefined | null): TeamInfo {
  if (!name) return DEFAULT;
  return TEAMS[name] ?? { short: abbreviate(name), color: "#71717a" };
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

function abbreviate(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);
}
