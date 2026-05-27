import { type ReactNode } from "react";

type Props = {
  title: ReactNode;
  sub?: ReactNode;
  /** Right-aligned slot — filter pills, action buttons, etc. */
  right?: ReactNode;
};

/**
 * Standard page header: 28px H1 on the left, optional secondary line beneath,
 * and an optional right-aligned slot (filter pills, export buttons, etc).
 * Lives above each page's grid and gets ~18px bottom margin.
 */
export function PageHead({ title, sub, right }: Props) {
  return (
    <div className="flex items-end justify-between mb-[18px]">
      <div>
        <div className="text-[28px] font-semibold tracking-[-0.6px] leading-[1.05] text-ipl-ink">
          {title}
        </div>
        {sub && <div className="text-[13px] text-ipl-sub mt-1">{sub}</div>}
      </div>
      {right}
    </div>
  );
}
