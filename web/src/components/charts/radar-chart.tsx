"use client";

/**
 * Multi-axis radar / spider chart. Each series renders as a filled polygon
 * with vertex dots; per-vertex data labels and an HTML overlay tooltip on
 * hover make the geometry feel like a chart rather than a static shape.
 *
 * Sizing: rendered at natural pixel width (no width="100%") so axis labels
 * and dot sizes don't get blown up when the SVG is embedded in a wider card.
 */

import { useState } from "react";

export type RadarAxis = { label: string };

export type RadarTick = {
  /** Position on the radius in [0, 1]. */
  value: number;
  /** Display string drawn next to the ring. */
  label: string;
};

export type RadarSeries = {
  name: string;
  color: string;
  /** Values in [0, 1], one per axis. */
  values: number[];
  /** Optional formatted strings shown next to each vertex (e.g. "148.3"). */
  displayValues?: (string | null)[];
  /** Optional sample size per axis surfaced in the hover tooltip. */
  samples?: number[];
};

type Props = {
  axes: RadarAxis[];
  series: RadarSeries[];
  /** Tick labels on the rings; drawn along the topmost spoke. */
  ticks?: RadarTick[];
  /** Caption under the tick numbers — e.g. "strike rate" or "economy". */
  scaleLabel?: string;
  width?: number;
  height?: number;
};

export function RadarChart({
  axes,
  series,
  ticks,
  scaleLabel,
  width = 240,
  height = 240,
}: Props) {
  const [hover, setHover] = useState<{ axis: number; series: number } | null>(
    null,
  );

  if (axes.length === 0 || series.length === 0) return null;

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 38;
  const n = axes.length;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  // (axis index, radius factor) → pixel coordinate on the radar grid.
  const angleOf = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i: number, v: number): [number, number] => {
    const a = angleOf(i);
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
  };

  // Tick labels are drawn along a non-axis radial — straight down between
  // the lower spokes for a 5-axis chart — so they never sit on a data dot
  // or its value label. For other axis counts we keep the same direction;
  // it falls between two spokes for n=3/4/6 as well.
  const tickAngle = Math.PI / 2;
  const tickPt = (v: number): [number, number] => [
    cx + Math.cos(tickAngle) * r * v,
    cy + Math.sin(tickAngle) * r * v,
  ];

  const gridLevels = ticks?.map((t) => t.value) ?? [0.25, 0.5, 0.75, 1];

  // The hover tooltip is an HTML overlay so it stays crisp regardless of
  // any future SVG scaling; SVG <foreignObject> would re-introduce the
  // stretching bug this redesign exists to fix.
  let tooltipNode: React.ReactNode = null;
  if (hover) {
    const s = series[hover.series];
    const v = s.values[hover.axis];
    const disp = s.displayValues?.[hover.axis] ?? null;
    const samp = s.samples?.[hover.axis];
    const [hx, hy] = pt(hover.axis, clamp(v));
    tooltipNode = (
      <div
        className="absolute pointer-events-none text-[10px] font-mono leading-tight rounded-[4px] shadow"
        style={{
          left: hx,
          top: hy - 38,
          transform: "translateX(-50%)",
          background: "var(--color-ipl-surface)",
          border: "1px solid var(--color-ipl-line)",
          padding: "4px 6px",
          whiteSpace: "nowrap",
          color: "var(--color-ipl-ink)",
          zIndex: 5,
        }}
      >
        <div className="uppercase text-[9px] text-ipl-sub tracking-[0.06em]">
          {axes[hover.axis].label}
        </div>
        <div className="font-semibold" style={{ color: s.color }}>
          {disp ?? "—"}
        </div>
        {samp != null && (
          <div className="text-ipl-sub">{samp.toLocaleString()} balls</div>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative inline-block"
      style={{ width, height }}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
        {/* Concentric grid */}
        {gridLevels.map((g) => (
          <polygon
            key={g}
            points={axes.map((_, i) => pt(i, g).join(",")).join(" ")}
            fill="none"
            stroke="var(--color-ipl-line2)"
            strokeWidth="1"
          />
        ))}
        {/* Outer ring slightly darker so the chart frame is readable */}
        <polygon
          points={axes.map((_, i) => pt(i, 1).join(",")).join(" ")}
          fill="none"
          stroke="var(--color-ipl-line)"
          strokeWidth="1"
        />
        {/* Axis spokes */}
        {axes.map((_, i) => {
          const [x, y] = pt(i, 1);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="var(--color-ipl-line2)"
              strokeWidth="1"
            />
          );
        })}

        {/* Tick labels along a non-axis radial (straight down), drawn just
            left of the line so they read like a thermometer scale. */}
        {ticks?.map((t) => {
          const [tx, ty] = tickPt(t.value);
          return (
            <text
              key={t.value}
              x={tx - 4}
              y={ty + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--color-ipl-sub)"
              className="font-mono"
            >
              {t.label}
            </text>
          );
        })}

        {/* Series polygons + vertices */}
        {series.map((s, si) => {
          const pts = s.values
            .map((v, i) => pt(i, clamp(v)).join(","))
            .join(" ");
          return (
            <g key={si}>
              <polygon
                points={pts}
                fill={s.color}
                fillOpacity="0.16"
                stroke={s.color}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              {s.values.map((v, i) => {
                const [x, y] = pt(i, clamp(v));
                const isHover =
                  hover && hover.series === si && hover.axis === i;
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={isHover ? 4.5 : 3}
                    fill={s.color}
                    stroke="var(--color-ipl-surface)"
                    strokeWidth="1.5"
                    style={{ cursor: "pointer", transition: "r 100ms" }}
                    onMouseEnter={() => setHover({ axis: i, series: si })}
                  />
                );
              })}
              {/* Data labels next to each vertex. For low values the dot is
                  far from the axis label, so we offset outward; for higher
                  values we flip and offset inward (toward the centre) so the
                  number never collides with the axis label or tick caption.
                  Offset has to clear both the dot (~4.5px effective radius)
                  and the text half-height (~5px), so we use ~18px to leave
                  comfortable breathing room either side of the polygon edge. */}
              {s.values.map((v, i) => {
                const disp = s.displayValues?.[i];
                if (!disp) return null;
                const cv = clamp(v);
                const [x, y] = pt(i, cv);
                const a = angleOf(i);
                const offset = cv >= 0.55 ? -18 : 16;
                const dx = Math.cos(a) * offset;
                const dy = Math.sin(a) * offset;
                return (
                  <text
                    key={`v${i}`}
                    x={x + dx}
                    y={y + dy + 3}
                    textAnchor="middle"
                    fontSize="9"
                    fill={s.color}
                    className="font-mono font-semibold"
                  >
                    {disp}
                  </text>
                );
              })}
            </g>
          );
        })}

        {/* Axis labels — modest size and case so they sit alongside the chart
            instead of overwhelming it. Pushed slightly further out than the
            outer grid ring to leave room for the radially-offset data labels. */}
        {axes.map((a, i) => {
          const [x, y] = pt(i, 1.24);
          return (
            <text
              key={i}
              x={x}
              y={y + 3}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-ipl-ink)"
              className="font-semibold"
            >
              {a.label}
            </text>
          );
        })}

        {/* Optional caption for the tick scale */}
        {scaleLabel && (
          <text
            x={cx}
            y={height - 4}
            textAnchor="middle"
            fontSize="9"
            fill="var(--color-ipl-sub)"
            className="uppercase tracking-[0.08em]"
          >
            {scaleLabel}
          </text>
        )}
      </svg>
      {tooltipNode}
    </div>
  );
}
