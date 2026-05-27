"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { canonicalTeam, teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { Card } from "@/components/card";

type AllTimeBatRow = { batter: string; team: string; runs: number };
type AllTimeBowlRow = { bowler: string; team: string; wickets: number };
type MatchesPerSeasonRow = { season: number; n: number };
type TopperRow = { season: number; team: string };
type FinalRow = {
  season: number;
  team_1: string;
  team_2: string;
  winner: string | null;
};
type Kpis = {
  matches: number;
  runs: number;
  sixes: number;
  players: number;
};

type SeasonCard = {
  season: number;
  matches: number;
  champion: string | null;
  runner_up: string | null;
  /** Team that finished first in the points table that season. */
  topper: string | null;
};

export function LandingContent() {
  const matchesQ = useDuckQuery<MatchesPerSeasonRow>(
    `SELECT CAST(season AS BIGINT) AS season,
            CAST(COUNT(*) AS BIGINT) AS n
     FROM matches GROUP BY season ORDER BY season`,
  );

  const topperQ = useDuckQuery<TopperRow>(
    `SELECT CAST(season AS BIGINT) AS season, team
     FROM points_table
     WHERE position = 1`,
  );

  const finalsQ = useDuckQuery<FinalRow>(
    `SELECT CAST(season AS BIGINT) AS season,
            team_1, team_2, winner
     FROM matches
     WHERE match_stage = 'Final'`,
  );

  // All-time career totals. `arg_max(team, season)` picks the player's most
  // recent franchise so the badge color tracks their current identity rather
  // than where they happened to debut.
  const topBattersQ = useDuckQuery<AllTimeBatRow>(
    `SELECT batter,
            arg_max(team, season) AS team,
            CAST(SUM(runs) AS BIGINT) AS runs
     FROM batting_scorecard
     WHERE batter IS NOT NULL
     GROUP BY batter
     ORDER BY runs DESC
     LIMIT 5`,
  );

  const topBowlersQ = useDuckQuery<AllTimeBowlRow>(
    `SELECT bowler,
            arg_max(team, season) AS team,
            CAST(SUM(wickets) AS BIGINT) AS wickets
     FROM bowling_scorecard
     WHERE bowler IS NOT NULL
     GROUP BY bowler
     ORDER BY wickets DESC
     LIMIT 5`,
  );

  const kpiQ = useDuckQuery<Kpis>(
    `SELECT
        (SELECT CAST(COUNT(*)              AS BIGINT) FROM matches)                AS matches,
        (SELECT CAST(SUM(total_runs)       AS BIGINT) FROM ball_by_ball)           AS runs,
        (SELECT CAST(SUM(sixes)            AS BIGINT) FROM batting_scorecard)      AS sixes,
        (SELECT CAST(COUNT(DISTINCT player) AS BIGINT) FROM players)               AS players`,
  );

  // Stitch the three per-season queries into one per-row object, indexed by
  // descending season so the typographic roll reads newest → oldest.
  const seasonCards = useMemo<SeasonCard[]>(() => {
    if (
      matchesQ.status !== "success" ||
      topperQ.status !== "success" ||
      finalsQ.status !== "success"
    )
      return [];
    const matchesBy = new Map(matchesQ.data.map((r) => [r.season, r.n]));
    const topperBy = new Map(topperQ.data.map((r) => [r.season, r.team]));
    const finalsBy = new Map<number, FinalRow>();
    for (const f of finalsQ.data) finalsBy.set(f.season, f);
    const seasons = Array.from(matchesBy.keys()).sort((a, b) => b - a);
    return seasons.map((season) => {
      const final = finalsBy.get(season);
      let champion: string | null = null;
      let runner_up: string | null = null;
      if (final && final.winner) {
        champion = final.winner;
        runner_up =
          canonicalTeam(final.winner) === canonicalTeam(final.team_1)
            ? final.team_2
            : final.team_1;
      }
      return {
        season,
        matches: matchesBy.get(season) ?? 0,
        champion,
        runner_up,
        topper: topperBy.get(season) ?? null,
      };
    });
  }, [matchesQ, topperQ, finalsQ]);

  // Dynasty count: most championships across all seasons.
  const dynasties = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of seasonCards) {
      if (!c.champion) continue;
      const t = canonicalTeam(c.champion);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [seasonCards]);

  const kpis = kpiQ.status === "success" ? kpiQ.data[0] : null;
  const totalSeasons = seasonCards.length || 19;

  return (
    <div className="px-6 lg:px-12 py-7">
      {/* Hero header */}
      <div className="flex items-end justify-between flex-wrap gap-6 mb-6">
        <div>
          <div className="text-[11px] tracking-[0.15em] text-ipl-sub font-semibold uppercase mb-2">
            openIPL · Champions Wall
          </div>
          <h1 className="font-semibold tracking-[-2.4px] leading-[1.0] text-ipl-ink text-[64px]">
            <span className="font-mono text-ipl-accent">{totalSeasons}</span>{" "}
            seasons.
            <br />
            <span className="font-serif italic font-normal">One archive.</span>
          </h1>
        </div>
        <KpiQuadrant kpis={kpis} />
      </div>

      {/* Two-column body — both columns share a fixed height so the champion
          roll and the right-side cards bottom out on the same line. */}
      <div className="grid gap-6" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        {/* Champion typographic roll — scrolls so every season stays reachable. */}
        <div className="flex flex-col h-[720px]">
          <ChampHeader />
          <div className="flex-1 min-h-0 overflow-y-auto sleek-scroll border-b border-ipl-line">
            {seasonCards.map((s) => (
              <ChampRow key={s.season} season={s} />
            ))}
          </div>
        </div>

        {/* Right column — caps at the same 660px and scrolls internally if
            the leaders + dynasties cards overflow. */}
        <div className="flex flex-col gap-3.5 h-[720px] overflow-y-auto sleek-scroll">
          <Card kicker="DYNASTIES" title="Most championships" padded>
            <div className="flex flex-col gap-2">
              {dynasties.length === 0 && <Empty />}
              {dynasties.map(([team, count]) => (
                <Link
                  key={team}
                  href={`/h2h?team1=${encodeURIComponent(team)}`}
                  className="flex items-center gap-2.5 hover:bg-ipl-line2/40 rounded-md px-1 py-1.5 -mx-1"
                >
                  <TeamBadge team={team} size={22} />
                  <span className="text-[13px] font-semibold text-ipl-ink flex-1 truncate">
                    {team}
                  </span>
                  <span className="flex gap-0.5">
                    {Array.from({ length: count }).map((_, i) => (
                      <Trophy key={i} />
                    ))}
                  </span>
                  <span className="font-mono text-[13px] font-semibold w-4 text-right">
                    {count}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
          <Card kicker="ALL-TIME LEADERS" title="19 seasons combined" padded>
            <LeaderSection
              label="Most career runs"
              rows={
                topBattersQ.status === "success"
                  ? topBattersQ.data.map((r) => ({
                      key: r.batter,
                      team: r.team,
                      value: r.runs,
                      suffix: " runs",
                    }))
                  : []
              }
              loading={topBattersQ.status === "loading"}
            />
            <div className="mt-3.5">
              <LeaderSection
                label="Most career wickets"
                rows={
                  topBowlersQ.status === "success"
                    ? topBowlersQ.data.map((r) => ({
                        key: r.bowler,
                        team: r.team,
                        value: r.wickets,
                        suffix: " wkts",
                      }))
                    : []
                }
                loading={topBowlersQ.status === "loading"}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── Champion roll row ───────────────────────────────────────────────── */

const ROW_COLS = "90px 1fr 1fr 110px";

function ChampHeader() {
  return (
    <div
      className="grid items-center gap-4 px-0 py-2 border-t border-b border-ipl-line text-[10px] uppercase tracking-[0.1em] text-ipl-sub font-semibold"
      style={{ gridTemplateColumns: ROW_COLS }}
    >
      <span>Season</span>
      <span>Champion</span>
      <span>Table topper</span>
      <span className="text-right">Matches</span>
    </div>
  );
}

function ChampRow({ season }: { season: SeasonCard }) {
  return (
    <Link
      href={`/season/${season.season}/overview`}
      className="grid items-center gap-4 py-2 border-b border-ipl-line2 last:border-b-0 text-ipl-ink hover:bg-ipl-line2/40 transition-colors"
      style={{ gridTemplateColumns: ROW_COLS }}
    >
      <div className="font-mono font-semibold tracking-[-0.6px] text-[22px]">
        {season.season}
      </div>
      <div className="flex items-center gap-2.5 min-w-0">
        {season.champion ? (
          <>
            <TeamBadge team={season.champion} size={24} />
            <div className="min-w-0 leading-tight">
              <div className="text-[13px] font-semibold whitespace-nowrap">
                {season.champion}
              </div>
              {season.runner_up && (
                <div className="text-[10px] text-ipl-sub whitespace-nowrap">
                  beat {season.runner_up}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-ipl-accent">
              Season in progress
            </div>
            <div className="text-[10px] text-ipl-sub">
              {season.matches} of 74 played
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5 min-w-0">
        {season.topper ? (
          <>
            <TeamBadge team={season.topper} size={22} />
            <span className="text-[13px] font-semibold whitespace-nowrap">
              {season.topper}
            </span>
          </>
        ) : (
          <span className="text-[11px] text-ipl-soft">—</span>
        )}
      </div>
      <div className="font-mono text-[12px] text-ipl-sub text-right">
        {season.matches} matches
      </div>
    </Link>
  );
}

/* ── KPI quadrant ────────────────────────────────────────────────────── */

function KpiQuadrant({ kpis }: { kpis: Kpis | null }) {
  // 2×2 grid; transparent ground, hairline dividers in the middle. Each cell
  // is a label (top-left, small) + value (bottom-aligned, mono).
  return (
    <div className="border border-ipl-line rounded-[10px] overflow-hidden shrink-0 w-[260px]">
      <div className="grid grid-cols-2 grid-rows-2 divide-x divide-y divide-ipl-line2">
        <KpiCell label="Matches" value={kpis?.matches} />
        <KpiCell label="Runs"    value={kpis?.runs} format="short" />
        <KpiCell label="Sixes"   value={kpis?.sixes} />
        <KpiCell label="Players" value={kpis?.players} />
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null | undefined;
  format?: "short";
}) {
  const formatted =
    value == null
      ? "—"
      : format === "short"
        ? shortNumber(value)
        : value.toLocaleString();
  return (
    <div className="p-3 flex flex-col justify-between min-h-[80px]">
      <div className="text-[10px] tracking-[0.1em] text-ipl-sub font-semibold uppercase">
        {label}
      </div>
      <div className="font-mono font-semibold leading-none tracking-[-1px] text-[24px] text-ipl-ink">
        {formatted}
      </div>
    </div>
  );
}

function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return n.toLocaleString();
}

/* ── Leaders mini-leaderboards ───────────────────────────────────────── */

type LeaderEntry = {
  key: string;
  team: string;
  value: number;
  suffix: string;
};

function LeaderSection({
  label,
  rows,
  loading,
}: {
  label: string;
  rows: LeaderEntry[];
  loading: boolean;
}) {
  const { resolve } = usePlayerNames();
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold mb-1.5">
        {label}
      </div>
      {loading && (
        <div className="text-[11px] text-ipl-sub">Loading…</div>
      )}
      {!loading && rows.length === 0 && (
        <div className="text-[11px] text-ipl-sub">No data yet.</div>
      )}
      {!loading && rows.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <li key={r.key}>
              <Link
                href={`/player/${encodeURIComponent(r.key)}`}
                className="flex items-center gap-2 text-[12px] -mx-1 px-1 py-0.5 rounded hover:bg-ipl-line2/40"
              >
                <span className="font-mono w-4 text-ipl-sub">{i + 1}</span>
                <TeamBadge team={r.team} size={18} />
                <span className="flex-1 font-semibold text-ipl-ink truncate">
                  {resolve(r.key)}
                </span>
                <span className="font-mono font-semibold whitespace-nowrap">
                  {r.value.toLocaleString()}
                  <span className="text-ipl-sub font-medium">{r.suffix}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ── Trophy + empty ──────────────────────────────────────────────────── */

function Trophy() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M4 2 H10 V6 Q10 8.5 7 8.5 Q4 8.5 4 6 Z"
        stroke="#c5a253"
        strokeWidth="1.2"
        fill="#c5a25330"
      />
      <path d="M4 3 L2 3 Q2 5 4 5.5" stroke="#c5a253" strokeWidth="1.2" fill="none" />
      <path d="M10 3 L12 3 Q12 5 10 5.5" stroke="#c5a253" strokeWidth="1.2" fill="none" />
      <rect x="6" y="8.5" width="2" height="2.5" fill="#c5a253" />
      <rect x="4.5" y="11" width="5" height="1.2" rx="0.4" fill="#c5a253" />
    </svg>
  );
}

function Empty() {
  return <div className="text-ipl-sub text-sm">Loading champions…</div>;
}
