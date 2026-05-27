import { TeamBadge } from "@/components/team-badge";
import { teamShort } from "@/lib/teams";

/**
 * Match-by-match results grid. One row per team; each cell is a colored chip
 * showing whether the team won (green), lost (red), or had a no-result (grey)
 * in their N-th game of the season — in chronological order, so cell 1 is
 * their season opener regardless of which match number it was league-wide.
 */

export type ResultOutcome = "W" | "L" | "N";

export type ResultsRow = {
  /** Canonical team name — used for the badge + short-code label. */
  team: string;
  /** Outcomes in chronological order across the season. */
  results: ResultOutcome[];
};

type Props = {
  rows: ResultsRow[];
  /** Cell side length. */
  cellSize?: number;
};

const COLOR: Record<ResultOutcome, string> = {
  W: "var(--color-ipl-pos)",
  L: "var(--color-ipl-neg)",
  N: "var(--color-ipl-soft)",
};

export function ResultsGrid({ rows, cellSize = 22 }: Props) {
  if (rows.length === 0) return null;
  const maxCols = Math.max(...rows.map((r) => r.results.length));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const wins = row.results.filter((r) => r === "W").length;
        const losses = row.results.filter((r) => r === "L").length;
        const nrs = row.results.filter((r) => r === "N").length;
        return (
          <div key={row.team} className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 w-[80px] shrink-0">
              <TeamBadge team={row.team} size={18} />
              <span className="font-mono font-semibold text-[11px]">
                {teamShort(row.team)}
              </span>
            </span>
            <div
              className="flex gap-[3px]"
              style={{ flex: "1 0 auto" }}
            >
              {Array.from({ length: maxCols }).map((_, i) => {
                const r = row.results[i];
                return (
                  <div
                    key={i}
                    title={r ? `Match ${i + 1}: ${labelFor(r)}` : ""}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 3,
                      background: r ? COLOR[r] : "var(--color-ipl-line2)",
                      opacity: r ? 1 : 0.4,
                    }}
                  />
                );
              })}
            </div>
            <span className="font-mono text-[11px] text-ipl-sub whitespace-nowrap w-[80px] text-right">
              <span className="text-ipl-pos font-semibold">{wins}W</span>
              {" · "}
              <span className="text-ipl-neg font-semibold">{losses}L</span>
              {nrs > 0 && (
                <>
                  {" · "}
                  <span className="text-ipl-soft font-semibold">{nrs}NR</span>
                </>
              )}
            </span>
          </div>
        );
      })}
      <div className="flex gap-3 text-[10px] text-ipl-sub mt-2">
        <Swatch color={COLOR.W} label="Win" />
        <Swatch color={COLOR.L} label="Loss" />
        <Swatch color={COLOR.N} label="No result" />
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function labelFor(o: ResultOutcome): string {
  if (o === "W") return "Won";
  if (o === "L") return "Lost";
  return "No result";
}
