"use client";

import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort, teamColor } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { Card, Loading, Empty, ErrorBox, SplitBar } from "./chart-shell";

type Row = {
  team: string;
  home_played: number;
  home_won: number;
  away_played: number;
  away_won: number;
};

export function HomeAdvantageByTeam({ year }: { year: number }) {
  const state = useDuckQuery<Row>(
    `WITH per_team AS (
       SELECT team_1 AS team,
              CASE WHEN winner = team_1 THEN 1 ELSE 0 END AS won,
              1 AS is_home
       FROM matches
       WHERE season = ${year} AND COALESCE(result,'') != 'no result' AND winner IS NOT NULL
       UNION ALL
       SELECT team_2 AS team,
              CASE WHEN winner = team_2 THEN 1 ELSE 0 END AS won,
              0 AS is_home
       FROM matches
       WHERE season = ${year} AND COALESCE(result,'') != 'no result' AND winner IS NOT NULL
     )
     SELECT team,
            CAST(SUM(CASE WHEN is_home = 1 THEN 1 ELSE 0 END) AS BIGINT) AS home_played,
            CAST(SUM(CASE WHEN is_home = 1 THEN won ELSE 0 END) AS BIGINT) AS home_won,
            CAST(SUM(CASE WHEN is_home = 0 THEN 1 ELSE 0 END) AS BIGINT) AS away_played,
            CAST(SUM(CASE WHEN is_home = 0 THEN won ELSE 0 END) AS BIGINT) AS away_won
     FROM per_team
     GROUP BY team
     ORDER BY (
       CASE WHEN SUM(CASE WHEN is_home=1 THEN 1 ELSE 0 END) > 0
            THEN SUM(CASE WHEN is_home=1 THEN won ELSE 0 END) * 1.0
                 / SUM(CASE WHEN is_home=1 THEN 1 ELSE 0 END)
            ELSE 0 END
     ) DESC`
  );

  const rows = state.status === "success" ? state.data : [];

  return (
    <Card title="Home vs Away — By Team">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && rows.length === 0 && <Empty />}
      {state.status === "success" && rows.length > 0 && (
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const homeWinPct =
              r.home_played > 0 ? (r.home_won / r.home_played) * 100 : 0;
            const awayWinPct =
              r.away_played > 0 ? (r.away_won / r.away_played) * 100 : 0;
            return (
              <li key={r.team} className="grid grid-cols-[minmax(0,1fr)_1fr_1fr] items-center gap-4">
                <div className="flex items-center gap-2 text-sm font-medium text-ipl-ink">
                  <TeamBadge team={r.team} size="sm" />
                  <span className="truncate">{teamShort(r.team)}</span>
                </div>
                <SplitBar
                  label="Home"
                  pct={homeWinPct}
                  numerator={r.home_won}
                  denominator={r.home_played}
                  color={teamColor(r.team)}
                  delay={i * 60}
                />
                <SplitBar
                  label="Away"
                  pct={awayWinPct}
                  numerator={r.away_won}
                  denominator={r.away_played}
                  color={teamColor(r.team)}
                  dim
                  delay={i * 60 + 100}
                />
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
