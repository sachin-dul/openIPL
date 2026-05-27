"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { canonicalTeam, teamShort } from "@/lib/teams";
import { LATEST_SEASON } from "@/lib/seasons";
import { TeamBadge } from "@/components/team-badge";
import { Card } from "@/components/card";
import { PageHead } from "@/components/page-head";

type Row = {
  player: string;
  role: string | null;
  mat: number;
  seasons: number;
  first_season: number;
  last_season: number;
  team: string | null;
  /**
   * Every distinct franchise the player has appeared for, ordered oldest →
   * newest by first season at that team, pipe-separated. Raw cricsheet names
   * (still needs `canonicalTeam()` to collapse RCB Bangalore↔Bengaluru, etc).
   */
  teams_played: string | null;
  runs: number;
  bat_balls: number;
  bat_outs: number;
  bat_hs: number;
  bat_50s: number;
  bat_100s: number;
  wkts: number;
  bowl_runs: number;
  bowl_overs: number;
  bbi_wkts: number;
  bbi_runs: number;
  bowl_5w: number;
  bowling_kind: "spin" | "pace" | null;
  nationality: "Indian" | "Overseas" | null;
  country: string | null;
  peak_year: number | null;
  oc_count: number | null;
  pc_count: number | null;
};

// One DuckDB query pulls every player aggregate the table needs. CTEs:
//   players_agg     — matches + season span + role per player (matches-derived)
//   players_base    — FULL OUTER union of players_meta and players_agg:
//                     every registered player gets a row, even if they were
//                     squadded but never came on (151 such names). Players
//                     in the matches table but missing from players_meta
//                     (3 cricsheet aliases like "Arshad Khan (2)") also
//                     survive — they get null country/role on the JOIN below.
//   latest_team     — most recent franchise per player (drives the row badge)
//   team_history    — every (player, team) pair the player has appeared in,
//                     aggregated as a pipe-joined chronological list. Feeds
//                     the "ever played for" filter semantics and the +N
//                     past-franchises chip.
//   bat_innings     — per-innings batting (used for HS/50s/100s + Avg/SR)
//   bowl_innings    — per-innings bowling (used for BBI + 5w + Avg/Econ)
//   bbi             — best bowling figures per player (wkts DESC, runs ASC, overs DESC)
//   bat_/bowl_season— season totals (feeds composite/peak/OC/PC)
//   composite       — bat+bowl season totals joined, carries a composite score
//   peak            — pick highest-composite season per player
//   oc / pc         — Orange/Purple cap season winners
const SQL = /* sql */ `
WITH
players_agg AS (
  SELECT
    player,
    ANY_VALUE(role) AS legacy_role,
    CAST(SUM(matches) AS BIGINT) AS mat,
    CAST(COUNT(DISTINCT season) AS BIGINT) AS played_seasons,
    CAST(MIN(season) AS BIGINT) AS played_first,
    CAST(MAX(season) AS BIGINT) AS played_last
  FROM players WHERE player IS NOT NULL
  GROUP BY player
),
players_base AS (
  -- FULL OUTER so registry-only players (squadded but never picked) keep
  -- a row, and the handful of matches-only players (cricsheet alias quirks
  -- like Arshad Khan (2)) also survive.
  --
  -- role: prefer the normalized players_meta.role (Wikipedia infobox +
  -- stats fallback, one of Batsman/Bowler/All-rounder/Wicket-keeper).
  -- For the rare players_agg-only rows, capitalize the collector heuristic.
  SELECT
    COALESCE(pm.cricsheet_name, pa.player)                       AS player,
    COALESCE(
      pm.role,
      CASE pa.legacy_role
        WHEN 'batter'      THEN 'Batsman'
        WHEN 'bowler'      THEN 'Bowler'
        WHEN 'all-rounder' THEN 'All-rounder'
      END
    )                                                             AS role,
    COALESCE(pa.mat, 0)                                           AS mat,
    CAST(COALESCE(pa.played_seasons, 0)               AS BIGINT)  AS seasons,
    CAST(COALESCE(pa.played_first, pm.first_season)   AS BIGINT)  AS first_season,
    CAST(COALESCE(pm.last_season,  pa.played_last)    AS BIGINT)  AS last_season
  FROM players_meta pm
  FULL OUTER JOIN players_agg pa ON pa.player = pm.cricsheet_name
),
latest_team AS (
  SELECT player, team FROM (
    SELECT player, team,
           ROW_NUMBER() OVER (PARTITION BY player ORDER BY season DESC, matches DESC) AS rk
    FROM players WHERE player IS NOT NULL AND team IS NOT NULL
  ) WHERE rk = 1
),
team_history AS (
  SELECT player, team, MIN(season) AS first_yr
  FROM players WHERE player IS NOT NULL AND team IS NOT NULL
  GROUP BY player, team
),
team_history_agg AS (
  SELECT player,
         STRING_AGG(team, '|' ORDER BY first_yr ASC, team ASC) AS teams_played
  FROM team_history
  GROUP BY player
),
bat_innings AS (
  SELECT batter AS player,
         runs,
         balls,
         CASE WHEN LOWER(COALESCE(dismissal, 'not out')) <> 'not out' THEN 1 ELSE 0 END AS is_out,
         CASE WHEN runs >= 100 THEN 1 ELSE 0 END AS is_100,
         CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END AS is_50
  FROM batting_scorecard WHERE batter IS NOT NULL
),
bat_totals AS (
  SELECT player,
         CAST(SUM(runs) AS BIGINT)   AS runs,
         CAST(SUM(balls) AS BIGINT)  AS bat_balls,
         CAST(SUM(is_out) AS BIGINT) AS bat_outs,
         CAST(MAX(runs) AS BIGINT)   AS bat_hs,
         CAST(SUM(is_50) AS BIGINT)  AS bat_50s,
         CAST(SUM(is_100) AS BIGINT) AS bat_100s
  FROM bat_innings GROUP BY player
),
bowl_innings AS (
  SELECT bowler AS player,
         wickets,
         runs   AS bowl_runs,
         overs,
         CASE WHEN wickets >= 5 THEN 1 ELSE 0 END AS is_5w
  FROM bowling_scorecard WHERE bowler IS NOT NULL
),
bowl_totals AS (
  SELECT player,
         CAST(SUM(wickets)   AS BIGINT) AS wkts,
         CAST(SUM(bowl_runs) AS BIGINT) AS bowl_runs,
         CAST(SUM(overs)     AS DOUBLE) AS bowl_overs,
         CAST(SUM(is_5w)     AS BIGINT) AS bowl_5w
  FROM bowl_innings GROUP BY player
),
bbi AS (
  SELECT player,
         CAST(wickets   AS BIGINT) AS bbi_wkts,
         CAST(bowl_runs AS BIGINT) AS bbi_runs
  FROM (
    SELECT player, wickets, bowl_runs, overs,
           ROW_NUMBER() OVER (
             PARTITION BY player
             ORDER BY wickets DESC, bowl_runs ASC, overs DESC
           ) AS rk
    FROM bowl_innings
  ) WHERE rk = 1
),
bat_season AS (
  SELECT batter AS player, season, SUM(runs) AS s_runs
  FROM batting_scorecard WHERE batter IS NOT NULL
  GROUP BY batter, season
),
bowl_season AS (
  SELECT bowler AS player, season, SUM(wickets) AS s_wkts
  FROM bowling_scorecard WHERE bowler IS NOT NULL
  GROUP BY bowler, season
),
composite AS (
  SELECT
    COALESCE(b.player, bw.player) AS player,
    COALESCE(b.season, bw.season) AS season,
    COALESCE(b.s_runs, 0)         AS s_runs,
    COALESCE(bw.s_wkts, 0)        AS s_wkts,
    COALESCE(b.s_runs, 0) + COALESCE(bw.s_wkts, 0) * 20 AS s_score
  FROM bat_season b
  FULL OUTER JOIN bowl_season bw
    ON b.player = bw.player AND b.season = bw.season
),
peak AS (
  SELECT player, season AS peak_year FROM (
    SELECT player, season,
           ROW_NUMBER() OVER (PARTITION BY player ORDER BY s_score DESC, season DESC) AS rk
    FROM composite
  ) WHERE rk = 1
),
oc AS (
  SELECT player, COUNT(*) AS oc_count FROM (
    SELECT player, season, s_runs,
           ROW_NUMBER() OVER (PARTITION BY season ORDER BY s_runs DESC) AS rk
    FROM composite WHERE s_runs > 0
  ) WHERE rk = 1
  GROUP BY player
),
pc AS (
  SELECT player, COUNT(*) AS pc_count FROM (
    SELECT player, season, s_wkts,
           ROW_NUMBER() OVER (PARTITION BY season ORDER BY s_wkts DESC) AS rk
    FROM composite WHERE s_wkts > 0
  ) WHERE rk = 1
  GROUP BY player
)
SELECT
  pb.player,
  pb.role,
  pb.mat,
  pb.seasons,
  pb.first_season,
  pb.last_season,
  lt.team,
  th.teams_played            AS teams_played,
  COALESCE(bt.runs, 0)       AS runs,
  COALESCE(bt.bat_balls, 0)  AS bat_balls,
  COALESCE(bt.bat_outs, 0)   AS bat_outs,
  COALESCE(bt.bat_hs, 0)     AS bat_hs,
  COALESCE(bt.bat_50s, 0)    AS bat_50s,
  COALESCE(bt.bat_100s, 0)   AS bat_100s,
  COALESCE(bo.wkts, 0)       AS wkts,
  COALESCE(bo.bowl_runs, 0)  AS bowl_runs,
  COALESCE(bo.bowl_overs, 0) AS bowl_overs,
  COALESCE(bb.bbi_wkts, 0)   AS bbi_wkts,
  COALESCE(bb.bbi_runs, 0)   AS bbi_runs,
  COALESCE(bo.bowl_5w, 0)    AS bowl_5w,
  pm.bowling_kind             AS bowling_kind,
  pm.nationality              AS nationality,
  pm.country                  AS country,
  CAST(p.peak_year AS BIGINT) AS peak_year,
  CAST(oc.oc_count AS BIGINT) AS oc_count,
  CAST(pc.pc_count AS BIGINT) AS pc_count
FROM players_base pb
LEFT JOIN latest_team       lt ON lt.player = pb.player
LEFT JOIN team_history_agg  th ON th.player = pb.player
LEFT JOIN bat_totals   bt ON bt.player = pb.player
LEFT JOIN bowl_totals  bo ON bo.player = pb.player
LEFT JOIN bbi          bb ON bb.player = pb.player
LEFT JOIN players_meta pm ON pm.cricsheet_name = pb.player
LEFT JOIN peak         p  ON p.player  = pb.player
LEFT JOIN oc              ON oc.player = pb.player
LEFT JOIN pc              ON pc.player = pb.player
`;


type SortKey =
  | "runs"
  | "bat_avg"
  | "bat_sr"
  | "wkts"
  | "bowl_avg"
  | "bowl_econ"
  | "mat"
  | "player"
  | "peak";
type SortDir = "asc" | "desc";
type TeamScope = "ever" | "now";

// Derived stats helpers — computed per-row at render so the SQL stays simple.
// All return null when the denominator is zero (rendered as an em-dash).

// Canonical, deduped chronological list of every franchise the player has
// appeared for. The SQL emits raw cricsheet names pipe-joined oldest-first;
// canonicalTeam() collapses RCB Bangalore↔Bengaluru and the RPS-with-s typo
// so they don't show twice. KXIP and PBKS are intentionally NOT collapsed
// (different franchise eras, per teams.ts).
function teamsOf(r: Row): string[] {
  const raw = r.teams_played ? r.teams_played.split("|") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    const c = canonicalTeam(name);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  if (out.length === 0 && r.team) {
    out.push(canonicalTeam(r.team));
  }
  return out;
}

function batAvg(r: Row): number | null {
  return r.bat_outs > 0 ? r.runs / r.bat_outs : null;
}
function batSR(r: Row): number | null {
  return r.bat_balls > 0 ? (r.runs / r.bat_balls) * 100 : null;
}
function bowlAvg(r: Row): number | null {
  return r.wkts > 0 ? r.bowl_runs / r.wkts : null;
}
function bowlEcon(r: Row): number | null {
  return r.bowl_overs > 0 ? r.bowl_runs / r.bowl_overs : null;
}

export function PlayersContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const team = params.get("team") ?? "All";
  const role = params.get("role") ?? "All";
  // minSeasons filter has three modes:
  //   null  → "All"  (no filter, default)
  //   0     → exactly 0 matches played (registry-only tail)
  //   N > 0 → played in at least N seasons ("1+", "5+", "10+", "15+")
  // Storing as `number | null` keeps "All" distinct from "exactly 0".
  const minRaw = params.get("min");
  const minSeasons: number | null = minRaw == null ? null : Number(minRaw);
  const status = params.get("status") ?? "All";
  const nationality = params.get("nat") ?? "All";
  const country = params.get("country") ?? "All";
  const style = params.get("style") ?? "All";
  const search = params.get("q") ?? "";
  // teamScope flips the Team filter between "latest team only" (`now`, the
  // default — latest_team is the player's most recent franchise, so active
  // players land under their current side and retired players under their
  // final side) and "any team they ever played for" (`ever`). It governs
  // the filter inclusion test and the per-team count badges; the row's +N
  // chip is unaffected because it always reflects full history.
  const teamScope: TeamScope = params.get("tscope") === "ever" ? "ever" : "now";
  const sortKey = (params.get("sort") ?? "runs") as SortKey;
  const sortDir = (params.get("dir") ?? "desc") as SortDir;

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    // Any change other than "page" itself collapses the user back to page 1
    // so the row they were viewing doesn't shift outside the filtered set.
    if (Object.keys(next).some((k) => k !== "page")) {
      sp.delete("page");
    }
    for (const [k, v] of Object.entries(next)) {
      if (v == null) sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const state = useDuckQuery<Row>(SQL);
  const { resolve } = usePlayerNames();
  const rows = state.status === "success" ? state.data : [];

  // Full chronological franchise history per player. Always full — this is
  // what the row's +N chip renders, regardless of the current filter scope.
  const teamsByPlayer = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(r.player, teamsOf(r));
    return m;
  }, [rows]);

  // Scope-aware projection: under `ever` the filter and counts use the full
  // history map; under `now` they collapse to just the current franchise.
  // Keeping these two layers separate means flipping the toggle is cheap
  // and the +N chip stays informative even in `now` mode.
  const filterTeamsByPlayer = useMemo(() => {
    if (teamScope === "ever") return teamsByPlayer;
    const m = new Map<string, string[]>();
    for (const r of rows) {
      m.set(r.player, r.team ? [canonicalTeam(r.team)] : []);
    }
    return m;
  }, [rows, teamsByPlayer, teamScope]);

  const searchLc = search.trim().toLowerCase();

  // One shared predicate so the filtered table and the sidebar counts can't
  // disagree on which rows are visible. `opts.skipTeam` lets the count pass
  // compute team membership *as if the team filter weren't applied* — so
  // picking RCB doesn't hollow out every other franchise's count to zero.
  // Career totals are untouched; only inclusion narrows.
  function passes(
    r: Row,
    opts: { skipTeam?: boolean; skipCountry?: boolean } = {},
  ): boolean {
    if (!opts.skipTeam && team !== "All") {
      const ts = filterTeamsByPlayer.get(r.player);
      if (!ts || !ts.includes(team)) return false;
    }
    if (role !== "All") {
      if (r.role !== role) return false;
    }
    // Seasons filter: null = All, 0 = exactly never-played, N>0 = seasons >= N.
    if (minSeasons === 0) {
      if (r.seasons !== 0) return false;
    } else if (minSeasons != null && r.seasons < minSeasons) {
      return false;
    }
    if (status === "Active" && r.last_season < LATEST_SEASON - 1) return false;
    if (status === "Retired" && r.last_season >= LATEST_SEASON - 1) return false;
    if (nationality !== "All" && r.nationality !== nationality) return false;
    if (!opts.skipCountry && country !== "All" && r.country !== country) return false;
    if (style !== "All") {
      if (r.bowl_overs <= 0) return false;
      const kind = r.bowling_kind ?? "";
      if (kind !== style.toLowerCase()) return false;
    }
    if (searchLc) {
      const haystack = `${resolve(r.player)} ${r.player}`.toLowerCase();
      if (!haystack.includes(searchLc)) return false;
    }
    return true;
  }

  // Unique teams across the active scope, canonicalized so RCB/Bangalore
  // collapse to one filter row. Counts respect every active filter EXCEPT
  // team — that's the faceted-search convention (so a user can see "if I
  // pick this other team instead, how many would match?"). Under `ever`
  // each player ticks every team they've represented (sums exceed the
  // player total — expected); under `now` each player ticks exactly one.
  const { teamsForFilter, teamCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!passes(r, { skipTeam: true })) continue;
      for (const c of filterTeamsByPlayer.get(r.player) ?? []) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.keys()).sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
    );
    return {
      teamsForFilter: ["All", ...sorted],
      teamCounts: counts,
    };
    // `team` is deliberately omitted from deps — switching the team filter
    // shouldn't recompute its own count basis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filterTeamsByPlayer, role, minSeasons, status, nationality, country, style, searchLc, resolve]);

  // Country counts mirror the team-count pattern: faceted on every active
  // filter except country itself, so the user can see "if I pick this
  // other country instead, how many would match?". Players with a null
  // country (the unmapped tail) don't show up in the list — they remain
  // reachable via the Nationality filter's heuristic.
  const { countriesForFilter, countryCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!passes(r, { skipCountry: true })) continue;
      if (r.country && CRICKETING_NATIONS.has(r.country)) {
        counts.set(r.country, (counts.get(r.country) ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.keys()).sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
    );
    return {
      countriesForFilter: ["All", ...sorted],
      countryCounts: counts,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, team, role, minSeasons, status, nationality, style, searchLc, resolve, filterTeamsByPlayer]);

  const filtered = useMemo(() => {
    return rows.filter((r) => passes(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, team, role, minSeasons, status, nationality, country, style, searchLc, resolve, filterTeamsByPlayer]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => cmp(a, b, sortKey, sortDir, resolve));
    return list;
  }, [filtered, sortKey, sortDir, resolve]);

  function onSort(key: SortKey) {
    if (sortKey === key) {
      update({ sort: key, dir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      update({ sort: key, dir: key === "player" ? "asc" : "desc" });
    }
  }

  const PAGE_SIZE = 50;
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const rawPage = Number(params.get("page") ?? "1");
  const page = Math.min(Math.max(1, isFinite(rawPage) ? rawPage : 1), totalPages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div>
      <PageHead
        title="Players · all-time"
        sub={
          state.status === "success" ? (
            <>
              <span className="font-mono tabular-nums text-ipl-ink font-medium">
                {rows.length.toLocaleString()}
              </span>{" "}
              players · IPL 2008–{LATEST_SEASON}. Filter by team, role, or career
              length — open any row for a full profile.
            </>
          ) : (
            "Loading career stats…"
          )
        }
      />

      <div className="grid grid-cols-[260px_1fr] gap-3.5">
        {/*
         * Filters live in a single sticky scroll container so they remain in
         * reach as the user scrolls through hundreds of player rows. The
         * inner column owns the visual layout (gaps between cards); the
         * outer aside owns the scroll behavior. `top-2` parks the strip
         * just below the viewport edge once the page header scrolls past.
         */}
        <aside
          className="self-start sticky top-2 max-h-[calc(100vh-1rem)] overflow-y-auto sleek-scroll"
        >
          <div className="flex flex-col gap-3 pr-1">
            <ActiveFiltersCard
              team={team}
              role={role}
              style={style}
              minSeasons={minSeasons}
              status={status}
              nationality={nationality}
              country={country}
              search={search}
              teamScope={teamScope}
              onClear={(key) => {
                if (key === "all") {
                  update({ team: null, role: null, style: null, min: null, status: null, nat: null, country: null, q: null, tscope: null });
                } else {
                  update({ [key]: null });
                }
              }}
            />
            <SearchBox
              value={search}
              onChange={(v) => update({ q: v ? v : null })}
            />
            <FilterGroup
              title="Team"
              items={teamsForFilter}
              active={team}
              onPick={(v) => update({ team: v === "All" ? null : v })}
              counts={teamCounts}
              subheader={
                <TeamScopeToggle
                  value={teamScope}
                  onChange={(next) => update({ tscope: next === "now" ? null : next })}
                />
              }
              valueRenderer={(v) =>
                v === "All" ? (
                  "All teams"
                ) : (
                  <span className="flex items-center gap-2 min-w-0">
                    <TeamBadge team={v} size={16} />
                    <span className="truncate">{teamShort(v)}</span>
                  </span>
                )
              }
            />
            <FilterGroup
              title="Status"
              items={["All", "Active", "Retired"]}
              active={status}
              onPick={(v) => update({ status: v === "All" ? null : v })}
            />
            <FilterGroup
              title="Nationality"
              items={["All", "Indian", "Overseas"]}
              active={nationality}
              onPick={(v) => update({ nat: v === "All" ? null : v })}
            />
            <FilterGroup
              title="Country"
              items={countriesForFilter}
              active={country}
              onPick={(v) => update({ country: v === "All" ? null : v })}
              counts={countryCounts}
              valueRenderer={(v) =>
                v === "All" ? (
                  "All countries"
                ) : (
                  <span className="flex items-center gap-2 min-w-0">
                    <CountryFlag country={v} size={14} />
                    <span className="truncate">{v}</span>
                  </span>
                )
              }
            />
            <FilterGroup
              title="Role"
              items={["All", "Batsman", "Bowler", "All-rounder", "Wicket-keeper"]}
              active={role}
              onPick={(v) => update({ role: v === "All" ? null : v })}
            />
            <FilterGroup
              title="Bowling style"
              items={["All", "Spin", "Pace"]}
              active={style}
              onPick={(v) => update({ style: v === "All" ? null : v })}
            />
            <FilterGroup
              title="Seasons played"
              items={["All", "0", "1+", "5+", "10+", "15+"]}
              active={
                minSeasons == null
                  ? "All"
                  : minSeasons === 0
                  ? "0"
                  : `${minSeasons}+`
              }
              onPick={(v) => {
                if (v === "All") {
                  update({ min: null });
                } else if (v === "0") {
                  update({ min: "0" });
                } else {
                  update({ min: String(Number(v.replace("+", ""))) });
                }
              }}
            />
          </div>
        </aside>

        <Card
          kicker={
            state.status === "success"
              ? `${filtered.length} PLAYERS${
                  totalRows > PAGE_SIZE ? ` · PAGE ${page} / ${totalPages}` : ""
                }`
              : "LOADING"
          }
          title="Career stats · sortable"
          padded={false}
          action={
            <span className="inline-flex items-center gap-1.5">
              <span className="text-ipl-soft">Sort by</span>
              <span className="text-ipl-ink font-medium">{SORT_LABEL[sortKey]}</span>
              <span className="text-[9px] text-ipl-sub">
                {sortDir === "desc" ? "▼" : "▲"}
              </span>
            </span>
          }
        >
          {state.status === "loading" && (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-ipl-sub text-sm">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-ipl-soft animate-pulse" />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-ipl-soft animate-pulse"
                  style={{ animationDelay: "120ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-ipl-soft animate-pulse"
                  style={{ animationDelay: "240ms" }}
                />
              </span>
              <span>Loading career stats…</span>
            </div>
          )}
          {state.status === "error" && (
            <pre className="p-6 text-ipl-neg text-xs whitespace-pre-wrap">{state.error.message}</pre>
          )}
          {state.status === "success" && sorted.length === 0 && (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-center">
              <div className="text-[28px] text-ipl-soft leading-none">⌀</div>
              <div className="text-ipl-ink text-sm font-medium">No matching players</div>
              <div className="text-ipl-sub text-xs max-w-[28ch]">
                Try removing a filter — or use the chip strip at the top to clear individual ones.
              </div>
            </div>
          )}
          {state.status === "success" && sorted.length > 0 && (
            <>
              <PlayersTable
                rows={pageRows}
                onSort={onSort}
                sortKey={sortKey}
                sortDir={sortDir}
                teamsByPlayer={teamsByPlayer}
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                pageStart={pageStart}
                pageSize={PAGE_SIZE}
                total={totalRows}
                onPage={(n) => update({ page: n === 1 ? null : String(n) })}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

const SORT_LABEL: Record<SortKey, string> = {
  runs: "Runs",
  bat_avg: "Bat avg",
  bat_sr: "SR",
  wkts: "Wkts",
  bowl_avg: "Bowl avg",
  bowl_econ: "Econ",
  mat: "Matches",
  player: "Name",
  peak: "Peak season",
};

// Sentinels keep "no data" rows from being treated as the best on a desc
// sort (rows with no average shouldn't appear at the top of "Bat avg ↓").
const ASC_NULL = Number.POSITIVE_INFINITY;
const DESC_NULL = Number.NEGATIVE_INFINITY;
function nullify(v: number | null, dir: SortDir): number {
  if (v != null) return v;
  return dir === "asc" ? ASC_NULL : DESC_NULL;
}

function cmp(
  a: Row,
  b: Row,
  key: SortKey,
  dir: SortDir,
  resolve: (s: string | null | undefined) => string,
): number {
  let av: number | string = 0;
  let bv: number | string = 0;
  switch (key) {
    case "runs":      av = a.runs; bv = b.runs; break;
    case "wkts":      av = a.wkts; bv = b.wkts; break;
    case "mat":       av = a.mat;  bv = b.mat;  break;
    case "peak":      av = a.peak_year ?? 0; bv = b.peak_year ?? 0; break;
    case "player":    av = resolve(a.player); bv = resolve(b.player); break;
    case "bat_avg":   av = nullify(batAvg(a), dir);   bv = nullify(batAvg(b), dir); break;
    case "bat_sr":    av = nullify(batSR(a), dir);    bv = nullify(batSR(b), dir); break;
    case "bowl_avg":  av = nullify(bowlAvg(a), dir);  bv = nullify(bowlAvg(b), dir); break;
    case "bowl_econ": av = nullify(bowlEcon(a), dir); bv = nullify(bowlEcon(b), dir); break;
  }
  if (typeof av === "string") {
    const r = av.localeCompare(bv as string);
    return dir === "asc" ? r : -r;
  }
  return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
}

/**
 * Sidebar "Active filters" card — surfaces every applied filter as a
 * dismissible chip and a single "Clear all" link. Rendered above the
 * FilterGroups so the user always sees what's narrowing the result set
 * before they scroll past the controls. Returns null when nothing is
 * active so the card doesn't take up dead space on the default view.
 */
function ActiveFiltersCard({
  team,
  role,
  style,
  minSeasons,
  status,
  nationality,
  country,
  search,
  teamScope,
  onClear,
}: {
  team: string;
  role: string;
  style: string;
  minSeasons: number | null;
  status: string;
  nationality: string;
  country: string;
  search: string;
  teamScope: TeamScope;
  onClear: (key: "team" | "role" | "style" | "min" | "status" | "nat" | "country" | "q" | "tscope" | "all") => void;
}) {
  const chips: { key: Parameters<typeof onClear>[0]; label: string; tone?: "ink" }[] = [];
  if (search.trim()) chips.push({ key: "q", label: `“${search.trim()}”` });
  if (team !== "All") chips.push({ key: "team", label: teamShort(team) });
  // Only surface the scope chip when it diverges from the default ("ever").
  // The toggle inside the Team card is the primary control; this chip is a
  // visible reminder + one-click way back to the default.
  if (team !== "All" && teamScope === "now") {
    chips.push({ key: "tscope", label: "Current roster only", tone: "ink" });
  }
  if (role !== "All") chips.push({ key: "role", label: role });
  if (style !== "All") chips.push({ key: "style", label: style });
  if (minSeasons === 0) chips.push({ key: "min", label: "Never played" });
  else if (minSeasons != null && minSeasons > 0)
    chips.push({ key: "min", label: `${minSeasons}+ seasons` });
  if (status !== "All") chips.push({ key: "status", label: status, tone: "ink" });
  if (nationality !== "All") chips.push({ key: "nat", label: nationality });
  if (country !== "All") chips.push({ key: "country", label: country });
  if (chips.length === 0) return null;
  return (
    <div className="bg-ipl-surface border border-ipl-line rounded-[10px] p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] tracking-[0.1em] text-ipl-sub font-semibold uppercase">
          Active filters
        </span>
        {chips.length > 1 && (
          <button
            type="button"
            onClick={() => onClear("all")}
            className="text-[10px] text-ipl-sub hover:text-ipl-ink underline underline-offset-2 decoration-ipl-line"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key + c.label}
            type="button"
            onClick={() => onClear(c.key)}
            className="inline-flex items-center gap-1.5 text-[11px] px-2 py-[3px] rounded-full bg-ipl-line2/70 hover:bg-ipl-line2 text-ipl-ink transition-colors max-w-full"
            title="Remove filter"
          >
            <span className="truncate">{c.label}</span>
            <span className="text-ipl-soft leading-none text-[12px] shrink-0">×</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="bg-ipl-surface border border-ipl-line rounded-[10px] p-3">
      <label className="block text-[10px] tracking-[0.1em] text-ipl-sub font-semibold mb-2 uppercase">
        Search
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute left-2 top-1/2 -translate-y-1/2 text-ipl-soft pointer-events-none"
        >
          {/* Inline magnifying-glass glyph — no extra dependency, sized to the
              input. */}
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Player name…"
          className="w-full text-[12px] border border-ipl-line rounded-[6px] pl-7 pr-2 py-1.5 bg-ipl-bg text-ipl-ink placeholder:text-ipl-soft focus:outline-none focus:border-ipl-accent transition-colors"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ipl-soft hover:text-ipl-ink text-[14px] leading-none px-1"
            title="Clear search"
            aria-label="Clear search"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Two-state segmented control inside the Team filter card. Default is
 * `ever` (a player matches if any past franchise lines up), `now` narrows
 * to the current roster. The hint line below the toggle paraphrases the
 * active mode so the semantics are visible without clicking anything.
 */
function TeamScopeToggle({
  value,
  onChange,
}: {
  value: TeamScope;
  onChange: (next: TeamScope) => void;
}) {
  const hint =
    value === "ever"
      ? "Includes every franchise a player has appeared for."
      : "Active players show under their current team; retired players under their last.";
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="tablist"
        aria-label="Team filter scope"
        className="inline-flex items-stretch rounded-[6px] border border-ipl-line bg-ipl-bg p-[2px] text-[10.5px] font-medium select-none"
      >
        <TeamScopeOption
          label="Ever"
          active={value === "ever"}
          onClick={() => onChange("ever")}
        />
        <TeamScopeOption
          label="Currently"
          active={value === "now"}
          onClick={() => onChange("now")}
        />
      </div>
      <div className="text-[10px] text-ipl-soft leading-snug">{hint}</div>
    </div>
  );
}

function TeamScopeOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "flex-1 px-2 py-[3px] rounded-[4px] transition-colors " +
        (active
          ? "bg-ipl-line2 text-ipl-ink"
          : "text-ipl-sub hover:text-ipl-ink hover:bg-ipl-line2/40")
      }
    >
      {label}
    </button>
  );
}

function FilterGroup({
  title,
  items,
  active,
  onPick,
  valueRenderer,
  counts,
  subheader,
}: {
  title: string;
  items: string[];
  active: string;
  onPick: (v: string) => void;
  valueRenderer?: (v: string) => React.ReactNode;
  /** Optional per-item count (e.g. number of players per team). */
  counts?: Map<string, number>;
  /** Optional slot rendered between the section title and the item list. */
  subheader?: React.ReactNode;
}) {
  return (
    <div className="bg-ipl-surface border border-ipl-line rounded-[10px] py-2.5">
      <div className="text-[10px] tracking-[0.1em] text-ipl-sub font-semibold uppercase px-3 pb-1.5">
        {title}
      </div>
      {subheader ? <div className="px-3 pb-2">{subheader}</div> : null}
      <div className="flex flex-col max-h-[280px] overflow-y-auto sleek-scroll">
        {items.map((it) => {
          const isActive = it === active;
          const count = counts?.get(it);
          return (
            <button
              key={it}
              type="button"
              onClick={() => onPick(it)}
              className={
                "group relative text-[12px] text-left pl-3 pr-2 py-1.5 transition-colors flex items-center justify-between gap-2 " +
                (isActive
                  ? "text-ipl-ink bg-ipl-line2/60 font-semibold"
                  : "text-ipl-sub hover:text-ipl-ink hover:bg-ipl-line2/40 font-medium")
              }
            >
              {/* Active accent bar — only visible when this row is selected. */}
              <span
                aria-hidden="true"
                className={
                  "absolute left-0 top-0 bottom-0 w-[3px] rounded-r-sm " +
                  (isActive ? "bg-ipl-ink" : "bg-transparent")
                }
              />
              <span className="min-w-0 flex-1">
                {valueRenderer ? valueRenderer(it) : it}
              </span>
              {count != null ? (
                <span
                  className={
                    "text-[10px] tabular-nums font-mono shrink-0 " +
                    (isActive ? "text-ipl-sub" : "text-ipl-soft")
                  }
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayersTable({
  rows,
  onSort,
  sortKey,
  sortDir,
  teamsByPlayer,
}: {
  rows: Row[];
  onSort: (k: SortKey) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  teamsByPlayer: Map<string, string[]>;
}) {
  const { resolve } = usePlayerNames();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          {/* Column-group banner: separates batting / bowling stat clusters. */}
          <tr>
            <th colSpan={4} className="bg-ipl-line2/30 border-b border-ipl-line2" />
            <th
              colSpan={3}
              className="bg-ipl-line2/60 border-b border-ipl-line2 text-[9px] tracking-[0.12em] text-ipl-sub font-semibold uppercase text-center py-[3px] border-l border-r border-ipl-line2"
            >
              Batting
            </th>
            <th
              colSpan={3}
              className="bg-ipl-line2/60 border-b border-ipl-line2 text-[9px] tracking-[0.12em] text-ipl-sub font-semibold uppercase text-center py-[3px] border-r border-ipl-line2"
            >
              Bowling
            </th>
            <th colSpan={3} className="bg-ipl-line2/30 border-b border-ipl-line2" />
          </tr>
          <tr className="text-ipl-sub">
            <Th align="left"  sortable onClick={() => onSort("player")} sorted={sortKey === "player" ? sortDir : null}>Player</Th>
            <Th align="left">Team</Th>
            <Th align="left">Role</Th>
            <Th align="right" sortable onClick={() => onSort("mat")}       sorted={sortKey === "mat"       ? sortDir : null}>Mat</Th>
            <Th align="right" sortable onClick={() => onSort("runs")}      sorted={sortKey === "runs"      ? sortDir : null}>Runs</Th>
            <Th align="right" sortable onClick={() => onSort("bat_avg")}   sorted={sortKey === "bat_avg"   ? sortDir : null}>Avg</Th>
            <Th align="right" sortable onClick={() => onSort("bat_sr")}    sorted={sortKey === "bat_sr"    ? sortDir : null}>SR</Th>
            <Th align="right" sortable onClick={() => onSort("wkts")}      sorted={sortKey === "wkts"      ? sortDir : null}>Wkts</Th>
            <Th align="right" sortable onClick={() => onSort("bowl_avg")}  sorted={sortKey === "bowl_avg"  ? sortDir : null}>Avg</Th>
            <Th align="right" sortable onClick={() => onSort("bowl_econ")} sorted={sortKey === "bowl_econ" ? sortDir : null}>Econ</Th>
            <Th align="right" sortable onClick={() => onSort("peak")}      sorted={sortKey === "peak"      ? sortDir : null}>Best</Th>
            <Th align="right">Caps</Th>
            <Th align="right"><span className="sr-only">Open</span></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const teamName = r.team ? canonicalTeam(r.team) : null;
            const role = r.role ?? "—";
            const bAvg = batAvg(r);
            const bSR = batSR(r);
            const wAvg = bowlAvg(r);
            const wEcon = bowlEcon(r);
            return (
              <tr
                key={r.player}
                className="border-b border-ipl-line2 last:border-b-0 hover:bg-ipl-line2/40 group transition-colors"
              >
                <td className="pl-3 pr-2 py-2 text-ipl-ink relative">
                  <Link
                    href={`/player/${encodeURIComponent(r.player)}`}
                    className="block font-semibold group-hover:text-ipl-accent transition-colors"
                  >
                    {resolve(r.player)}
                  </Link>
                </td>
                <td className="px-2 py-2">
                  {teamName ? (
                    <span className="flex items-center gap-1.5">
                      <TeamBadge team={teamName} size={20} />
                      <span className="text-[11px] text-ipl-sub font-mono tracking-wide">
                        {teamShort(teamName)}
                      </span>
                      <TeamHistoryChip
                        all={teamsByPlayer.get(r.player) ?? []}
                        current={teamName}
                      />
                    </span>
                  ) : (
                    <span className="text-ipl-soft">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-[11px] text-ipl-sub whitespace-nowrap">
                  {role}
                  {r.bowling_kind && r.bowl_overs > 0 ? (
                    <span className="text-ipl-soft"> · {r.bowling_kind}</span>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-right font-mono text-ipl-sub tabular-nums">
                  {r.mat}
                </td>
                <td className="px-2 py-2 text-right font-mono font-semibold text-ipl-ink tabular-nums border-l border-ipl-line2/60">
                  {r.runs ? fmt(r.runs) : <DashCell />}
                </td>
                <td className="px-2 py-2 text-right font-mono text-ipl-sub tabular-nums">
                  {bAvg != null ? bAvg.toFixed(1) : <DashCell />}
                </td>
                <td className="px-2 py-2 text-right font-mono text-ipl-sub tabular-nums border-r border-ipl-line2/60">
                  {bSR != null ? bSR.toFixed(1) : <DashCell />}
                </td>
                <td className="px-2 py-2 text-right font-mono font-semibold text-ipl-ink tabular-nums">
                  {r.wkts ? r.wkts : <DashCell />}
                </td>
                <td className="px-2 py-2 text-right font-mono text-ipl-sub tabular-nums">
                  {wAvg != null ? wAvg.toFixed(1) : <DashCell />}
                </td>
                <td className="px-2 py-2 text-right font-mono text-ipl-sub tabular-nums border-r border-ipl-line2/60">
                  {wEcon != null ? wEcon.toFixed(2) : <DashCell />}
                </td>
                <td className="px-2 py-2 text-right font-mono text-ipl-soft tabular-nums">
                  {r.peak_year ? r.peak_year : "—"}
                </td>
                <td className={`px-2 py-2 whitespace-nowrap ${
                  (r.oc_count ?? 0) > 1 || (r.pc_count ?? 0) > 1 ? "text-right" : "text-center"
                }`}>
                  {r.oc_count ? <CapBadge tone="orange" count={r.oc_count} /> : null}
                  {r.pc_count ? <CapBadge tone="purple" count={r.pc_count} /> : null}
                </td>
                <td className="pl-2 pr-3 py-2 text-right text-ipl-soft group-hover:text-ipl-accent transition-colors">
                  →
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DashCell() {
  return <span className="text-ipl-soft font-medium">—</span>;
}

// Country display name → flag file path under /public/flags/. Cricket
// convention: UK is "England", every Caribbean cricket member groups as
// "West Indies" (downloaded from Wikimedia, not flagcdn — no ISO code).
// Countries missing from this map render the COUNTRY_FALLBACK chip.
// Cricketing nations shown in the Country filter dropdown. Limited to the
// 12 ICC Full Members so the list stays meaningful — Associate-member rows
// (Namibia/Nepal/etc.) and mis-mapped ones (Portugal) still appear on the
// player row but don't pollute the filter.
const CRICKETING_NATIONS: ReadonlySet<string> = new Set([
  "India", "Australia", "South Africa", "New Zealand", "England",
  "Sri Lanka", "West Indies", "Pakistan", "Afghanistan", "Bangladesh",
  "Zimbabwe", "Ireland", "Nepal",
]);

const COUNTRY_FLAG: Record<string, string> = {
  India: "flags/india.svg",
  Australia: "flags/australia.svg",
  "South Africa": "flags/south-africa.svg",
  "New Zealand": "flags/new-zealand.svg",
  England: "flags/england.svg",
  "Sri Lanka": "flags/sri-lanka.svg",
  "West Indies": "flags/west-indies.svg",
  Pakistan: "flags/pakistan.svg",
  Afghanistan: "flags/afghanistan.svg",
  Bangladesh: "flags/bangladesh.svg",
  Zimbabwe: "flags/zimbabwe.svg",
  Namibia: "flags/namibia.svg",
  Malaysia: "flags/malaysia.svg",
  Portugal: "flags/portugal.svg",
  Nepal: "flags/nepal.svg",
  Kenya: "flags/kenya.svg",
  Ireland: "flags/ireland.svg",
};

/**
 * Country flag at the requested pixel width. Renders the SVG from
 * /public/flags/ when we have one, else a small grey "?" chip so the
 * row layout doesn't collapse. The `rounded-[2px]` corner softens
 * flagcdn's hard rectangles next to the filter chrome.
 */
function CountryFlag({ country, size = 18 }: { country: string; size?: number }) {
  const path = COUNTRY_FLAG[country];
  if (!path) {
    return (
      <span
        className="inline-flex items-center justify-center bg-ipl-line2 text-ipl-soft font-mono shrink-0 rounded-[2px]"
        style={{ width: size * 1.5, height: size, fontSize: Math.max(8, size * 0.55) }}
        aria-label={country}
      >
        ?
      </span>
    );
  }
  /* eslint-disable @next/next/no-img-element */
  return (
    <img
      src={`/${path}`}
      alt={country}
      width={size * 1.5}
      height={size}
      className="object-cover shrink-0 rounded-[2px] border border-ipl-line/40"
      style={{ width: size * 1.5, height: size }}
    />
  );
  /* eslint-enable @next/next/no-img-element */
}

/**
 * "+N" past-franchises chip rendered next to the current-team badge. Click
 * (or tap) toggles a portal-anchored popover listing every past franchise
 * the player has appeared for, oldest → newest. Portaled so the popover
 * isn't clipped by the table's horizontal-scroll wrapper; closes on
 * outside-click, Esc, and any scroll/resize (position is fixed and would
 * go stale otherwise).
 */
function TeamHistoryChip({ all, current }: { all: string[]; current: string }) {
  const past = useMemo(() => all.filter((t) => t !== current), [all, current]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  if (past.length === 0) return null;

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(true);
  }

  const tooltip = `Also played for: ${past.map((t) => teamShort(t)).join(" · ")}`;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={tooltip}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tooltip}
        className={
          "text-[9.5px] font-mono leading-none px-1.5 py-[3px] rounded-full border transition-colors cursor-pointer tabular-nums " +
          (open
            ? "bg-ipl-line2 text-ipl-ink border-ipl-line"
            : "bg-ipl-line2/50 text-ipl-sub border-transparent hover:bg-ipl-line2 hover:text-ipl-ink")
        }
      >
        +{past.length}
      </button>
      {open && pos != null && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }}
              className="min-w-[160px] bg-ipl-surface border border-ipl-line rounded-md shadow-lg p-2"
            >
              <div className="text-[9px] uppercase tracking-[0.08em] text-ipl-sub font-semibold mb-1.5 pb-1 border-b border-ipl-line2">
                Also played for
              </div>
              <ul className="flex flex-col gap-1.5">
                {past.map((t) => (
                  <li key={t} className="flex items-center gap-1.5 text-[11px]">
                    <TeamBadge team={t} size={14} />
                    <span className="text-ipl-ink whitespace-nowrap">{teamShort(t)}</span>
                    <span className="text-ipl-soft truncate">{t}</span>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Th({
  children,
  align = "left",
  sortable,
  sorted,
  onClick,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  sorted?: SortDir | null;
  onClick?: () => void;
}) {
  const base =
    "px-2.5 py-2 text-[10px] tracking-[0.06em] uppercase border-b border-ipl-line font-medium select-none ";
  const alignCls = align === "right" ? "text-right" : "text-left";
  const activeCls = sorted ? "text-ipl-ink " : "";
  if (!sortable) {
    return <th className={base + alignCls + activeCls}>{children}</th>;
  }
  return (
    <th
      className={base + alignCls + activeCls + " cursor-pointer hover:text-ipl-ink transition-colors"}
      onClick={onClick}
    >
      <span
        className={
          "inline-flex items-center gap-1 " +
          (align === "right" ? "flex-row-reverse" : "")
        }
      >
        {children}
        {/* Triangle-glyph sort indicator. Always-rendered (invisible when
            inactive) so the column header doesn't jump on sort change. */}
        <span
          aria-hidden="true"
          className={
            "text-[8px] leading-none " +
            (sorted ? "text-ipl-ink" : "text-transparent")
          }
        >
          {sorted === "asc" ? "▲" : "▼"}
        </span>
      </span>
    </th>
  );
}

function CapBadge({ tone, count }: { tone: "orange" | "purple"; count: number }) {
  // Literal hex fallback (mirrored from globals.css) — inline `var(--color-…)`
  // sometimes fails to resolve on Tailwind v4 page hot-reload.
  const bg = tone === "orange" ? "#f59e0b" : "#7c3aed";
  const initial = tone === "orange" ? "O" : "P";
  const label = tone === "orange" ? "Orange Cap" : "Purple Cap";
  return (
    <span
      className="inline-flex items-center gap-1 align-middle ml-1 text-[10px] font-mono"
      title={`${label} · ${count} ${count === 1 ? "win" : "wins"}`}
    >
      <span
        className="font-bold rounded-[3px] px-1.5 py-[1px] leading-none"
        style={{ backgroundColor: bg, color: "#ffffff" }}
      >
        {initial}
      </span>
      {count > 1 ? (
        <span className="text-ipl-sub tabular-nums">×{count}</span>
      ) : null}
    </span>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function Pagination({
  page,
  totalPages,
  pageStart,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  pageStart: number;
  pageSize: number;
  total: number;
  onPage: (n: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <div className="px-3.5 py-3 text-[11px] text-ipl-sub border-t border-ipl-line2 flex justify-between items-center">
        <span>
          Showing <span className="font-mono text-ipl-ink">{total}</span> of{" "}
          <span className="font-mono text-ipl-ink">{total}</span> players
        </span>
      </div>
    );
  }
  const from = pageStart + 1;
  const to = Math.min(pageStart + pageSize, total);
  return (
    <div className="px-3.5 py-3 border-t border-ipl-line2 flex justify-between items-center text-[11px] text-ipl-sub gap-3 flex-wrap">
      <span>
        Showing{" "}
        <span className="font-mono text-ipl-ink">
          {from}–{to}
        </span>{" "}
        of <span className="font-mono text-ipl-ink">{total}</span> players
      </span>
      <div className="flex items-center gap-1">
        <PageBtn label="« First" disabled={page === 1} onClick={() => onPage(1)} />
        <PageBtn label="‹ Prev" disabled={page === 1} onClick={() => onPage(page - 1)} />
        <span className="px-2 text-ipl-ink font-mono">
          Page {page} of {totalPages}
        </span>
        <PageBtn
          label="Next ›"
          disabled={page === totalPages}
          onClick={() => onPage(page + 1)}
        />
        <PageBtn
          label="Last »"
          disabled={page === totalPages}
          onClick={() => onPage(totalPages)}
        />
      </div>
    </div>
  );
}

function PageBtn({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-2 py-1 rounded-[5px] border border-ipl-line bg-ipl-surface " +
        (disabled
          ? "text-ipl-soft cursor-not-allowed opacity-60"
          : "text-ipl-ink hover:bg-ipl-line2/60")
      }
    >
      {label}
    </button>
  );
}
