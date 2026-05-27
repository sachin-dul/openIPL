/**
 * Runs-per-over bar chart with optional wicket markers above bars that ended
 * an over in which a wicket fell. Single innings only — for comparing two
 * innings, render two ManhattanCharts side by side.
 */

type Over = number | { runs: number; wkts: number };

type Props = {
  overs: Over[];
  width?: number;
  height?: number;
  color?: string;
  /** Over indices at which a wicket fell. Optional alternative to embedding `{runs, wkts}` per over. */
  wicketAtOvers?: number[];
};

export function ManhattanChart({
  overs,
  width = 360,
  height = 160,
  color = "var(--color-ipl-accent)",
  wicketAtOvers = [],
}: Props) {
  if (overs.length === 0) return null;
  const runsOf = (o: Over) => (typeof o === "number" ? o : o.runs);
  const max = Math.max(...overs.map(runsOf), 18);
  const pad = { l: 22, r: 10, t: 12, b: 22 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const bw = W / overs.length;

  const ticks = [6, 12, 18, 24].filter((t) => t <= max);
  const wicketSet = new Set(wicketAtOvers);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" className="block">
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={pad.t + H - (t / max) * H}
            y2={pad.t + H - (t / max) * H}
            stroke="var(--color-ipl-line2)"
          />
          <text
            x={pad.l - 4}
            y={pad.t + H - (t / max) * H + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--color-ipl-sub)"
            className="font-mono"
          >
            {t}
          </text>
        </g>
      ))}

      {overs.map((o, i) => {
        const runs = runsOf(o);
        const hadWkt =
          (typeof o === "object" && o.wkts > 0) || wicketSet.has(i);
        const barH = (runs / max) * H;
        return (
          <g key={i}>
            <rect
              x={pad.l + i * bw + 1}
              y={pad.t + H - barH}
              width={Math.max(bw - 2, 0.5)}
              height={barH}
              fill={color}
              opacity={hadWkt ? 1 : 0.78}
              rx="1.5"
            >
              <title>{`Over ${i + 1}: ${runs}${hadWkt ? " (wkt)" : ""}`}</title>
            </rect>
            {hadWkt && (
              <circle
                cx={pad.l + i * bw + bw / 2}
                cy={pad.t + H - barH - 5}
                r="2.5"
                fill="var(--color-ipl-neg)"
              />
            )}
          </g>
        );
      })}

      {[0, 6, 12, 18, 19]
        .filter((i) => i < overs.length)
        .map((i) => (
          <text
            key={i}
            x={pad.l + i * bw + bw / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize="9"
            fill="var(--color-ipl-sub)"
            className="font-mono"
          >
            {i + 1}
          </text>
        ))}
    </svg>
  );
}
