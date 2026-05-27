import { type ReactNode } from "react";

type Props = {
  /** Tiny uppercase label above the title (e.g. "ORANGE CAP · IPL 2025"). */
  kicker?: ReactNode;
  /** Main title shown 14px / weight 600. */
  title?: ReactNode;
  /** Right-aligned slot in the header — sort dropdowns, filter pills, etc. */
  action?: ReactNode;
  /** When false the body has no padding (use for tables that flush to edges). */
  padded?: boolean;
  /** Extra classes on the outer container — handy for grid spans. */
  className?: string;
  children: ReactNode;
};

/**
 * The universal container for the redesign. Every dashboard block sits inside
 * one of these — bordered, 10px radius, white surface, optional header strip
 * with kicker / title / action.
 */
export function Card({ kicker, title, action, padded = true, className, children }: Props) {
  const hasHeader = Boolean(kicker || title || action);
  return (
    <div
      className={
        "bg-ipl-surface border border-ipl-line rounded-[10px] overflow-hidden flex flex-col " +
        (className ?? "")
      }
    >
      {hasHeader && (
        <div className="flex items-baseline justify-between gap-3 px-3.5 pt-2.5 pb-2 border-b border-ipl-line2">
          <div>
            {kicker && (
              <div className="text-[10px] uppercase font-semibold tracking-[0.08em] text-ipl-sub">
                {kicker}
              </div>
            )}
            {title && (
              <div className="text-[14px] font-semibold tracking-[-0.01em] text-ipl-ink">
                {title}
              </div>
            )}
          </div>
          {action && <div className="text-[11px] text-ipl-sub">{action}</div>}
        </div>
      )}
      <div className={(padded ? "p-3.5 " : "") + "flex-1 flex flex-col min-h-0"}>{children}</div>
    </div>
  );
}
