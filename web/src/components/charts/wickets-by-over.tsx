/**
 * Stacked-bar histogram of wickets per over for a season. Bars are colored by
 * phase: pale purple for powerplay (overs 1-6), indigo for middle (7-15), red
 * for the death (16-20). Dashed verticals mark the phase boundaries.
 */

type Props = {
  /** values[i] = number of wickets across all matches in over i+1. Length 20. */
  values: number[];
  width?: number;
  height?: number;
};

const COLORS = {
  pp: "#a78bfa",
  mid: "var(--color-ipl-accent)",
  death: "var(--color-ipl-neg)",
} as const;

function phaseFor(overIdx: number): keyof typeof COLORS {
  if (overIdx < 6) return "pp";
  if (overIdx < 15) return "mid";
  return "death";
}

export function WicketsByOver({ values, width = 360, height = 180 }: Props) {
  const overs = values.length;
  if (overs === 0) return null;
  const max = Math.max(...values, 3);
  const pad = { l: 24, r: 10, t: 10, b: 22 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const bw = W / overs;

  const ticks = niceTicks(max);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" className="block">
      {/* y-grid + ticks */}
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

      {/* Bars */}
      {values.map((v, i) => (
        <rect
          key={i}
          x={pad.l + i * bw + 1}
          y={pad.t + H - (v / max) * H}
          width={Math.max(bw - 2, 0.5)}
          height={(v / max) * H}
          fill={COLORS[phaseFor(i)]}
          rx="1.5"
        >
          <title>{`Over ${i + 1}: ${v} wkts`}</title>
        </rect>
      ))}

      {/* Phase boundaries */}
      <line
        x1={pad.l + bw * 6}
        x2={pad.l + bw * 6}
        y1={pad.t}
        y2={pad.t + H}
        stroke="var(--color-ipl-line)"
        strokeDasharray="2 3"
      />
      <line
        x1={pad.l + bw * 15}
        x2={pad.l + bw * 15}
        y1={pad.t}
        y2={pad.t + H}
        stroke="var(--color-ipl-line)"
        strokeDasharray="2 3"
      />

      {/* X-axis labels (1, 6, 12, 16, 20) */}
      {[0, 5, 11, 15, 19]
        .filter((i) => i < overs)
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

function niceTicks(max: number): number[] {
  if (max <= 3) return [1, 2, 3].filter((t) => t <= max);
  if (max <= 6) return [2, 4, 6].filter((t) => t <= max);
  if (max <= 12) return [4, 8, 12].filter((t) => t <= max);
  const step = Math.ceil(max / 4);
  return [step, step * 2, step * 3, step * 4].filter((t) => t <= max * 1.1);
}
