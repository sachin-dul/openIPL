"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { teamColor } from "@/lib/teams";
import { WICKET_EXCLUDE } from "@/lib/cricket-sql";
import { TeamBadge } from "@/components/team-badge";
import { Card } from "@/components/card";
import { Stat } from "@/components/stat";
import { PageHead } from "@/components/page-head";
import {
  RunDistChart,
  type RunDistBucket,
} from "@/components/charts/run-dist-chart";
import {
  DismissalBar,
  type DismissalRow,
} from "@/components/charts/dismissal-bar";

const DEFAULT_BATTER = "V Kohli";
const DEFAULT_BOWLER = "JJ Bumrah";

type SummaryRow = {
  balls: number;
  innings: number;
  runs: number;
  dismissals: number;
  fours: number;
  sixes: number;
  dots: number;
};

type DistRow = { runs: number; n: number };

type DismissalRaw = { wicket_kind: string; n: number };

type TimelineRow = {
  season: number;
  match_number: number;
  over: number;
  ball: number;
  wicket_kind: string;
};

type PhaseRow = {
  phase: string;
  balls: number;
  runs: number;
  wkts: number;
};

type PlayerInfo = { team: string | null; role: string | null };

export function MatchupContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const batter = params.get("batter") ?? DEFAULT_BATTER;
  const bowler = params.get("bowler") ?? DEFAULT_BOWLER;

  function setPlayer(slot: "batter" | "bowler", value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(slot, value);
    else sp.delete(slot);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  const batterE = sqlEscape(batter);
  const bowlerE = sqlEscape(bowler);
  const fixture = `batter = '${batterE}' AND bowler = '${bowlerE}'`;

  // Career-deliveries summary: balls, runs, dismissals, dots, boundaries. Wides
  // and no-balls are excluded from the legal-ball count so SR/dot% stay clean.
  const summaryQ = useDuckQuery<SummaryRow>(
    `SELECT
        CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
        CAST(COUNT(DISTINCT (season, match_number)) AS BIGINT) AS innings,
        CAST(SUM(batter_runs) AS BIGINT) AS runs,
        CAST(SUM(CASE WHEN is_wicket AND ${WICKET_EXCLUDE} THEN 1 ELSE 0 END) AS BIGINT) AS dismissals,
        CAST(SUM(CASE WHEN batter_runs = 4 THEN 1 ELSE 0 END) AS BIGINT) AS fours,
        CAST(SUM(CASE WHEN batter_runs = 6 THEN 1 ELSE 0 END) AS BIGINT) AS sixes,
        CAST(SUM(CASE WHEN batter_runs = 0 AND COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0
                      THEN 1 ELSE 0 END) AS BIGINT) AS dots
     FROM ball_by_ball
     WHERE ${fixture}`,
  );

  const distQ = useDuckQuery<DistRow>(
    `SELECT
        CAST(batter_runs AS BIGINT) AS runs,
        CAST(COUNT(*) AS BIGINT) AS n
     FROM ball_by_ball
     WHERE ${fixture}
       AND COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0
       AND batter_runs IN (0,1,2,3,4,6)
     GROUP BY batter_runs`,
  );

  const dismissalsQ = useDuckQuery<DismissalRaw>(
    `SELECT wicket_kind,
            CAST(COUNT(*) AS BIGINT) AS n
     FROM ball_by_ball
     WHERE ${fixture}
       AND is_wicket AND ${WICKET_EXCLUDE}
     GROUP BY wicket_kind
     ORDER BY n DESC`,
  );

  const timelineQ = useDuckQuery<TimelineRow>(
    `SELECT CAST(season AS BIGINT) AS season,
            CAST(match_number AS BIGINT) AS match_number,
            CAST(over AS BIGINT) AS over,
            CAST(CASE WHEN ball ~ '^[0-9]+$' THEN CAST(ball AS BIGINT) ELSE 0 END AS BIGINT) AS ball,
            wicket_kind
     FROM ball_by_ball
     WHERE ${fixture}
       AND is_wicket AND ${WICKET_EXCLUDE}
     ORDER BY season DESC, over DESC`,
  );

  const phaseQ = useDuckQuery<PhaseRow>(
    `SELECT phase,
            CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
            CAST(SUM(batter_runs) AS BIGINT) AS runs,
            CAST(SUM(CASE WHEN is_wicket AND ${WICKET_EXCLUDE} THEN 1 ELSE 0 END) AS BIGINT) AS wkts
     FROM ball_by_ball
     WHERE ${fixture} AND phase IS NOT NULL
     GROUP BY phase`,
  );

  // Latest team + role for each player — fed into PlayerPicker chips.
  const batterInfoQ = useDuckQuery<PlayerInfo>(
    `SELECT
        (SELECT team FROM (
            SELECT team, ROW_NUMBER() OVER (PARTITION BY 1 ORDER BY season DESC) AS rk
            FROM players WHERE player = '${batterE}' AND team IS NOT NULL
          ) WHERE rk = 1) AS team,
        (SELECT ANY_VALUE(role) FROM players WHERE player = '${batterE}') AS role`,
  );
  const bowlerInfoQ = useDuckQuery<PlayerInfo>(
    `SELECT
        (SELECT team FROM (
            SELECT team, ROW_NUMBER() OVER (PARTITION BY 1 ORDER BY season DESC) AS rk
            FROM players WHERE player = '${bowlerE}' AND team IS NOT NULL
          ) WHERE rk = 1) AS team,
        (SELECT ANY_VALUE(role) FROM players WHERE player = '${bowlerE}') AS role`,
  );

  const summary = summaryQ.status === "success" ? summaryQ.data[0] : null;
  const batterInfo = batterInfoQ.status === "success" ? batterInfoQ.data[0] : null;
  const bowlerInfo = bowlerInfoQ.status === "success" ? bowlerInfoQ.data[0] : null;

  const distBuckets = useMemo<RunDistBucket[]>(() => {
    if (distQ.status !== "success") return [];
    const total = distQ.data.reduce((s, r) => s + r.n, 0);
    const byRuns = new Map(distQ.data.map((r) => [r.runs, r.n]));
    return [0, 1, 2, 3, 4, 6].map((runs) => {
      const n = byRuns.get(runs) ?? 0;
      return { runs, count: n, pct: total > 0 ? (n / total) * 100 : 0 };
    });
  }, [distQ]);

  return (
    <div>
      <PageHead
        title="Matchup · Batter vs Bowler"
        sub="Every legal delivery they've shared, broken into shape."
      />

      {/* Hero */}
      <div className="bg-ipl-surface border border-ipl-line rounded-[14px] p-5">
        <div
          className="grid items-center gap-4"
          style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
        >
          <PlayerPicker
            label="Batter"
            value={batter}
            info={batterInfo}
            onChange={(v) => setPlayer("batter", v)}
          />
          <div className="text-center">
            <div
              className="font-mono font-semibold leading-[0.9] tracking-[-0.05em]"
              style={{
                fontSize: 64,
                color: "var(--color-ipl-accent)",
              }}
            >
              {summary?.balls ?? "—"}
            </div>
            <div className="text-[11px] text-ipl-sub font-semibold tracking-[0.08em] uppercase mt-1">
              Balls · {summary?.innings ?? 0} innings
            </div>
          </div>
          <PlayerPicker
            label="Bowler"
            value={bowler}
            info={bowlerInfo}
            onChange={(v) => setPlayer("bowler", v)}
            right
          />
        </div>
      </div>

      {/* 5 stat tiles */}
      <div className="grid grid-cols-5 gap-2.5 mt-3.5">
        <Card padded>
          <Stat label="Runs" value={summary?.runs ?? "—"} />
        </Card>
        <Card padded>
          <Stat
            label="SR"
            value={
              summary && summary.balls > 0
                ? ((summary.runs / summary.balls) * 100).toFixed(1)
                : "—"
            }
          />
        </Card>
        <Card padded>
          <Stat
            label="Dismissed"
            value={summary?.dismissals != null ? `${summary.dismissals}×` : "—"}
          />
        </Card>
        <Card padded>
          <Stat
            label="Dot %"
            value={
              summary && summary.balls > 0
                ? Math.round((summary.dots / summary.balls) * 100)
                : "—"
            }
            unit="%"
          />
        </Card>
        <Card padded>
          <Stat
            label="Boundaries"
            value={summary ? summary.fours + summary.sixes : "—"}
            sub={
              summary
                ? `${summary.fours}×4 · ${summary.sixes}×6`
                : undefined
            }
          />
        </Card>
      </div>

      {/* Run dist + dismissals timeline */}
      <div
        className="grid gap-3.5 mt-3.5"
        style={{ gridTemplateColumns: "1.3fr 1fr" }}
      >
        <Card kicker="BALL-BY-BALL" title="Run distribution" padded>
          {distQ.status === "loading" && <LoadingCell />}
          {distQ.status === "error" && <ErrorBlock message={distQ.error.message} />}
          {distQ.status === "success" && distBuckets.length > 0 && (
            <RunDistChart buckets={distBuckets} />
          )}
          {distQ.status === "success" && (summary?.balls ?? 0) === 0 && <EmptyCell />}
        </Card>
        <Card
          kicker="DISMISSALS"
          title={`How ${shortName(bowler)} got ${shortName(batter)}`}
          padded
        >
          <Timeline
            rows={timelineQ.status === "success" ? timelineQ.data : []}
            loading={timelineQ.status === "loading"}
          />
        </Card>
      </div>

      {/* Dismissal mix + phase breakdown */}
      <div
        className="grid gap-3.5 mt-3.5"
        style={{ gridTemplateColumns: "1fr 1.4fr" }}
      >
        <Card
          kicker={`HOW ${shortName(bowler).toUpperCase()} GETS ${shortName(batter).toUpperCase()}`}
          title={`Dismissal mix · ${summary?.dismissals ?? 0} dismissals`}
          padded
        >
          <DismissalsCard
            rows={dismissalsQ.status === "success" ? dismissalsQ.data : []}
            loading={dismissalsQ.status === "loading"}
            color={teamColor(bowlerInfo?.team ?? "")}
          />
        </Card>
        <Card kicker="PHASE BREAKDOWN" title="When they meet" padded>
          <PhaseBoxes
            rows={phaseQ.status === "success" ? phaseQ.data : []}
            loading={phaseQ.status === "loading"}
          />
        </Card>
      </div>
    </div>
  );
}

/* ── Player picker ───────────────────────────────────────────────────── */

function PlayerPicker({
  label,
  value,
  info,
  onChange,
  right,
}: {
  label: string;
  value: string;
  info: PlayerInfo | null;
  onChange: (v: string) => void;
  right?: boolean;
}) {
  const { resolve } = usePlayerNames();
  const teamName = info?.team ?? null;
  const color = teamName ? teamColor(teamName) : "var(--color-ipl-accent)";
  const displayName = resolve(value);
  return (
    <div
      className={
        "flex items-center gap-3.5 " + (right ? "flex-row-reverse" : "flex-row")
      }
    >
      <Link
        href={`/player/${encodeURIComponent(value)}`}
        title="Open profile"
        className="w-[60px] h-[60px] rounded-full flex items-center justify-center font-mono font-bold text-[20px] shrink-0 hover:opacity-90"
        style={{ background: `${color}22`, color }}
      >
        {initials(displayName)}
      </Link>
      <div className={"flex-1 " + (right ? "text-right" : "text-left")}>
        <div className="text-[10px] tracking-[0.08em] text-ipl-sub font-semibold uppercase">
          {label}
        </div>
        <PlayerInput
          value={value}
          displayName={displayName}
          onChange={onChange}
        />
        <div
          className={
            "text-[11px] text-ipl-sub flex items-center gap-1.5 mt-0.5 " +
            (right ? "justify-end" : "justify-start")
          }
        >
          {teamName && <TeamBadge team={teamName} size={14} />}
          {teamName && <span>{teamName}</span>}
        </div>
      </div>
    </div>
  );
}

function PlayerInput({
  value,
  displayName,
  onChange,
}: {
  value: string;
  displayName: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      key={value}
      type="text"
      defaultValue={value}
      placeholder={displayName}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v) onChange(v);
        }
      }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== value) onChange(v);
      }}
      title="Type a player name (as it appears on scorecards) and press Enter"
      className="bg-transparent border-0 border-b border-transparent focus:border-ipl-accent focus:outline-none text-[22px] font-bold tracking-[-0.4px] text-ipl-ink w-full"
    />
  );
}

/* ── Dismissals timeline ─────────────────────────────────────────────── */

function Timeline({ rows, loading }: { rows: TimelineRow[]; loading: boolean }) {
  if (loading) return <LoadingCell />;
  if (rows.length === 0)
    return (
      <div className="text-ipl-sub text-sm p-2">No dismissals on record.</div>
    );
  return (
    <div className="flex flex-col">
      {rows.slice(0, 6).map((r, i) => (
        <div
          key={i}
          className="grid items-center gap-2 text-[12px] py-2 border-b border-ipl-line2 last:border-b-0"
          style={{ gridTemplateColumns: "36px 50px 1fr" }}
        >
          <span className="font-mono text-ipl-sub font-semibold">{`'${String(r.season).slice(2)}`}</span>
          <span className="font-mono text-ipl-sub">
            {r.over}.{r.ball} ov
          </span>
          <span className="text-ipl-ink truncate">{titleCase(r.wicket_kind)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Dismissals card ─────────────────────────────────────────────────── */

function DismissalsCard({
  rows,
  loading,
  color,
}: {
  rows: DismissalRaw[];
  loading: boolean;
  color: string;
}) {
  if (loading) return <LoadingCell />;
  if (rows.length === 0)
    return <div className="text-ipl-sub text-sm">No dismissals.</div>;
  const total = rows.reduce((s, r) => s + r.n, 0);
  const top = rows[0];
  const data: DismissalRow[] = rows.map((r) => ({
    kind: titleCase(r.wicket_kind),
    n: r.n,
  }));
  return (
    <>
      <DismissalBar rows={data} color={color || "var(--color-ipl-accent)"} />
      <div
        className="text-[11px] text-ipl-sub mt-3 p-2.5 rounded-md"
        style={{ background: "var(--color-ipl-bg)" }}
      >
        Most common:{" "}
        <span className="font-mono text-ipl-ink font-semibold">
          {titleCase(top.wicket_kind).toLowerCase()} ({top.n} of {total})
        </span>
      </div>
    </>
  );
}

/* ── Phase boxes ─────────────────────────────────────────────────────── */

function PhaseBoxes({ rows, loading }: { rows: PhaseRow[]; loading: boolean }) {
  if (loading) return <LoadingCell />;
  if (rows.length === 0) return <EmptyCell />;
  const ordered: Array<{ key: string; label: string }> = [
    { key: "powerplay", label: "PP" },
    { key: "middle", label: "MID" },
    { key: "death", label: "DEATH" },
  ];
  const byPhase = new Map(rows.map((r) => [r.phase, r]));
  // Highlight the phase where the bowler has the best concede-rate (smallest
  // runs per ball, with at least 6 balls so noise doesn't flip the call).
  let bestKey: string | null = null;
  let bestRpb = Infinity;
  for (const o of ordered) {
    const r = byPhase.get(o.key);
    if (!r || r.balls < 6) continue;
    const rpb = r.runs / r.balls;
    if (rpb < bestRpb) {
      bestRpb = rpb;
      bestKey = o.key;
    }
  }
  return (
    <div className="grid grid-cols-3 gap-3.5">
      {ordered.map((o) => {
        const r = byPhase.get(o.key);
        const balls = r?.balls ?? 0;
        const runs = r?.runs ?? 0;
        const wkts = r?.wkts ?? 0;
        const sr = balls > 0 ? (runs / balls) * 100 : null;
        const highlight = o.key === bestKey;
        return (
          <div
            key={o.key}
            className={
              "rounded-lg p-3 border " +
              (highlight
                ? "border-ipl-accent bg-ipl-bg"
                : "border-ipl-line bg-ipl-surface")
            }
          >
            <div
              className={
                "text-[10px] tracking-[0.1em] font-bold " +
                (highlight ? "text-ipl-accent" : "text-ipl-sub")
              }
            >
              {o.label}
            </div>
            <div className="font-mono font-semibold text-[26px] tracking-[-0.6px] mt-1">
              {runs}
              <span className="text-[12px] text-ipl-sub">/{balls}</span>
            </div>
            <div className="flex justify-between font-mono text-[10px] text-ipl-sub mt-1.5">
              <span>SR {sr != null ? sr.toFixed(0) : "—"}</span>
              <span className="text-ipl-neg">W {wkts}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function LoadingCell() {
  return <div className="p-4 text-center text-ipl-sub text-sm">Loading…</div>;
}

function ErrorBlock({ message }: { message: string }) {
  return <pre className="p-3 text-ipl-neg text-xs whitespace-pre-wrap">{message}</pre>;
}

function EmptyCell() {
  return <div className="p-4 text-center text-ipl-sub text-sm">No data yet.</div>;
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
