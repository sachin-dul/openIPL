"use client";

import { useDuckQuery } from "@/lib/use-duck-query";
import { Card, DonutWithLegend, type Slice } from "./chart-shell";

type HomeAwayOverall = {
  home_wins: number;
  away_wins: number;
  decided: number;
};

export function HomeVsAwayOverall({ year }: { year: number }) {
  const state = useDuckQuery<HomeAwayOverall>(
    `SELECT
       CAST(SUM(CASE WHEN winner = team_1 THEN 1 ELSE 0 END) AS BIGINT) AS home_wins,
       CAST(SUM(CASE WHEN winner = team_2 THEN 1 ELSE 0 END) AS BIGINT) AS away_wins,
       CAST(SUM(CASE WHEN winner IS NOT NULL THEN 1 ELSE 0 END) AS BIGINT) AS decided
     FROM matches
     WHERE season = ${year}
       AND COALESCE(result, '') != 'no result'`
  );

  const r = state.status === "success" ? state.data[0] : null;
  const home = r?.home_wins ?? 0;
  const away = r?.away_wins ?? 0;
  const total = home + away;
  const homePct = total > 0 ? Math.round((home / total) * 100) : 0;
  const awayPct = total > 0 ? 100 - homePct : 0;

  const C_HOME = "#16a34a";
  const C_AWAY = "#0ea5e9";
  const slices: Slice[] = [
    { label: "Home wins", value: home, color: C_HOME },
    { label: "Away wins", value: away, color: C_AWAY },
  ];

  return (
    <Card title="Home vs Away — Overall">
      <DonutWithLegend
        slices={slices}
        total={total}
        totalLabel="matches"
        legend={[
          { color: C_HOME, label: "Home wins", value: home, pct: homePct },
          { color: C_AWAY, label: "Away wins", value: away, pct: awayPct },
        ]}
        loading={state.status === "loading"}
        error={state.status === "error" ? state.error.message : null}
        empty={state.status === "success" && total === 0}
      />
    </Card>
  );
}
