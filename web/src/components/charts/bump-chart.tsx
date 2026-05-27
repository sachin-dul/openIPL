/**
 * Standings-rank bump chart across N seasons. Each team is a polyline of its
 * final position per season; highlighted teams are full-opacity with a thicker
 * stroke and a trailing label at the right edge. Faded teams remain visible so
 * the eye can still see the overall shape.
 */

export type BumpTeam = {
  team: string;
  /** Position per season, in chronological order. null = team didn't play. */
  ranks: Array<number | null>;
  color: string;
};

type Props = {
  teams: BumpTeam[];
  /** Season year corresponding to ranks[0]. Used to label x-axis ticks. */
  startYear: number;
  highlight?: string[];
  width?: number;
  height?: number;
};

export function BumpChart({
  teams,
  startYear,
  highlight = [],
  width = 620,
  height = 260,
}: Props) {
  if (teams.length === 0) return null;
  const seasons = teams[0].ranks.length;
  if (seasons === 0) return null;

  const maxRank = Math.max(
    ...teams.flatMap((t) => t.ranks.filter((r): r is number => r != null)),
    10,
  );

  const pad = { l: 30, r: 64, t: 14, b: 24 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / Math.max(seasons - 1, 1)) * W;
  const y = (r: number) =>
    pad.t + ((r - 1) / Math.max(maxRank - 1, 1)) * H;

  const rankTicks = pickRankTicks(maxRank);
  const seasonTicks = pickSeasonTicks(seasons);
  const isHi = (t: string) => highlight.includes(t);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" className="block">
      {/* Rank gridlines */}
      {rankTicks.map((r) => (
        <g key={r}>
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={y(r)}
            y2={y(r)}
            stroke="var(--color-ipl-line2)"
          />
          <text
            x={pad.l - 6}
            y={y(r) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--color-ipl-sub)"
            className="font-mono"
          >
            {r}
          </text>
        </g>
      ))}

      {/* Qualified-zone (top 4) shading */}
      <rect
        x={pad.l}
        y={y(1)}
        width={W}
        height={y(4) - y(1)}
        fill="var(--color-ipl-pos)"
        opacity="0.05"
      />

      {/* Team polylines */}
      {teams.map((t) => {
        const hi = isHi(t.team);
        const pts = t.ranks
          .map((r, i) => (r == null ? null : `${x(i)},${y(r)}`))
          .filter((p): p is string => p != null)
          .join(" ");
        return (
          <g key={t.team} opacity={hi ? 1 : 0.16}>
            <polyline
              points={pts}
              fill="none"
              stroke={t.color}
              strokeWidth={hi ? 2.2 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {t.ranks.map((r, i) =>
              r != null ? (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(r)}
                  r={hi ? 3 : 2}
                  fill={t.color}
                  stroke="#fff"
                  strokeWidth="1.2"
                />
              ) : null,
            )}
            {hi && labelEnd(t, x, y, width, pad)}
          </g>
        );
      })}

      {/* Season ticks */}
      {seasonTicks.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={height - 6}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-ipl-sub)"
          className="font-mono"
        >
          {`'${String(startYear + i).slice(2)}`}
        </text>
      ))}
    </svg>
  );
}

function labelEnd(
  t: BumpTeam,
  x: (i: number) => number,
  y: (r: number) => number,
  width: number,
  pad: { r: number },
) {
  // Walk from the right to find the last non-null rank — handles teams that
  // weren't in the league during the most recent season.
  for (let i = t.ranks.length - 1; i >= 0; i--) {
    const r = t.ranks[i];
    if (r == null) continue;
    return (
      <text
        x={width - pad.r + 4}
        y={y(r) + 3}
        fontSize="10"
        fill={t.color}
        fontWeight="700"
        className="font-mono"
      >
        {t.team}
      </text>
    );
  }
  return null;
}

function pickRankTicks(maxRank: number): number[] {
  if (maxRank <= 8) return [1, 4, 8];
  return [1, 4, 8, 10];
}

function pickSeasonTicks(n: number): number[] {
  if (n <= 6) return Array.from({ length: n }, (_, i) => i);
  const step = Math.max(1, Math.round(n / 5));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}
