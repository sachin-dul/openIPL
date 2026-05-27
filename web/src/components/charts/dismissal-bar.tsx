/**
 * Stack of horizontal bars showing how a batter got out (or how a bowler
 * took wickets). Each row: dismissal kind label, bar, raw count, percentage.
 */

export type DismissalRow = { kind: string; n: number };

type Props = {
  rows: DismissalRow[];
  /** Bar fill color. */
  color?: string;
};

export function DismissalBar({
  rows,
  color = "var(--color-ipl-accent)",
}: Props) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.n, 0);
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div
          key={r.kind}
          className="grid items-center gap-2 text-[11px]"
          style={{ gridTemplateColumns: "80px 1fr 36px 36px" }}
        >
          <span className="text-ipl-sub">{r.kind}</span>
          <div className="h-2.5 bg-ipl-line2 rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm"
              style={{ width: `${(r.n / max) * 100}%`, background: color }}
            />
          </div>
          <span className="font-mono text-right font-semibold">{r.n}</span>
          <span className="font-mono text-right text-ipl-sub">
            {total > 0 ? Math.round((r.n / total) * 100) : 0}%
          </span>
        </div>
      ))}
    </div>
  );
}
