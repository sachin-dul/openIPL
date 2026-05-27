/**
 * Player's runs-by-season bar chart. Each bar is tinted by the team the
 * player played for that season (`color` on the data point). The single
 * highest-runs season gets full opacity and a value label above the bar;
 * other seasons are rendered at ~60% opacity in their team color.
 */

export type CareerSeasonPoint = {
  season: number;
  runs: number;
  /** Team color for this season; falls back to `fallbackColor` if absent. */
  color?: string;
};

type Props = {
  data: CareerSeasonPoint[];
  /** Color used when a data point has no team color attached. */
  fallbackColor?: string;
  width?: number;
  height?: number;
};

export function CareerChart({
  data,
  fallbackColor = "var(--color-ipl-soft)",
  width = 620,
  height = 200,
}: Props) {
  if (data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a.season - b.season);
  const max = Math.max(...sorted.map((d) => d.runs), 1);
  const pad = { l: 32, r: 16, t: 26, b: 28 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  /* Bars sit inside per-season slots so the leftmost bar starts at the
     y-axis instead of straddling it (which was the case with the previous
     endpoint-distributed positioning). */
  const slotW = W / sorted.length;
  const x = (i: number) => pad.l + (i + 0.5) * slotW;
  const y = (v: number) => pad.t + H - (v / max) * H;
  const bw = slotW * 0.72;

  const yTicks = niceTicks(max);
  const xTickIdx = pickXTicks(sorted.length);

  // Identify the overall peak season — labeled above its bar.
  let peakIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].runs > sorted[peakIdx].runs) peakIdx = i;
  }
  const peakValue = sorted[peakIdx].runs;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" className="block">
      {/* Y gridlines */}
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--color-ipl-line2)"
          />
          <text
            x={pad.l - 4}
            y={y(t) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--color-ipl-sub)"
            className="font-mono"
          >
            {t}
          </text>
        </g>
      ))}

      {/* Bars — all full opacity so team colors read true. Peak bar gets a
          dot+label callout instead of an opacity contrast. */}
      {sorted.map((d, i) => {
        const isPeak = d.runs === peakValue && peakValue > 0;
        const fill = d.color ?? fallbackColor;
        const cx = x(i);
        const top = y(d.runs);
        return (
          <g key={d.season}>
            <rect
              x={cx - bw / 2}
              y={top}
              width={bw}
              height={pad.t + H - top}
              fill={fill}
              rx="2"
            >
              <title>{`${d.season}: ${d.runs} runs`}</title>
            </rect>
            {isPeak && (
              <>
                <circle cx={cx} cy={top - 10} r={2.5} fill={fill} />
                <text
                  x={cx}
                  y={top - 16}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="var(--color-ipl-ink)"
                  className="font-mono"
                >
                  {peakValue}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* X-axis labels */}
      {xTickIdx.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={height - 8}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-ipl-sub)"
          className="font-mono"
        >
          {`'${String(sorted[i].season).slice(2)}`}
        </text>
      ))}
    </svg>
  );
}

function niceTicks(max: number): number[] {
  if (max <= 300) return [100, 200, 300].filter((t) => t <= max);
  if (max <= 600) return [200, 400, 600].filter((t) => t <= max);
  if (max <= 1000) return [250, 500, 750, 1000].filter((t) => t <= max);
  const step = Math.ceil(max / 4 / 100) * 100;
  return [step, step * 2, step * 3, step * 4].filter((t) => t <= max * 1.1);
}

function pickXTicks(n: number): number[] {
  if (n <= 6) return Array.from({ length: n }, (_, i) => i);
  const step = Math.max(1, Math.round(n / 5));
  const ticks = [];
  for (let i = 0; i < n; i += step) ticks.push(i);
  if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);
  return ticks;
}
