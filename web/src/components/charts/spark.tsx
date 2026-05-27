/**
 * Tiny inline sparkline. Pass a numeric array; nulls break the line into
 * separate segments. Auto-scales to the data range. Optionally fills the area
 * under the line in a translucent tint of the stroke color.
 */
type Props = {
  values: Array<number | null>;
  width?: number;
  height?: number;
  /** Stroke + tint color. Defaults to the brand accent. */
  color?: string;
  /** Translucent area fill below the line. */
  area?: boolean;
  /**
   * Optional per-point tooltip text. Length must match `values`. When provided,
   * each point gets a hover target with a native browser tooltip.
   */
  pointTitles?: string[];
};

export function Spark({
  values,
  width = 80,
  height = 22,
  color = "var(--color-ipl-accent)",
  area = true,
  pointTitles,
}: Props) {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) {
    return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} />;
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const xs = values.map((_, i) => (i / Math.max(values.length - 1, 1)) * width);
  const ys = values.map((v) =>
    v == null ? null : height - ((v - min) / range) * (height - 2) - 1,
  );

  const segments: string[][] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length > 1) segments.push(cur);
      cur = [];
    } else {
      cur.push(`${xs[i].toFixed(1)},${(ys[i] as number).toFixed(1)}`);
    }
  });
  if (cur.length > 1) segments.push(cur);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="block"
    >
      {area &&
        segments.map((s, i) => {
          const xStart = s[0].split(",")[0];
          const xEnd = s[s.length - 1].split(",")[0];
          return (
            <polygon
              key={i}
              points={`${xStart},${height} ${s.join(" ")} ${xEnd},${height}`}
              fill={color}
              opacity="0.12"
            />
          );
        })}
      {segments.map((s, i) => (
        <polyline
          key={i}
          points={s.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {/* Hover targets per point: invisible-ish circles with native <title>
          tooltips, sized larger than the visible dot for an easier hover. */}
      {pointTitles &&
        values.map((v, i) => {
          if (v == null) return null;
          const cx = xs[i];
          const cy = ys[i] as number;
          return (
            <circle
              key={`pt-${i}`}
              cx={cx}
              cy={cy}
              r={Math.max(2, height / 6)}
              fill={color}
              fillOpacity={0.001}
              stroke={color}
              strokeOpacity={0}
              style={{ cursor: "default" }}
            >
              <title>{pointTitles[i]}</title>
            </circle>
          );
        })}
    </svg>
  );
}
