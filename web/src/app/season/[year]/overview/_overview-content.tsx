"use client";

import { useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort } from "@/lib/teams";
import { TeamBadge, TeamInline } from "@/components/team-badge";
import { VisSingleContainer, VisDonut } from "@unovis/react";

// ── Types ────────────────────────────────────────────────────────────────────
type StandingsRow = {
  position: number;
  team: string;
  played: number;
  won: number;
  lost: number;
  no_result: number;
  net_run_rate: number;
  points: number;
};

type KeyStats = {
  matches: number;
  highest_total: number;
  highest_team: string;
  lowest_total: number;
  lowest_team: string;
  closest_margin: number;
  closest_kind: string; // "runs" | "wickets"
  closest_winner: string;
  closest_loser: string;
};

type LeaderRow = {
  player: string;
  team: string;
  total: number;
};

type NumbersStats = {
  sixes: number;
  fours: number;
  toss_total: number;
  toss_winner_won: number;
  field_first: number;
};

// ── Page ─────────────────────────────────────────────────────────────────────
export function OverviewContent({ year }: { year: number }) {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">IPL {year}</h1>
        <p className="text-zinc-500 text-sm mt-1">Season overview</p>
      </header>

      <StatsTabs year={year} />

      <Standings year={year} />

      <RecentResults year={year} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WinsPie year={year} />
        <AvgScoreByInnings year={year} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BoundaryLeaderboard year={year} stat="sixes" title="Most Sixes" />
        <BoundaryLeaderboard year={year} stat="fours" title="Most Fours" />
      </div>
    </div>
  );
}

// ── Stats Tabs ───────────────────────────────────────────────────────────────
type Tab = "key" | "leaders" | "numbers";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "key", label: "Key Stats" },
  { id: "leaders", label: "Leaders" },
  { id: "numbers", label: "Numbers" },
];

function StatsTabs({ year }: { year: number }) {
  const [tab, setTab] = useState<Tab>("key");

  return (
    <section>
      <nav className="flex gap-1 mb-4 border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (tab === t.id
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-900")
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "key" && <KeyStatsRow year={year} />}
      {tab === "leaders" && <LeadersRow year={year} />}
      {tab === "numbers" && <NumbersRow year={year} />}
    </section>
  );
}

// Cricket-style score: "237/4", or "49" with a small (all out) tag when 10 wkts.
function ScoreValue({ runs, wickets }: { runs: number; wickets: number }) {
  if (wickets >= 10) {
    return (
      <span>
        {runs}
        <span className="ml-1.5 text-xs font-medium text-zinc-500 align-middle">
          (all out)
        </span>
      </span>
    );
  }
  return (
    <span>
      {runs}
      <span className="text-zinc-400">/</span>
      {wickets}
    </span>
  );
}

// ── Stat Box ─────────────────────────────────────────────────────────────────
function StatBox({
  label,
  value,
  sub,
  accent = "neutral",
  delay = 0,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: "neutral" | "primary" | "success" | "warning" | "danger";
  delay?: number;
}) {
  const accentStyles = {
    neutral: "border-zinc-200",
    primary: "border-blue-200 bg-blue-50/50",
    success: "border-emerald-200 bg-emerald-50/50",
    warning: "border-amber-200 bg-amber-50/50",
    danger: "border-rose-200 bg-rose-50/50",
  };
  return (
    <div
      className={
        "border rounded-lg p-4 bg-white min-h-[6rem] animate-fade-in " +
        accentStyles[accent]
      }
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="text-xs text-zinc-500 uppercase tracking-wider underline decoration-zinc-300 underline-offset-4">
        {label}
      </div>
      <div className="text-2xl font-bold text-zinc-900 mt-2 tabular-nums">
        {value}
      </div>
      {sub && (
        <div className="text-xs text-zinc-500 mt-1 truncate">{sub}</div>
      )}
    </div>
  );
}

// ── Key Stats ────────────────────────────────────────────────────────────────
function KeyStatsRow({ year }: { year: number }) {
  const matches = useDuckQuery<{ matches: number }>(
    `SELECT CAST(COUNT(DISTINCT match_number) AS BIGINT) AS matches
     FROM ball_by_ball WHERE season = ${year}`
  );

  const high = useDuckQuery<{ team: string; total: number; wickets: number }>(
    `SELECT team, total, wickets FROM (
       SELECT team,
              CAST(SUM(total_runs) AS BIGINT) AS total,
              CAST(SUM(CAST(is_wicket AS INTEGER)) AS BIGINT) AS wickets
       FROM ball_by_ball
       WHERE season = ${year}
       GROUP BY match_number, innings, team
     ) ORDER BY total DESC LIMIT 1`
  );

  const low = useDuckQuery<{ team: string; total: number; wickets: number }>(
    // Exclude rain-curtailed micro-innings (< 60 balls); legitimate all-out
    // collapses like RCB 49/10 in 2017 are 60+ balls and survive the filter.
    `SELECT team, total, wickets FROM (
       SELECT team,
              CAST(SUM(total_runs) AS BIGINT) AS total,
              CAST(SUM(CAST(is_wicket AS INTEGER)) AS BIGINT) AS wickets,
              CAST(COUNT(*) AS BIGINT) AS balls
       FROM ball_by_ball
       WHERE season = ${year}
       GROUP BY match_number, innings, team
     ) WHERE balls >= 60
     ORDER BY total ASC LIMIT 1`
  );

  // Closest match: smallest positive win margin (runs OR wickets)
  const closest = useDuckQuery<{
    winner: string;
    loser: string;
    margin: number;
    kind: string;
  }>(
    `SELECT
       winner,
       CASE WHEN winner = team_1 THEN team_2 ELSE team_1 END AS loser,
       CASE
         WHEN win_by_runs > 0 THEN win_by_runs
         ELSE win_by_wickets
       END AS margin,
       CASE WHEN win_by_runs > 0 THEN 'runs' ELSE 'wickets' END AS kind
     FROM matches
     WHERE season = ${year}
       AND COALESCE(result, '') != 'no result'
       AND (win_by_runs > 0 OR win_by_wickets > 0)
     ORDER BY margin ASC, win_by_runs ASC
     LIMIT 1`
  );

  const matchesValue =
    matches.status === "success" && matches.data[0]
      ? matches.data[0].matches.toLocaleString()
      : "—";
  const highValue = high.status === "success" && high.data[0] ? high.data[0] : null;
  const lowValue = low.status === "success" && low.data[0] ? low.data[0] : null;
  const closeValue =
    closest.status === "success" && closest.data[0] ? closest.data[0] : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatBox label="Matches Played" value={matchesValue} accent="primary" delay={0} />
      <StatBox
        label="Highest Total"
        value={highValue ? <ScoreValue runs={highValue.total} wickets={highValue.wickets} /> : "—"}
        sub={
          highValue ? (
            <TeamInline team={highValue.team} />
          ) : undefined
        }
        accent="success"
        delay={80}
      />
      <StatBox
        label="Lowest Total"
        value={lowValue ? <ScoreValue runs={lowValue.total} wickets={lowValue.wickets} /> : "—"}
        sub={
          lowValue ? (
            <TeamInline team={lowValue.team} />
          ) : undefined
        }
        accent="warning"
        delay={160}
      />
      <StatBox
        label="Closest Match"
        value={
          closeValue
            ? `${closeValue.margin} ${closeValue.kind === "runs" ? "runs" : "wkts"}`
            : "—"
        }
        sub={
          closeValue ? (
            <span className="flex items-center gap-1.5 truncate">
              <TeamBadge team={closeValue.winner} size="xs" />
              <span className="font-medium text-zinc-700">
                {teamShort(closeValue.winner)}
              </span>
              <span className="text-zinc-400">beat</span>
              <TeamBadge team={closeValue.loser} size="xs" />
              <span className="text-zinc-500">{teamShort(closeValue.loser)}</span>
            </span>
          ) : undefined
        }
        accent="danger"
        delay={240}
      />
    </div>
  );
}

// ── Leaders ──────────────────────────────────────────────────────────────────
function LeadersRow({ year }: { year: number }) {
  // IPL Orange Cap: runs DESC, tiebreak on career strike rate
  const topRuns = useDuckQuery<LeaderRow>(
    `SELECT batter AS player,
            ANY_VALUE(team) AS team,
            CAST(SUM(runs) AS BIGINT) AS total
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     ORDER BY SUM(runs) DESC,
              (SUM(runs) * 100.0 / NULLIF(SUM(balls), 0)) DESC NULLS LAST
     LIMIT 1`
  );

  // IPL Purple Cap: wickets DESC, tiebreak on career economy
  const topWickets = useDuckQuery<LeaderRow>(
    `SELECT bowler AS player,
            ANY_VALUE(team) AS team,
            CAST(SUM(wickets) AS BIGINT) AS total
     FROM bowling_scorecard
     WHERE season = ${year} AND bowler IS NOT NULL
     GROUP BY bowler
     ORDER BY SUM(wickets) DESC,
              (SUM(runs) * 6.0 / NULLIF(SUM(FLOOR(overs)*6 + ROUND((overs - FLOOR(overs))*10)), 0)) ASC NULLS LAST
     LIMIT 1`
  );

  const runs = topRuns.status === "success" ? topRuns.data[0] : null;
  const wkts = topWickets.status === "success" ? topWickets.data[0] : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <StatBox
        label="Leading Run Scorer"
        value={
          runs ? (
            <span className="flex items-center gap-2">
              <TeamBadge team={runs.team} size="sm" />
              <span>{runs.player}</span>
            </span>
          ) : "—"
        }
        sub={runs ? `${runs.total.toLocaleString()} runs · ${teamShort(runs.team)}` : undefined}
        delay={0}
      />
      <StatBox
        label="Leading Wicket Taker"
        value={
          wkts ? (
            <span className="flex items-center gap-2">
              <TeamBadge team={wkts.team} size="sm" />
              <span>{wkts.player}</span>
            </span>
          ) : "—"
        }
        sub={wkts ? `${wkts.total.toLocaleString()} wickets · ${teamShort(wkts.team)}` : undefined}
        delay={80}
      />
    </div>
  );
}

// ── Numbers ──────────────────────────────────────────────────────────────────
function NumbersRow({ year }: { year: number }) {
  const ballAgg = useDuckQuery<{ sixes: number; fours: number }>(
    `SELECT
       CAST(SUM(CASE WHEN batter_runs = 6 THEN 1 ELSE 0 END) AS BIGINT) AS sixes,
       CAST(SUM(CASE WHEN batter_runs = 4 THEN 1 ELSE 0 END) AS BIGINT) AS fours
     FROM ball_by_ball
     WHERE season = ${year}`
  );

  const tossAgg = useDuckQuery<{
    total: number;
    toss_won: number;
    field_first: number;
  }>(
    `SELECT
       CAST(COUNT(*) AS BIGINT) AS total,
       CAST(SUM(CASE WHEN toss_winner = winner THEN 1 ELSE 0 END) AS BIGINT) AS toss_won,
       CAST(SUM(CASE WHEN toss_decision = 'field' THEN 1 ELSE 0 END) AS BIGINT) AS field_first
     FROM matches
     WHERE season = ${year} AND COALESCE(result, '') != 'no result'`
  );

  const balls = ballAgg.status === "success" ? ballAgg.data[0] : null;
  const toss = tossAgg.status === "success" ? tossAgg.data[0] : null;
  const pct = (n: number, d: number) =>
    d > 0 ? `${Math.round((n / d) * 100)}%` : "—";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatBox
        label="Total Sixes"
        value={balls ? balls.sixes.toLocaleString() : "—"}
        delay={0}
      />
      <StatBox
        label="Total Fours"
        value={balls ? balls.fours.toLocaleString() : "—"}
        delay={80}
      />
      <StatBox
        label="Toss Winner Won"
        value={toss ? `${toss.toss_won}/${toss.total}` : "—"}
        sub={toss ? pct(toss.toss_won, toss.total) : undefined}
        delay={160}
      />
      <StatBox
        label="Chose to Field"
        value={toss ? `${toss.field_first}/${toss.total}` : "—"}
        sub={toss ? pct(toss.field_first, toss.total) : undefined}
        delay={240}
      />
    </div>
  );
}

// ── Standings ────────────────────────────────────────────────────────────────
type FormResult = "W" | "L" | "NR";

type FormRow = {
  team: string;
  match_number: number;
  result: FormResult;
};

function Standings({ year }: { year: number }) {
  const state = useDuckQuery<StandingsRow>(
    `SELECT position, team, played, won, lost, no_result, net_run_rate, points
     FROM points_table
     WHERE season = ${year}
     ORDER BY position`
  );

  // For each match the team played, classify W/L/NR. Last 5 per team is computed
  // client-side from this row set.
  const formState = useDuckQuery<FormRow>(
    `WITH per_match AS (
       SELECT match_number, team_1 AS team,
              CASE
                WHEN COALESCE(result, '') = 'no result' THEN 'NR'
                WHEN winner = team_1 THEN 'W'
                ELSE 'L'
              END AS result
       FROM matches WHERE season = ${year}
       UNION ALL
       SELECT match_number, team_2 AS team,
              CASE
                WHEN COALESCE(result, '') = 'no result' THEN 'NR'
                WHEN winner = team_2 THEN 'W'
                ELSE 'L'
              END AS result
       FROM matches WHERE season = ${year}
     )
     SELECT team, CAST(match_number AS BIGINT) AS match_number, result FROM per_match`
  );

  const formByTeam = (() => {
    if (formState.status !== "success") return new Map<string, FormResult[]>();
    const map = new Map<string, FormRow[]>();
    for (const r of formState.data) {
      if (!map.has(r.team)) map.set(r.team, []);
      map.get(r.team)!.push(r);
    }
    const out = new Map<string, FormResult[]>();
    for (const [team, rows] of map) {
      rows.sort((a, b) => a.match_number - b.match_number);
      out.set(team, rows.slice(-5).map((r) => r.result as FormResult));
    }
    return out;
  })();

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Points Table
      </h2>

      <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
        {state.status === "loading" && (
          <div className="px-4 py-12 text-zinc-500 text-sm text-center">
            Loading standings…
          </div>
        )}
        {state.status === "error" && (
          <pre className="px-4 py-6 text-red-600 text-xs whitespace-pre-wrap">
            {state.error.message}
          </pre>
        )}
        {state.status === "success" && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-medium w-12">#</th>
                <th className="text-left px-4 py-3 font-medium">Team</th>
                <Th>P</Th>
                <Th>W</Th>
                <Th>L</Th>
                <Th>NR</Th>
                <Th>NRR</Th>
                <Th>Pts</Th>
                <th className="text-left px-4 py-3 font-medium">Form</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((r, i) => (
                <tr
                  key={r.position}
                  className="border-t border-zinc-100 hover:bg-zinc-50 animate-fade-in"
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  <td className="px-4 py-3 text-zinc-500 tabular-nums">
                    {r.position}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <TeamBadge team={r.team} />
                      <span className="font-medium text-zinc-900">
                        {r.team}
                      </span>
                    </div>
                  </td>
                  <Td>{r.played}</Td>
                  <Td emphasis="positive">{r.won}</Td>
                  <Td emphasis="negative">{r.lost}</Td>
                  <Td>{r.no_result}</Td>
                  <Td>
                    {(r.net_run_rate >= 0 ? "+" : "") +
                      r.net_run_rate.toFixed(3)}
                  </Td>
                  <Td emphasis="strong">{r.points}</Td>
                  <td className="px-4 py-3">
                    <FormBadges results={formByTeam.get(r.team) ?? []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function FormBadges({ results }: { results: FormResult[] }) {
  if (results.length === 0)
    return <span className="text-zinc-400 text-xs">–</span>;
  const colors: Record<FormResult, string> = {
    W: "bg-emerald-600",
    L: "bg-rose-600",
    NR: "bg-zinc-400",
  };
  const lastIdx = results.length - 1;
  return (
    <div className="flex items-center gap-1">
      {results.map((r, i) => (
        <span
          key={i}
          className={
            "inline-block pb-0.5 " +
            (i === lastIdx ? "border-b-2 border-zinc-700" : "")
          }
        >
          <span
            className={
              "inline-flex items-center justify-center w-5 h-5 rounded text-white text-[10px] font-bold animate-pop-in " +
              colors[r]
            }
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {r}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Wins: Bat First vs Chase ─────────────────────────────────────────────────
type WinsRow = { bat_first: number; chase: number };
type WinsSlice = { label: string; value: number; color: string };

const C_BAT_FIRST = "#f59e0b"; // amber
const C_CHASE = "#0ea5e9"; // sky

function WinsPie({ year }: { year: number }) {
  const state = useDuckQuery<WinsRow>(
    `WITH m AS (
       SELECT
         CASE WHEN toss_decision = 'bat' THEN toss_winner
              WHEN toss_winner = team_1 THEN team_2
              ELSE team_1
         END AS bat_first_team,
         winner
       FROM matches
       WHERE season = ${year}
         AND COALESCE(result, '') != 'no result'
         AND winner IS NOT NULL
     )
     SELECT
       CAST(SUM(CASE WHEN winner = bat_first_team THEN 1 ELSE 0 END) AS BIGINT) AS bat_first,
       CAST(SUM(CASE WHEN winner != bat_first_team THEN 1 ELSE 0 END) AS BIGINT) AS chase
     FROM m`
  );

  const r = state.status === "success" ? state.data[0] : null;
  const slices: WinsSlice[] = r
    ? [
        { label: "Bat first", value: r.bat_first, color: C_BAT_FIRST },
        { label: "Chase", value: r.chase, color: C_CHASE },
      ]
    : [];
  const total = r ? r.bat_first + r.chase : 0;
  const batPct = total > 0 ? Math.round(((r?.bat_first ?? 0) / total) * 100) : 0;
  const chasePct = total > 0 ? 100 - batPct : 0;

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Wins: Bat First vs Chase
      </h2>

      <div className="border border-zinc-200 rounded-lg p-6 bg-white h-72 flex flex-col justify-center">
        {state.status === "loading" && (
          <div className="text-zinc-500 text-sm py-12 text-center">Loading…</div>
        )}
        {state.status === "error" && (
          <pre className="text-red-600 text-xs whitespace-pre-wrap">
            {state.error.message}
          </pre>
        )}
        {state.status === "success" && total === 0 && (
          <div className="text-zinc-500 text-sm py-12 text-center">
            No decided matches yet.
          </div>
        )}
        {state.status === "success" && total > 0 && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-44 h-44">
              <VisSingleContainer<WinsSlice> data={slices} height="100%">
                <VisDonut<WinsSlice>
                  value={(d) => d.value}
                  color={(d) => d.color}
                  arcWidth={26}
                  centralLabel={`${total}`}
                  centralSubLabel="wins"
                />
              </VisSingleContainer>
            </div>
            <ul className="flex items-center gap-6 text-sm">
              <li className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: C_BAT_FIRST }}
                />
                <span className="text-zinc-700">Bat first</span>
                <span className="font-semibold tabular-nums text-zinc-900">
                  {r?.bat_first}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  ({batPct}%)
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: C_CHASE }}
                />
                <span className="text-zinc-700">Chase</span>
                <span className="font-semibold tabular-nums text-zinc-900">
                  {r?.chase}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  ({chasePct}%)
                </span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Most Sixes / Most Fours ──────────────────────────────────────────────────
type BoundaryStat = "sixes" | "fours";
type BoundaryView = "overall" | "innings";

type OverallRow = {
  batter: string;
  team: string;
  count: number;
  innings: number;
};

type InningsRow = {
  batter: string;
  team: string;
  count: number;
  runs: number;
  balls: number;
  match_number: number;
  team_1: string;
  team_2: string;
};

const BOUNDARY_COLOR: Record<BoundaryStat, string> = {
  sixes: "#FF6B6B",
  fours: "#1a73e8",
};

function BoundaryLeaderboard({
  year,
  stat,
  title,
}: {
  year: number;
  stat: BoundaryStat;
  title: string;
}) {
  const [view, setView] = useState<BoundaryView>("overall");

  const overall = useDuckQuery<OverallRow>(
    view === "overall"
      ? `SELECT batter,
                ANY_VALUE(team) AS team,
                CAST(SUM(${stat}) AS BIGINT) AS count,
                CAST(COUNT(*) AS BIGINT) AS innings
         FROM batting_scorecard
         WHERE season = ${year} AND batter IS NOT NULL
         GROUP BY batter
         HAVING SUM(${stat}) > 0
         ORDER BY count DESC, AVG(strike_rate) DESC
         LIMIT 10`
      : "SELECT 1 AS batter, '' AS team, 0 AS count, 0 AS innings WHERE FALSE"
  );

  const innings = useDuckQuery<InningsRow>(
    view === "innings"
      ? `SELECT b.batter, b.team,
                CAST(b.${stat} AS BIGINT) AS count,
                CAST(b.runs AS BIGINT) AS runs,
                CAST(b.balls AS BIGINT) AS balls,
                CAST(b.match_number AS BIGINT) AS match_number,
                m.team_1, m.team_2
         FROM batting_scorecard b
         LEFT JOIN matches m
           ON b.season = m.season AND b.match_number = m.match_number
         WHERE b.season = ${year} AND b.batter IS NOT NULL AND b.${stat} > 0
         ORDER BY b.${stat} DESC, b.strike_rate DESC
         LIMIT 10`
      : "SELECT '' AS batter, '' AS team, 0 AS count, 0 AS runs, 0 AS balls, 0 AS match_number, '' AS team_1, '' AS team_2 WHERE FALSE"
  );

  const state = view === "overall" ? overall : innings;
  const rows: Array<OverallRow | InningsRow> =
    state.status === "success" ? state.data : [];
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const color = BOUNDARY_COLOR[stat];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </h2>
        <div className="flex bg-zinc-100 rounded-md p-0.5 text-xs font-medium">
          {(["overall", "innings"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "px-2.5 py-1 rounded transition-colors " +
                (view === v
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900")
              }
            >
              {v === "overall" ? "Overall" : "Best Innings"}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-zinc-200 rounded-lg p-3 bg-white">
        {state.status === "loading" && (
          <div className="text-zinc-500 text-sm py-8 text-center">Loading…</div>
        )}
        {state.status === "error" && (
          <pre className="text-red-600 text-xs whitespace-pre-wrap py-4">
            {state.error.message}
          </pre>
        )}
        {state.status === "success" && rows.length === 0 && (
          <div className="text-zinc-500 text-sm py-8 text-center">
            No data for this season.
          </div>
        )}
        {state.status === "success" && rows.length > 0 && (
          <ol className="space-y-1.5">
            {rows.map((r, i) => (
              <li
                key={
                  view === "overall"
                    ? r.batter
                    : `${r.batter}-${(r as InningsRow).match_number}`
                }
                className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 py-1.5 px-2 rounded hover:bg-zinc-50"
              >
                <span className="text-xs text-zinc-400 tabular-nums text-right">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    <TeamBadge team={r.team} size="xs" />
                    <span className="truncate">{r.batter}</span>
                    <span className="text-xs text-zinc-500 font-normal">
                      {teamShort(r.team)}
                    </span>
                  </div>
                  <div className="relative h-1 mt-1 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full animate-bar-x"
                      style={{
                        width: `${max > 0 ? (r.count / max) * 100 : 0}%`,
                        background: color,
                        animationDelay: `${i * 50}ms`,
                      }}
                    />
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                    {view === "overall"
                      ? `${(r as OverallRow).innings} innings`
                      : (() => {
                          const ir = r as InningsRow;
                          const opp =
                            ir.team === ir.team_1
                              ? teamShort(ir.team_2)
                              : teamShort(ir.team_1);
                          return `${ir.runs} (${ir.balls}) vs ${opp} · M${ir.match_number}`;
                        })()}
                  </div>
                </div>
                <span className="font-bold tabular-nums text-zinc-900 text-base">
                  {r.count}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// ── Average Score by Innings ─────────────────────────────────────────────────
type InningsAvg = { innings: number; avg_score: number };

function AvgScoreByInnings({ year }: { year: number }) {
  const state = useDuckQuery<InningsAvg>(
    // Exclude rain-shortened innings (target_overs < 20). Use ball_by_ball
    // grouped per match-innings, then average per innings number.
    `WITH innings_totals AS (
       SELECT match_number, innings,
              CAST(SUM(total_runs) AS BIGINT) AS total
       FROM ball_by_ball
       WHERE season = ${year}
       GROUP BY match_number, innings
     )
     SELECT innings, CAST(ROUND(AVG(total)) AS BIGINT) AS avg_score
     FROM innings_totals
     WHERE match_number IN (
       SELECT match_number FROM matches
       WHERE season = ${year} AND COALESCE(target_overs, 20.0) >= 20.0
     )
     GROUP BY innings
     HAVING innings IN (1, 2)
     ORDER BY innings`
  );

  const rows = state.status === "success" ? state.data : [];
  const max = rows.reduce((m, r) => Math.max(m, r.avg_score), 0);

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Average Score by Innings
      </h2>

      <div className="border border-zinc-200 rounded-lg p-6 bg-white h-72 flex flex-col justify-center">
        {state.status === "loading" && (
          <div className="text-zinc-500 text-sm py-12 text-center">Loading…</div>
        )}
        {state.status === "error" && (
          <pre className="text-red-600 text-xs whitespace-pre-wrap">
            {state.error.message}
          </pre>
        )}
        {state.status === "success" && rows.length === 0 && (
          <div className="text-zinc-500 text-sm py-12 text-center">
            No completed innings.
          </div>
        )}
        {state.status === "success" && rows.length > 0 && (
          <div className="flex items-end justify-around gap-8 h-56 pt-4">
            {rows.map((r) => {
              const pct = max > 0 ? (r.avg_score / max) * 100 : 0;
              const color = r.innings === 1 ? "#1a73e8" : "#45B7D1";
              return (
                <div
                  key={r.innings}
                  className="flex flex-col items-center gap-3 flex-1 max-w-[120px]"
                >
                  <div className="text-2xl font-bold tabular-nums text-zinc-900">
                    {r.avg_score}
                  </div>
                  <div className="w-full bg-zinc-100 rounded-t-md flex items-end overflow-hidden h-40">
                    <div
                      className="w-full rounded-t-md animate-bar-y"
                      style={{
                        height: `${pct}%`,
                        background: color,
                        animationDelay: `${r.innings === 1 ? 0 : 150}ms`,
                      }}
                    />
                  </div>
                  <div className="text-xs uppercase tracking-wider text-zinc-500">
                    {r.innings === 1 ? "1st innings" : "2nd innings"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Recent Results ───────────────────────────────────────────────────────────
type MatchRow = {
  match_number: number;
  date: string;
  team_1: string;
  team_2: string;
  team_1_score: string | null;
  team_2_score: string | null;
  winner: string | null;
  result: string | null;
  win_by_runs: number | null;
  win_by_wickets: number | null;
  player_of_match: string | null;
};

function RecentResults({ year }: { year: number }) {
  const state = useDuckQuery<MatchRow>(
    `SELECT match_number, date, team_1, team_2, team_1_score, team_2_score,
            winner, result, win_by_runs, win_by_wickets, player_of_match
     FROM matches
     WHERE season = ${year}
     ORDER BY match_number DESC`
  );

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Recent Results
      </h2>

      {state.status === "loading" && (
        <div className="text-zinc-500 text-sm py-6">Loading matches…</div>
      )}
      {state.status === "error" && (
        <pre className="text-red-600 text-xs whitespace-pre-wrap py-6">
          {state.error.message}
        </pre>
      )}
      {state.status === "success" && (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-6 px-6 snap-x">
          {state.data.map((m, i) => (
            <MatchCard key={m.match_number} match={m} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}

function MatchCard({ match: m, index }: { match: MatchRow; index: number }) {
  const isNoResult =
    m.result === "no result" || !m.winner || m.winner === "";
  const winner = m.winner;
  const t1Won = !isNoResult && winner === m.team_1;
  const t2Won = !isNoResult && winner === m.team_2;

  const margin = isNoResult
    ? "No Result"
    : (m.win_by_wickets ?? 0) > 0
      ? `${winner} won by ${m.win_by_wickets} wkts`
      : `${winner} won by ${m.win_by_runs} runs`;

  return (
    <article
      className="flex-none w-60 border border-zinc-200 rounded-xl p-4 bg-white snap-start animate-slide-in-right"
      style={{ animationDelay: `${Math.min(index * 40, 600)}ms` }}
    >
      <div className="text-xs text-zinc-500 mb-2">
        Match {m.match_number} · {m.date}
      </div>
      <TeamLine
        team={m.team_1}
        score={m.team_1_score}
        won={t1Won}
        dim={isNoResult || t2Won}
      />
      <TeamLine
        team={m.team_2}
        score={m.team_2_score}
        won={t2Won}
        dim={isNoResult || t1Won}
      />
      <div className="text-xs text-zinc-500 mt-3 pt-2 border-t border-zinc-100 truncate">
        {margin}
      </div>
      {!isNoResult && m.player_of_match && (
        <div className="text-xs text-zinc-500 mt-1 truncate">
          POM:{" "}
          <span className="font-medium text-blue-700">{m.player_of_match}</span>
        </div>
      )}
    </article>
  );
}

function TeamLine({
  team,
  score,
  won,
  dim,
}: {
  team: string;
  score: string | null;
  won?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-2 mb-1.5 last:mb-0 " +
        (dim ? "opacity-50" : "") +
        " " +
        (won ? "font-bold text-zinc-900" : "text-zinc-700")
      }
    >
      <TeamBadge team={team} />
      <span className="flex-1 truncate">{teamShort(team)}</span>
      <span className="font-mono text-xs text-zinc-700">
        {score && score !== "nan" ? score : "—"}
      </span>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-right px-4 py-3 font-medium tabular-nums">{children}</th>
  );
}

function Td({
  children,
  emphasis,
}: {
  children: React.ReactNode;
  emphasis?: "positive" | "negative" | "strong";
}) {
  const cls = {
    positive: "text-emerald-600 font-medium",
    negative: "text-rose-600",
    strong: "text-zinc-900 font-semibold",
  };
  return (
    <td
      className={
        "px-4 py-3 text-right tabular-nums " +
        (emphasis ? cls[emphasis] : "text-zinc-700")
      }
    >
      {children}
    </td>
  );
}
