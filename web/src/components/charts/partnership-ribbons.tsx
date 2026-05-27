/**
 * Horizontal "ribbons" for each partnership in an innings. Each row shows the
 * wicket number, both batters' names, a bar scaled to the largest partnership
 * in this innings, the runs total, and the balls faced.
 */

export type PartnershipRow = {
  wicket: number;
  batter1: string;
  batter2: string;
  runs: number;
  balls: number;
};

type Props = {
  rows: PartnershipRow[];
  color?: string;
};

export function PartnershipRibbons({
  rows,
  color = "var(--color-ipl-accent)",
}: Props) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.runs), 1);
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {rows.map((r) => (
        <div
          key={r.wicket}
          className="flex items-center gap-2.5 text-[12px]"
        >
          <span className="font-mono text-ipl-sub w-4">{r.wicket}</span>
          <span className="text-ipl-ink text-[11px] w-[140px] truncate">
            {r.batter1} · {r.batter2}
          </span>
          <div className="flex-1 h-[14px] bg-ipl-line2 rounded-[3px] overflow-hidden">
            <div
              className="h-full rounded-[3px]"
              style={{ width: `${(r.runs / max) * 100}%`, background: color }}
            />
          </div>
          <span className="font-mono w-7 text-right font-semibold">{r.runs}</span>
          <span className="font-mono text-ipl-sub w-9 text-[11px]">
            {r.balls}b
          </span>
        </div>
      ))}
    </div>
  );
}
