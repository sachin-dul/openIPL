"use client";

import { useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort, teamColor } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";

const C_FOURS = "#1a73e8";
const C_SIXES = "#FF6B6B";

type AggRow = {
  batter: string;
  team: string;
  runs: number;
  innings: number;
  balls: number;
  fours: number;
  sixes: number;
  fifties: number;
  hundreds: number;
  dismissals: number;
};

type InningsRow = {
  batter: string;
  team: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strike_rate: number;
  match_number: number;
  team_1: string;
  team_2: string;
};

type SrRow = {
  batter: string;
  team: string;
  runs: number;
  balls: number;
  sr: number;
};

type BoundaryRow = {
  batter: string;
  team: string;
  fours: number;
  sixes: number;
  boundaries: number;
};

type PhaseRow = {
  phase: string;
  runs: number;
  balls: number;
  sixes: number;
  fours: number;
  dots: number;
};

export function BattingContent({ year }: { year: number }) {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">IPL {year}</h1>
        <p className="text-zinc-500 text-sm mt-1">Batting</p>
      </header>

      <OrangeCapRace year={year} />
      <BattingLeaderboard year={year} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HighestScores year={year} />
        <BestStrikeRates year={year} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MostBoundaries year={year} />
        <BattingByPhase year={year} />
      </div>
    </div>
  );
}

// ── 1. Orange Cap Race ───────────────────────────────────────────────────────
function OrangeCapRace({ year }: { year: number }) {
  const state = useDuckQuery<AggRow>(
    `SELECT batter, ANY_VALUE(team) AS team,
            CAST(SUM(runs) AS BIGINT) AS runs,
            CAST(COUNT(*) AS BIGINT) AS innings,
            CAST(SUM(balls) AS BIGINT) AS balls,
            CAST(SUM(fours) AS BIGINT) AS fours,
            CAST(SUM(sixes) AS BIGINT) AS sixes,
            0 AS fifties, 0 AS hundreds, 0 AS dismissals
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     ORDER BY SUM(runs) DESC,
              -- IPL Orange Cap tiebreak: higher career strike rate
              (SUM(runs) * 100.0 / NULLIF(SUM(balls), 0)) DESC NULLS LAST
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];
  const max = rows.reduce((m, r) => Math.max(m, r.runs), 0);

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Orange Cap Race
      </h2>
      <div className="border border-zinc-200 rounded-lg p-4 bg-white">
        {state.status === "loading" && (
          <Loading />
        )}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.batter}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3"
              >
                <span className="text-xs text-zinc-400 tabular-nums text-right">
                  {i + 1}
                </span>
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    <TeamBadge team={r.team} size="sm" />
                    <span className="truncate">{r.batter}</span>
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
                        width: `${max > 0 ? (r.runs / max) * 100 : 0}%`,
                        background: teamColor(r.team),
                        animationDelay: `${i * 60}ms`,
                      }}
                    />
                  </div>
                </div>
                <span className="font-bold tabular-nums text-zinc-900 text-base min-w-[3rem] text-right">
                  {r.runs}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// ── 2. Batting Leaderboard (full table) ──────────────────────────────────────
function BattingLeaderboard({ year }: { year: number }) {
  const state = useDuckQuery<AggRow>(
    `SELECT batter, ANY_VALUE(team) AS team,
            CAST(SUM(runs) AS BIGINT) AS runs,
            CAST(COUNT(*) AS BIGINT) AS innings,
            CAST(SUM(balls) AS BIGINT) AS balls,
            CAST(SUM(fours) AS BIGINT) AS fours,
            CAST(SUM(sixes) AS BIGINT) AS sixes,
            CAST(SUM(CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END) AS BIGINT) AS fifties,
            CAST(SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) AS BIGINT) AS hundreds,
            CAST(SUM(CASE WHEN COALESCE(dismissal, '') NOT IN ('not out', '') THEN 1 ELSE 0 END) AS BIGINT) AS dismissals
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     -- IPL Orange Cap order: runs DESC, tiebreak on career strike rate
     ORDER BY SUM(runs) DESC,
              (SUM(runs) * 100.0 / NULLIF(SUM(balls), 0)) DESC NULLS LAST
     LIMIT 15`
  );

  const rows = state.status === "success" ? state.data : [];

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Batting Leaderboard
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
                <th className="text-left px-3 py-2.5 font-medium">Batter</th>
                <Th>Runs</Th>
                <Th>Inn</Th>
                <Th>Balls</Th>
                <Th>4s</Th>
                <Th>6s</Th>
                <Th>50s</Th>
                <Th>100s</Th>
                <Th>Avg</Th>
                <Th>SR</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const avg =
                  r.dismissals > 0
                    ? (r.runs / r.dismissals).toFixed(2)
                    : "—";
                const sr =
                  r.balls > 0
                    ? ((r.runs / r.balls) * 100).toFixed(1)
                    : "—";
                return (
                  <tr
                    key={r.batter}
                    className="border-t border-zinc-100 hover:bg-zinc-50"
                  >
                    <td className="px-3 py-2.5 text-zinc-500 tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <TeamBadge team={r.team} size="sm" />
                        <span className="font-medium text-zinc-900">
                          {r.batter}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {teamShort(r.team)}
                        </span>
                      </div>
                    </td>
                    <Td emphasis="strong">{r.runs}</Td>
                    <Td>{r.innings}</Td>
                    <Td>{r.balls}</Td>
                    <Td>{r.fours}</Td>
                    <Td>{r.sixes}</Td>
                    <Td>{r.fifties}</Td>
                    <Td>{r.hundreds}</Td>
                    <Td>{avg}</Td>
                    <Td>{sr}</Td>
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

// ── 3. Highest Scores ────────────────────────────────────────────────────────
function HighestScores({ year }: { year: number }) {
  const state = useDuckQuery<InningsRow>(
    `SELECT b.batter, b.team,
            CAST(b.runs AS BIGINT) AS runs,
            CAST(b.balls AS BIGINT) AS balls,
            CAST(b.fours AS BIGINT) AS fours,
            CAST(b.sixes AS BIGINT) AS sixes,
            b.strike_rate,
            CAST(b.match_number AS BIGINT) AS match_number,
            m.team_1, m.team_2
     FROM batting_scorecard b
     LEFT JOIN matches m
       ON b.season = m.season AND b.match_number = m.match_number
     WHERE b.season = ${year} AND b.batter IS NOT NULL
     ORDER BY b.runs DESC, b.strike_rate DESC
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Highest Scores
      </h2>
      <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Batter</th>
                <Th>Runs</Th>
                <Th>Balls</Th>
                <Th>4s</Th>
                <Th>6s</Th>
                <Th>SR</Th>
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
                    key={`${r.batter}-${r.match_number}-${i}`}
                    className="border-t border-zinc-100 hover:bg-zinc-50"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <TeamBadge team={r.team} size="sm" />
                        <span className="font-medium text-zinc-900">
                          {r.batter}
                        </span>
                      </div>
                    </td>
                    <Td emphasis="strong">{r.runs}</Td>
                    <Td>{r.balls}</Td>
                    <Td>{r.fours}</Td>
                    <Td>{r.sixes}</Td>
                    <Td>{r.strike_rate.toFixed(1)}</Td>
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

// ── 4. Best Strike Rates (min 30 balls) ──────────────────────────────────────
function BestStrikeRates({ year }: { year: number }) {
  const state = useDuckQuery<SrRow>(
    `SELECT batter, ANY_VALUE(team) AS team,
            CAST(SUM(runs) AS BIGINT) AS runs,
            CAST(SUM(balls) AS BIGINT) AS balls,
            (SUM(runs) * 100.0 / SUM(balls)) AS sr
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     HAVING SUM(balls) >= 30
     ORDER BY sr DESC
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Best Strike Rates <span className="text-zinc-400 normal-case">(min 30 balls)</span>
      </h2>
      <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Batter</th>
                <Th>SR</Th>
                <Th>Runs</Th>
                <Th>Balls</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.batter}
                  className="border-t border-zinc-100 hover:bg-zinc-50"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <TeamBadge team={r.team} size="sm" />
                      <span className="font-medium text-zinc-900">
                        {r.batter}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {teamShort(r.team)}
                      </span>
                    </div>
                  </td>
                  <Td emphasis="strong">{r.sr.toFixed(1)}</Td>
                  <Td>{r.runs}</Td>
                  <Td>{r.balls}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── 5. Most Boundaries (stacked bar: 4s vs 6s) ───────────────────────────────
function MostBoundaries({ year }: { year: number }) {
  const state = useDuckQuery<BoundaryRow>(
    `SELECT batter, ANY_VALUE(team) AS team,
            CAST(SUM(fours) AS BIGINT) AS fours,
            CAST(SUM(sixes) AS BIGINT) AS sixes,
            CAST(SUM(fours) + SUM(sixes) AS BIGINT) AS boundaries
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     ORDER BY boundaries DESC
     LIMIT 10`
  );

  const rows = state.status === "success" ? state.data : [];
  const max = rows.reduce((m, r) => Math.max(m, r.boundaries), 0);

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Most Boundaries
      </h2>
      <div className="border border-zinc-200 rounded-lg p-4 bg-white">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <ErrorBox message={state.error.message} />}
        {state.status === "success" && rows.length === 0 && <Empty />}
        {state.status === "success" && rows.length > 0 && (
          <>
            <div className="flex items-center gap-4 text-xs text-zinc-500 mb-3">
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-sm"
                  style={{ background: C_FOURS }}
                />
                Fours
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-sm"
                  style={{ background: C_SIXES }}
                />
                Sixes
              </span>
            </div>
            <ol className="space-y-2">
              {rows.map((r, i) => (
                <li
                  key={r.batter}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 mb-1.5">
                      <TeamBadge team={r.team} size="sm" />
                      <span className="truncate">{r.batter}</span>
                      <span className="text-xs text-zinc-500 font-normal">
                        {teamShort(r.team)}
                      </span>
                    </div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-zinc-100">
                      <div
                        className="animate-bar-x"
                        style={{
                          width: `${max > 0 ? (r.fours / max) * 100 : 0}%`,
                          background: C_FOURS,
                          animationDelay: `${i * 60}ms`,
                        }}
                      />
                      <div
                        className="animate-bar-x"
                        style={{
                          width: `${max > 0 ? (r.sixes / max) * 100 : 0}%`,
                          background: C_SIXES,
                          animationDelay: `${i * 60 + 200}ms`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-zinc-600 tabular-nums whitespace-nowrap">
                    <span className="font-bold text-zinc-900">
                      {r.boundaries}
                    </span>{" "}
                    <span className="text-zinc-400">
                      ({r.fours}×4 · {r.sixes}×6)
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

// ── 6. Batting by Phase (with team filter) ───────────────────────────────────
type PhaseTeamRow = { team: string };

const PHASE_INFO: Record<
  string,
  { title: string; overs: string; color: string; bg: string }
> = {
  powerplay: {
    title: "Powerplay",
    overs: "Overs 1–6",
    color: "#3b82f6",
    bg: "bg-blue-50/40",
  },
  middle: {
    title: "Middle",
    overs: "Overs 7–15",
    color: "#f59e0b",
    bg: "bg-amber-50/40",
  },
  death: {
    title: "Death",
    overs: "Overs 16–20",
    color: "#ef4444",
    bg: "bg-rose-50/40",
  },
};

function BattingByPhase({ year }: { year: number }) {
  const [team, setTeam] = useState<string>("All");

  const teams = useDuckQuery<PhaseTeamRow>(
    `SELECT DISTINCT team FROM ball_by_ball WHERE season = ${year} ORDER BY team`
  );

  const filter =
    team === "All" ? "" : `AND team = '${team.replace(/'/g, "''")}'`;
  const state = useDuckQuery<PhaseRow>(
    `SELECT phase,
            CAST(SUM(batter_runs) AS BIGINT) AS runs,
            CAST(COUNT(*) AS BIGINT) AS balls,
            CAST(SUM(CASE WHEN batter_runs = 6 THEN 1 ELSE 0 END) AS BIGINT) AS sixes,
            CAST(SUM(CASE WHEN batter_runs = 4 THEN 1 ELSE 0 END) AS BIGINT) AS fours,
            CAST(SUM(CASE WHEN batter_runs = 0 THEN 1 ELSE 0 END) AS BIGINT) AS dots
     FROM ball_by_ball
     WHERE season = ${year} ${filter}
     GROUP BY phase
     ORDER BY CASE phase WHEN 'powerplay' THEN 1 WHEN 'middle' THEN 2 ELSE 3 END`
  );

  const rows = state.status === "success" ? state.data : [];

  // Compute derived metrics + max-per-metric for relative bars
  const enriched = rows.map((r) => ({
    ...r,
    rr: r.balls > 0 ? (r.runs / r.balls) * 6 : 0,
    bdry_pct: r.balls > 0 ? ((r.fours + r.sixes) / r.balls) * 100 : 0,
    dot_pct: r.balls > 0 ? (r.dots / r.balls) * 100 : 0,
  }));
  const max = {
    runs: Math.max(1, ...enriched.map((r) => r.runs)),
    fours: Math.max(1, ...enriched.map((r) => r.fours)),
    sixes: Math.max(1, ...enriched.map((r) => r.sixes)),
    rr: Math.max(1, ...enriched.map((r) => r.rr)),
    bdry_pct: Math.max(1, ...enriched.map((r) => r.bdry_pct)),
    dot_pct: Math.max(1, ...enriched.map((r) => r.dot_pct)),
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Batting by Phase
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

type EnrichedPhase = PhaseRow & {
  rr: number;
  bdry_pct: number;
  dot_pct: number;
};
type PhaseMax = {
  runs: number;
  fours: number;
  sixes: number;
  rr: number;
  bdry_pct: number;
  dot_pct: number;
};

function PhaseCard({
  row,
  max,
  delay = 0,
}: {
  row: EnrichedPhase;
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
        <h3 className="font-semibold text-zinc-900 leading-tight">{info.title}</h3>
        <span className="text-xs text-zinc-500">{info.overs}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span
          className="text-3xl font-bold tabular-nums"
          style={{ color: info.color }}
        >
          {row.rr.toFixed(2)}
        </span>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          Run rate
        </span>
      </div>
      <div className="relative h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-4">
        <div
          className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
          style={{
            width: `${(row.rr / max.rr) * 100}%`,
            background: info.color,
          }}
        />
      </div>

      <ul className="space-y-2.5 text-sm">
        <MetricRow
          label="Runs"
          value={row.runs.toLocaleString()}
          pct={(row.runs / max.runs) * 100}
          color={info.color}
        />
        <MetricRow
          label="Fours"
          value={row.fours.toLocaleString()}
          pct={(row.fours / max.fours) * 100}
          color={info.color}
        />
        <MetricRow
          label="Sixes"
          value={row.sixes.toLocaleString()}
          pct={(row.sixes / max.sixes) * 100}
          color={info.color}
        />
        <MetricRow
          label="Boundary %"
          value={`${row.bdry_pct.toFixed(1)}%`}
          pct={(row.bdry_pct / max.bdry_pct) * 100}
          color={info.color}
        />
        <MetricRow
          label="Dot %"
          value={`${row.dot_pct.toFixed(1)}%`}
          pct={(row.dot_pct / max.dot_pct) * 100}
          color="#a1a1aa"
          dim
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
  dim,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
  dim?: boolean;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className={dim ? "text-zinc-400" : "text-zinc-500"}>{label}</span>
        <span
          className={
            "tabular-nums font-medium " +
            (dim ? "text-zinc-500" : "text-zinc-900")
          }
        >
          {value}
        </span>
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
