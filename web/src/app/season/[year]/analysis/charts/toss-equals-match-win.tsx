"use client";

import { useDuckQuery } from "@/lib/use-duck-query";
import { Card, DonutWithLegend, type Slice } from "./chart-shell";

export function TossEqualsMatchWin({ year }: { year: number }) {
  const state = useDuckQuery<{ won: number; lost: number }>(
    `SELECT
       CAST(SUM(CASE WHEN toss_winner = winner THEN 1 ELSE 0 END) AS BIGINT) AS won,
       CAST(SUM(CASE WHEN toss_winner != winner AND winner IS NOT NULL THEN 1 ELSE 0 END) AS BIGINT) AS lost
     FROM matches
     WHERE season = ${year}
       AND COALESCE(result, '') != 'no result'
       AND winner IS NOT NULL`
  );

  const r = state.status === "success" ? state.data[0] : null;
  const won = r?.won ?? 0;
  const lost = r?.lost ?? 0;
  const total = won + lost;
  const wonPct = total > 0 ? Math.round((won / total) * 100) : 0;
  const lostPct = total > 0 ? 100 - wonPct : 0;
  const C_WON = "#16a34a";
  const C_LOST = "#dc2626";

  const slices: Slice[] = [
    { label: "Toss winner won", value: won, color: C_WON },
    { label: "Toss winner lost", value: lost, color: C_LOST },
  ];

  return (
    <Card title="Toss Win = Match Win?">
      <DonutWithLegend
        slices={slices}
        total={total}
        totalLabel="matches"
        legend={[
          { color: C_WON, label: "Toss winner won", value: won, pct: wonPct },
          { color: C_LOST, label: "Toss winner lost", value: lost, pct: lostPct },
        ]}
        loading={state.status === "loading"}
        error={state.status === "error" ? state.error.message : null}
        empty={state.status === "success" && total === 0}
      />
    </Card>
  );
}
