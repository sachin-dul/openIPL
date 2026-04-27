"use client";

import { useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort, teamColor } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";

const C_DOTS = "#0ea5e9";
const C_WKTS = "#7c3aed";

// `overs` is stored in cricket notation (e.g. 3.4 = 3 overs 4 balls, NOT 3.4 overs).
// To aggregate across innings we must convert to total balls first.
const BALLS_EXPR =
  "(FLOOR(overs) * 6 + ROUND((overs - FLOOR(overs)) * 10))";

type AggRow = {
  bowler: string;
  team: string;
  innings: number;
  balls: number;
  runs: number;
  wickets: number;
  dots: number;
  four_w: number;
  five_w: number;
  bbi: string | null;
};

type FiguresRow = {
  bowler: string;
  team: string;
  wickets: number;
  runs: number;
  overs: number;
  economy: number;
  dots: number;
  match_number: number;
  team_1: string;
  team_2: string;
};

type EconRow = {
  bowler: string;
  team: string;
  balls: number;
  runs: number;
  wickets: number;
};

type DotsRow = {
  bowler: string;
  team: string;
  dots: number;
  balls: number;
  wickets: number;
};

type PhaseBowlRow = {
  phase: string;
  runs: number;
  balls: number;
  wickets: number;
  dots: number;
};

type PhaseTeamRow = { team: string };

export function BowlingContent({ year }: { year: number }) {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">IPL {year}</h1>
        <p className="text-zinc-500 text-sm mt-1">Bowling</p>
      </header>

      <PurpleCapRace year={year} />
      <BowlingLeaderboard year={year} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BestFigures year={year} />
        <BestEconomy year={year} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MostDots year={year} />
        <BowlingByPhase year={year} />
      </div>
    </div>
  );
}

// ── 1. Purple Cap Race ───────────────────────────────────────────────────────
function PurpleCapRace({ year }: { year: number }) {
  const state = useDuckQuery<{
    bowler: string;
    team: string;
    wickets: number;
    innings: number;
  }>(
    `SELECT bowler, ANY_VALUE(team) AS team,
            CAST(SUM(wickets) AS BIGINT) AS wickets,
            CAST(COUNT(*) AS BIGINT) AS innings
     FROM bowling_scorecard
     WHERE season = ${year} AND bowler IS NOT NULL
     GROUP BY bowler
     -- IPL Purple Cap order: wickets DESC, tiebreak on career economy ASC
     ORDER BY SUM(wickets) DESC,
              (SUM(runs) * 6.0 / NULLIF(SUM(${BALLS_EXPR}), 0)) ASC NULLS LAST
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];
  const max = rows.reduce((m, r) => Math.max(m, r.wickets), 0);

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Purple Cap Race
      </h2>
      <div className="border border-zinc-200 rounded-lg p-4 bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.bowler}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3"
              >
                <span className="text-xs text-zinc-400 tabular-nums text-right">
                  {i + 1}
                </span>
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    <TeamBadge team={r.team} size="sm" />
                    <span className="truncate">{r.bowler}</span>
                    <span className="text-xs text-zinc-500 font-normal">
                      {teamShort(r.team)}
                    </span>
                    <span className="text-xs text-zinc-400 font-normal ml-auto">
                      {r.innings} inn
                    </span>
                  </div>
                  <div className="relative h-2 mt-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
                      style={{
                        width: `${max > 0 ? (r.wickets / max) * 100 : 0}%`,
                        background: teamColor(r.team),
                        animationDelay: `${i * 60}ms`,
                      }}
                    />
                  </div>
                </div>
                <span className="font-bold tabular-nums text-zinc-900 text-base min-w-[3rem] text-right">
                  {r.wickets}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// ── 2. Bowling Leaderboard ───────────────────────────────────────────────────
function BowlingLeaderboard({ year }: { year: number }) {
  const state = useDuckQuery<AggRow>(
    `WITH agg AS (
       SELECT bowler, ANY_VALUE(team) AS team,
              CAST(COUNT(*) AS BIGINT) AS innings,
              CAST(SUM(${BALLS_EXPR}) AS BIGINT) AS balls,
              CAST(SUM(runs) AS BIGINT) AS runs,
              CAST(SUM(wickets) AS BIGINT) AS wickets,
              CAST(SUM(dots) AS BIGINT) AS dots,
              CAST(SUM(CASE WHEN wickets = 4 THEN 1 ELSE 0 END) AS BIGINT) AS four_w,
              CAST(SUM(CASE WHEN wickets >= 5 THEN 1 ELSE 0 END) AS BIGINT) AS five_w
       FROM bowling_scorecard
       WHERE season = ${year} AND bowler IS NOT NULL
       GROUP BY bowler
     ),
     bbi AS (
       SELECT bowler,
              FIRST(CAST(wickets AS VARCHAR) || '/' || CAST(runs AS VARCHAR)
                    ORDER BY wickets DESC, runs ASC, overs DESC) AS bbi
       FROM bowling_scorecard
       WHERE season = ${year} AND bowler IS NOT NULL
       GROUP BY bowler
     )
     SELECT a.*, b.bbi FROM agg a LEFT JOIN bbi b USING (bowler)
     -- IPL Purple Cap order: wickets DESC, tiebreak on economy ASC
     ORDER BY a.wickets DESC,
              (a.runs * 6.0 / NULLIF(a.balls, 0)) ASC NULLS LAST
     LIMIT 15`
  );

  const rows = state.status === "success" ? state.data : [];

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Bowling Leaderboard
      </h2>
      <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium w-10">#</th>
                <th className="text-left px-3 py-2.5 font-medium">Bowler</th>
                <Th>Wkts</Th>
                <Th>Inn</Th>
                <Th>Overs</Th>
                <Th>Runs</Th>
                <Th>BBI</Th>
                <Th>Avg</Th>
                <Th>Econ</Th>
                <Th>SR</Th>
                <Th>4W</Th>
                <Th>5W</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const overs = ballsToOvers(r.balls);
                const avg =
                  r.wickets > 0
                    ? (r.runs / r.wickets).toFixed(2)
                    : "—";
                const econ =
                  r.balls > 0 ? ((r.runs / r.balls) * 6).toFixed(2) : "—";
                const sr =
                  r.wickets > 0 ? (r.balls / r.wickets).toFixed(1) : "—";
                return (
                  <tr
                    key={r.bowler}
                    className="border-t border-zinc-100 hover:bg-zinc-50 animate-fade-in"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <td className="px-3 py-2.5 text-zinc-500 tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <TeamBadge team={r.team} size="sm" />
                        <span className="font-medium text-zinc-900">
                          {r.bowler}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {teamShort(r.team)}
                        </span>
                      </div>
                    </td>
                    <Td emphasis="strong">{r.wickets}</Td>
                    <Td>{r.innings}</Td>
                    <Td>{overs}</Td>
                    <Td>{r.runs}</Td>
                    <Td>{r.bbi ?? "—"}</Td>
                    <Td>{avg}</Td>
                    <Td>{econ}</Td>
                    <Td>{sr}</Td>
                    <Td>{r.four_w}</Td>
                    <Td>{r.five_w}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── 3. Best Figures ──────────────────────────────────────────────────────────
function BestFigures({ year }: { year: number }) {
  const state = useDuckQuery<FiguresRow>(
    `SELECT b.bowler, b.team,
            CAST(b.wickets AS BIGINT) AS wickets,
            CAST(b.runs AS BIGINT) AS runs,
            b.overs, b.economy,
            CAST(b.dots AS BIGINT) AS dots,
            CAST(b.match_number AS BIGINT) AS match_number,
            m.team_1, m.team_2
     FROM bowling_scorecard b
     LEFT JOIN matches m
       ON b.season = m.season AND b.match_number = m.match_number
     WHERE b.season = ${year} AND b.bowler IS NOT NULL
     ORDER BY b.wickets DESC, b.runs ASC, b.overs ASC
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Best Bowling Figures
      </h2>
      <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Bowler</th>
                <Th>Figs</Th>
                <Th>Overs</Th>
                <Th>Econ</Th>
                <Th>Dots</Th>
                <th className="text-left px-3 py-2.5 font-medium">vs</th>
                <th className="text-left px-3 py-2.5 font-medium">M</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const opp =
                  r.team === r.team_1
                    ? teamShort(r.team_2)
                    : teamShort(r.team_1);
                return (
                  <tr
                    key={`${r.bowler}-${r.match_number}-${i}`}
                    className="border-t border-zinc-100 hover:bg-zinc-50 animate-fade-in"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <TeamBadge team={r.team} size="sm" />
                        <span className="font-medium text-zinc-900">
                          {r.bowler}
                        </span>
                      </div>
                    </td>
                    <Td emphasis="strong">
                      {r.wickets}/{r.runs}
                    </Td>
                    <Td>{r.overs.toFixed(1)}</Td>
                    <Td>{r.economy.toFixed(2)}</Td>
                    <Td>{r.dots}</Td>
                    <td className="px-3 py-2.5 text-zinc-600 text-xs">{opp}</td>
                    <td className="px-3 py-2.5 text-zinc-500 text-xs">
                      M{r.match_number}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── 4. Best Economy (min 10 overs / 60 balls) ────────────────────────────────
function BestEconomy({ year }: { year: number }) {
  const state = useDuckQuery<EconRow>(
    `SELECT bowler, ANY_VALUE(team) AS team,
            CAST(SUM(${BALLS_EXPR}) AS BIGINT) AS balls,
            CAST(SUM(runs) AS BIGINT) AS runs,
            CAST(SUM(wickets) AS BIGINT) AS wickets
     FROM bowling_scorecard
     WHERE season = ${year} AND bowler IS NOT NULL
     GROUP BY bowler
     HAVING SUM(${BALLS_EXPR}) >= 60
     ORDER BY (SUM(runs) * 6.0 / SUM(${BALLS_EXPR})) ASC
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Best Economy{" "}
        <span className="text-zinc-400 normal-case">(min 10 overs)</span>
      </h2>
      <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Bowler</th>
                <Th>Econ</Th>
                <Th>Overs</Th>
                <Th>Wkts</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const econ = (r.runs / r.balls) * 6;
                return (
                  <tr
                    key={r.bowler}
                    className="border-t border-zinc-100 hover:bg-zinc-50 animate-fade-in"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <TeamBadge team={r.team} size="sm" />
                        <span className="font-medium text-zinc-900">
                          {r.bowler}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {teamShort(r.team)}
                        </span>
                      </div>
                    </td>
                    <Td emphasis="strong">{econ.toFixed(2)}</Td>
                    <Td>{ballsToOvers(r.balls)}</Td>
                    <Td>{r.wickets}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── 5. Most Dot Balls ────────────────────────────────────────────────────────
function MostDots({ year }: { year: number }) {
  const state = useDuckQuery<DotsRow>(
    `SELECT bowler, ANY_VALUE(team) AS team,
            CAST(SUM(dots) AS BIGINT) AS dots,
            CAST(SUM(${BALLS_EXPR}) AS BIGINT) AS balls,
            CAST(SUM(wickets) AS BIGINT) AS wickets
     FROM bowling_scorecard
     WHERE season = ${year} AND bowler IS NOT NULL
     GROUP BY bowler
     ORDER BY dots DESC
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];
  const max = rows.reduce((m, r) => Math.max(m, r.dots), 0);

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Most Dot Balls
      </h2>
      <div className="border border-zinc-200 rounded-lg p-4 bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <ol className="space-y-2">
            {rows.map((r, i) => {
              const dotPct = r.balls > 0 ? (r.dots / r.balls) * 100 : 0;
              return (
                <li
                  key={r.bowler}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 mb-1.5">
                      <TeamBadge team={r.team} size="sm" />
                      <span className="truncate">{r.bowler}</span>
                      <span className="text-xs text-zinc-500 font-normal">
                        {teamShort(r.team)}
                      </span>
                      <span className="text-xs text-zinc-400 font-normal ml-auto">
                        {dotPct.toFixed(1)}% dot
                      </span>
                    </div>
                    <div className="relative h-2 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
                        style={{
                          width: `${max > 0 ? (r.dots / max) * 100 : 0}%`,
                          background: C_DOTS,
                          animationDelay: `${i * 60}ms`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="font-bold tabular-nums text-zinc-900 text-base min-w-[3rem] text-right">
                    {r.dots}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

// ── 6. Bowling by Phase (with team filter) ───────────────────────────────────
const PHASE_INFO: Record<
  string,
  { title: string; overs: string; color: string }
> = {
  powerplay: { title: "Powerplay", overs: "Overs 1–6", color: "#3b82f6" },
  middle: { title: "Middle", overs: "Overs 7–15", color: "#f59e0b" },
  death: { title: "Death", overs: "Overs 16–20", color: "#ef4444" },
};

function BowlingByPhase({ year }: { year: number }) {
  const [team, setTeam] = useState<string>("All");

  const teams = useDuckQuery<PhaseTeamRow>(
    `SELECT DISTINCT team FROM ball_by_ball WHERE season = ${year} ORDER BY team`
  );

  // Bowling team is the OTHER team in the match (ball_by_ball.team is the batting team).
  const teamFilter =
    team === "All"
      ? ""
      : `AND CASE WHEN bbb.team = m.team_1 THEN m.team_2 ELSE m.team_1 END = '${team.replace(/'/g, "''")}'`;

  const state = useDuckQuery<PhaseBowlRow>(
    `SELECT bbb.phase,
            CAST(SUM(bbb.total_runs) AS BIGINT) AS runs,
            CAST(COUNT(*) AS BIGINT) AS balls,
            CAST(SUM(CASE WHEN bbb.is_wicket THEN 1 ELSE 0 END) AS BIGINT) AS wickets,
            CAST(SUM(CASE WHEN bbb.batter_runs = 0 THEN 1 ELSE 0 END) AS BIGINT) AS dots
     FROM ball_by_ball bbb
     LEFT JOIN matches m
       ON bbb.season = m.season AND bbb.match_number = m.match_number
     WHERE bbb.season = ${year} ${teamFilter}
     GROUP BY bbb.phase
     ORDER BY CASE bbb.phase WHEN 'powerplay' THEN 1 WHEN 'middle' THEN 2 ELSE 3 END`
  );

  const rows = state.status === "success" ? state.data : [];
  const enriched = rows.map((r) => ({
    ...r,
    econ: r.balls > 0 ? (r.runs / r.balls) * 6 : 0,
    dot_pct: r.balls > 0 ? (r.dots / r.balls) * 100 : 0,
    wkts_per_match: r.wickets, // raw wickets per phase across season
  }));
  const max = {
    runs: Math.max(1, ...enriched.map((r) => r.runs)),
    wickets: Math.max(1, ...enriched.map((r) => r.wickets)),
    dots: Math.max(1, ...enriched.map((r) => r.dots)),
    econ: Math.max(1, ...enriched.map((r) => r.econ)),
    dot_pct: Math.max(1, ...enriched.map((r) => r.dot_pct)),
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Bowling by Phase
        </h2>
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="border border-zinc-300 rounded-md px-2 py-1 bg-white text-zinc-900 text-xs focus:outline-none"
        >
          <option value="All">All Teams</option>
          {(teams.status === "success" ? teams.data : []).map((t) => (
            <option key={t.team} value={t.team}>
              {teamShort(t.team)}
            </option>
          ))}
        </select>
      </div>

      {state.status === "loading" && (
        <div className="border border-zinc-200 rounded-lg p-8 bg-white text-center text-zinc-500 text-sm">
          Loading…
        </div>
      )}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && enriched.length === 0 && (
        <div className="border border-zinc-200 rounded-lg p-8 bg-white text-center text-zinc-500 text-sm">
          No data.
        </div>
      )}
      {state.status === "success" && enriched.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {enriched.map((r, i) => (
            <PhaseCard key={r.phase} row={r} max={max} delay={i * 100} />
          ))}
        </div>
      )}
    </section>
  );
}

type EnrichedBowlPhase = PhaseBowlRow & {
  econ: number;
  dot_pct: number;
};
type PhaseMax = {
  runs: number;
  wickets: number;
  dots: number;
  econ: number;
  dot_pct: number;
};

function PhaseCard({
  row,
  max,
  delay = 0,
}: {
  row: EnrichedBowlPhase;
  max: PhaseMax;
  delay?: number;
}) {
  const info = PHASE_INFO[row.phase] ?? PHASE_INFO.middle;
  return (
    <div
      className="border border-zinc-200 rounded-lg p-4 bg-white animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-3">
        <h3 className="font-semibold text-zinc-900 leading-tight">
          {info.title}
        </h3>
        <span className="text-xs text-zinc-500">{info.overs}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span
          className="text-3xl font-bold tabular-nums"
          style={{ color: info.color }}
        >
          {row.econ.toFixed(2)}
        </span>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          Economy
        </span>
      </div>
      <div className="relative h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-4">
        <div
          className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
          style={{
            width: `${(row.econ / max.econ) * 100}%`,
            background: info.color,
          }}
        />
      </div>

      <ul className="space-y-2.5 text-sm">
        <MetricRow
          label="Wickets"
          value={row.wickets.toLocaleString()}
          pct={(row.wickets / max.wickets) * 100}
          color={C_WKTS}
        />
        <MetricRow
          label="Runs conceded"
          value={row.runs.toLocaleString()}
          pct={(row.runs / max.runs) * 100}
          color={info.color}
        />
        <MetricRow
          label="Dots"
          value={row.dots.toLocaleString()}
          pct={(row.dots / max.dots) * 100}
          color={C_DOTS}
        />
        <MetricRow
          label="Dot %"
          value={`${row.dot_pct.toFixed(1)}%`}
          pct={(row.dot_pct / max.dot_pct) * 100}
          color={C_DOTS}
        />
      </ul>
    </div>
  );
}

function MetricRow({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-zinc-500">{label}</span>
        <span className="tabular-nums font-medium text-zinc-900">{value}</span>
      </div>
      <div className="relative h-1 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
          style={{ width: `${Math.min(100, pct)}%`, background: color }}
        />
      </div>
    </li>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ballsToOvers(balls: number): string {
  const fullOvers = Math.floor(balls / 6);
  const rem = balls % 6;
  return rem === 0 ? `${fullOvers}` : `${fullOvers}.${rem}`;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-right px-3 py-2.5 font-medium tabular-nums">
      {children}
    </th>
  );
}

function Td({
  children,
  emphasis,
}: {
  children: React.ReactNode;
  emphasis?: "strong";
}) {
  return (
    <td
      className={
        "px-3 py-2.5 text-right tabular-nums " +
        (emphasis === "strong"
          ? "text-zinc-900 font-semibold"
          : "text-zinc-700")
      }
    >
      {children}
    </td>
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
