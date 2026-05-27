"use client";

import {
  VisSingleContainer,
  VisDonut,
} from "@unovis/react";

export const PHASE_ORDER = ["powerplay", "middle", "death"] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  powerplay: "Powerplay (1-6)",
  middle: "Middle (7-15)",
  death: "Death (16-20)",
};

export const PHASE_BAND_COLORS: Record<Phase, string> = {
  powerplay: "#bfdbfe",
  middle: "#fde68a",
  death: "#fca5a5",
};

export const DRS_OUTCOMES = [
  "Overturned",
  "Umpire's Call",
  "On-field Stood",
] as const;
export type DrsOutcome = (typeof DRS_OUTCOMES)[number];

export const DRS_COLORS: Record<DrsOutcome, string> = {
  Overturned: "#16a34a",
  "Umpire's Call": "#eab308",
  "On-field Stood": "#dc2626",
};

export const IMPACT_INTENT_COLORS = {
  bat: "#16a34a",
  bowl: "#f59e0b",
  same: "#9ca3af",
} as const;
export type ImpactIntent = keyof typeof IMPACT_INTENT_COLORS;

export function Card({
  title,
  right,
  padded = true,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  /** When false, body has no padding (use for tables that flush to edges). */
  padded?: boolean;
  children: React.ReactNode;
}) {
  // Matches the shared @/components/card chrome (bg-ipl-surface, 10px radius,
  // 14px title in the header strip). Keeps h-full + flex-fill in the body so
  // unovis canvases that rely on `flex-1` still size correctly inside.
  return (
    <div className="bg-ipl-surface border border-ipl-line rounded-[10px] overflow-hidden flex flex-col h-full animate-fade-in">
      <div className="flex items-baseline justify-between gap-3 px-3.5 pt-2.5 pb-2 border-b border-ipl-line2">
        <div className="text-[14px] font-semibold tracking-[-0.01em] text-ipl-ink">
          {title}
        </div>
        {right && <div className="text-[11px] text-ipl-sub">{right}</div>}
      </div>
      <div className={(padded ? "p-3.5 " : "") + "flex-1 flex flex-col"}>
        {children}
      </div>
    </div>
  );
}

export type Slice = { label: string; value: number; color: string };

export function DonutWithLegend({
  slices,
  total,
  totalLabel,
  legend,
  loading,
  error,
  empty,
}: {
  slices: Slice[];
  total: number;
  totalLabel: string;
  legend: { color: string; label: string; value: number; pct: number }[];
  loading: boolean;
  error: string | null;
  empty: boolean;
}) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (empty) return <Empty />;

  return (
    <div className="flex flex-col items-center justify-center gap-4 flex-1">
      <div className="w-44 h-44">
        {/* unovis types `data` as a single Datum on VisSingleContainer, but a
            donut consumes the full array — the runtime is happy, the types
            just need a nudge. */}
        <VisSingleContainer<Slice>
          data={slices as unknown as Slice}
          height="100%"
        >
          <VisDonut<Slice>
            value={(d) => d.value}
            color={(d) => d.color}
            arcWidth={26}
            centralLabel={`${total}`}
            centralSubLabel={totalLabel}
          />
        </VisSingleContainer>
      </div>
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        {legend.map((l) => (
          <li key={l.label} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: l.color }}
            />
            <span className="text-ipl-sub">{l.label}</span>
            <span className="font-semibold tabular-nums text-ipl-ink font-mono">
              {l.value}
            </span>
            <span className="text-xs text-ipl-sub tabular-nums font-mono">
              ({l.pct}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SplitBar({
  label,
  pct,
  numerator,
  denominator,
  color,
  dim,
  delay,
}: {
  label: string;
  pct: number;
  numerator: number;
  denominator: number;
  color: string;
  dim?: boolean;
  delay: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-ipl-sub">{label}</span>
        <span className="tabular-nums text-ipl-ink font-mono">
          <span className="font-semibold text-ipl-ink">{numerator}</span>
          <span className="text-ipl-sub">/{denominator}</span>
          {denominator > 0 && (
            <span className="text-ipl-sub ml-1">
              ({Math.round(pct)}%)
            </span>
          )}
        </span>
      </div>
      <div className="relative h-1.5 bg-ipl-line2 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
          style={{
            width: `${pct}%`,
            background: color,
            opacity: dim ? 0.5 : 1,
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="px-4 py-8 text-ipl-sub text-sm text-center">Loading…</div>
  );
}

export function Empty({ message = "No data." }: { message?: string } = {}) {
  return (
    <div className="px-4 py-8 text-ipl-sub text-sm text-center">{message}</div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <pre className="px-4 py-6 text-ipl-neg text-xs whitespace-pre-wrap">
      {message}
    </pre>
  );
}
