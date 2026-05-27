/**
 * Cumulative-runs worm for two innings of a match. Pass two same-length arrays
 * (one entry per over, starting at over 0 = 0 runs) plus the over indices at
 * which wickets fell. Renders as paired colored lines with hollow circles at
 * wickets and a shaded powerplay band.
 */

export type WormSeries = {
  /** Cumulative runs at end of overs 0, 1, …, N. */
  cumulative: number[];
  /** Over indices (matching `cumulative`) at which wickets fell. */
  wicketAtOvers: number[];
  color: string;
  label: string;
};

type Props = {
  a: WormSeries;
  b: WormSeries;
  width?: number;
  height?: number;
};

export function WormChart({ a, b, width = 600, height = 240 }: Props) {
  const overs = Math.max(a.cumulative.length, b.cumulative.length) - 1;
  if (overs <= 0) return null;
  const max = Math.max(...a.cumulative, ...b.cumulative, 50);
  const pad = { l: 34, r: 14, t: 16, b: 26 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / overs) * W;
  const y = (v: number) => pad.t + H - (v / max) * H;
  const path = (arr: number[]) =>
    arr
      .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");

  const yTicks = niceY(max);
  const xTicks = [0, 5, 10, 15, 20].filter((t) => t <= overs);

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
            stroke="var(--color-ipl-line)"
            strokeWidth="1"
          />
          <text
            x={pad.l - 6}
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

      {/* Powerplay band */}
      <rect
        x={x(0)}
        y={pad.t}
        width={x(Math.min(6, overs)) - x(0)}
        height={H}
        fill="var(--color-ipl-accent)"
        opacity="0.05"
      />
      <text
        x={x(Math.min(3, overs))}
        y={pad.t + 11}
        textAnchor="middle"
        fontSize="8"
        fill="var(--color-ipl-sub)"
        letterSpacing="0.6"
      >
        POWERPLAY
      </text>

      {/* Worms */}
      <path
        d={path(a.cumulative)}
        stroke={a.color}
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={path(b.cumulative)}
        stroke={b.color}
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Wicket markers */}
      {a.wicketAtOvers.map((o, i) => (
        <circle
          key={`a${i}`}
          cx={x(o)}
          cy={y(a.cumulative[o] ?? 0)}
          r="3"
          fill="#fff"
          stroke={a.color}
          strokeWidth="2"
        />
      ))}
      {b.wicketAtOvers.map((o, i) => (
        <circle
          key={`b${i}`}
          cx={x(o)}
          cy={y(b.cumulative[o] ?? 0)}
          r="3"
          fill="#fff"
          stroke={b.color}
          strokeWidth="2"
        />
      ))}

      {/* X labels */}
      {xTicks.map((t) => (
        <text
          key={t}
          x={x(t)}
          y={height - 6}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-ipl-sub)"
          className="font-mono"
        >
          {t}
        </text>
      ))}
    </svg>
  );
}

function niceY(max: number): number[] {
  if (max <= 80) return [0, 25, 50, 75].filter((t) => t <= max);
  if (max <= 200) return [0, 50, 100, 150, 200].filter((t) => t <= max);
  return [0, 50, 100, 150, 200, 250, 300].filter((t) => t <= max);
}
