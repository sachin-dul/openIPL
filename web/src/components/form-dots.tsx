type Props = {
  /** A string of W / L / N characters (e.g. "WWLWL"). Any other char shows as neutral. */
  form: string;
  /** Pixel side-length of each chip. Defaults to 12. */
  size?: number;
};

const COLORS: Record<string, string> = {
  W: "var(--color-ipl-pos)",
  L: "var(--color-ipl-neg)",
  N: "var(--color-ipl-soft)",
};

/**
 * Last-N results as a row of colored letter chips. Used on the points table
 * (form column) and on the Landing "dynasties" panel.
 */
export function FormDots({ form, size = 12 }: Props) {
  const chars = Array.from(form);
  const lastIdx = chars.length - 1;
  return (
    <span className="inline-flex gap-[3px] items-end">
      {chars.map((c, i) => {
        const bg = COLORS[c] ?? COLORS.N;
        const isLast = i === lastIdx;
        return (
          <span key={i} className="inline-flex flex-col items-center gap-[2px]">
            <span
              className="inline-flex items-center justify-center text-white font-mono font-bold rounded-[3px]"
              style={{ width: size, height: size, background: bg, fontSize: size * 0.6 }}
            >
              {c}
            </span>
            <span
              aria-hidden
              style={{
                width: size,
                height: 2,
                background: isLast ? "var(--color-ipl-ink)" : "transparent",
                borderRadius: 1,
              }}
            />
          </span>
        );
      })}
    </span>
  );
}
