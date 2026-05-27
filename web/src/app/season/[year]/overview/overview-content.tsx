"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { canonicalTeam, teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { Card } from "@/components/card";
import { Stat } from "@/components/stat";
import { PageHead } from "@/components/page-head";
import { FormDots } from "@/components/form-dots";
import {
  HeadToHeadMatrix,
  type MatchRow as HeadToHeadMatchRow,
} from "@/components/charts/head-to-head-matrix";

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

type FormRow = { team: string; form: string };

type HighlightsRow = {
  matches: number;
  total_sixes: number;
  total_fours: number;
  hi_score: string | null;
  hi_team: string | null;
  hi_match: number | null;
  lo_score: string | null;
  lo_team: string | null;
  lo_match: number | null;
  cl_winner: string | null;
  cl_loser: string | null;
  cl_runs: number;
  cl_wickets: number;
  cl_match_id: number | null;
};

type CapBatterDetail = {
  batter: string;
  team: string;
  runs: number;
  innings: number;
  hs: number;
  avg: number | null;
  sr: number | null;
};

type CapBowlerDetail = {
  bowler: string;
  team: string;
  wickets: number;
  innings: number;
  econ: number | null;
  avg: number | null;
};

type MatchRow = {
  match_number: number;
  cricsheet_match_id: number;
  date: string;
  team_1: string;
  team_2: string;
  team_1_score: string;
  team_2_score: string;
  winner: string;
  win_by_runs: number;
  win_by_wickets: number;
  player_of_match: string | null;
};

export function OverviewContent({ year }: { year: number }) {
  return (
    <div>
      <PageHead title={`IPL ${year}`} />

      <div className="grid grid-cols-[1.5fr_1fr] gap-3.5">
        {/* min-w-0 on each column so the highlights grid can't push the
            points-table column wide. */}
        <div className="min-w-0">
          <PointsTableCard year={year} />
        </div>
        <HighlightsGrid year={year} />
      </div>

      <div className="mt-3.5">
        <RecentResultsCard year={year} />
      </div>

      <div className="mt-3.5">
        <HeadToHeadMatrixCard year={year} />
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3.5">
        <WinsBatChaseCard year={year} />
        <InningsScoreDistributionCard year={year} />
      </div>

      <div className="mt-3.5">
        <BoundaryLeaderboardsCard year={year} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   POINTS TABLE
   -------------------------------------------------------------------------- */

function PointsTableCard({ year }: { year: number }) {
  const standings = useDuckQuery<StandingsRow>(
    `SELECT
        CAST(position AS BIGINT) AS position,
        team,
        CAST(played AS BIGINT) AS played,
        CAST(won AS BIGINT) AS won,
        CAST(lost AS BIGINT) AS lost,
        CAST(no_result AS BIGINT) AS no_result,
        CAST(net_run_rate AS DOUBLE) AS net_run_rate,
        CAST(points AS BIGINT) AS points
     FROM points_table
     WHERE season = ${year}
     ORDER BY position`
  );

  // Form is the last-5 result string per team, computed from `matches`. Pulled
  // separately because it's a noisier query that we don't want to block the
  // base standings rendering on.
  const form = useDuckQuery<FormRow>(
    `WITH played AS (
        SELECT team_1 AS team, match_number, winner FROM matches
        WHERE season = ${year} AND winner IS NOT NULL AND winner != ''
        UNION ALL
        SELECT team_2 AS team, match_number, winner FROM matches
        WHERE season = ${year} AND winner IS NOT NULL AND winner != ''
      ),
      ranked AS (
        SELECT team, winner,
               ROW_NUMBER() OVER (PARTITION BY team ORDER BY match_number DESC) AS rn
        FROM played
      )
      SELECT team, STRING_AGG(CASE WHEN winner = team THEN 'W' ELSE 'L' END, '' ORDER BY rn DESC) AS form
      FROM ranked WHERE rn <= 5
      GROUP BY team`
  );

  const formMap = useMemo(() => {
    const m = new Map<string, string>();
    if (form.status === "success") {
      for (const r of form.data) m.set(canonicalTeam(r.team), r.form);
    }
    return m;
  }, [form]);

  return (
    <Card kicker="STANDINGS" title="Points table" padded={false}>
      {standings.status === "loading" && <LoadingCell />}
      {standings.status === "error" && <ErrorCell message={standings.error.message} />}
      {standings.status === "success" && (
        <PointsTable rows={standings.data} formMap={formMap} />
      )}
    </Card>
  );
}

function PointsTable({
  rows,
  formMap,
}: {
  rows: StandingsRow[];
  formMap: Map<string, string>;
}) {
  return (
    <table className="w-full text-[12px] border-collapse">
      <thead>
        <tr className="text-ipl-sub">
          {["#", "Team", "P", "W", "L", "NR", "NRR", "Pts", "Form"].map((h, i) => (
            <th
              key={h}
              className={
                "px-3 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line " +
                (i <= 1 ? "text-left" : "text-right")
              }
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const qualified = r.position <= 4;
          const canon = canonicalTeam(r.team);
          const form = formMap.get(canon);
          return (
            <tr
              key={r.team}
              className={
                "border-b border-ipl-line2 last:border-b-0 " +
                (qualified ? "bg-ipl-pos/[0.04]" : "")
              }
            >
              <td
                className={
                  "px-3 py-2.5 font-mono font-semibold " +
                  (qualified ? "text-ipl-pos" : "text-ipl-sub")
                }
              >
                {r.position}
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <TeamBadge team={r.team} size={22} />
                  <span className="font-semibold text-ipl-ink">{teamShort(r.team)}</span>
                  <span className="text-ipl-sub text-[11px]">{r.team}</span>
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono">{r.played}</td>
              <td className="px-3 py-2.5 text-right font-mono">{r.won}</td>
              <td className="px-3 py-2.5 text-right font-mono text-ipl-sub">{r.lost}</td>
              <td className="px-3 py-2.5 text-right font-mono text-ipl-sub">{r.no_result}</td>
              <td
                className={
                  "px-3 py-2.5 text-right font-mono " +
                  (r.net_run_rate >= 0 ? "text-ipl-pos" : "text-ipl-neg")
                }
              >
                {r.net_run_rate >= 0 ? "+" : ""}
                {r.net_run_rate.toFixed(3)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono font-bold text-[14px]">{r.points}</td>
              <td className="px-3 py-2.5 text-right">
                {form ? <FormDots form={form} /> : <span className="text-ipl-soft text-[11px]">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* --------------------------------------------------------------------------
   HIGHLIGHTS GRID — 8 season-defining stat tiles
   -------------------------------------------------------------------------- */

function HighlightsGrid({ year }: { year: number }) {
  // Header stats come from a single combined query (one row, lots of scalars).
  // Cap leaders need full batting/bowling aggregates so they get their own
  // queries — the top-1 row plus enough columns to show meaningful subs.
  const statsQ = useDuckQuery<HighlightsRow>(
    `WITH all_scores AS (
        SELECT team_1 AS team, team_1_score AS score,
               CAST(match_number AS BIGINT) AS match_number,
               CAST(SPLIT_PART(team_1_score, '/', 1) AS BIGINT) AS runs
        FROM matches
        WHERE season = ${year}
          AND team_1_score IS NOT NULL AND team_1_score != ''
          AND LOWER(COALESCE(result, '')) NOT IN ('no result')
        UNION ALL
        SELECT team_2 AS team, team_2_score AS score,
               CAST(match_number AS BIGINT) AS match_number,
               CAST(SPLIT_PART(team_2_score, '/', 1) AS BIGINT) AS runs
        FROM matches
        WHERE season = ${year}
          AND team_2_score IS NOT NULL AND team_2_score != ''
          AND LOWER(COALESCE(result, '')) NOT IN ('no result')
      ),
      hi AS (
        SELECT team, score, match_number FROM all_scores ORDER BY runs DESC LIMIT 1
      ),
      lo AS (
        SELECT team, score, match_number FROM all_scores ORDER BY runs ASC LIMIT 1
      ),
      closest AS (
        SELECT match_number, team_1, team_2, winner,
               COALESCE(win_by_runs, 0)    AS wr,
               COALESCE(win_by_wickets, 0) AS ww,
               cricsheet_match_id
        FROM matches
        WHERE season = ${year}
          AND winner IS NOT NULL AND winner != ''
          AND LOWER(COALESCE(result, '')) NOT IN ('no result')
        ORDER BY LEAST(
          CASE WHEN COALESCE(win_by_runs, 0) > 0 THEN win_by_runs ELSE 999 END,
          CASE WHEN COALESCE(win_by_wickets, 0) > 0 THEN win_by_wickets ELSE 999 END
        ) ASC
        LIMIT 1
      )
      SELECT
        (SELECT CAST(COUNT(*) AS BIGINT) FROM matches WHERE season = ${year}) AS matches,
        (SELECT CAST(COALESCE(SUM(sixes), 0) AS BIGINT) FROM batting_scorecard WHERE season = ${year}) AS total_sixes,
        (SELECT CAST(COALESCE(SUM(fours), 0) AS BIGINT) FROM batting_scorecard WHERE season = ${year}) AS total_fours,
        (SELECT score        FROM hi) AS hi_score,
        (SELECT team         FROM hi) AS hi_team,
        (SELECT match_number FROM hi) AS hi_match,
        (SELECT score        FROM lo) AS lo_score,
        (SELECT team         FROM lo) AS lo_team,
        (SELECT match_number FROM lo) AS lo_match,
        (SELECT winner FROM closest) AS cl_winner,
        (SELECT CASE WHEN team_1 = winner THEN team_2 ELSE team_1 END FROM closest) AS cl_loser,
        (SELECT CAST(wr AS BIGINT) FROM closest) AS cl_runs,
        (SELECT CAST(ww AS BIGINT) FROM closest) AS cl_wickets,
        (SELECT CAST(cricsheet_match_id AS BIGINT) FROM closest) AS cl_match_id
    `,
  );

  const ocQ = useDuckQuery<CapBatterDetail>(
    `SELECT batter,
            ANY_VALUE(team) AS team,
            CAST(SUM(runs) AS BIGINT)     AS runs,
            CAST(COUNT(*) AS BIGINT)      AS innings,
            CAST(MAX(runs) AS BIGINT)     AS hs,
            CAST(SUM(runs) AS DOUBLE) /
              NULLIF(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END), 0) AS avg,
            100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     ORDER BY runs DESC
     LIMIT 1`,
  );

  const pcQ = useDuckQuery<CapBowlerDetail>(
    `WITH per_bowler AS (
        SELECT bowler,
          ANY_VALUE(team) AS team,
          CAST(SUM(wickets) AS BIGINT) AS wickets,
          CAST(COUNT(*) AS BIGINT)     AS innings,
          CAST(SUM(runs) AS BIGINT)    AS runs_given,
          SUM(FLOOR(overs)) + SUM((overs - FLOOR(overs)) * 10) / 6 AS overs_total
        FROM bowling_scorecard
        WHERE season = ${year} AND bowler IS NOT NULL
        GROUP BY bowler
      )
      SELECT bowler, team, wickets, innings,
             CASE WHEN overs_total > 0
                  THEN runs_given / overs_total
                  ELSE NULL END AS econ,
             CASE WHEN wickets > 0
                  THEN CAST(runs_given AS DOUBLE) / wickets
                  ELSE NULL END AS avg
      FROM per_bowler
      ORDER BY wickets DESC
      LIMIT 1`,
  );
  const { resolve } = usePlayerNames();

  const s = statsQ.status === "success" ? statsQ.data[0] : null;
  const oc = ocQ.status === "success" ? ocQ.data[0] : null;
  const pc = pcQ.status === "success" ? pcQ.data[0] : null;

  return (
    <div className="grid grid-cols-2 gap-3.5 content-start">
      <Card padded>
        <Stat
          label="Matches played"
          value={s ? s.matches.toLocaleString() : "—"}
          sub="season total"
        />
      </Card>
      <Card padded>
        <Stat
          label="Sixes"
          value={s ? s.total_sixes.toLocaleString() : "—"}
          sub="across all innings"
        />
      </Card>
      <Card padded>
        <Stat
          label="Fours"
          value={s ? s.total_fours.toLocaleString() : "—"}
          sub="across all innings"
        />
      </Card>
      <Card padded>
        <ClosestTile data={s} />
      </Card>
      <Card padded>
        <ScoreTile label="Highest total" score={s?.hi_score} team={s?.hi_team} match={s?.hi_match} />
      </Card>
      <Card padded>
        <ScoreTile label="Lowest total" score={s?.lo_score} team={s?.lo_team} match={s?.lo_match} />
      </Card>
      <Card padded>
        <CapTile
          kind="orange"
          name={oc?.batter ?? null}
          displayName={oc ? resolve(oc.batter) : null}
          team={oc?.team ?? null}
          primaryValue={oc?.runs ?? null}
          primaryUnit="runs"
          subStats={
            oc
              ? [
                  oc.avg != null ? `${oc.avg.toFixed(1)} avg` : null,
                  oc.sr != null ? `${oc.sr.toFixed(0)} SR` : null,
                  oc.innings != null ? `${oc.innings} inn` : null,
                ].filter(Boolean) as string[]
              : []
          }
        />
      </Card>
      <Card padded>
        <CapTile
          kind="purple"
          name={pc?.bowler ?? null}
          displayName={pc ? resolve(pc.bowler) : null}
          team={pc?.team ?? null}
          primaryValue={pc?.wickets ?? null}
          primaryUnit="wkts"
          subStats={
            pc
              ? [
                  pc.econ != null ? `${pc.econ.toFixed(2)} econ` : null,
                  pc.avg != null ? `${pc.avg.toFixed(1)} avg` : null,
                  pc.innings != null ? `${pc.innings} inn` : null,
                ].filter(Boolean) as string[]
              : []
          }
        />
      </Card>
    </div>
  );
}

function ScoreTile({
  label,
  score,
  team,
  match,
}: {
  label: string;
  score: string | null | undefined;
  team: string | null | undefined;
  match: number | null | undefined;
}) {
  // "190/9" → [runs, wkts]; keep `/wkts` muted so the headline runs read first.
  const [runs, wkts] = score ? score.split("/") : ["—", null];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold">
        {label}
      </div>
      <div className="font-mono font-semibold text-[26px] text-ipl-ink leading-none mt-1.5 tracking-[-0.02em]">
        {runs}
        {wkts && (
          <span className="text-[14px] text-ipl-sub font-medium">/{wkts}</span>
        )}
      </div>
      {team && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-ipl-sub">
          <TeamBadge team={team} size={16} />
          <span className="truncate">{teamShort(team)}</span>
          {match != null && <span className="font-mono ml-auto">M{match}</span>}
        </div>
      )}
    </div>
  );
}

function ClosestTile({ data }: { data: HighlightsRow | null }) {
  if (!data || !data.cl_winner) {
    return (
      <Stat label="Closest match" value="—" sub="no completed matches" />
    );
  }
  const margin =
    data.cl_runs > 0
      ? `${data.cl_runs} run${data.cl_runs === 1 ? "" : "s"}`
      : data.cl_wickets > 0
        ? `${data.cl_wickets} wkt${data.cl_wickets === 1 ? "" : "s"}`
        : "—";
  const inner = (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold">
        Closest match
      </div>
      <div className="font-mono font-semibold text-[26px] text-ipl-ink leading-none mt-1.5 tracking-[-0.02em]">
        {margin}
      </div>
      {data.cl_winner && data.cl_loser && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-ipl-sub">
          <TeamBadge team={data.cl_winner} size={16} />
          <span className="font-semibold text-ipl-ink">
            {teamShort(data.cl_winner)}
          </span>
          <span>beat</span>
          <TeamBadge team={data.cl_loser} size={16} />
          <span>{teamShort(data.cl_loser)}</span>
        </div>
      )}
    </div>
  );
  if (data.cl_match_id != null) {
    return (
      <Link href={`/match/${data.cl_match_id}`} className="block hover:opacity-90">
        {inner}
      </Link>
    );
  }
  return inner;
}

/** Colored kicker for the Orange/Purple Cap labels in the highlights grid. */
function CapKicker({
  kind,
  children,
}: {
  kind: "orange" | "purple";
  children: React.ReactNode;
}) {
  const color =
    kind === "orange" ? "var(--color-ipl-orange)" : "var(--color-ipl-purple)";
  return (
    <span
      className="text-[10px] uppercase tracking-[0.1em] font-bold"
      style={{ color }}
    >
      {children}
    </span>
  );
}

function CapTile({
  kind,
  name,
  displayName,
  team,
  primaryValue,
  primaryUnit,
  subStats,
}: {
  kind: "orange" | "purple";
  name: string | null;
  displayName: string | null;
  team: string | null;
  primaryValue: number | null;
  primaryUnit: string;
  subStats: string[];
}) {
  const labelTxt = kind === "orange" ? "Orange Cap" : "Purple Cap";
  return (
    <div>
      <CapKicker kind={kind}>{labelTxt}</CapKicker>
      <div className="font-mono font-semibold text-[26px] text-ipl-ink leading-none mt-1.5 tracking-[-0.02em]">
        {primaryValue != null ? primaryValue.toLocaleString() : "—"}
        <span className="text-[14px] text-ipl-sub font-medium ml-1">
          {primaryUnit}
        </span>
      </div>
      {name && team ? (
        <Link
          href={`/player/${encodeURIComponent(name)}`}
          className="flex items-center gap-1.5 mt-1.5 text-[11px] hover:text-ipl-accent"
        >
          <TeamBadge team={team} size={16} />
          <span className="font-semibold text-ipl-ink truncate">
            {displayName ?? name}
          </span>
        </Link>
      ) : (
        <div className="mt-1.5 text-[11px] text-ipl-soft">—</div>
      )}
      {subStats.length > 0 && (
        <div className="text-[10px] text-ipl-sub font-mono mt-1 truncate">
          {subStats.join(" · ")}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   RECENT RESULTS
   -------------------------------------------------------------------------- */

function RecentResultsCard({ year }: { year: number }) {
  const q = useDuckQuery<MatchRow>(
    `SELECT
        CAST(match_number AS BIGINT) AS match_number,
        CAST(cricsheet_match_id AS BIGINT) AS cricsheet_match_id,
        CAST(date AS VARCHAR) AS date,
        team_1, team_2, team_1_score, team_2_score, winner,
        CAST(COALESCE(win_by_runs, 0) AS BIGINT) AS win_by_runs,
        CAST(COALESCE(win_by_wickets, 0) AS BIGINT) AS win_by_wickets,
        player_of_match
     FROM matches
     WHERE season = ${year} AND winner IS NOT NULL AND winner != ''
     ORDER BY match_number DESC
     LIMIT 10`,
  );

  return (
    <Card title="Recent Results" padded className="min-w-0">
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorCell message={q.error.message} />}
      {q.status === "success" && q.data.length === 0 && (
        <div className="p-6 text-center text-ipl-sub text-sm">
          No completed matches yet.
        </div>
      )}
      {q.status === "success" && q.data.length > 0 && (
        <div className="flex gap-3 overflow-x-auto sleek-scroll pb-1.5">
          {q.data.map((m) => (
            <RecentMatchCard key={m.match_number} m={m} />
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentMatchCard({ m }: { m: MatchRow }) {
  const { resolve } = usePlayerNames();
  const winnerCanon = canonicalTeam(m.winner);
  const margin =
    m.win_by_runs > 0
      ? `${m.win_by_runs} run${m.win_by_runs === 1 ? "" : "s"}`
      : `${m.win_by_wickets} wkt${m.win_by_wickets === 1 ? "" : "s"}`;
  return (
    <Link
      href={`/match/${m.cricsheet_match_id}`}
      className="shrink-0 w-[260px] border border-ipl-line rounded-lg p-3 bg-ipl-surface hover:border-ipl-soft transition-colors"
    >
      <div className="text-[11px] text-ipl-sub mb-2">
        Match {m.match_number} · {m.date}
      </div>
      <div className="flex flex-col gap-1.5">
        <TeamScoreRow
          team={m.team_1}
          score={m.team_1_score}
          bold={canonicalTeam(m.team_1) === winnerCanon}
        />
        <TeamScoreRow
          team={m.team_2}
          score={m.team_2_score}
          bold={canonicalTeam(m.team_2) === winnerCanon}
        />
      </div>
      <div className="text-[12px] text-ipl-ink mt-2.5">
        {m.winner} won by {margin}
      </div>
      {m.player_of_match && (
        <div className="text-[11px] text-ipl-sub mt-1">
          POM:{" "}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.location.href = `/player/${encodeURIComponent(
                m.player_of_match as string,
              )}`;
            }}
            className="text-ipl-accent font-semibold hover:underline"
          >
            {resolve(m.player_of_match)}
          </button>
        </div>
      )}
    </Link>
  );
}

function TeamScoreRow({
  team,
  score,
  bold,
}: {
  team: string;
  score: string;
  bold: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <TeamBadge team={team} size={22} />
      <span
        className={
          "font-semibold " + (bold ? "text-ipl-ink" : "text-ipl-sub")
        }
      >
        {teamShort(team)}
      </span>
      <span
        className={
          "ml-auto font-mono font-semibold " +
          (bold ? "text-ipl-ink" : "text-ipl-sub")
        }
      >
        {score}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------------
   SCORING RHYTHM (PHASE HEATMAP)
   -------------------------------------------------------------------------- */

function HeadToHeadMatrixCard({ year }: { year: number }) {
  // Every match in the season — the matrix component sorts league vs playoff
  // and infers home/away from venues itself.
  const matchesQ = useDuckQuery<HeadToHeadMatchRow>(
    `SELECT team_1, team_2, venue,
            winner,
            CAST(COALESCE(win_by_runs, 0)    AS BIGINT) AS win_by_runs,
            CAST(COALESCE(win_by_wickets, 0) AS BIGINT) AS win_by_wickets,
            result, match_stage,
            CAST(cricsheet_match_id AS BIGINT)          AS cricsheet_match_id,
            CAST(date AS VARCHAR)                       AS date
     FROM matches
     WHERE season = ${year}`,
  );

  // Team list comes from the points table so we get exactly the participating
  // teams in canonical order — short-code alphabetical matches the screenshot.
  const teamsQ = useDuckQuery<{ team: string }>(
    `SELECT team FROM points_table WHERE season = ${year}`,
  );

  const teams = useMemo(() => {
    if (teamsQ.status !== "success") return [] as string[];
    const canonical = teamsQ.data.map((r) => canonicalTeam(r.team));
    return [...new Set(canonical)].sort((a, b) =>
      teamShort(a).localeCompare(teamShort(b)),
    );
  }, [teamsQ]);

  const matches = useMemo<HeadToHeadMatchRow[]>(() => {
    if (matchesQ.status !== "success") return [];
    return matchesQ.data.map((m) => ({
      ...m,
      team_1: canonicalTeam(m.team_1),
      team_2: canonicalTeam(m.team_2),
      winner: m.winner ? canonicalTeam(m.winner) : null,
    }));
  }, [matchesQ]);

  return (
    <Card kicker="POINTS SUMMARY" title="Head-to-head results" padded={false}>
      {(matchesQ.status === "loading" || teamsQ.status === "loading") && <LoadingCell />}
      {matchesQ.status === "error" && <ErrorCell message={matchesQ.error.message} />}
      {teamsQ.status === "error" && <ErrorCell message={teamsQ.error.message} />}
      {matchesQ.status === "success" &&
        teamsQ.status === "success" &&
        (matches.length === 0 || teams.length === 0 ? (
          <div className="p-6 text-center text-ipl-sub text-sm">No matches yet.</div>
        ) : (
          <div className="p-3">
            <HeadToHeadMatrix teams={teams} matches={matches} />
          </div>
        ))}
    </Card>
  );
}

/* --------------------------------------------------------------------------
   BAT-FIRST VS CHASE WINS (DONUT) + 1ST/2ND INNINGS SCORE DISTRIBUTION
   -------------------------------------------------------------------------- */

type WinsSplitRow = {
  bat_first_wins: number;
  chase_wins: number;
};

const C_BAT_FIRST = "#3a5cff"; // ipl-accent
const C_CHASE = "#f59e0b"; // ipl-orange

function WinsBatChaseCard({ year }: { year: number }) {
  const q = useDuckQuery<WinsSplitRow>(
    `SELECT
        CAST(SUM(CASE WHEN winner = team_1 THEN 1 ELSE 0 END) AS BIGINT) AS bat_first_wins,
        CAST(SUM(CASE WHEN winner = team_2 THEN 1 ELSE 0 END) AS BIGINT) AS chase_wins
     FROM matches
     WHERE season = ${year}
       AND LOWER(COALESCE(result, '')) NOT IN ('no result')`,
  );

  const r = q.status === "success" ? q.data[0] : null;
  const total = r ? r.bat_first_wins + r.chase_wins : 0;
  // Naming mirrors the donut colors so the badge reads as "this side won
  // more". Even split is the rare ties case; we still surface it so the
  // header never looks empty when both halves of the donut are equal.
  const verdict =
    !r || total === 0
      ? null
      : r.bat_first_wins === r.chase_wins
        ? { label: "Even split", color: "var(--color-ipl-sub)" }
        : r.bat_first_wins > r.chase_wins
          ? { label: "Setters edge", color: C_BAT_FIRST }
          : { label: "Chasers edge", color: C_CHASE };

  return (
    <Card kicker="WINS" title="Bat first vs chase" padded>
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorCell message={q.error.message} />}
      {q.status === "success" && (!r || total === 0) && (
        <div className="text-ipl-sub text-sm">No completed matches yet.</div>
      )}
      {q.status === "success" && r && total > 0 && (
        <div className="relative flex items-center justify-center min-h-[340px]">
          {verdict && (
            <span
              className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white opacity-80"
              style={{ backgroundColor: verdict.color }}
            >
              {verdict.label}
            </span>
          )}
          <DonutChart
            segments={[
              {
                value: r.bat_first_wins,
                color: C_BAT_FIRST,
                label: "Bat first",
              },
              { value: r.chase_wins, color: C_CHASE, label: "Chase" },
            ]}
            centerLabel={String(total)}
            size={240}
            stroke={70}
          />
        </div>
      )}
    </Card>
  );
}

function DonutChart({
  segments,
  centerLabel,
  size = 140,
  stroke = 18,
}: {
  segments: { value: number; color: string; label?: string }[];
  centerLabel: string;
  size?: number;
  stroke?: number;
}) {
  // Centerline of the stroke — labels positioned here sit visually in the
  // middle of the colored ring.
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const cumStarts: number[] = [];
  segments.reduce((acc, s) => {
    cumStarts.push(acc);
    return acc + s.value / total;
  }, 0);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
        <circle
          r={radius}
          fill="none"
          stroke="var(--color-ipl-line2)"
          strokeWidth={stroke}
        />
        {segments.map((s, i) => {
          const pct = s.value / total;
          const dash = pct * circ;
          const offset = -cumStarts[i] * circ;
          // <title> renders a native hover tooltip on the arc — no JS needed.
          // Must be the FIRST child of the hovered element to register.
          const labelText = s.label ?? "";
          const tip = `${labelText ? `${labelText} — ` : ""}${s.value} match${
            s.value === 1 ? "" : "es"
          } (${Math.round(pct * 100)}%)`;
          return (
            <circle
              key={i}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={offset}
              style={{ cursor: "default" }}
            >
              <title>{tip}</title>
            </circle>
          );
        })}
      </g>

      {/* Inline arc labels — placed at the angular midpoint of each segment,
          radially at the stroke centerline. Skipped if the arc is too thin
          to fit text legibly. Font sizes scale with the stroke band so labels
          never overflow the colored ring. */}
      {segments.map((s, i) => {
        const frac = s.value / total;
        if (!s.label || frac < 0.08) return null;
        const midFraction = cumStarts[i] + frac / 2;
        const angle = -Math.PI / 2 + midFraction * 2 * Math.PI;
        const cx = size / 2 + radius * Math.cos(angle);
        const cy = size / 2 + radius * Math.sin(angle);
        const labelSize = Math.max(11, Math.min(13, Math.round(stroke * 0.18)));
        const pctSize = Math.max(9, Math.min(11, Math.round(stroke * 0.14)));
        const gap = labelSize * 0.55;
        return (
          <g key={`lbl-${i}`} style={{ pointerEvents: "none" }}>
            <text
              x={cx}
              y={cy - gap}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={labelSize}
              fontWeight={600}
              fill="#fff"
            >
              {s.label}
            </text>
            <text
              x={cx}
              y={cy + gap}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={pctSize}
              fontWeight={600}
              fill="#fff"
              style={{
                fontFamily: "var(--font-mono)",
                fontFeatureSettings: '"tnum", "zero"',
              }}
            >
              {Math.round(frac * 100)}%
            </text>
          </g>
        );
      })}

      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.round(size * 0.18)}
        fontWeight={600}
        fill="var(--color-ipl-ink)"
        style={{
          fontFamily: "var(--font-mono)",
          fontFeatureSettings: '"tnum", "zero"',
          letterSpacing: "-0.02em",
        }}
      >
        {centerLabel}
      </text>
    </svg>
  );
}

type InningsScoreRow = { innings: number; score: number };

function InningsScoreDistributionCard({ year }: { year: number }) {
  // Restrict to full 20-over matches so rain-shortened chases don't distort
  // the 2nd-innings distribution toward small totals.
  const q = useDuckQuery<InningsScoreRow>(
    `WITH s AS (
        SELECT 1 AS innings,
               TRY_CAST(SPLIT_PART(team_1_score, '/', 1) AS INTEGER) AS score
        FROM matches
        WHERE season = ${year}
          AND LOWER(COALESCE(result, '')) NOT IN ('no result')
          AND COALESCE(target_overs, 20) >= 20
        UNION ALL
        SELECT 2 AS innings,
               TRY_CAST(SPLIT_PART(team_2_score, '/', 1) AS INTEGER) AS score
        FROM matches
        WHERE season = ${year}
          AND LOWER(COALESCE(result, '')) NOT IN ('no result')
          AND COALESCE(target_overs, 20) >= 20
      )
      SELECT CAST(innings AS INTEGER) AS innings,
             CAST(score AS INTEGER)   AS score
      FROM s WHERE score IS NOT NULL`,
  );

  const data = useMemo<InningsScoreRow[]>(
    () => (q.status === "success" ? q.data : []),
    [q],
  );
  const s1 = useMemo(
    () => data.filter((r) => r.innings === 1).map((r) => r.score),
    [data],
  );
  const s2 = useMemo(
    () => data.filter((r) => r.innings === 2).map((r) => r.score),
    [data],
  );
  const mean1 = s1.length ? s1.reduce((a, b) => a + b, 0) / s1.length : null;
  const mean2 = s2.length ? s2.reduce((a, b) => a + b, 0) / s2.length : null;

  return (
    <Card kicker="INNINGS TOTALS" title="1st vs 2nd innings distribution" padded>
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorCell message={q.error.message} />}
      {q.status === "success" && s1.length === 0 && s2.length === 0 && (
        <div className="text-ipl-sub text-sm">No completed full innings yet.</div>
      )}
      {q.status === "success" && (s1.length > 0 || s2.length > 0) && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <MeanStat
              color={C_BAT_FIRST}
              label="1st innings avg"
              mean={mean1}
              n={s1.length}
            />
            <MeanStat
              color={C_CHASE}
              label="2nd innings avg"
              mean={mean2}
              n={s2.length}
            />
          </div>
          <HistogramDensity
            s1={s1}
            s2={s2}
            mean1={mean1}
            mean2={mean2}
            color1={C_BAT_FIRST}
            color2={C_CHASE}
          />
        </div>
      )}
    </Card>
  );
}

function MeanStat({
  color,
  label,
  mean,
  n,
}: {
  color: string;
  label: string;
  mean: number | null;
  n: number;
}) {
  return (
    <div
      className="rounded-md border border-ipl-line px-3 pt-2.5 pb-2 bg-ipl-surface"
      style={{
        backgroundImage: `linear-gradient(90deg, ${color}40 0%, ${color}1a 60%, ${color}00 100%)`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-ipl-sub">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span className="font-mono font-semibold text-[28px] leading-none text-ipl-ink tracking-[-0.02em]">
          {mean != null ? mean.toFixed(0) : "—"}
        </span>
        <span className="text-[11px] text-ipl-sub">
          runs · {n} innings
        </span>
      </div>
    </div>
  );
}

function HistogramDensity({
  s1,
  s2,
  mean1,
  mean2,
  color1,
  color2,
}: {
  s1: number[];
  s2: number[];
  mean1: number | null;
  mean2: number | null;
  color1: string;
  color2: string;
}) {
  const all = [...s1, ...s2];
  if (all.length === 0) return null;

  // Lock the x-axis to a 10-run grid that hugs the observed range — keeps the
  // distributions filling the chart rather than getting shoved to one side.
  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const min = Math.max(0, Math.floor((rawMin - 5) / 10) * 10);
  const max = Math.ceil((rawMax + 5) / 10) * 10;
  const binWidth = 10;
  const nBins = Math.max(1, Math.round((max - min) / binWidth));

  // Raw count per bin — much more intuitive than density on the Y axis
  // ("3 innings landed in 150–159") and lets the KDE curve share the scale
  // once we multiply by N * binWidth.
  const histCounts = (xs: number[]) => {
    const bins = new Array(nBins).fill(0);
    for (const v of xs) {
      if (v < min || v >= max) continue;
      const idx = Math.min(nBins - 1, Math.floor((v - min) / binWidth));
      bins[idx] += 1;
    }
    return bins;
  };

  const h1 = histCounts(s1);
  const h2 = histCounts(s2);

  // KDE — Silverman's rule of thumb for bandwidth.
  const silverman = (xs: number[]) => {
    if (xs.length < 2) return Math.max(8, binWidth);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    return Math.max(6, 1.06 * Math.sqrt(v) * Math.pow(xs.length, -1 / 5));
  };
  const bw1 = silverman(s1);
  const bw2 = silverman(s2);
  const kde = (xs: number[], bw: number, x: number) => {
    if (xs.length === 0) return 0;
    let sum = 0;
    for (const v of xs) {
      const u = (x - v) / bw;
      sum += Math.exp(-0.5 * u * u);
    }
    return sum / (xs.length * bw * Math.sqrt(2 * Math.PI));
  };
  const STEPS = 80;
  const xs = Array.from(
    { length: STEPS + 1 },
    (_, i) => min + (i / STEPS) * (max - min),
  );
  // Multiply density by N * binWidth so the curve sits on the same count
  // axis as the histogram bars (expected count per bin).
  const k1 = xs.map((x) => kde(s1, bw1, x) * s1.length * binWidth);
  const k2 = xs.map((x) => kde(s2, bw2, x) * s2.length * binWidth);

  const yMax = Math.max(...h1, ...h2, ...k1, ...k2, 1) * 1.1;

  // viewBox dimensions chosen to match the card's actual pixel width so SVG
  // text renders at ~1:1 scale (avoids the "huge serif fonts" look).
  const W = 540;
  const H = 260;
  const pad = { t: 16, r: 16, b: 40, l: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const xScale = (v: number) => pad.l + ((v - min) / (max - min)) * innerW;
  const yScale = (v: number) => pad.t + innerH - (v / yMax) * innerH;
  const baseY = pad.t + innerH;

  const yTicks = niceTicks(yMax, 4);
  const xTickStep = max - min <= 120 ? 20 : 40;
  const xTicks: number[] = [];
  for (let x = min; x <= max; x += xTickStep) xTicks.push(x);

  const pathFor = (ys: number[]) => {
    if (ys.length === 0) return "";
    let d = `M ${xScale(xs[0]).toFixed(2)} ${yScale(ys[0]).toFixed(2)}`;
    for (let i = 1; i < ys.length; i += 1) {
      d += ` L ${xScale(xs[i]).toFixed(2)} ${yScale(ys[i]).toFixed(2)}`;
    }
    return d;
  };

  const areaFor = (ys: number[]) => {
    const top = pathFor(ys);
    if (!top) return "";
    return `${top} L ${xScale(xs[xs.length - 1]).toFixed(2)} ${baseY.toFixed(
      2,
    )} L ${xScale(xs[0]).toFixed(2)} ${baseY.toFixed(2)} Z`;
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* Y gridlines + count ticks */}
      {yTicks.map((t) => (
        <g key={`y-${t}`}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="var(--color-ipl-line2)"
            strokeWidth={1}
          />
          <text
            x={pad.l - 6}
            y={yScale(t) + 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--color-ipl-sub)"
            style={{
              fontFamily: "var(--font-mono)",
              fontFeatureSettings: '"tnum", "zero"',
            }}
          >
            {Math.round(t)}
          </text>
        </g>
      ))}

      {/* Y axis title — rotated, sits left of the ticks */}
      <text
        x={12}
        y={pad.t + innerH / 2}
        textAnchor="middle"
        fontSize={10}
        fill="var(--color-ipl-sub)"
        transform={`rotate(-90, 12, ${pad.t + innerH / 2})`}
        style={{
          fontFamily: "var(--font-sans)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Innings count
      </text>

      {/* Histogram bars — drawn first so density curves sit on top */}
      {h1.map((d, i) => {
        if (d <= 0) return null;
        const x0 = xScale(min + i * binWidth);
        const x1 = xScale(min + (i + 1) * binWidth);
        const y = yScale(d);
        return (
          <rect
            key={`b1-${i}`}
            x={x0}
            y={y}
            width={Math.max(0, x1 - x0 - 0.5)}
            height={Math.max(0, baseY - y)}
            fill={color1}
            fillOpacity={0.22}
          />
        );
      })}
      {h2.map((d, i) => {
        if (d <= 0) return null;
        const x0 = xScale(min + i * binWidth);
        const x1 = xScale(min + (i + 1) * binWidth);
        const y = yScale(d);
        return (
          <rect
            key={`b2-${i}`}
            x={x0}
            y={y}
            width={Math.max(0, x1 - x0 - 0.5)}
            height={Math.max(0, baseY - y)}
            fill={color2}
            fillOpacity={0.22}
          />
        );
      })}

      {/* Density curves (filled area + outline) */}
      {s1.length >= 2 && (
        <>
          <path d={areaFor(k1)} fill={color1} fillOpacity={0.12} />
          <path d={pathFor(k1)} stroke={color1} strokeWidth={2} fill="none" />
        </>
      )}
      {s2.length >= 2 && (
        <>
          <path d={areaFor(k2)} fill={color2} fillOpacity={0.12} />
          <path d={pathFor(k2)} stroke={color2} strokeWidth={2} fill="none" />
        </>
      )}

      {/* Mean reference lines — dashed verticals labeled at the top. Labels
          align outward (toward the chart edge) based on which mean is larger,
          so they never point at each other and never overlap. */}
      {mean1 != null && (
        <MeanRule
          x={xScale(mean1)}
          top={pad.t}
          bottom={baseY}
          color={color1}
          label={`${Math.round(mean1)}`}
          align={
            mean2 == null || mean1 >= mean2 ? "right" : "left"
          }
        />
      )}
      {mean2 != null && (
        <MeanRule
          x={xScale(mean2)}
          top={pad.t}
          bottom={baseY}
          color={color2}
          label={`${Math.round(mean2)}`}
          align={
            mean1 == null || mean2 >= mean1 ? "right" : "left"
          }
        />
      )}

      {/* X axis */}
      <line
        x1={pad.l}
        x2={W - pad.r}
        y1={baseY}
        y2={baseY}
        stroke="var(--color-ipl-soft)"
        strokeWidth={1}
      />
      {xTicks.map((t) => (
        <text
          key={`x-${t}`}
          x={xScale(t)}
          y={baseY + 16}
          textAnchor="middle"
          fontSize={11}
          fill="var(--color-ipl-sub)"
          style={{
            fontFamily: "var(--font-mono)",
            fontFeatureSettings: '"tnum", "zero"',
          }}
        >
          {t}
        </text>
      ))}
      <text
        x={pad.l + innerW / 2}
        y={H - 6}
        textAnchor="middle"
        fontSize={10}
        fill="var(--color-ipl-sub)"
        style={{
          fontFamily: "var(--font-sans)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Innings total (runs)
      </text>
    </svg>
  );
}

function MeanRule({
  x,
  top,
  bottom,
  color,
  label,
  align,
}: {
  x: number;
  top: number;
  bottom: number;
  color: string;
  label: string;
  align: "left" | "right";
}) {
  const dx = align === "left" ? -5 : 5;
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={top}
        y2={bottom}
        stroke={color}
        strokeWidth={1.25}
        strokeDasharray="4 3"
      />
      {/* White halo via paint-order: the stroke is drawn first behind the
          fill, giving the colored text legibility over bars and density
          curves without needing a solid background rect. */}
      <text
        x={x + dx}
        y={top + 9}
        textAnchor={align === "left" ? "end" : "start"}
        fontSize={11}
        fontWeight={700}
        fill={color}
        stroke="#ffffff"
        strokeWidth={3}
        paintOrder="stroke"
        style={{
          fontFamily: "var(--font-mono)",
          fontFeatureSettings: '"tnum", "zero"',
        }}
      >
        {label}
      </text>
    </g>
  );
}

function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const niceF = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  const step = niceF * exp;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

/* --------------------------------------------------------------------------
   MOST SIXES / MOST FOURS LEADERBOARDS (Total vs Best-innings toggle)
   -------------------------------------------------------------------------- */

type BoundaryLeader = {
  batter: string;
  team: string;
  sixes: number;
  fours: number;
};

type BoundaryMode = "total" | "best";

function BoundaryLeaderboardsCard({ year }: { year: number }) {
  const [mode, setMode] = useState<BoundaryMode>("total");
  // SUM ranks by season totals; MAX ranks by the best single-innings count.
  const agg = mode === "total" ? "SUM" : "MAX";

  const sixesQ = useDuckQuery<BoundaryLeader>(
    `SELECT batter,
            ANY_VALUE(team) AS team,
            CAST(${agg}(sixes) AS BIGINT) AS sixes,
            CAST(${agg}(fours) AS BIGINT) AS fours
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     HAVING ${agg}(sixes) > 0
     ORDER BY sixes DESC, fours DESC
     LIMIT 5`,
  );

  const foursQ = useDuckQuery<BoundaryLeader>(
    `SELECT batter,
            ANY_VALUE(team) AS team,
            CAST(${agg}(sixes) AS BIGINT) AS sixes,
            CAST(${agg}(fours) AS BIGINT) AS fours
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     HAVING ${agg}(fours) > 0
     ORDER BY fours DESC, sixes DESC
     LIMIT 5`,
  );

  return (
    <Card
      kicker="BOUNDARIES"
      title={
        mode === "total" ? "Most sixes & fours" : "Highest in a single innings"
      }
      padded
      action={<BoundaryModeToggle value={mode} onChange={setMode} />}
    >
      <div className="grid grid-cols-2 gap-6">
        <BoundaryColumn
          heading="Most sixes"
          tone="var(--color-ipl-neg)"
          metric="sixes"
          state={sixesQ}
        />
        <BoundaryColumn
          heading="Most fours"
          tone="var(--color-ipl-accent)"
          metric="fours"
          state={foursQ}
        />
      </div>
    </Card>
  );
}

function BoundaryModeToggle({
  value,
  onChange,
}: {
  value: BoundaryMode;
  onChange: (v: BoundaryMode) => void;
}) {
  const options: { value: BoundaryMode; label: string }[] = [
    { value: "total", label: "Total" },
    { value: "best", label: "Best innings" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-ipl-line bg-ipl-bg p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "px-2 py-0.5 text-[11px] font-semibold rounded-sm transition-colors " +
              (active
                ? "bg-ipl-surface text-ipl-ink shadow-[0_0_0_1px_var(--color-ipl-line)]"
                : "text-ipl-sub hover:text-ipl-ink")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function BoundaryColumn({
  heading,
  tone,
  metric,
  state,
}: {
  heading: string;
  tone: string;
  metric: "sixes" | "fours";
  state: ReturnType<typeof useDuckQuery<BoundaryLeader>>;
}) {
  // useDuckQuery resets to "loading" every time the SQL string changes, which
  // makes the leaderboard flash a Loading cell on each toggle. Hold onto the
  // last successful rows so subsequent refetches swap data in place; only the
  // very first load shows the spinner. We use the render-time setState
  // pattern (allowed when guarded by a signature change) so we don't need
  // a useEffect to mirror the query result into local state.
  const [stable, setStable] = useState<{
    rows: LeaderRow[];
    loaded: boolean;
    sig: string;
  }>({ rows: [], loaded: false, sig: "" });

  if (state.status === "success") {
    const first = state.data[0];
    const sig = `${metric}|${state.data.length}|${first?.batter ?? ""}|${first?.sixes ?? 0}|${first?.fours ?? 0}`;
    if (sig !== stable.sig) {
      setStable({
        rows: state.data.map((r) => ({
          name: r.batter,
          team: r.team,
          value: metric === "sixes" ? r.sixes : r.fours,
        })),
        loaded: true,
        sig,
      });
    }
  }

  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.1em] font-bold mb-2"
        style={{ color: tone }}
      >
        {heading}
      </div>
      <LeaderboardBody
        status={
          state.status === "error"
            ? "error"
            : stable.loaded
              ? "success"
              : "loading"
        }
        message={state.status === "error" ? state.error.message : ""}
        rows={stable.rows}
        tone={tone}
      />
    </div>
  );
}

type LeaderRow = { name: string; team: string; value: number };

function LeaderboardBody({
  status,
  message,
  rows,
  tone,
}: {
  status: "loading" | "success" | "error";
  message: string;
  rows: LeaderRow[];
  tone: string;
}) {
  const { resolve } = usePlayerNames();
  if (status === "loading") return <LoadingCell />;
  if (status === "error") return <ErrorCell message={message} />;
  if (rows.length === 0)
    return <div className="text-ipl-sub text-sm">No data for this season yet.</div>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div
          key={r.name}
          className="flex items-center gap-2.5 text-[12px] animate-fade-in"
        >
          <span className="font-mono w-4 text-ipl-sub">{i + 1}</span>
          <TeamBadge team={r.team} size={20} />
          <Link
            href={`/player/${encodeURIComponent(r.name)}`}
            className="flex-1 font-semibold text-ipl-ink hover:text-ipl-accent truncate"
          >
            {resolve(r.name)}
          </Link>
          <div className="w-[180px] h-[12px] bg-ipl-line2 rounded-sm overflow-hidden">
            <div
              key={r.value}
              className="h-full rounded-sm animate-bar-x"
              style={{
                width: `${max > 0 ? (r.value / max) * 100 : 0}%`,
                background: tone,
              }}
            />
          </div>
          <span className="font-mono w-[36px] text-right font-semibold">
            {r.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
   SHARED CELLS
   -------------------------------------------------------------------------- */

function LoadingCell() {
  return <div className="p-6 text-center text-ipl-sub text-sm">Loading…</div>;
}

function ErrorCell({ message }: { message: string }) {
  return <pre className="p-4 text-ipl-neg text-xs whitespace-pre-wrap">{message}</pre>;
}
