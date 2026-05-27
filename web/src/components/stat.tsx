import { type ReactNode } from "react";

type Props = {
  /** Tiny uppercase column header above the value. */
  label: string;
  /** The number (or short text) to feature. Pre-format with commas / decimals. */
  value: ReactNode;
  /** Optional units suffix shown smaller and sub-colored next to the value. */
  unit?: string;
  /** "+12" / "-3.2" / "↑0.4" — colored green on +/↑, red otherwise. */
  delta?: string;
  /** Secondary line under the value (e.g. "across 19 seasons"). */
  sub?: ReactNode;
  /** Big variant: 38px value, used in hero cards. */
  big?: boolean;
};

/**
 * The fundamental data tile. Pairs a small uppercase label with a mono number,
 * and optionally a delta and/or sub-line.
 */
export function Stat({ label, value, unit, delta, sub, big = false }: Props) {
  const positive = delta ? delta.startsWith("+") || delta.startsWith("↑") : false;
  return (
    <div>
      <div className="text-[10px] uppercase font-semibold tracking-[0.08em] text-ipl-sub">
        {label}
      </div>
      <div
        className={
          "font-mono font-semibold leading-none mt-1 text-ipl-ink tracking-[-0.02em] " +
          (big ? "text-[38px]" : "text-[24px]")
        }
      >
        {value}
        {unit && (
          <span className={"ml-1 text-ipl-sub " + (big ? "text-base" : "text-xs")}>
            {unit}
          </span>
        )}
      </div>
      {(delta || sub) && (
        <div className="flex items-center gap-1.5 text-[11px] text-ipl-sub mt-1.5">
          {delta && (
            <span
              className={
                "font-mono font-semibold " + (positive ? "text-ipl-pos" : "text-ipl-neg")
              }
            >
              {delta}
            </span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}
