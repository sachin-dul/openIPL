import { type ReactNode } from "react";

type Props = {
  label: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
};

/**
 * Small rounded filter pill. Used at the top-right of pages for binary state
 * filters (Active/Retired, Featured, etc). Active = solid ink; inactive =
 * outline; disabled = muted with no hover.
 */
export function Pill({ label, active, disabled, onClick, title }: Props) {
  // Inline background/border/color so the active/inactive contrast is robust
  // even when a Tailwind v4 utility for a custom CSS-variable color doesn't
  // resolve at runtime (we hit this on chart tooltips too).
  // Literal hex values (mirrored from globals.css `@theme inline`). Tailwind
  // v4 sometimes fails to resolve `var(--color-ipl-*)` inside inline `style`
  // until you've touched the file — using the raw color removes that fragility.
  const style: React.CSSProperties = disabled
    ? {
        backgroundColor: "#ffffff",
        borderColor: "#e6e3dc",
        color: "#a09e96",
      }
    : active
      ? {
          backgroundColor: "#15171a",
          borderColor: "#15171a",
          color: "#ffffff",
        }
      : {
          backgroundColor: "#ffffff",
          borderColor: "#a09e96",
          color: "#15171a",
        };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      className={
        "text-[11px] px-2.5 py-[5px] rounded-full font-semibold border transition-colors " +
        (disabled
          ? "cursor-not-allowed"
          : active
            ? ""
            : "hover:border-ipl-soft")
      }
    >
      {label}
    </button>
  );
}
