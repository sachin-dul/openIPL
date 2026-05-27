/**
 * Placeholder search affordance in the top bar. The ⌘K command-palette is not
 * wired yet — clicking does nothing for now. The visual exists because every
 * page in the design carries this element; we'll attach behavior in a follow-up.
 */
export function SearchPill() {
  return (
    <button
      type="button"
      aria-label="Search (not yet wired)"
      className="flex items-center gap-1.5 border border-ipl-line rounded-[7px] px-2.5 py-[5px] text-[12px] text-ipl-sub bg-ipl-bg min-w-[220px] cursor-text"
    >
      <SearchIcon />
      <span className="flex-1 text-left">Search players, matches…</span>
      <span className="font-mono text-[10px] text-ipl-soft border border-ipl-line px-1 rounded-[3px] leading-[1.4]">
        ⌘K
      </span>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
