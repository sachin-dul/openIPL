"use client";

import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort, teamColor } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import {
  VisSingleContainer,
  VisDonut,
  VisXYContainer,
  VisLine,
  VisAxis,
  VisCrosshair,
  VisTooltip,
} from "@unovis/react";

export function AnalysisContent({ year }: { year: number }) {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">IPL {year}</h1>
        <p className="text-zinc-500 text-sm mt-1">Season analysis</p>
      </header>

      <StandingsProgression year={year} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TossDecisions year={year} />
        <TossEqualsMatchWin year={year} />
        <HomeVsAwayOverall year={year} />
      </div>

      <HomeAdvantageByTeam year={year} />
    </div>
  );
}

// ── Standings Progression ────────────────────────────────────────────────────
type RawMatchPts = { team: string; match_number: number; pts: number };
type Snapshot = { match: number; position: number; points: number; played: number };

function StandingsProgression({ year }: { year: number }) {
  const state = useDuckQuery<RawMatchPts>(
    `SELECT team, CAST(match_number AS BIGINT) AS match_number, CAST(pts AS BIGINT) AS pts FROM (
       SELECT team_1 AS team, match_number,
              CASE WHEN COALESCE(result,'')='no result' THEN 1
                   WHEN winner=team_1 THEN 2 ELSE 0 END AS pts
       FROM matches WHERE season = ${year}
       UNION ALL
       SELECT team_2 AS team, match_number,
              CASE WHEN COALESCE(result,'')='no result' THEN 1
                   WHEN winner=team_2 THEN 2 ELSE 0 END AS pts
       FROM matches WHERE season = ${year}
     ) ORDER BY match_number`
  );

  const raw = state.status === "success" ? state.data : [];
  const { teamSeries, allTeams, lastMatch } = buildStandings(raw);

  return (
    <Card title="Standings Progression">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && allTeams.length === 0 && <Empty />}
      {state.status === "success" && allTeams.length > 0 && (
        <div>
          {/* Final-standings legend, ordered by final position. */}
          <ol className="flex flex-wrap gap-2 mb-4">
            {allTeams.map((team, i) => (
              <li
                key={team}
                className="flex items-center gap-1.5 text-xs animate-fade-in"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="text-zinc-400 tabular-nums w-4 text-right">
                  {i + 1}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded font-bold text-white text-[10px]"
                  style={{ background: teamColor(team) }}
                >
                  {teamShort(team)}
                </span>
              </li>
            ))}
          </ol>

          <VisXYContainer<Snapshot>
            height={420}
            yDomain={[1, allTeams.length]}
            xDomain={[1, lastMatch]}
          >
            {allTeams.map((team) => (
              <VisLine<Snapshot>
                key={team}
                data={teamSeries[team]}
                x={(d) => d.match}
                // Invert: position 1 (best) plots at the top of the y-axis.
                y={(d) => allTeams.length + 1 - d.position}
                color={teamColor(team)}
                lineWidth={3}
                curveType="basis"
              />
            ))}
            <VisAxis<Snapshot>
              type="x"
              label="Match"
              tickFormat={(v: number) => `M${v}`}
            />
            <VisAxis<Snapshot>
              type="y"
              label="Position"
              // Translate inverted y-value back to actual position label.
              tickFormat={(v: number) =>
                String(allTeams.length + 1 - Math.round(v))
              }
              numTicks={allTeams.length}
            />
            <VisCrosshair<Snapshot>
              template={(d: Snapshot) =>
                `<div style="font-size:12px;padding:4px 8px;">M${d.match} · #${d.position}</div>`
              }
            />
            <VisTooltip />
          </VisXYContainer>
          <p className="text-xs text-zinc-500 mt-2">
            Lines are smoothed for readability; teams ranked by points-only here
            (NRR ties broken alphabetically).
          </p>
        </div>
      )}
    </Card>
  );
}

/** Compute per-team rank snapshots from raw per-match points. */
function buildStandings(raw: RawMatchPts[]): {
  teamSeries: Record<string, Snapshot[]>;
  allTeams: string[];
  lastMatch: number;
} {
  if (raw.length === 0)
    return { teamSeries: {}, allTeams: [], lastMatch: 0 };

  const points: Record<string, number> = {};
  const played: Record<string, number> = {};
  const teams = [...new Set(raw.map((r) => r.team))];
  teams.forEach((t) => {
    points[t] = 0;
    played[t] = 0;
  });

  // Group by match_number so we update both teams before ranking
  const byMatch = new Map<number, RawMatchPts[]>();
  for (const r of raw) {
    if (!byMatch.has(r.match_number)) byMatch.set(r.match_number, []);
    byMatch.get(r.match_number)!.push(r);
  }
  const matchNums = [...byMatch.keys()].sort((a, b) => a - b);

  const series: Record<string, Snapshot[]> = {};
  teams.forEach((t) => (series[t] = []));

  for (const mn of matchNums) {
    for (const r of byMatch.get(mn)!) {
      points[r.team] += r.pts;
      played[r.team] += 1;
    }
    // Rank teams that have played at least one game
    const ranked = [...teams]
      .filter((t) => played[t] > 0)
      .sort((a, b) => {
        if (points[b] !== points[a]) return points[b] - points[a];
        return a.localeCompare(b);
      });
    ranked.forEach((team, i) => {
      series[team].push({
        match: mn,
        position: i + 1,
        points: points[team],
        played: played[team],
      });
    });
  }

  // Sort allTeams by their final rank for stable color/label order
  const finalRank = (t: string) => {
    const last = series[t][series[t].length - 1];
    return last ? last.position : 999;
  };
  const sorted = [...teams].sort((a, b) => finalRank(a) - finalRank(b));

  return { teamSeries: series, allTeams: sorted, lastMatch: matchNums[matchNums.length - 1] };
}

// ── Toss Decisions ───────────────────────────────────────────────────────────
type TossDecisionRow = { decision: string; n: number };
type Slice = { label: string; value: number; color: string };

function TossDecisions({ year }: { year: number }) {
  const state = useDuckQuery<TossDecisionRow>(
    `SELECT toss_decision AS decision, CAST(COUNT(*) AS BIGINT) AS n
     FROM matches
     WHERE season = ${year}
       AND COALESCE(result, '') != 'no result'
       AND toss_decision IS NOT NULL
     GROUP BY toss_decision`
  );

  const rows = state.status === "success" ? state.data : [];
  const totalN = rows.reduce((a, r) => a + r.n, 0);
  const bat = rows.find((r) => r.decision === "bat")?.n ?? 0;
  const field = rows.find((r) => r.decision === "field")?.n ?? 0;
  const C_BAT = "#f59e0b";
  const C_FIELD = "#0ea5e9";

  const slices: Slice[] = [
    { label: "Chose to bat", value: bat, color: C_BAT },
    { label: "Chose to field", value: field, color: C_FIELD },
  ];
  const batPct = totalN > 0 ? Math.round((bat / totalN) * 100) : 0;
  const fieldPct = totalN > 0 ? 100 - batPct : 0;

  return (
    <Card title="Toss Decisions">
      <DonutWithLegend
        slices={slices}
        total={totalN}
        totalLabel="tosses"
        legend={[
          { color: C_BAT, label: "Chose to bat", value: bat, pct: batPct },
          { color: C_FIELD, label: "Chose to field", value: field, pct: fieldPct },
        ]}
        loading={state.status === "loading"}
        error={state.status === "error" ? state.error.message : null}
        empty={state.status === "success" && totalN === 0}
      />
    </Card>
  );
}

// ── Toss Win = Match Win? ────────────────────────────────────────────────────
function TossEqualsMatchWin({ year }: { year: number }) {
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

// ── Home vs Away — Overall ───────────────────────────────────────────────────
type HomeAwayOverall = {
  home_wins: number;
  away_wins: number;
  decided: number;
};

function HomeVsAwayOverall({ year }: { year: number }) {
  // Heuristic: team_1 = home in the JSON when there's a designated host.
  // For league seasons each team has 'home' games tagged this way; we approximate
  // home wins as matches where winner == team_1, away wins where winner == team_2.
  // Neutral-venue editions (2009 / 2014 partial / 2020) tilt toward 50/50 by design.
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
      <p className="text-xs text-zinc-500 mt-4 text-center">
        Approximated from team_1 / team_2 ordering; neutral-venue seasons (2009, 2020) skew this measure.
      </p>
    </Card>
  );
}

// ── Home Advantage by Team ───────────────────────────────────────────────────
type HomeTeamRow = {
  team: string;
  home_played: number;
  home_won: number;
  away_played: number;
  away_won: number;
};

function HomeAdvantageByTeam({ year }: { year: number }) {
  const state = useDuckQuery<HomeTeamRow>(
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
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
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

function SplitBar({
  label,
  pct,
  numerator,
  denominator,
  color,
  dim,
  delay,
}: {
  label: string;
  pct: number;
  numerator: number;
  denominator: number;
  color: string;
  dim?: boolean;
  delay: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-zinc-500">{label}</span>
        <span className="tabular-nums text-zinc-700">
          <span className="font-semibold text-zinc-900">{numerator}</span>
          <span className="text-zinc-400">/{denominator}</span>
          {denominator > 0 && (
            <span className="text-zinc-400 ml-1">
              ({Math.round(pct)}%)
            </span>
          )}
        </span>
      </div>
      <div className="relative h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
          style={{
            width: `${pct}%`,
            background: color,
            opacity: dim ? 0.5 : 1,
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}

// ── Shared chart shell + donut helper ────────────────────────────────────────
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        {title}
      </h2>
      <div className="border border-zinc-200 rounded-lg p-6 bg-white">
        {children}
      </div>
    </section>
  );
}

function DonutWithLegend({
  slices,
  total,
  totalLabel,
  legend,
  loading,
  error,
  empty,
}: {
  slices: Slice[];
  total: number;
  totalLabel: string;
  legend: { color: string; label: string; value: number; pct: number }[];
  loading: boolean;
  error: string | null;
  empty: boolean;
}) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (empty) return <Empty />;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-44 h-44">
        <VisSingleContainer<Slice> data={slices} height="100%">
          <VisDonut<Slice>
            value={(d) => d.value}
            color={(d) => d.color}
            arcWidth={26}
            centralLabel={`${total}`}
            centralSubLabel={totalLabel}
          />
        </VisSingleContainer>
      </div>
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        {legend.map((l) => (
          <li key={l.label} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: l.color }}
            />
            <span className="text-zinc-700">{l.label}</span>
            <span className="font-semibold tabular-nums text-zinc-900">
              {l.value}
            </span>
            <span className="text-xs text-zinc-500 tabular-nums">
              ({l.pct}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Loading() {
  return (
    <div className="px-4 py-8 text-zinc-500 text-sm text-center">Loading…</div>
  );
}

function Empty() {
  return (
    <div className="px-4 py-8 text-zinc-500 text-sm text-center">No data.</div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <pre className="px-4 py-6 text-red-600 text-xs whitespace-pre-wrap">
      {message}
    </pre>
  );
}
