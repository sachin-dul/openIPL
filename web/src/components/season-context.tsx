"use client";

import { createContext, useContext, type ReactNode } from "react";

const SeasonContext = createContext<number | null>(null);

/**
 * Marks the subtree as scoped to a specific IPL season. TeamBadge reads this
 * to pick the era-correct logo for franchises with multiple visual eras
 * (e.g. RR's pre-2019 crest). Wrap `/season/[year]/...` layouts and any
 * single-match content in this so descendant badges become season-aware
 * without prop drilling.
 */
export function SeasonProvider({
  season,
  children,
}: {
  season: number | null | undefined;
  children: ReactNode;
}) {
  return (
    <SeasonContext.Provider value={season ?? null}>
      {children}
    </SeasonContext.Provider>
  );
}

export function useImpliedSeason(): number | null {
  return useContext(SeasonContext);
}
