"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import {
  canonicalTeam,
  teamAliases,
  teamColor,
  teamInfo,
  teamShort,
} from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { Card } from "@/components/card";

const PICKABLE_TEAMS = [
  "Chennai Super Kings",
  "Mumbai Indians",
  "Royal Challengers Bengaluru",
  "Kolkata Knight Riders",
  "Rajasthan Royals",
  "Sunrisers Hyderabad",
  "Delhi Capitals",
  "Punjab Kings",
  "Gujarat Titans",
  "Lucknow Super Giants",
];

const DEFAULT_A = "Chennai Super Kings";
const DEFAULT_B = "Mumbai Indians";

type SummaryRow = {
  meetings: number;
  a_wins: number;
  b_wins: number;
  ties: number;
  no_results: number;
  a_toss: number;
  b_toss: number;
  a_batfirst_wins: number;
  b_batfirst_wins: number;
};

type SideAgg = {
  side: "A" | "B";
  highest: number;
  avg_score: number;
  avg_boundaries: number;
  avg_sixes: number;
  total_dots: number;
  total_balls: number;
};

type SeasonRow = {
  season: number;
  meetings: number;
  a_wins: number;
  b_wins: number;
};

type TopBatRow = {
  batter: string;
  side: "A" | "B";
  runs: number;
  innings: number;
};

type TopBowlRow = {
  bowler: string;
  side: "A" | "B";
  wickets: number;
  innings: number;
};

export function H2HContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const a = params.get("team1") ?? DEFAULT_A;
  const b = params.get("team2") ?? DEFAULT_B;

  function setTeam(slot: "team1" | "team2", value: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set(slot, value);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  function swap() {
    const sp = new URLSearchParams(params.toString());
    sp.set("team1", b);
    sp.set("team2", a);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  const aAliases = sqlList(teamAliases(a));
  const bAliases = sqlList(teamAliases(b));

  // Single summary row: total meetings, wins per side, ties/NRs, plus toss
  // counts and bat-first wins. The (team_1 IN A AND team_2 IN B) OR (mirror)
  // filter is the canonical "this match is between these two clubs" predicate
  // that gets used by almost every query on this page.
  const summaryQ = useDuckQuery<SummaryRow>(
    `WITH h AS (
        SELECT m.* FROM matches m
        WHERE (m.team_1 IN (${aAliases}) AND m.team_2 IN (${bAliases}))
           OR (m.team_1 IN (${bAliases}) AND m.team_2 IN (${aAliases}))
      )
      SELECT
        CAST(COUNT(*) AS BIGINT) AS meetings,
        CAST(SUM(CASE WHEN winner IN (${aAliases}) THEN 1 ELSE 0 END) AS BIGINT) AS a_wins,
        CAST(SUM(CASE WHEN winner IN (${bAliases}) THEN 1 ELSE 0 END) AS BIGINT) AS b_wins,
        CAST(SUM(CASE WHEN COALESCE(result, '') = 'tie'       THEN 1 ELSE 0 END) AS BIGINT) AS ties,
        CAST(SUM(CASE WHEN COALESCE(result, '') = 'no result' THEN 1 ELSE 0 END) AS BIGINT) AS no_results,
        CAST(SUM(CASE WHEN toss_winner IN (${aAliases}) THEN 1 ELSE 0 END) AS BIGINT) AS a_toss,
        CAST(SUM(CASE WHEN toss_winner IN (${bAliases}) THEN 1 ELSE 0 END) AS BIGINT) AS b_toss,
        CAST(SUM(CASE WHEN team_1 IN (${aAliases}) AND winner = team_1 THEN 1
                      WHEN team_2 IN (${aAliases}) AND winner = team_2 AND
                           COALESCE(win_by_runs, 0) > 0 THEN 1
                      ELSE 0 END) AS BIGINT) AS a_batfirst_wins,
        CAST(SUM(CASE WHEN team_1 IN (${bAliases}) AND winner = team_1 THEN 1
                      WHEN team_2 IN (${bAliases}) AND winner = team_2 AND
                           COALESCE(win_by_runs, 0) > 0 THEN 1
                      ELSE 0 END) AS BIGINT) AS b_batfirst_wins
      FROM h`,
  );

  // Per-innings aggregates over every meeting → max + averages per side. Side
  // (A vs B) collapses both canonical and aliased team names down to a single
  // bucket so "Royal Challengers Bangalore" and "…Bengaluru" don't split.
  const sideQ = useDuckQuery<SideAgg>(
    `WITH h AS (
        SELECT season, match_number FROM matches
        WHERE (team_1 IN (${aAliases}) AND team_2 IN (${bAliases}))
           OR (team_1 IN (${bAliases}) AND team_2 IN (${aAliases}))
      ),
      innings AS (
        SELECT
          CASE WHEN bbb.team IN (${aAliases}) THEN 'A' ELSE 'B' END AS side,
          bbb.season, bbb.match_number, bbb.innings,
          SUM(bbb.total_runs) AS runs,
          SUM(CASE WHEN COALESCE(bbb.wides,0)=0 AND COALESCE(bbb.noballs,0)=0 THEN 1 ELSE 0 END) AS balls,
          SUM(CASE WHEN bbb.batter_runs = 4 THEN 1 ELSE 0 END) AS fours,
          SUM(CASE WHEN bbb.batter_runs = 6 THEN 1 ELSE 0 END) AS sixes,
          SUM(CASE WHEN bbb.total_runs = 0 AND COALESCE(bbb.wides,0)=0 AND COALESCE(bbb.noballs,0)=0
                   THEN 1 ELSE 0 END) AS dots
        FROM ball_by_ball bbb
        JOIN h ON bbb.season = h.season AND bbb.match_number = h.match_number
        WHERE bbb.team IN (${aAliases}) OR bbb.team IN (${bAliases})
        GROUP BY side, bbb.season, bbb.match_number, bbb.innings
      )
      SELECT
        side,
        CAST(MAX(runs) AS BIGINT) AS highest,
        AVG(runs) AS avg_score,
        AVG(fours + sixes) AS avg_boundaries,
        AVG(sixes) AS avg_sixes,
        CAST(SUM(dots) AS BIGINT) AS total_dots,
        CAST(SUM(balls) AS BIGINT) AS total_balls
      FROM innings
      GROUP BY side`,
  );

  // Meetings stacked by season — used for the "Win share '08 → '25" panel.
  const seasonsQ = useDuckQuery<SeasonRow>(
    `SELECT
        CAST(season AS BIGINT) AS season,
        CAST(COUNT(*) AS BIGINT) AS meetings,
        CAST(SUM(CASE WHEN winner IN (${aAliases}) THEN 1 ELSE 0 END) AS BIGINT) AS a_wins,
        CAST(SUM(CASE WHEN winner IN (${bAliases}) THEN 1 ELSE 0 END) AS BIGINT) AS b_wins
     FROM matches
     WHERE (team_1 IN (${aAliases}) AND team_2 IN (${bAliases}))
        OR (team_1 IN (${bAliases}) AND team_2 IN (${aAliases}))
     GROUP BY season
     ORDER BY season`,
  );

  // Top scorers and wicket-takers across the fixture — 4 of each, the design
  // grids them as a 2-up of 4-up tiles ("ICONS · THIS FIXTURE").
  const topBatQ = useDuckQuery<TopBatRow>(
    `SELECT
        bs.batter,
        CASE WHEN bs.team IN (${aAliases}) THEN 'A' ELSE 'B' END AS side,
        CAST(SUM(bs.runs) AS BIGINT) AS runs,
        CAST(COUNT(*) AS BIGINT) AS innings
     FROM batting_scorecard bs
     JOIN matches m ON bs.season = m.season AND bs.match_number = m.match_number
     WHERE bs.batter IS NOT NULL
       AND (bs.team IN (${aAliases}) OR bs.team IN (${bAliases}))
       AND ((m.team_1 IN (${aAliases}) AND m.team_2 IN (${bAliases}))
         OR (m.team_1 IN (${bAliases}) AND m.team_2 IN (${aAliases})))
     GROUP BY bs.batter, side
     ORDER BY runs DESC
     LIMIT 4`,
  );

  const topBowlQ = useDuckQuery<TopBowlRow>(
    `SELECT
        bs.bowler,
        CASE WHEN bs.team IN (${aAliases}) THEN 'A' ELSE 'B' END AS side,
        CAST(SUM(bs.wickets) AS BIGINT) AS wickets,
        CAST(COUNT(*) AS BIGINT) AS innings
     FROM bowling_scorecard bs
     JOIN matches m ON bs.season = m.season AND bs.match_number = m.match_number
     WHERE bs.bowler IS NOT NULL
       AND (bs.team IN (${aAliases}) OR bs.team IN (${bAliases}))
       AND ((m.team_1 IN (${aAliases}) AND m.team_2 IN (${bAliases}))
         OR (m.team_1 IN (${bAliases}) AND m.team_2 IN (${aAliases})))
     GROUP BY bs.bowler, side
     ORDER BY wickets DESC
     LIMIT 4`,
  );

  const summary = summaryQ.status === "success" ? summaryQ.data[0] : null;
  const sides = sideQ.status === "success" ? sideQ.data : [];
  const seasons = seasonsQ.status === "success" ? seasonsQ.data : [];

  const sideAgg = useMemo(() => {
    const map: Record<"A" | "B", SideAgg | null> = { A: null, B: null };
    for (const s of sides) map[s.side] = s;
    return map;
  }, [sides]);

  return (
    <div>
      <TeamPickers a={a} b={b} setTeam={setTeam} swap={swap} />
      <SplitHero a={a} b={b} summary={summary} />
      <CompareCard
        a={a}
        b={b}
        summary={summary}
        aAgg={sideAgg.A}
        bAgg={sideAgg.B}
      />
      <div
        className="grid gap-3.5 mt-3.5"
        style={{ gridTemplateColumns: "1.2fr 1fr" }}
      >
        <Card kicker="MEETINGS BY SEASON" title="Win share, season by season" padded>
          {seasonsQ.status === "loading" && <LoadingCell />}
          {seasonsQ.status === "error" && <ErrorBlock message={seasonsQ.error.message} />}
          {seasonsQ.status === "success" && seasons.length === 0 && <EmptyCell />}
          {seasonsQ.status === "success" && seasons.length > 0 && (
            <SeasonMeetings rows={seasons} a={a} b={b} />
          )}
        </Card>
        <Card kicker="ICONS · THIS FIXTURE" title="Top scorers + wicket-takers" padded>
          <Icons
            batting={topBatQ.status === "success" ? topBatQ.data : []}
            bowling={topBowlQ.status === "success" ? topBowlQ.data : []}
            a={a}
            b={b}
            loading={topBatQ.status === "loading" || topBowlQ.status === "loading"}
          />
        </Card>
      </div>
    </div>
  );
}

/* ── Pickers ─────────────────────────────────────────────────────────── */

function TeamPickers({
  a,
  b,
  setTeam,
  swap,
}: {
  a: string;
  b: string;
  setTeam: (slot: "team1" | "team2", value: string) => void;
  swap: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5 text-[12px]">
      <PickerSelect
        label="Team A"
        value={a}
        onChange={(v) => setTeam("team1", v)}
        exclude={b}
      />
      <button
        type="button"
        onClick={swap}
        title="Swap teams"
        className="text-[11px] font-semibold px-2.5 py-[5px] rounded-md border border-ipl-line bg-ipl-surface text-ipl-ink hover:border-ipl-soft"
      >
        ⇄ Swap
      </button>
      <PickerSelect
        label="Team B"
        value={b}
        onChange={(v) => setTeam("team2", v)}
        exclude={a}
      />
    </div>
  );
}

function PickerSelect({
  label,
  value,
  onChange,
  exclude,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  exclude: string;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono border border-ipl-line rounded-md px-2 py-[5px] bg-ipl-surface text-ipl-ink text-[12px] focus:outline-none focus:border-ipl-accent"
      >
        {PICKABLE_TEAMS.map((t) => (
          <option key={t} value={t} disabled={canonicalTeam(t) === canonicalTeam(exclude)}>
            {teamShort(t)} · {t}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ── Hero: split-screen ──────────────────────────────────────────────── */

function SplitHero({
  a,
  b,
  summary,
}: {
  a: string;
  b: string;
  summary: SummaryRow | null;
}) {
  const aInfo = teamInfo(a);
  const bInfo = teamInfo(b);
  const meetings = summary?.meetings ?? 0;
  const aPct =
    meetings > 0 && summary
      ? (summary.a_wins / meetings) * 100
      : null;
  const bPct =
    meetings > 0 && summary
      ? (summary.b_wins / meetings) * 100
      : null;
  return (
    <div
      className="grid border border-ipl-line rounded-[14px] overflow-hidden mb-3.5"
      style={{ gridTemplateColumns: "1fr 1fr" }}
    >
      <SplitSide team={a} info={aInfo} wins={summary?.a_wins} pct={aPct} />
      <SplitSide
        team={b}
        info={bInfo}
        wins={summary?.b_wins}
        pct={bPct}
        right
      />
    </div>
  );
}

function SplitSide({
  team,
  info,
  wins,
  pct,
  right,
}: {
  team: string;
  info: ReturnType<typeof teamInfo>;
  wins: number | undefined;
  pct: number | null;
  right?: boolean;
}) {
  return (
    <div
      className="relative p-6 overflow-hidden"
      style={{
        background: info.color,
        color: info.ink,
        textAlign: right ? "right" : "left",
      }}
    >
      <div className="font-mono font-bold text-[88px] leading-[0.85] tracking-[-0.04em] opacity-95">
        {wins != null ? wins : "—"}
      </div>
      <div
        className="text-[13px] mt-1 font-semibold tracking-[0.08em]"
        style={{ opacity: 0.7 }}
      >
        WINS{pct != null ? ` · ${pct.toFixed(1)}%` : ""}
      </div>
      <div className="mt-4">
        <div
          className="flex items-center gap-2 mb-1"
          style={{
            justifyContent: right ? "flex-end" : "flex-start",
          }}
        >
          <TeamBadge team={team} size={28} />
          <div
            className="text-[11px] font-semibold tracking-[0.08em]"
            style={{ opacity: 0.7 }}
          >
            {teamShort(team)}
          </div>
        </div>
        <div className="text-[26px] font-bold leading-none tracking-[-0.4px]">
          {team}
        </div>
      </div>
    </div>
  );
}

/* ── Compare bars ────────────────────────────────────────────────────── */

function CompareCard({
  a,
  b,
  summary,
  aAgg,
  bAgg,
}: {
  a: string;
  b: string;
  summary: SummaryRow | null;
  aAgg: SideAgg | null;
  bAgg: SideAgg | null;
}) {
  const aColor = teamColor(a);
  const bColor = teamColor(b);
  const dotPct = (agg: SideAgg | null) =>
    agg && agg.total_balls > 0 ? (agg.total_dots / agg.total_balls) * 100 : null;

  const rows: CompareRowData[] = [
    {
      label: "Wins",
      av: summary?.a_wins ?? null,
      bv: summary?.b_wins ?? null,
    },
    {
      label: "Highest total",
      av: aAgg?.highest ?? null,
      bv: bAgg?.highest ?? null,
    },
    {
      label: "Avg score",
      av: round1(aAgg?.avg_score),
      bv: round1(bAgg?.avg_score),
    },
    {
      label: "Boundaries / inn",
      av: round1(aAgg?.avg_boundaries),
      bv: round1(bAgg?.avg_boundaries),
    },
    {
      label: "Sixes / inn",
      av: round1(aAgg?.avg_sixes),
      bv: round1(bAgg?.avg_sixes),
    },
    {
      label: "Dot-ball",
      av: round1(dotPct(aAgg)),
      bv: round1(dotPct(bAgg)),
      unit: "%",
    },
    {
      label: "Toss won",
      av: summary?.a_toss ?? null,
      bv: summary?.b_toss ?? null,
    },
    {
      label: "Bat-first wins",
      av: summary?.a_batfirst_wins ?? null,
      bv: summary?.b_batfirst_wins ?? null,
    },
  ];

  return (
    <Card
      kicker={`HEAD-TO-HEAD · ${summary?.meetings ?? 0} MATCHES`}
      title="Stat-by-stat"
      padded
    >
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <CompareRow
            key={r.label}
            row={r}
            aColor={aColor}
            bColor={bColor}
          />
        ))}
      </div>
    </Card>
  );
}

type CompareRowData = {
  label: string;
  av: number | null;
  bv: number | null;
  unit?: string;
};

function CompareRow({
  row,
  aColor,
  bColor,
}: {
  row: CompareRowData;
  aColor: string;
  bColor: string;
}) {
  const max = Math.max(row.av ?? 0, row.bv ?? 0, 1);
  const aWidth = ((row.av ?? 0) / max) * 100;
  const bWidth = ((row.bv ?? 0) / max) * 100;
  return (
    <div
      className="grid items-center gap-3 text-[12px]"
      style={{ gridTemplateColumns: "1fr 120px 1fr" }}
    >
      {/* Left = team A: number then bar, anchored to right edge */}
      <div className="flex items-center justify-end gap-2">
        <span className="font-mono font-bold text-[14px] text-ipl-ink">
          {row.av != null ? `${row.av}${row.unit ?? ""}` : "—"}
        </span>
        <div
          className="h-2.5 rounded-sm"
          style={{
            width: `${aWidth}%`,
            background: aColor,
            maxWidth: 200,
          }}
        />
      </div>
      <div className="text-center text-[10px] tracking-[0.08em] text-ipl-sub font-semibold uppercase">
        {row.label}
      </div>
      {/* Right = team B: bar then number */}
      <div className="flex items-center gap-2">
        <div
          className="h-2.5 rounded-sm"
          style={{
            width: `${bWidth}%`,
            background: bColor,
            maxWidth: 200,
          }}
        />
        <span className="font-mono font-bold text-[14px] text-ipl-ink">
          {row.bv != null ? `${row.bv}${row.unit ?? ""}` : "—"}
        </span>
      </div>
    </div>
  );
}

/* ── Season meetings ─────────────────────────────────────────────────── */

function SeasonMeetings({
  rows,
  a,
  b,
}: {
  rows: SeasonRow[];
  a: string;
  b: string;
}) {
  const aColor = teamColor(a);
  const bColor = teamColor(b);
  const maxMeetings = Math.max(...rows.map((r) => r.meetings), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const aShare = r.meetings > 0 ? (r.a_wins / r.meetings) * 100 : 0;
        const bShare = r.meetings > 0 ? (r.b_wins / r.meetings) * 100 : 0;
        const draws = 100 - aShare - bShare;
        return (
          <div
            key={r.season}
            className="grid items-center gap-2 text-[11px]"
            style={{ gridTemplateColumns: "32px 1fr 56px" }}
          >
            <span className="font-mono text-ipl-sub">{`'${String(r.season).slice(2)}`}</span>
            <div
              className="h-3 rounded-sm overflow-hidden bg-ipl-line2 flex"
              style={{ width: `${(r.meetings / maxMeetings) * 100}%`, minWidth: 40 }}
            >
              <div style={{ width: `${aShare}%`, background: aColor }} />
              <div
                style={{ width: `${draws}%`, background: "var(--color-ipl-soft)" }}
              />
              <div style={{ width: `${bShare}%`, background: bColor }} />
            </div>
            <span className="font-mono text-right text-ipl-sub">
              {r.a_wins}–{r.b_wins}
              {r.meetings > r.a_wins + r.b_wins
                ? ` (${r.meetings - r.a_wins - r.b_wins})`
                : ""}
            </span>
          </div>
        );
      })}
      <div className="flex gap-3 text-[10px] text-ipl-sub mt-2">
        <Swatch color={aColor} label={teamShort(a)} />
        <Swatch color={bColor} label={teamShort(b)} />
        <Swatch color="var(--color-ipl-soft)" label="No result / tie" />
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/* ── Icons: top scorers + wicket-takers ──────────────────────────────── */

function Icons({
  batting,
  bowling,
  a,
  b,
  loading,
}: {
  batting: TopBatRow[];
  bowling: TopBowlRow[];
  a: string;
  b: string;
  loading: boolean;
}) {
  const { resolve } = usePlayerNames();
  if (loading) return <LoadingCell />;
  if (batting.length === 0 && bowling.length === 0) return <EmptyCell />;
  const teamFor = (side: "A" | "B") => (side === "A" ? a : b);
  return (
    <div>
      <SectionLabel>Top scorers</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {batting.map((r) => (
          <IconTile
            key={`bat-${r.batter}`}
            playerKey={r.batter}
            displayName={resolve(r.batter)}
            team={teamFor(r.side)}
            value={r.runs.toLocaleString()}
            valueLabel={`runs · ${r.innings} mts`}
          />
        ))}
      </div>
      <div className="mt-3">
        <SectionLabel>Top wicket-takers</SectionLabel>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {bowling.map((r) => (
          <IconTile
            key={`bowl-${r.bowler}`}
            playerKey={r.bowler}
            displayName={resolve(r.bowler)}
            team={teamFor(r.side)}
            value={r.wickets.toString()}
            valueLabel={`wkts · ${r.innings} mts`}
          />
        ))}
      </div>
    </div>
  );
}

function IconTile({
  playerKey,
  displayName,
  team,
  value,
  valueLabel,
}: {
  playerKey: string;
  displayName: string;
  team: string;
  value: string;
  valueLabel: string;
}) {
  return (
    <Link
      href={`/player/${encodeURIComponent(playerKey)}`}
      className="rounded-[7px] p-2.5 hover:bg-ipl-line2 transition-colors block"
      style={{ background: "var(--color-ipl-bg)" }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <TeamBadge team={team} size={16} />
        <span className="text-[12px] font-semibold text-ipl-ink truncate">{displayName}</span>
      </div>
      <div className="font-mono font-semibold text-[18px] tracking-[-0.02em]">{value}</div>
      <div className="text-[10px] text-ipl-sub">{valueLabel}</div>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold mb-1.5">
      {children}
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function LoadingCell() {
  return <div className="p-6 text-center text-ipl-sub text-sm">Loading…</div>;
}

function ErrorBlock({ message }: { message: string }) {
  return <pre className="p-3 text-ipl-neg text-xs whitespace-pre-wrap">{message}</pre>;
}

function EmptyCell() {
  return <div className="p-6 text-center text-ipl-sub text-sm">No meetings yet.</div>;
}

function round1(v: number | null | undefined): number | null {
  if (v == null) return null;
  return Math.round(v * 10) / 10;
}

function sqlList(xs: string[]): string {
  return xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
}
