import { teamShort, teamColor, teamLogo } from "@/lib/teams";

export type BadgeSize = "xs" | "sm" | "md";

const SIZES: Record<BadgeSize, { box: string; text: string }> = {
  xs: { box: "w-4 h-4", text: "text-[7px]" },
  sm: { box: "w-5 h-5", text: "text-[8px]" },
  md: { box: "w-6 h-6", text: "text-[9px]" },
};

/** Team logo (or colored short-code badge fallback) at the requested size. */
export function TeamBadge({
  team,
  size = "md",
}: {
  team: string;
  size?: BadgeSize;
}) {
  const cls = SIZES[size];
  const logo = teamLogo(team);
  if (logo) {
    /* eslint-disable @next/next/no-img-element */
    return (
      <img
        src={`/${logo}`}
        alt={teamShort(team)}
        className={`${cls.box} object-contain flex-shrink-0`}
      />
    );
  }
  return (
    <span
      className={`${cls.box} rounded-md flex items-center justify-center ${cls.text} font-bold text-white flex-shrink-0`}
      style={{ background: teamColor(team) }}
    >
      {teamShort(team)}
    </span>
  );
}

/** Logo + full team name on one inline line. */
export function TeamInline({ team }: { team: string }) {
  return (
    <span className="flex items-center gap-1.5 truncate">
      <TeamBadge team={team} size="xs" />
      <span className="truncate">{team}</span>
    </span>
  );
}
