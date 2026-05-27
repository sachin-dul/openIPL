/**
 * Per-player stacked bar showing runs scored across the three phases of an
 * innings (powerplay / middle / death). Bar widths are scaled relative to
 * the largest total, with a phase-color legend underneath.
 */

export type PhaseStackRow = {
  who: string;
  pp: number;
  mid: number;
  death: number;
  /** Optional legal-ball counts per phase. When present, SR is shown on hover. */
  ppBalls?: number;
  midBalls?: number;
  deathBalls?: number;
};

type Props = {
  rows: PhaseStackRow[];
  /** Suffix on the per-row total (e.g. " runs", " wkts"). */
  totalSuffix?: string;
};

const COLORS = {
  pp: "#a78bfa",
  mid: "var(--color-ipl-accent)",
  death: "var(--color-ipl-neg)",
} as const;

const PHASE_LABELS = {
  pp: "Powerplay",
  mid: "Middle",
  death: "Death",
} as const;

function sr(runs: number, balls: number | undefined): string | null {
  if (!balls || balls <= 0) return null;
  return ((runs / balls) * 100).toFixed(1);
}

export function PhaseStack({ rows, totalSuffix = " runs" }: Props) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.pp + r.mid + r.death), 1);
  return (
    <div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const total = r.pp + r.mid + r.death;
          const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
          const segs: {
            key: "pp" | "mid" | "death";
            runs: number;
            balls: number | undefined;
          }[] = [
            { key: "pp", runs: r.pp, balls: r.ppBalls },
            { key: "mid", runs: r.mid, balls: r.midBalls },
            { key: "death", runs: r.death, balls: r.deathBalls },
          ];
          return (
            <div key={r.who} className="text-[11px]">
              <div className="flex justify-between mb-1">
                <span className="font-semibold text-ipl-ink">{r.who}</span>
                <span className="font-mono text-ipl-sub">
                  {total.toLocaleString()}
                  {totalSuffix}
                </span>
              </div>
              <div
                className="flex h-3 rounded-sm overflow-hidden"
                style={{ width: `${(total / max) * 100}%`, minWidth: 80 }}
              >
                {segs.map((s) => {
                  const w = pct(s.runs);
                  const srStr = sr(s.runs, s.balls);
                  // Native browser tooltip on each segment: phase, runs, SR.
                  // Strike rate adds the real story — two batters with the
                  // same death-overs runs can have very different SRs.
                  const tip = srStr
                    ? `${PHASE_LABELS[s.key]} · ${s.runs} runs · SR ${srStr}`
                    : `${PHASE_LABELS[s.key]} · ${s.runs} runs`;
                  return (
                    <div
                      key={s.key}
                      title={tip}
                      style={{ width: `${w}%`, background: COLORS[s.key] }}
                    />
                  );
                })}
              </div>
              {/* Per-phase SR line — shown when ball counts are available. */}
              {(r.ppBalls != null || r.midBalls != null || r.deathBalls != null) && (
                <div className="flex gap-3 mt-1 text-[10px] font-mono text-ipl-sub">
                  {segs.map((s) => {
                    const srStr = sr(s.runs, s.balls);
                    if (srStr == null) return null;
                    return (
                      <span key={s.key} className="inline-flex items-center gap-1">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-[1px]"
                          style={{ background: COLORS[s.key] }}
                        />
                        {srStr}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-3 text-[10px] text-ipl-sub">
        <LegendSwatch color={COLORS.pp} label="Powerplay" />
        <LegendSwatch color={COLORS.mid} label="Middle" />
        <LegendSwatch color={COLORS.death} label="Death" />
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-2 h-2 rounded-[1px]" style={{ background: color }} />
      {label}
    </span>
  );
}
