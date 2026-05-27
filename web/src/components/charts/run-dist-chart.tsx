/**
 * Histogram of runs scored per ball faced. Six fixed buckets: 0 / 1 / 2 / 3 /
 * 4 / 6. Each bar carries its count above and its share-of-total percent below
 * the run value at the bottom. Heights are scaled to the largest bucket.
 */

export type RunDistBucket = {
  /** Runs value: 0, 1, 2, 3, 4, or 6. */
  runs: number;
  /** Count of balls in this bucket. */
  count: number;
  /** Percent of total balls (0–100). */
  pct: number;
};

const COLOR_FOR_RUNS: Record<number, string> = {
  0: "var(--color-ipl-soft)",
  1: "var(--color-ipl-sub)",
  2: "var(--color-ipl-accent)",
  3: "var(--color-ipl-accent)",
  4: "var(--color-ipl-pos)",
  6: "var(--color-ipl-neg)",
};

type Props = {
  buckets: RunDistBucket[];
  height?: number;
};

export function RunDistChart({ buckets, height = 160 }: Props) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div>
      <div className="flex gap-3 items-end px-2.5" style={{ height }}>
        {buckets.map((b) => {
          const h = (b.count / max) * 100;
          return (
            <div
              key={b.runs}
              className="flex-1 flex flex-col items-center gap-1.5"
            >
              <span className="font-mono text-[11px] font-semibold text-ipl-ink">
                {b.count}
              </span>
              <div
                className="w-full rounded-sm"
                style={{
                  height: `${Math.max(h, 2)}%`,
                  background: COLOR_FOR_RUNS[b.runs] ?? "var(--color-ipl-sub)",
                  opacity: 0.88,
                  minHeight: 4,
                }}
              />
              <span className="font-mono text-[11px] font-bold text-ipl-sub">
                {b.runs}
              </span>
              <span className="text-[10px] text-ipl-sub">
                {Math.round(b.pct)}%
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-ipl-sub mt-2 text-center">
        Runs scored per ball faced
      </div>
    </div>
  );
}
