"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { canonicalTeam, teamColor, teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { SeasonProvider } from "@/components/season-context";
import { PlayerLink } from "@/components/player-link";
import { Card } from "@/components/card";
import { WormChart, type WormSeries } from "@/components/charts/worm-chart";
import { ManhattanChart } from "@/components/charts/manhattan-chart";
import {
  PartnershipRibbons,
  type PartnershipRow as RibbonRow,
} from "@/components/charts/partnership-ribbons";

/* ── Types ─────────────────────────────────────────────────────────────── */

type MatchInfo = {
  cricsheet_match_id: number;
  match_number: number;
  season: number;
  date: string;
  venue: string;
  team_1: string;
  team_2: string;
  toss_winner: string | null;
  toss_decision: string | null;
  winner: string | null;
  result: string | null;
  win_by_runs: number | null;
  win_by_wickets: number | null;
  player_of_match: string | null;
  team_1_score: string | null;
  team_2_score: string | null;
  team_1_overs: number | null;
  team_2_overs: number | null;
  match_stage: string | null;
};

type OverRow = {
  innings: number;
  team: string;
  over: number;
  over_runs: number;
  wkts: number;
};

type FOWRow = {
  innings: number;
  team: string;
  wicket_number: number;
  player_out: string;
  score: number;
  over: string;
};

type PartnershipRaw = {
  innings: number;
  team: string;
  wicket_number: number;
  batter_1: string;
  batter_1_runs: number;
  batter_1_balls: number;
  batter_2: string;
  batter_2_runs: number;
  batter_2_balls: number;
  total_runs: number;
  total_balls: number;
};

type ReviewRow = {
  team: string;
  decision: string;
};

type PomBatRow = {
  batter: string;
  team: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strike_rate: number;
  dismissal: string | null;
  batting_position: number;
};

type PomBowlRow = {
  bowler: string;
  team: string;
  overs: number;
  runs: number;
  wickets: number;
  economy: number;
};

/* ── Main ──────────────────────────────────────────────────────────────── */

export function MatchContent({ rawId }: { rawId: string }) {
  // cricsheet_match_id is stored as BIGINT in the parquet, but the URL slug
  // arrives as a string. Reject anything that isn't a clean integer up-front
  // so we don't blow up DuckDB with a CAST error on stale links like "2025-74".
  const idNum = /^\d+$/.test(rawId) ? Number(rawId) : null;

  const matchQ = useDuckQuery<MatchInfo>(
    idNum != null
      ? `SELECT * FROM matches WHERE cricsheet_match_id = ${idNum} LIMIT 1`
      : `SELECT * FROM matches WHERE FALSE`,
  );

  const m =
    matchQ.status === "success" && matchQ.data.length > 0
      ? matchQ.data[0]
      : null;
  const ready = !!m;
  const season = m?.season ?? 0;
  const mn = m?.match_number ?? 0;
  const matchKey = ready ? `season = ${season} AND match_number = ${mn}` : "1=0";

  if (idNum == null) return <NotFound id={rawId} />;
  if (matchQ.status === "loading") return <PageLoader />;
  if (matchQ.status === "error")
    return <ErrorBlock message={matchQ.error.message} />;
  if (!m) return <NotFound id={rawId} />;

  return (
    <SeasonProvider season={m.season}>
      <div>
        <ScoreHeader m={m} />
        <div
          className="grid gap-3.5 mt-3"
          style={{ gridTemplateColumns: "1.4fr 1fr" }}
        >
          <WormCard m={m} matchKey={matchKey} />
          <div className="flex flex-col gap-3.5">
            <FowCard m={m} matchKey={matchKey} />
            <PomCard m={m} matchKey={matchKey} />
          </div>
        </div>
        <div
          className="grid gap-3.5 mt-3.5"
          style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}
        >
          <PartnershipsCard m={m} matchKey={matchKey} />
          <ManhattanCard m={m} matchKey={matchKey} />
          <DrsCard m={m} matchKey={matchKey} />
        </div>
      </div>
    </SeasonProvider>
  );
}

/* ── Score header ──────────────────────────────────────────────────────── */

function ScoreHeader({ m }: { m: MatchInfo }) {
  const winner = m.winner ?? "";
  const margin = m.win_by_runs
    ? `${m.win_by_runs} run${m.win_by_runs === 1 ? "" : "s"}`
    : m.win_by_wickets
      ? `${m.win_by_wickets} wkt${m.win_by_wickets === 1 ? "" : "s"}`
      : "—";
  const date = formatDate(m.date);
  return (
    <div className="bg-ipl-surface border border-ipl-line rounded-[12px] p-4">
      <div className="flex justify-between items-center mb-3 text-[11px] text-ipl-sub">
        <span>
          {m.match_stage && m.match_stage !== "league" ? `${m.match_stage} · ` : ""}
          Match {m.match_number} · {m.venue} · {date}
        </span>
        {winner && (
          <span>
            <span className="text-ipl-pos font-bold">{teamShort(winner)}</span>
            {" "}won by {margin}
          </span>
        )}
      </div>
      <div
        className="grid items-center gap-3"
        style={{ gridTemplateColumns: "1fr 60px 1fr" }}
      >
        <ScoreSide
          team={m.team_1}
          score={m.team_1_score ?? ""}
          overs={m.team_1_overs ?? 0}
          winner={canonicalTeam(winner) === canonicalTeam(m.team_1)}
        />
        <div className="font-mono text-center text-[12px] text-ipl-sub font-semibold">
          vs
        </div>
        <ScoreSide
          team={m.team_2}
          score={m.team_2_score ?? ""}
          overs={m.team_2_overs ?? 0}
          winner={canonicalTeam(winner) === canonicalTeam(m.team_2)}
          right
        />
      </div>
    </div>
  );
}

function ScoreSide({
  team,
  score,
  overs,
  winner,
  right,
}: {
  team: string;
  score: string;
  overs: number;
  winner: boolean;
  right?: boolean;
}) {
  const [runs, wkts] = (score || "—/—").split("/");
  const rpo = overs > 0 ? (Number(runs) / overs).toFixed(2) : "—";
  return (
    <div
      className={
        "flex items-center gap-3.5 " + (right ? "flex-row-reverse" : "flex-row")
      }
    >
      <TeamBadge team={team} size={48} />
      <div className={"flex-1 " + (right ? "text-right" : "text-left")}>
        <div
          className={
            "flex items-center gap-1.5 " + (right ? "justify-end" : "justify-start")
          }
        >
          <span className="text-[15px] font-bold text-ipl-ink">{team}</span>
          {winner && <Trophy />}
        </div>
        <div className="font-mono text-[44px] font-semibold leading-none tracking-[-0.04em]">
          {runs}
          <span className="text-ipl-sub font-medium">/{wkts}</span>
        </div>
        <div className="text-[11px] text-ipl-sub mt-1">
          <span className="font-mono">{overs.toFixed(1)} ov</span>
          {" · "}
          <span className="font-mono">{rpo} rpo</span>
        </div>
      </div>
    </div>
  );
}

function Trophy() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
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

/* ── Worm chart ────────────────────────────────────────────────────────── */

function WormCard({ m, matchKey }: { m: MatchInfo; matchKey: string }) {
  const q = useDuckQuery<OverRow>(
    `SELECT CAST(innings AS BIGINT) AS innings, team,
            CAST(over AS BIGINT) AS over,
            CAST(SUM(total_runs) AS BIGINT) AS over_runs,
            CAST(SUM(CASE WHEN is_wicket THEN 1 ELSE 0 END) AS BIGINT) AS wkts
     FROM ball_by_ball
     WHERE ${matchKey} AND over BETWEEN 1 AND 20
     GROUP BY innings, team, over
     ORDER BY innings, over`,
  );

  const series = useMemo(() => {
    if (q.status !== "success") return null;
    const byInnings = new Map<number, OverRow[]>();
    for (const r of q.data) {
      const arr = byInnings.get(r.innings) ?? [];
      arr.push(r);
      byInnings.set(r.innings, arr);
    }
    function build(innings: number, color: string, label: string): WormSeries {
      const rows = byInnings.get(innings) ?? [];
      const cumulative: number[] = [0];
      const wicketAtOvers: number[] = [];
      let total = 0;
      for (const r of rows) {
        total += r.over_runs;
        cumulative.push(total);
        if (r.wkts > 0) wicketAtOvers.push(r.over);
      }
      return { cumulative, wicketAtOvers, color, label };
    }
    return {
      a: build(1, teamColor(m.team_1), m.team_1),
      b: build(2, teamColor(m.team_2), m.team_2),
    };
  }, [q, m.team_1, m.team_2]);

  return (
    <Card
      kicker="WORM · CUMULATIVE RUNS"
      title={`${teamShort(m.team_1)} ${m.team_1_score ?? ""}  vs  ${teamShort(m.team_2)} ${m.team_2_score ?? ""}`}
      padded
    >
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorBlock message={q.error.message} />}
      {q.status === "success" && series && (
        <>
          <WormChart a={series.a} b={series.b} height={240} />
          <div className="flex gap-4 text-[11px] text-ipl-sub mt-2">
            <LegendDot color={series.a.color} label={`${teamShort(m.team_1)} · ${m.team_1_score ?? ""} in ${(m.team_1_overs ?? 0).toFixed(1)}`} />
            <LegendDot color={series.b.color} label={`${teamShort(m.team_2)} · ${m.team_2_score ?? ""} in ${(m.team_2_overs ?? 0).toFixed(1)}`} />
            <span className="ml-auto">○ = wicket</span>
          </div>
        </>
      )}
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-3 h-[3px] rounded-[1px]"
        style={{ background: color }}
      />
      <span>{label}</span>
    </span>
  );
}

/* ── Fall of wickets ───────────────────────────────────────────────────── */

function FowCard({ m, matchKey }: { m: MatchInfo; matchKey: string }) {
  const q = useDuckQuery<FOWRow>(
    `SELECT CAST(innings AS BIGINT) AS innings,
            team,
            CAST(wicket_number AS BIGINT) AS wicket_number,
            player_out,
            CAST(score AS BIGINT) AS score,
            CAST(over AS VARCHAR) AS over
     FROM fall_of_wickets
     WHERE ${matchKey}
     ORDER BY innings, wicket_number`,
  );
  const { resolve } = usePlayerNames();
  const winnerCanon = canonicalTeam(m.winner ?? "");
  const focusInnings = useMemo<FOWRow[]>(() => {
    if (q.status !== "success") return [];
    // Show the winning team's batting innings if available; otherwise innings 1.
    const winnerRows = q.data.filter((r) => canonicalTeam(r.team) === winnerCanon);
    if (winnerRows.length > 0) return winnerRows;
    return q.data.filter((r) => r.innings === 1);
  }, [q, winnerCanon]);

  const focusTeam = focusInnings[0]?.team ?? m.winner ?? m.team_1;

  return (
    <Card kicker="FALL OF WICKETS" title={`${teamShort(focusTeam)} innings`} padded>
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorBlock message={q.error.message} />}
      {q.status === "success" && focusInnings.length === 0 && (
        <div className="text-ipl-sub text-sm">No wickets fell.</div>
      )}
      {q.status === "success" && focusInnings.length > 0 && (
        <table className="w-full text-[11px] border-collapse">
          <tbody>
            {focusInnings.map((r) => (
              <tr
                key={r.wicket_number}
                className="border-b border-ipl-line2 last:border-b-0"
              >
                <td className="py-1.5 font-mono text-ipl-sub w-[22px]">
                  {r.wicket_number}
                </td>
                <td className="py-1.5 font-mono font-semibold w-[60px]">
                  {r.score}
                  <span className="text-ipl-sub font-medium">
                    /{r.wicket_number}
                  </span>
                </td>
                <td className="py-1.5 font-mono text-ipl-sub w-[50px]">
                  {r.over} ov
                </td>
                <td className="py-1.5 text-ipl-sub truncate">
                  <PlayerLink name={r.player_out} className="hover:text-ipl-accent text-ipl-ink">
                    {resolve(r.player_out)}
                  </PlayerLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ── Player of the match ───────────────────────────────────────────────── */

function PomCard({ m, matchKey }: { m: MatchInfo; matchKey: string }) {
  const pom = m.player_of_match;
  const batQ = useDuckQuery<PomBatRow>(
    pom
      ? `SELECT batter, team,
                CAST(runs AS BIGINT) AS runs,
                CAST(balls AS BIGINT) AS balls,
                CAST(fours AS BIGINT) AS fours,
                CAST(sixes AS BIGINT) AS sixes,
                CAST(strike_rate AS DOUBLE) AS strike_rate,
                dismissal,
                CAST(batting_position AS BIGINT) AS batting_position
         FROM batting_scorecard
         WHERE ${matchKey} AND batter = '${sqlEscape(pom)}'
         LIMIT 1`
      : `SELECT NULL AS batter, NULL AS team, 0 AS runs, 0 AS balls, 0 AS fours, 0 AS sixes,
                CAST(0 AS DOUBLE) AS strike_rate, NULL AS dismissal, 0 AS batting_position
         WHERE FALSE`,
  );
  const bowlQ = useDuckQuery<PomBowlRow>(
    pom
      ? `SELECT bowler, team,
                CAST(overs AS DOUBLE) AS overs,
                CAST(runs AS BIGINT) AS runs,
                CAST(wickets AS BIGINT) AS wickets,
                CAST(economy AS DOUBLE) AS economy
         FROM bowling_scorecard
         WHERE ${matchKey} AND bowler = '${sqlEscape(pom)}'
         LIMIT 1`
      : `SELECT NULL AS bowler, NULL AS team, CAST(0 AS DOUBLE) AS overs,
                0 AS runs, 0 AS wickets, CAST(0 AS DOUBLE) AS economy
         WHERE FALSE`,
  );
  const { resolve } = usePlayerNames();

  const bat = batQ.status === "success" ? batQ.data[0] : undefined;
  const bowl = bowlQ.status === "success" ? bowlQ.data[0] : undefined;

  return (
    <Card kicker="POM" title="Player of the match" padded>
      {!pom && <div className="text-ipl-sub text-sm">Not yet decided.</div>}
      {pom && (
        <>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-ipl-bg flex items-center justify-center font-mono font-bold text-ipl-sub text-[16px]">
              {initials(resolve(pom))}
            </div>
            <div className="flex-1 min-w-0">
              <Link
                href={`/player/${encodeURIComponent(pom)}`}
                className="font-bold text-[14px] text-ipl-ink hover:text-ipl-accent block truncate"
              >
                {resolve(pom)}
              </Link>
              <div className="text-[11px] text-ipl-sub truncate">
                {bat?.team
                  ? `${bat.team} · ${positionLabel(bat.batting_position)}`
                  : bowl?.team
                    ? bowl.team
                    : ""}
              </div>
            </div>
            {bat && bat.balls > 0 && (
              <div className="font-mono text-[22px] font-semibold tracking-[-0.04em]">
                {bat.runs}
                <span className="text-[12px] text-ipl-sub">({bat.balls})</span>
              </div>
            )}
          </div>
          {bat && bat.balls > 0 && (
            <div className="flex gap-3 text-[11px] text-ipl-sub mt-2.5">
              <MicroStat
                value={bat.strike_rate.toFixed(1)}
                label="SR"
              />
              <MicroStat value={`${bat.fours}×4 · ${bat.sixes}×6`} label="" />
            </div>
          )}
          {bowl && bowl.overs > 0 && (
            <div className="flex gap-3 text-[11px] text-ipl-sub mt-2.5">
              <MicroStat
                value={`${bowl.wickets}/${bowl.runs}`}
                label={`${bowl.overs.toFixed(1)} ov`}
              />
              <MicroStat value={bowl.economy.toFixed(2)} label="econ" />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function MicroStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="font-mono text-ipl-ink font-semibold">{value}</span>
      {label && <span>{label}</span>}
    </span>
  );
}

/* ── Partnerships ──────────────────────────────────────────────────────── */

function PartnershipsCard({
  m,
  matchKey,
}: {
  m: MatchInfo;
  matchKey: string;
}) {
  const q = useDuckQuery<PartnershipRaw>(
    `SELECT CAST(innings AS BIGINT) AS innings,
            team,
            CAST(wicket_number AS BIGINT) AS wicket_number,
            batter_1,
            CAST(batter_1_runs AS BIGINT)  AS batter_1_runs,
            CAST(batter_1_balls AS BIGINT) AS batter_1_balls,
            batter_2,
            CAST(batter_2_runs AS BIGINT)  AS batter_2_runs,
            CAST(batter_2_balls AS BIGINT) AS batter_2_balls,
            CAST(total_runs AS BIGINT)     AS total_runs,
            CAST(total_balls AS BIGINT)    AS total_balls
     FROM partnerships
     WHERE ${matchKey}
     ORDER BY innings, wicket_number`,
  );
  const { resolve } = usePlayerNames();
  const winnerCanon = canonicalTeam(m.winner ?? "");

  const { rows, team } = useMemo<{ rows: RibbonRow[]; team: string }>(() => {
    if (q.status !== "success") return { rows: [], team: m.winner ?? m.team_1 };
    const winnerRows = q.data.filter(
      (r) => canonicalTeam(r.team) === winnerCanon,
    );
    const focus = winnerRows.length > 0
      ? winnerRows
      : q.data.filter((r) => r.innings === 1);
    return {
      rows: focus.map((r) => ({
        wicket: r.wicket_number,
        batter1: shortName(resolve(r.batter_1)),
        batter2: shortName(resolve(r.batter_2)),
        runs: r.total_runs,
        balls: r.total_balls,
      })),
      team: focus[0]?.team ?? m.winner ?? m.team_1,
    };
  }, [q, winnerCanon, resolve, m]);

  return (
    <Card
      kicker={`PARTNERSHIPS · ${teamShort(team)}`}
      title="Stand by stand"
      padded
    >
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorBlock message={q.error.message} />}
      {q.status === "success" && rows.length === 0 && (
        <div className="text-ipl-sub text-sm">No partnership data.</div>
      )}
      {rows.length > 0 && (
        <PartnershipRibbons rows={rows} color={teamColor(team)} />
      )}
    </Card>
  );
}

/* ── Manhattan ─────────────────────────────────────────────────────────── */

function ManhattanCard({ m, matchKey }: { m: MatchInfo; matchKey: string }) {
  const q = useDuckQuery<OverRow>(
    `SELECT CAST(innings AS BIGINT) AS innings, team,
            CAST(over AS BIGINT) AS over,
            CAST(SUM(total_runs) AS BIGINT) AS over_runs,
            CAST(SUM(CASE WHEN is_wicket THEN 1 ELSE 0 END) AS BIGINT) AS wkts
     FROM ball_by_ball
     WHERE ${matchKey} AND over BETWEEN 1 AND 20
     GROUP BY innings, team, over
     ORDER BY innings, over`,
  );
  const winnerCanon = canonicalTeam(m.winner ?? "");
  const { overs, wkts, team } = useMemo(() => {
    if (q.status !== "success") return { overs: [] as number[], wkts: [] as number[], team: m.winner ?? m.team_1 };
    const winnerRows = q.data.filter((r) => canonicalTeam(r.team) === winnerCanon);
    const focus = winnerRows.length > 0 ? winnerRows : q.data.filter((r) => r.innings === 1);
    const overArr: number[] = [];
    const wktArr: number[] = [];
    for (const r of focus) {
      overArr.push(r.over_runs);
      if (r.wkts > 0) wktArr.push(r.over - 1);
    }
    return { overs: overArr, wkts: wktArr, team: focus[0]?.team ?? m.winner ?? m.team_1 };
  }, [q, winnerCanon, m]);

  return (
    <Card
      kicker="MANHATTAN"
      title={`Runs per over · ${teamShort(team)}`}
      padded
    >
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorBlock message={q.error.message} />}
      {overs.length > 0 && (
        <ManhattanChart overs={overs} wicketAtOvers={wkts} color={teamColor(team)} />
      )}
      {q.status === "success" && overs.length === 0 && (
        <div className="text-ipl-sub text-sm">No ball-by-ball data.</div>
      )}
    </Card>
  );
}

/* ── DRS mini summary ──────────────────────────────────────────────────── */

function DrsCard({ m, matchKey }: { m: MatchInfo; matchKey: string }) {
  const q = useDuckQuery<ReviewRow>(
    `SELECT team, COALESCE(decision, '') AS decision FROM reviews WHERE ${matchKey}`,
  );

  const stats = useMemo(() => {
    if (q.status !== "success") return null;
    const all = q.data;
    const total = all.length;
    const successful = all.filter((r) => r.decision === "upheld").length;
    const perTeam = new Map<string, { total: number; success: number }>();
    for (const r of all) {
      const t = canonicalTeam(r.team);
      const cur = perTeam.get(t) ?? { total: 0, success: 0 };
      cur.total += 1;
      if (r.decision === "upheld") cur.success += 1;
      perTeam.set(t, cur);
    }
    return { total, successful, perTeam };
  }, [q]);

  return (
    <Card kicker="DRS · MATCH" title="Reviews summary" padded>
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorBlock message={q.error.message} />}
      {q.status === "success" && stats && stats.total === 0 && (
        <div className="text-ipl-sub text-sm">No reviews this match.</div>
      )}
      {q.status === "success" && stats && stats.total > 0 && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[32px] font-semibold tracking-[-0.02em]">
              {stats.successful} / {stats.total}
            </span>
            <span className="text-[11px] text-ipl-sub">
              reviews successful · {Math.round((stats.successful / stats.total) * 100)}%
            </span>
          </div>
          <div className="flex gap-1.5 mt-2.5">
            {Array.from({ length: stats.total }).map((_, i) => (
              <span
                key={i}
                className="w-[22px] h-7 rounded-[3px]"
                style={{
                  background:
                    i < stats.successful ? "var(--color-ipl-pos)" : "var(--color-ipl-neg)",
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-[12px]">
            {[m.team_1, m.team_2].map((team) => {
              const canon = canonicalTeam(team);
              const t = stats.perTeam.get(canon);
              return (
                <div key={team}>
                  <div className="flex items-center gap-1.5 text-[10px] text-ipl-sub font-semibold tracking-[0.06em]">
                    <TeamBadge team={team} size={14} />
                    {teamShort(team)}
                  </div>
                  <div className="font-mono mt-0.5">
                    {t ? `${t.success}/${t.total} · ${Math.round((t.success / t.total) * 100)}%` : "0/0"}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function PageLoader() {
  return (
    <div className="p-12 text-center text-ipl-sub text-sm">Loading match…</div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="p-12 text-center">
      <h1 className="text-2xl font-bold text-ipl-ink">Match not found</h1>
      <p className="text-ipl-sub text-sm mt-2">
        No match with cricsheet ID <span className="font-mono">{id}</span> in the dataset.
        IDs are numeric — links like <span className="font-mono">/match/1422124</span> should work.
      </p>
    </div>
  );
}

function LoadingCell() {
  return <div className="p-4 text-center text-ipl-sub text-sm">Loading…</div>;
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <pre className="p-3 text-ipl-neg text-xs whitespace-pre-wrap">{message}</pre>
  );
}

function formatDate(s: string): string {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function positionLabel(pos: number): string {
  if (pos <= 3) return "top order";
  if (pos <= 6) return "middle order";
  return "lower order";
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const first = parts[0].charAt(0).toUpperCase();
  return `${first} ${last}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

