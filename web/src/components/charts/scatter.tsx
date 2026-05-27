/**
 * Lightweight 2D scatter, used on the Batting (SR vs Avg) and Bowling
 * (Econ vs Avg) pages. Each point is a colored dot with an optional inline
 * label rendered to its right.
 */

export type ScatterPoint = {
  x: number;
  y: number;
  label?: string;
  color?: string;
  /**
   * Multi-line tooltip text. Lines separated by `\n` (browsers render
   * line breaks in SVG `<title>`). Falls back to a default derived from
   * `label`, `xLabel`, and `yLabel` when omitted.
   */
  tooltip?: string;
};

type Props = {
  data: ScatterPoint[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
};

/** Pick a nice round step for axis ticks. Returns at most ~`count` values. */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / count;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const step = (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * exp;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

export function Scatter({
  data,
  width = 360,
  height = 220,
  xLabel,
  yLabel,
}: Props) {
  if (data.length === 0) return null;

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs) * 0.95;
  const xMax = Math.max(...xs) * 1.05;
  const yMin = Math.min(...ys) * 0.95;
  const yMax = Math.max(...ys) * 1.05;
  // Extra padding to fit tick labels on the left (numeric Y values) and
  // bottom (numeric X values + axis title).
  const pad = { l: 40, r: 16, t: 10, b: 38 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const x = (v: number) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * W;
  const y = (v: number) => pad.t + H - ((v - yMin) / (yMax - yMin || 1)) * H;

  const xTicks = niceTicks(xMin, xMax, 5);
  const yTicks = niceTicks(yMin, yMax, 5);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      className="block"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* Gridlines (faint, behind the data) */}
      {yTicks.map((t) => (
        <line
          key={`gy-${t}`}
          x1={pad.l}
          x2={pad.l + W}
          y1={y(t)}
          y2={y(t)}
          stroke="var(--color-ipl-line2)"
          strokeWidth={1}
        />
      ))}
      {xTicks.map((t) => (
        <line
          key={`gx-${t}`}
          x1={x(t)}
          x2={x(t)}
          y1={pad.t}
          y2={pad.t + H}
          stroke="var(--color-ipl-line2)"
          strokeWidth={1}
        />
      ))}

      {/* Axes */}
      <line
        x1={pad.l}
        x2={width - pad.r}
        y1={pad.t + H}
        y2={pad.t + H}
        stroke="var(--color-ipl-line)"
      />
      <line
        x1={pad.l}
        x2={pad.l}
        y1={pad.t}
        y2={pad.t + H}
        stroke="var(--color-ipl-line)"
      />

      {/* Y-axis tick numbers */}
      {yTicks.map((t) => (
        <text
          key={`yl-${t}`}
          x={pad.l - 6}
          y={y(t) + 3}
          textAnchor="end"
          fontSize={9}
          fill="var(--color-ipl-sub)"
          style={{
            fontFamily: "var(--font-mono)",
            fontFeatureSettings: '"tnum", "zero"',
          }}
        >
          {Number.isInteger(t) ? t : t.toFixed(1)}
        </text>
      ))}

      {/* X-axis tick numbers */}
      {xTicks.map((t) => (
        <text
          key={`xl-${t}`}
          x={x(t)}
          y={pad.t + H + 12}
          textAnchor="middle"
          fontSize={9}
          fill="var(--color-ipl-sub)"
          style={{
            fontFamily: "var(--font-mono)",
            fontFeatureSettings: '"tnum", "zero"',
          }}
        >
          {Number.isInteger(t) ? t : t.toFixed(1)}
        </text>
      ))}

      {/* Points. Hover affordance is the larger transparent circle on top so
          tooltips fire even when dots cluster; the visible circle stays small.
          Tooltip text comes from `d.tooltip` (caller-supplied multi-line) or
          falls back to a labeled default built from xLabel/yLabel. */}
      {data.map((d, i) => {
        const fmt = (n: number) =>
          Number.isInteger(n) ? `${n}` : n.toFixed(1);
        const defaultTip = [
          d.label ?? "",
          xLabel ? `${xLabel} ${fmt(d.x)}` : `x ${fmt(d.x)}`,
          yLabel ? `${yLabel} ${fmt(d.y)}` : `y ${fmt(d.y)}`,
        ]
          .filter(Boolean)
          .join("\n");
        const cx = x(d.x);
        const cy = y(d.y);
        // Flip the label to the left of the dot when placing it to the right
        // would clip past the plot's right edge. Approx 5.5px per char at
        // fontSize 9 — good enough to detect overflow without an offscreen
        // canvas measurement.
        const labelWidth = d.label ? d.label.length * 5.5 : 0;
        const flipLeft = cx + 7 + labelWidth > width - pad.r;
        return (
          <g key={i} style={{ cursor: "default" }}>
            <circle
              cx={cx}
              cy={cy}
              r="5"
              fill={d.color ?? "var(--color-ipl-accent)"}
              opacity="0.88"
              stroke="#fff"
              strokeWidth="1"
            />
            <circle
              cx={cx}
              cy={cy}
              r="12"
              fill={d.color ?? "var(--color-ipl-accent)"}
              fillOpacity={0.001}
            >
              <title>{d.tooltip ?? defaultTip}</title>
            </circle>
            {d.label && (
              <text
                x={flipLeft ? cx - 7 : cx + 7}
                y={cy + 3}
                textAnchor={flipLeft ? "end" : "start"}
                fontSize="9"
                fill="var(--color-ipl-ink)"
                className="font-mono"
                style={{ pointerEvents: "none" }}
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Axis titles */}
      {xLabel && (
        <text
          x={(pad.l + width - pad.r) / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-ipl-sub)"
          letterSpacing="0.6"
        >
          {xLabel.toUpperCase()}
        </text>
      )}
      {yLabel && (
        <text
          x={10}
          y={pad.t + H / 2}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-ipl-sub)"
          letterSpacing="0.6"
          transform={`rotate(-90 10 ${pad.t + H / 2})`}
        >
          {yLabel.toUpperCase()}
        </text>
      )}
    </svg>
  );
}
