/**
 * Team × over heat-map of average runs-per-over. Used on the season Overview.
 *
 * Pure SVG, no chart library. Cells are colored on a pale → indigo → red ramp;
 * teams are labeled on the left in mono, and three section headers
 * (Powerplay / Middle / Death) live above the appropriate column groups. The
 * SVG scales to the container's width via `viewBox`.
 */

export type HeatmapRow = {
  /** Team short code, e.g. "RCB". Rendered as the row label on the left. */
  team: string;
  /** Average runs/over for overs 1–20 (length 20, zero-indexed). */
  overs: number[];
};

type Props = {
  rows: HeatmapRow[];
  /** Native viewBox width — actual rendered width follows the container. */
  width?: number;
  height?: number;
};

export function PhaseHeatmap({ rows, width = 920, height = 280 }: Props) {
  if (rows.length === 0) return null;

  const cols = 20;
  const pad = { l: 48, r: 12, t: 26, b: 18 };
  const cw = (width - pad.l - pad.r) / cols;
  const ch = (height - pad.t - pad.b) / rows.length;

  const allVals = rows.flatMap((r) => r.overs);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = Math.max(max - min, 1e-6);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="Average runs per over per team"
      className="block"
    >
      {/* Phase headers */}
      <text x={pad.l + cw * 3} y={pad.t - 10} textAnchor="middle" fontSize="9" fill="var(--color-ipl-sub)" letterSpacing="0.8">POWERPLAY</text>
      <text x={pad.l + cw * 10.5} y={pad.t - 10} textAnchor="middle" fontSize="9" fill="var(--color-ipl-sub)" letterSpacing="0.8">MIDDLE</text>
      <text x={pad.l + cw * 17.5} y={pad.t - 10} textAnchor="middle" fontSize="9" fill="var(--color-ipl-sub)" letterSpacing="0.8">DEATH</text>

      {/* Phase dividers */}
      <line x1={pad.l + cw * 6} x2={pad.l + cw * 6} y1={pad.t - 4} y2={height - pad.b + 4} stroke="var(--color-ipl-line)" />
      <line x1={pad.l + cw * 15} x2={pad.l + cw * 15} y1={pad.t - 4} y2={height - pad.b + 4} stroke="var(--color-ipl-line)" />

      {/* Cells + row labels */}
      {rows.map((row, ri) => (
        <g key={row.team}>
          <text
            x={pad.l - 8}
            y={pad.t + ri * ch + ch / 2 + 4}
            textAnchor="end"
            fontSize="10"
            fill="var(--color-ipl-ink)"
            className="font-mono"
            fontWeight="600"
          >
            {row.team}
          </text>
          {row.overs.map((v, ci) => (
            <rect
              key={ci}
              x={pad.l + ci * cw + 1}
              y={pad.t + ri * ch + 1}
              width={Math.max(cw - 2, 0.5)}
              height={Math.max(ch - 2, 0.5)}
              fill={heatColor((v - min) / range)}
              rx="2"
            >
              <title>{`${row.team} · over ${ci + 1} · ${v.toFixed(2)} rpo`}</title>
            </rect>
          ))}
        </g>
      ))}

      {/* Over-axis ticks: 1 / 7 / 16 / 20 */}
      {[0, 6, 15, 19].map((i) => (
        <text
          key={i}
          x={pad.l + i * cw + cw / 2}
          y={height - 4}
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

/** Three-stop ramp from pale-cream → indigo → warm red. t in [0, 1]. */
function heatColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  // Pale (#f6f3ec) → Indigo (#3a5cff) → Red (#d23a3a)
  if (clamped < 0.5) {
    const k = clamped * 2; // 0..1
    return lerpRgb([246, 243, 236], [58, 92, 255], k);
  }
  const k = (clamped - 0.5) * 2; // 0..1
  return lerpRgb([58, 92, 255], [210, 58, 58], k);
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bch = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bch})`;
}
