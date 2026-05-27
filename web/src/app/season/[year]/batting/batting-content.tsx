"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { teamColor, teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { Card } from "@/components/card";
import { PageHead } from "@/components/page-head";
import { Scatter, type ScatterPoint } from "@/components/charts/scatter";

const LEADERBOARD_LIMIT = 10;
// Hardcoded floor that keeps part-time batters from cluttering the scatter.
// 50 balls is roughly two innings of meaningful batting.
const SCATTER_MIN_BALLS = 50;

type LeaderRow = {
  batter: string;
  team: string;
  runs: number;
  innings: number;
  balls: number;
  hs: number;
  fours: number;
  sixes: number;
  outs: number;
  avg: number | null;
  sr: number | null;
};

type SparkRow = {
  match_number: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  opponent: string;
};

type PhaseRaw = {
  batter: string;
  phase: string;
  runs: number;
  balls: number;
};

type PhaseBreakdown = {
  pp: number;
  mid: number;
  death: number;
  ppBalls: number;
  midBalls: number;
  deathBalls: number;
};

export function BattingContent({ year }: { year: number }) {
  const leaderboard = useDuckQuery<LeaderRow>(
    `SELECT
        batter,
        ANY_VALUE(team) AS team,
        CAST(SUM(runs)  AS BIGINT)   AS runs,
        CAST(COUNT(*)   AS BIGINT)   AS innings,
        CAST(SUM(balls) AS BIGINT)   AS balls,
        CAST(MAX(runs)  AS BIGINT)   AS hs,
        CAST(SUM(fours) AS BIGINT)   AS fours,
        CAST(SUM(sixes) AS BIGINT)   AS sixes,
        CAST(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END) AS BIGINT) AS outs,
        CAST(SUM(runs) AS DOUBLE) /
          NULLIF(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END), 0) AS avg,
        100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     ORDER BY runs DESC
     LIMIT ${LEADERBOARD_LIMIT}`,
  );

  // Phase-level runs + legal balls for the leaderboard batters. Runs in
  // parallel with the leaderboard query; the table renders empty bars until
  // this resolves, so the leaderboard isn't blocked on phase data.
  const phaseQ = useDuckQuery<PhaseRaw>(
    `WITH topN AS (
        SELECT batter FROM batting_scorecard
        WHERE season = ${year} AND batter IS NOT NULL
        GROUP BY batter
        ORDER BY SUM(runs) DESC
        LIMIT ${LEADERBOARD_LIMIT}
      )
      SELECT batter, phase,
             CAST(SUM(batter_runs) AS BIGINT) AS runs,
             CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0
                           THEN 1 ELSE 0 END) AS BIGINT) AS balls
      FROM ball_by_ball
      WHERE season = ${year}
        AND batter IN (SELECT batter FROM topN)
        AND phase IS NOT NULL
      GROUP BY batter, phase`,
  );

  const rows = leaderboard.status === "success" ? leaderboard.data : [];
  const top = rows[0];

  const phaseMap = useMemo(() => {
    const m = new Map<string, PhaseBreakdown>();
    if (phaseQ.status !== "success") return m;
    for (const r of phaseQ.data) {
      const cur =
        m.get(r.batter) ??
        ({
          pp: 0,
          mid: 0,
          death: 0,
          ppBalls: 0,
          midBalls: 0,
          deathBalls: 0,
        } satisfies PhaseBreakdown);
      if (r.phase === "powerplay") {
        cur.pp = r.runs;
        cur.ppBalls = r.balls;
      } else if (r.phase === "middle") {
        cur.mid = r.runs;
        cur.midBalls = r.balls;
      } else if (r.phase === "death") {
        cur.death = r.runs;
        cur.deathBalls = r.balls;
      }
      m.set(r.batter, cur);
    }
    return m;
  }, [phaseQ]);

  return (
    <div>
      <PageHead title={`IPL ${year}`} />

      <div className="grid grid-cols-[1fr_1.6fr] gap-3.5">
        <OrangeCapHero year={year} top={top} loading={leaderboard.status === "loading"} />
        <Card
          kicker="LEADERBOARD"
          title={`Top ${LEADERBOARD_LIMIT} batters · all metrics`}
          padded={false}
        >
          {leaderboard.status === "loading" && <LoadingCell />}
          {leaderboard.status === "error" && (
            <ErrorCell message={leaderboard.error.message} />
          )}
          {leaderboard.status === "success" && (
            <BatterTable rows={rows} phaseMap={phaseMap} />
          )}
        </Card>
      </div>

      <div className="mt-3.5 grid grid-cols-[1fr_1.6fr] gap-3.5">
        <BattingByPhaseCard year={year} />
        <ScatterCardShell year={year} />
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3.5">
        <BestInningsCard year={year} />
        <StrikeRateCard year={year} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   ORANGE CAP HERO
   -------------------------------------------------------------------------- */

function OrangeCapHero({
  year,
  top,
  loading,
}: {
  year: number;
  top: LeaderRow | undefined;
  loading: boolean;
}) {
  // Per-match runs + balls + boundaries for the hero player, plus the
  // opponent (derived from the matches row by taking whichever side isn't the
  // batter's team). Skipping the query until we know who to look up keeps the
  // dev console clean during the initial load.
  const spark = useDuckQuery<SparkRow>(
    top
      ? `SELECT
            CAST(bs.match_number AS BIGINT) AS match_number,
            CAST(bs.runs  AS BIGINT) AS runs,
            CAST(bs.balls AS BIGINT) AS balls,
            CAST(bs.fours AS BIGINT) AS fours,
            CAST(bs.sixes AS BIGINT) AS sixes,
            CASE WHEN bs.team = m.team_1 THEN m.team_2 ELSE m.team_1 END AS opponent
         FROM batting_scorecard bs
         JOIN matches m ON bs.season = m.season AND bs.match_number = m.match_number
         WHERE bs.season = ${year} AND bs.batter = '${sqlEscape(top.batter)}'
         ORDER BY bs.match_number`
      : `SELECT 0 AS match_number, 0 AS runs, 0 AS balls, 0 AS fours,
                0 AS sixes, '' AS opponent WHERE FALSE`,
  );
  const { resolve } = usePlayerNames();

  if (loading) {
    return (
      <div className="bg-ipl-surface border border-ipl-line rounded-[12px] p-5 min-h-[340px]">
        <LoadingCell />
      </div>
    );
  }

  if (!top) {
    return (
      <div className="bg-ipl-surface border border-ipl-line rounded-[12px] p-5">
        <div className="text-ipl-sub text-sm">
          No batting data for IPL {year} yet.
        </div>
      </div>
    );
  }

  // X-axis is the player's own match count (1..N), not the IPL match number,
  // so gaps in their schedule don't leave dead space on the chart. Each point
  // carries runs + strike rate (null when balls=0) plus a multi-line tooltip
  // showing opponent, runs/balls, SR, and boundary breakdown.
  const sparkData =
    spark.status === "success"
      ? spark.data.map((r, i) => {
          const sr = r.balls > 0 ? (r.runs / r.balls) * 100 : null;
          const oppShort = teamShort(r.opponent) || r.opponent;
          const tooltip = [
            `Match ${i + 1} vs ${oppShort}`,
            `${r.runs} runs (${r.balls} balls)`,
            sr != null ? `SR ${sr.toFixed(1)}` : "",
            `${r.fours}×4 · ${r.sixes}×6`,
          ]
            .filter(Boolean)
            .join("\n");
          return { match: i + 1, runs: r.runs, sr, tooltip };
        })
      : [];

  return (
    <div className="bg-ipl-surface border border-ipl-line rounded-[12px] p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-[11px] font-bold"
          style={{ background: "var(--color-ipl-orange)" }}
        >
          ★
        </span>
        <span className="text-[11px] tracking-[0.1em] text-ipl-sub font-semibold uppercase">
          Orange Cap · IPL {year}
        </span>
      </div>
      <div>
        <div className="text-[13px] text-ipl-sub flex items-center gap-1.5">
          <Link
            href={`/player/${encodeURIComponent(top.batter)}`}
            className="hover:text-ipl-accent font-medium"
          >
            {resolve(top.batter)}
          </Link>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <TeamBadge team={top.team} size={16} />
            {teamShort(top.team)}
          </span>
        </div>
        <div className="font-mono font-semibold leading-[0.9] tracking-[-0.05em] text-ipl-ink text-[72px] mt-1.5">
          {top.runs.toLocaleString()}
        </div>
        <div className="text-[12px] text-ipl-sub mt-1">
          runs in {top.innings} innings · hs {top.hs}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <HeroStat label="Average" value={top.avg != null ? top.avg.toFixed(1) : "—"} />
        <HeroStat label="Strike rate" value={top.sr != null ? top.sr.toFixed(1) : "—"} />
        <HeroStat label="Fours" value={top.fours.toString()} />
        <HeroStat label="Sixes" value={top.sixes.toString()} />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold">
            Runs &amp; SR per match
          </div>
          <div className="flex gap-2 text-[9px] font-mono text-ipl-sub">
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-[2px]"
                style={{ background: "var(--color-ipl-orange)" }}
              />
              Runs
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-[2px]"
                style={{
                  background: "var(--color-ipl-accent)",
                  opacity: 0.85,
                }}
              />
              SR
            </span>
          </div>
        </div>
        <MatchLineChart
          data={sparkData}
          avg={top.avg ?? undefined}
          color="var(--color-ipl-orange)"
          srColor="var(--color-ipl-accent)"
        />
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold">
        {label}
      </div>
      <div className="font-mono font-semibold text-[22px] text-ipl-ink leading-none tracking-[-0.02em] mt-0.5">
        {value}
      </div>
    </div>
  );
}

type MatchLineDatum = {
  match: number;
  runs: number;
  /** Optional strike rate plotted on a secondary (right) Y axis. */
  sr?: number | null;
  /** Multi-line tooltip text. Falls back to `Match N · runs` if absent. */
  tooltip?: string;
};

function MatchLineChart({
  data,
  color,
  srColor = "var(--color-ipl-accent)",
  width = 280,
  height = 150,
  avg,
}: {
  data: MatchLineDatum[];
  color: string;
  srColor?: string;
  width?: number;
  height?: number;
  avg?: number;
}) {
  if (data.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        className="block"
      />
    );
  }
  const hasSr = data.some((d) => d.sr != null);
  // Right padding grows to make room for the SR axis when present.
  const pad = { t: 10, r: hasSr ? 30 : 12, b: 22, l: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  // Runs scale: round max up to a clean multiple of 25.
  const maxRuns = Math.max(...data.map((d) => d.runs), 0);
  const runsMax = Math.max(25, Math.ceil(maxRuns / 25) * 25);

  // SR scale: round max up to a clean multiple of 50, floor at 100 so a
  // pre-explosive season still leaves headroom above the line.
  const maxSr = Math.max(
    ...data.map((d) => (d.sr != null ? d.sr : 0)),
    0,
  );
  const srMax = Math.max(100, Math.ceil(maxSr / 50) * 50);

  const minMatch = data[0].match;
  const maxMatch = data[data.length - 1].match;
  const matchSpan = Math.max(1, maxMatch - minMatch);

  const x = (m: number) => pad.l + ((m - minMatch) / matchSpan) * innerW;
  const yRuns = (r: number) => pad.t + innerH - (r / runsMax) * innerH;
  const ySr = (s: number) => pad.t + innerH - (s / srMax) * innerH;

  // 4 evenly-spaced gridlines on the runs axis.
  const runsStep = runsMax / 4;
  const runsTicks = [0, runsStep, runsStep * 2, runsStep * 3, runsMax];
  const srStep = srMax / 4;
  const srTicks = [0, srStep, srStep * 2, srStep * 3, srMax];

  // Show ~5 x-axis labels max, spaced evenly across the played matches.
  const xLabelStride = Math.max(1, Math.ceil(data.length / 5));
  const xLabels = data
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % xLabelStride === 0 || i === data.length - 1)
    .map(({ d }) => d.match);

  const runsLine = data
    .map((d) => `${x(d.match)},${yRuns(d.runs)}`)
    .join(" ");
  const runsArea = `${x(data[0].match)},${pad.t + innerH} ${runsLine} ${x(
    data[data.length - 1].match,
  )},${pad.t + innerH}`;

  // SR line: ignore points with null sr (player batted 0 balls) by splitting
  // the polyline into contiguous segments. Each segment renders separately.
  const srSegments: string[][] = [];
  let segCur: string[] = [];
  for (const d of data) {
    if (d.sr == null) {
      if (segCur.length > 1) srSegments.push(segCur);
      segCur = [];
    } else {
      segCur.push(`${x(d.match)},${ySr(d.sr)}`);
    }
  }
  if (segCur.length > 1) srSegments.push(segCur);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      className="block"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* Horizontal gridlines (anchored to the runs axis) */}
      {runsTicks.map((t) => (
        <line
          key={`g-${t}`}
          x1={pad.l}
          x2={pad.l + innerW}
          y1={yRuns(t)}
          y2={yRuns(t)}
          stroke="var(--color-ipl-line2)"
          strokeWidth={1}
        />
      ))}

      {/* Filled area under the runs line */}
      <polygon points={runsArea} fill={color} fillOpacity={0.12} />

      {/* Average reference line (runs axis) — line only; the value is already
          surfaced in the hero stats above the chart. */}
      {avg != null && avg > 0 && avg <= runsMax && (
        <line
          x1={pad.l}
          x2={pad.l + innerW}
          y1={yRuns(avg)}
          y2={yRuns(avg)}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="3 3"
          strokeOpacity={0.55}
        />
      )}

      {/* SR line — dashed to distinguish from the runs line. */}
      {hasSr &&
        srSegments.map((s, i) => (
          <polyline
            key={`sr-${i}`}
            points={s.join(" ")}
            fill="none"
            stroke={srColor}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

      {/* Runs line */}
      <polyline
        points={runsLine}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* SR markers — small open circles so they don't compete with runs dots. */}
      {hasSr &&
        data.map(
          (d) =>
            d.sr != null && (
              <circle
                key={`srpt-${d.match}`}
                cx={x(d.match)}
                cy={ySr(d.sr)}
                r={2.25}
                fill="#fff"
                stroke={srColor}
                strokeWidth={1.25}
              />
            ),
        )}

      {/* Data point dots with native tooltips. Visible dot is small (r=3); an
          invisible larger circle on top widens the hover target so the tooltip
          fires reliably even when dots cluster. The hover target sits on top
          of both lines so the tooltip covers the whole point. */}
      {data.map((d) => (
        <g key={`pt-${d.match}`} style={{ cursor: "default" }}>
          <circle
            cx={x(d.match)}
            cy={yRuns(d.runs)}
            r={3}
            fill={color}
            stroke="#fff"
            strokeWidth={1.25}
          />
          <circle
            cx={x(d.match)}
            cy={yRuns(d.runs)}
            r={10}
            fill={color}
            fillOpacity={0.001}
          >
            <title>{d.tooltip ?? `Match ${d.match} · ${d.runs} runs`}</title>
          </circle>
        </g>
      ))}

      {/* Left Y-axis tick labels (runs) */}
      {runsTicks.map((t) => (
        <text
          key={`yl-${t}`}
          x={pad.l - 6}
          y={yRuns(t) + 3}
          textAnchor="end"
          fontSize={9}
          fill={color}
          style={{
            fontFamily: "var(--font-mono)",
            fontFeatureSettings: '"tnum", "zero"',
          }}
        >
          {Math.round(t)}
        </text>
      ))}

      {/* Right Y-axis tick labels (SR) — only when SR data is present. */}
      {hasSr &&
        srTicks.map((t) => (
          <text
            key={`sl-${t}`}
            x={pad.l + innerW + 6}
            y={ySr(t) + 3}
            textAnchor="start"
            fontSize={9}
            fill={srColor}
            style={{
              fontFamily: "var(--font-mono)",
              fontFeatureSettings: '"tnum", "zero"',
            }}
          >
            {Math.round(t)}
          </text>
        ))}

      {/* X-axis baseline */}
      <line
        x1={pad.l}
        x2={pad.l + innerW}
        y1={pad.t + innerH}
        y2={pad.t + innerH}
        stroke="var(--color-ipl-line)"
        strokeWidth={1}
      />

      {/* X-axis tick labels */}
      {xLabels.map((m) => (
        <text
          key={`xl-${m}`}
          x={x(m)}
          y={pad.t + innerH + 12}
          textAnchor="middle"
          fontSize={9}
          fill="var(--color-ipl-sub)"
          style={{
            fontFamily: "var(--font-mono)",
            fontFeatureSettings: '"tnum", "zero"',
          }}
        >
          {m}
        </text>
      ))}

      {/* X-axis title */}
      <text
        x={pad.l + innerW / 2}
        y={height - 2}
        textAnchor="middle"
        fontSize={8}
        fill="var(--color-ipl-soft)"
        style={{
          fontFamily: "var(--font-sans)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Matches played
      </text>
    </svg>
  );
}

/* --------------------------------------------------------------------------
   LEADERBOARD TABLE
   -------------------------------------------------------------------------- */

type SortKey = "innings" | "runs" | "hs" | "avg" | "sr" | "fours" | "sixes";

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "innings", label: "Inn" },
  { key: "runs", label: "Runs" },
  { key: "hs", label: "HS" },
  { key: "avg", label: "Avg" },
  { key: "sr", label: "SR" },
  { key: "fours", label: "4s" },
  { key: "sixes", label: "6s" },
];

function BatterTable({
  rows,
  phaseMap,
}: {
  rows: LeaderRow[];
  phaseMap: Map<string, PhaseBreakdown>;
}) {
  const { resolve } = usePlayerNames();
  // Default to runs ↓ (matches the SQL ORDER BY so the initial paint is identical).
  const [sortKey, setSortKey] = useState<SortKey>("runs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls sink to the end regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const handleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      // Numeric columns are most useful descending on first click.
      setSortDir("desc");
    }
  };

  return (
    <table className="w-full text-[12px] border-collapse">
      <thead>
        <tr className="text-ipl-sub">
          <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
            #
          </th>
          <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
            Batter
          </th>
          {SORT_COLUMNS.map((c) => {
            const active = sortKey === c.key;
            return (
              <th
                key={c.key}
                className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right"
              >
                <button
                  type="button"
                  onClick={() => handleSort(c.key)}
                  className={
                    "inline-flex items-center gap-1 cursor-pointer transition-colors " +
                    (active
                      ? "text-ipl-ink font-semibold"
                      : "hover:text-ipl-ink")
                  }
                >
                  {c.label}
                  <span
                    aria-hidden
                    className={"text-[8px] " + (active ? "opacity-100" : "opacity-30")}
                  >
                    {active ? (sortDir === "desc" ? "▼" : "▲") : "▼"}
                  </span>
                </button>
              </th>
            );
          })}
          <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
            Phase
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => {
          const srColor =
            r.sr == null
              ? "text-ipl-ink"
              : r.sr > 170
                ? "text-ipl-pos"
                : r.sr < 130
                  ? "text-ipl-neg"
                  : "text-ipl-ink";
          return (
            <tr
              key={r.batter}
              className="border-b border-ipl-line2 last:border-b-0 hover:bg-ipl-line2/40 animate-fade-in"
            >
              <td className="px-2.5 py-2.5 font-mono text-ipl-sub font-semibold">{i + 1}</td>
              <td className="px-2.5 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <TeamBadge team={r.team} size={20} />
                  <Link
                    href={`/player/${encodeURIComponent(r.batter)}`}
                    className="font-semibold text-ipl-ink hover:text-ipl-accent"
                  >
                    {resolve(r.batter)}
                  </Link>
                </span>
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">{r.innings}</td>
              <td className="px-2.5 py-2.5 text-right font-mono font-bold text-[13px]">
                {r.runs.toLocaleString()}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono">{r.hs}</td>
              <td className="px-2.5 py-2.5 text-right font-mono">{r.avg != null ? r.avg.toFixed(1) : "—"}</td>
              <td className={"px-2.5 py-2.5 text-right font-mono font-semibold " + srColor}>
                {r.sr != null ? r.sr.toFixed(1) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">{r.fours}</td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">{r.sixes}</td>
              <td className="px-2.5 py-2.5">
                <MiniPhaseBar phase={phaseMap.get(r.batter)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const PHASE_COLORS = {
  pp: "#a78bfa",
  mid: "var(--color-ipl-accent)",
  death: "var(--color-ipl-neg)",
} as const;

function MiniPhaseBar({ phase }: { phase: PhaseBreakdown | undefined }) {
  // Renders a 90×10 stacked bar with PP / Middle / Death runs and a multi-
  // line native tooltip listing each phase's runs, balls, and strike rate.
  // When the phase data hasn't loaded yet (phaseMap empty), the bar shows
  // an empty track so the row layout doesn't jump.
  const W = 90;
  const H = 10;
  if (!phase) {
    return (
      <div className="bg-ipl-line2 rounded-sm" style={{ width: W, height: H }} />
    );
  }
  const total = phase.pp + phase.mid + phase.death;
  if (total === 0) {
    return (
      <div className="bg-ipl-line2 rounded-sm" style={{ width: W, height: H }} />
    );
  }
  const sr = (runs: number, balls: number) =>
    balls > 0 ? ((runs / balls) * 100).toFixed(1) : "—";
  const segs = [
    {
      key: "pp" as const,
      label: "Powerplay",
      runs: phase.pp,
      balls: phase.ppBalls,
    },
    {
      key: "mid" as const,
      label: "Middle",
      runs: phase.mid,
      balls: phase.midBalls,
    },
    {
      key: "death" as const,
      label: "Death",
      runs: phase.death,
      balls: phase.deathBalls,
    },
  ];
  const tooltip = segs
    .map(
      (s) =>
        `${s.label}: ${s.runs} runs · ${s.balls} balls · SR ${sr(s.runs, s.balls)}`,
    )
    .join("\n");
  return (
    <div
      className="flex rounded-sm overflow-hidden cursor-default"
      style={{ width: W, height: H }}
      title={tooltip}
    >
      {segs.map((s) => {
        const pct = (s.runs / total) * 100;
        if (pct <= 0) return null;
        return (
          <div
            key={s.key}
            style={{ width: `${pct}%`, background: PHASE_COLORS[s.key] }}
          />
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
   BATTING BY PHASE · league/team metrics heatmap + donut
   -------------------------------------------------------------------------- */

type PhaseAggRow = {
  phase: string;
  total_runs: number;
  balls: number;
  boundaries: number;
  dots: number;
};

type PhaseKey = "powerplay" | "middle" | "death";

const PHASE_META: { key: PhaseKey; label: string; donutColor: string }[] = [
  { key: "powerplay", label: "Powerplay (1-6)", donutColor: "#3a5cff" },
  { key: "middle", label: "Middle (7-15)", donutColor: "#0ea5e9" },
  { key: "death", label: "Death (16-20)", donutColor: "#bfdbfe" },
];

function BattingByPhaseCard({ year }: { year: number }) {
  const [teamFilter, setTeamFilter] = useState<string>(OVERALL);

  const teamsQ = useDuckQuery<TeamRow>(
    `SELECT DISTINCT team
     FROM batting_scorecard
     WHERE season = ${year} AND team IS NOT NULL
     ORDER BY team`,
  );

  const teamClause =
    teamFilter === OVERALL ? "" : `AND team = '${sqlEscape(teamFilter)}'`;

  // total_runs = batter runs + extras; balls = legal deliveries; boundaries
  // are 4s/6s off the bat only; dots = legal balls where no runs scored.
  const q = useDuckQuery<PhaseAggRow>(
    `SELECT phase,
            CAST(SUM(total_runs) AS BIGINT) AS total_runs,
            CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0
                          THEN 1 ELSE 0 END) AS BIGINT) AS balls,
            CAST(SUM(CASE WHEN batter_runs IN (4,6)
                          THEN 1 ELSE 0 END) AS BIGINT) AS boundaries,
            CAST(SUM(CASE WHEN total_runs = 0
                          AND COALESCE(wides,0)=0
                          AND COALESCE(noballs,0)=0
                          THEN 1 ELSE 0 END) AS BIGINT) AS dots
     FROM ball_by_ball
     WHERE season = ${year} AND phase IS NOT NULL ${teamClause}
     GROUP BY phase`,
  );

  type Metrics = {
    runRate: number;
    boundaryPct: number;
    dotPct: number;
    runs: number;
  };

  // Stable cache: hold the last successful metrics + the team they belong to,
  // so flipping the dropdown swaps data in place instead of flashing Loading.
  // Render-time setState pattern (guarded by a signature) avoids needing a
  // useEffect to mirror query results into state.
  const [stable, setStable] = useState<{
    team: string;
    metrics: Map<PhaseKey, Metrics>;
    loaded: boolean;
    sig: string;
  }>({ team: OVERALL, metrics: new Map(), loaded: false, sig: "" });

  if (q.status === "success") {
    const sig = `${teamFilter}|${q.data.length}|${q.data
      .map((r) => `${r.phase}:${r.total_runs}:${r.balls}`)
      .join(",")}`;
    if (sig !== stable.sig) {
      const m = new Map<PhaseKey, Metrics>();
      for (const r of q.data) {
        if (
          r.phase !== "powerplay" &&
          r.phase !== "middle" &&
          r.phase !== "death"
        )
          continue;
        const balls = r.balls;
        m.set(r.phase, {
          runRate: balls > 0 ? (6 * r.total_runs) / balls : 0,
          boundaryPct: balls > 0 ? (100 * r.boundaries) / balls : 0,
          dotPct: balls > 0 ? (100 * r.dots) / balls : 0,
          runs: r.total_runs,
        });
      }
      setStable({ team: teamFilter, metrics: m, loaded: true, sig });
    }
  }

  // Use the cached metrics when present. Color the heatmap/donut with the
  // currently-selected team's brand color (null when "All Teams" selected).
  const baseColor =
    stable.team === OVERALL ? null : teamColor(stable.team);
  const showLoading =
    q.status === "loading" && !stable.loaded;
  const showError = q.status === "error";

  return (
    <Card
      kicker="PHASE"
      title="Batting by Phase"
      padded
      action={
        <TeamDropdown
          value={teamFilter}
          onChange={setTeamFilter}
          teams={teamsQ.status === "success" ? teamsQ.data.map((t) => t.team) : []}
          defaultLabel="All Teams"
        />
      }
    >
      {showLoading && <LoadingCell />}
      {showError && q.status === "error" && (
        <ErrorCell message={q.error.message} />
      )}
      {!showLoading && !showError && stable.metrics.size === 0 && (
        <div className="text-ipl-sub text-sm">No phase data for this filter.</div>
      )}
      {!showLoading && !showError && stable.metrics.size > 0 && (
        <div className="flex flex-col gap-4">
          <PhaseHeatmap metrics={stable.metrics} baseColor={baseColor} />
          <div className="border-t border-ipl-line2 pt-3">
            <div className="text-center text-[11px] uppercase tracking-[0.08em] font-semibold text-ipl-sub mb-2">
              Runs by Phase
            </div>
            <PhaseDonut metrics={stable.metrics} baseColor={baseColor} />
          </div>
        </div>
      )}
    </Card>
  );
}

const HEATMAP_COLS: {
  key: "runRate" | "boundaryPct" | "dotPct";
  label: string;
  fmt: (v: number) => string;
}[] = [
  { key: "runRate", label: "Run Rate", fmt: (v) => v.toFixed(2) },
  { key: "boundaryPct", label: "Boundary %", fmt: (v) => v.toFixed(1) },
  { key: "dotPct", label: "Dot Ball %", fmt: (v) => v.toFixed(1) },
];

// Default blue ramp endpoints used when no specific team is selected
// ("All Teams" view). When a team is picked, both endpoints are derived from
// that team's brand color so the heatmap reads as belonging to that team.
const DEFAULT_HEAT_LIGHT = { r: 219, g: 234, b: 254 }; // #dbeafe
const DEFAULT_HEAT_DARK = { r: 29, g: 78, b: 216 }; // #1d4ed8

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return { r: 113, g: 113, b: 122 }; // neutral fallback
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

/** Mix a color with white. t=0 returns the original; t=1 returns white. */
function mixWithWhite(rgb: { r: number; g: number; b: number }, t: number) {
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * t),
    g: Math.round(rgb.g + (255 - rgb.g) * t),
    b: Math.round(rgb.b + (255 - rgb.b) * t),
  };
}

function rgbStr(rgb: { r: number; g: number; b: number }) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

/** sRGB-approximated relative luminance (0=black, 1=white). Used to pick a
 * legible text color against an arbitrary background. */
function lumaOf(rgb: { r: number; g: number; b: number }) {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** Build a heatmap color ramp from a base team color. Light end is a tinted
 * version of the brand color; dark end is the brand color itself. */
function rampFor(baseHex: string | null) {
  if (!baseHex)
    return { light: DEFAULT_HEAT_LIGHT, dark: DEFAULT_HEAT_DARK };
  const base = hexToRgb(baseHex);
  return { light: mixWithWhite(base, 0.82), dark: base };
}

function heatColor(t: number, ramp: ReturnType<typeof rampFor>): string {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(ramp.light.r + (ramp.dark.r - ramp.light.r) * clamped);
  const g = Math.round(ramp.light.g + (ramp.dark.g - ramp.light.g) * clamped);
  const b = Math.round(ramp.light.b + (ramp.dark.b - ramp.light.b) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

function PhaseHeatmap({
  metrics,
  baseColor,
}: {
  metrics: Map<
    PhaseKey,
    { runRate: number; boundaryPct: number; dotPct: number; runs: number }
  >;
  baseColor: string | null;
}) {
  // Per-column min/max so each metric's color scale is independent.
  const colRanges = HEATMAP_COLS.map((c) => {
    const vals = PHASE_META.map((p) => metrics.get(p.key)?.[c.key] ?? 0);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  });
  const ramp = rampFor(baseColor);

  return (
    <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-1.5">
      {/* Header row */}
      <div />
      {HEATMAP_COLS.map((c) => (
        <div
          key={`h-${c.key}`}
          className="text-center text-[11px] text-ipl-sub font-medium pb-1"
        >
          {c.label}
        </div>
      ))}
      {/* Body rows: one per phase × three metric cells */}
      {PHASE_META.map((p) => (
        <Fragment key={p.key}>
          <div className="text-[11px] text-ipl-ink font-medium self-center pr-2">
            {p.label}
          </div>
          {HEATMAP_COLS.map((c, ci) => {
            const m = metrics.get(p.key);
            const v = m?.[c.key] ?? 0;
            const range = colRanges[ci];
            const t =
              range.max === range.min
                ? 0.5
                : (v - range.min) / (range.max - range.min);
            const bg = heatColor(t, ramp);
            // Text color picks from luminance of the actual cell background:
            // the threshold flips between dark/light dynamically so brand
            // colors like CSK yellow still get dark text on the saturated
            // end of the ramp, while deep brand colors (MI blue, KKR purple)
            // get white text.
            const cellRgb = mixWithWhite(ramp.dark, 1 - t);
            const fg = lumaOf(cellRgb) > 0.6 ? "var(--color-ipl-ink)" : "#ffffff";
            return (
              <div
                key={`${p.key}-${c.key}`}
                title={`${p.label}\n${c.label}: ${c.fmt(v)}`}
                className="rounded-md text-center font-mono font-semibold text-[15px] py-2 cursor-default animate-fade-in"
                style={{ backgroundColor: bg, color: fg }}
              >
                {c.fmt(v)}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function PhaseDonut({
  metrics,
  baseColor,
}: {
  metrics: Map<
    PhaseKey,
    { runRate: number; boundaryPct: number; dotPct: number; runs: number }
  >;
  baseColor: string | null;
}) {
  // When a team is picked, derive three shades from its brand color so the
  // donut visually belongs to the team: PP gets the saturated brand color,
  // Middle a medium tint, Death a light tint. Default palette kicks in for
  // the "All Teams" view.
  const phaseColors = (() => {
    if (!baseColor) {
      return PHASE_META.map((p) => p.donutColor);
    }
    const base = hexToRgb(baseColor);
    return [
      rgbStr(base), // PP: full brand color
      rgbStr(mixWithWhite(base, 0.45)), // Mid: medium tint
      rgbStr(mixWithWhite(base, 0.78)), // Death: light tint
    ];
  })();

  const segments = PHASE_META.map((p, i) => ({
    key: p.key,
    label: p.label,
    color: phaseColors[i],
    runs: metrics.get(p.key)?.runs ?? 0,
  }));
  const total = segments.reduce((s, x) => s + x.runs, 0) || 1;

  const size = 130;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;

  // Cumulative starts so each segment's offset/dasharray draws correctly.
  const cumStarts: number[] = [];
  segments.reduce((acc, s) => {
    cumStarts.push(acc);
    return acc + s.runs / total;
  }, 0);

  // Position external labels at the angular midpoint of each segment, on the
  // appropriate side based on whether the midpoint lies on the left/right
  // half of the donut.
  const labels = segments.map((s, i) => {
    const frac = s.runs / total;
    const midFraction = cumStarts[i] + frac / 2;
    const angle = -Math.PI / 2 + midFraction * 2 * Math.PI;
    const lr = radius + stroke / 2 + 14;
    const lx = size / 2 + lr * Math.cos(angle);
    const ly = size / 2 + lr * Math.sin(angle);
    return {
      ...s,
      pct: frac * 100,
      angle,
      lx,
      ly,
      anchor: Math.cos(angle) >= 0 ? "start" : "end",
    } as const;
  });

  // Horizontal padding around the donut sized for ~14-char phase labels
  // ("Powerplay (1-6)" / "Death (16-20)") at fontSize 11 — about 90px wide.
  // The donut sits centered between the two label gutters.
  const margin = 100;
  const svgW = size + margin * 2;
  return (
    <div className="flex justify-center">
      <svg
        width={svgW}
        height={size + 20}
        viewBox={`0 0 ${svgW} ${size + 20}`}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <g transform={`translate(${margin + size / 2}, ${10 + size / 2}) rotate(-90)`}>
          {segments.map((s, i) => {
            const pct = s.runs / total;
            const dash = pct * circ;
            const offset = -cumStarts[i] * circ;
            return (
              <circle
                key={s.key}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={offset}
              >
                <title>{`${s.label}: ${s.runs.toLocaleString()} runs (${(pct * 100).toFixed(1)}%)`}</title>
              </circle>
            );
          })}
        </g>
        {/* Center label */}
        <text
          x={margin + size / 2}
          y={10 + size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={600}
          fill="var(--color-ipl-ink)"
        >
          Runs
        </text>
        {/* External phase labels with percentages */}
        {labels.map((l) => (
          <g key={`l-${l.key}`} transform={`translate(${margin}, 10)`}>
            <text
              x={l.lx}
              y={l.ly - 4}
              textAnchor={l.anchor}
              fontSize={11}
              fontWeight={500}
              fill="var(--color-ipl-ink)"
            >
              {l.label}
            </text>
            <text
              x={l.lx}
              y={l.ly + 9}
              textAnchor={l.anchor}
              fontSize={11}
              fontWeight={600}
              fill="var(--color-ipl-sub)"
              style={{
                fontFamily: "var(--font-mono)",
                fontFeatureSettings: '"tnum", "zero"',
              }}
            >
              {l.pct.toFixed(1)}%
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------------------
   SR vs Avg SCATTER
   -------------------------------------------------------------------------- */

type ScatterRow = {
  batter: string;
  team: string;
  balls: number;
  runs: number;
  innings: number;
  avg: number | null;
  sr: number | null;
};

type TeamRow = { team: string };

const OVERALL = "__overall__";

function ScatterCardShell({ year }: { year: number }) {
  const [teamFilter, setTeamFilter] = useState<string>(OVERALL);

  // List of distinct teams that fielded a batter this season. Drives the
  // dropdown options. Ordered alphabetically by canonical name.
  const teamsQ = useDuckQuery<TeamRow>(
    `SELECT DISTINCT team
     FROM batting_scorecard
     WHERE season = ${year} AND team IS NOT NULL
     ORDER BY team`,
  );
  const teamOptions = teamsQ.status === "success" ? teamsQ.data : [];

  // Pulling the scatter's own query so the team filter operates on the full
  // set of season batters, not just the top-by-runs leaderboard. SQL filter
  // is conditional: no clause when "overall" is selected.
  const teamClause =
    teamFilter === OVERALL
      ? ""
      : `AND team = '${sqlEscape(teamFilter)}'`;
  const q = useDuckQuery<ScatterRow>(
    `SELECT
        batter,
        ANY_VALUE(team) AS team,
        CAST(SUM(balls) AS BIGINT) AS balls,
        CAST(SUM(runs) AS BIGINT) AS runs,
        CAST(COUNT(*) AS BIGINT) AS innings,
        CAST(SUM(runs) AS DOUBLE) /
          NULLIF(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END), 0) AS avg,
        100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL ${teamClause}
     GROUP BY batter
     HAVING SUM(balls) >= ${SCATTER_MIN_BALLS}`,
  );

  // Stable cache so flipping the team dropdown swaps points in place rather
  // than flashing a Loading cell. Signature includes the filter so a refetch
  // with identical row count but different team still triggers the swap.
  const [stable, setStable] = useState<{
    rows: ScatterRow[];
    loaded: boolean;
    sig: string;
  }>({ rows: [], loaded: false, sig: "" });

  if (q.status === "success") {
    const sig = `${teamFilter}|${q.data.length}|${
      q.data[0]?.batter ?? ""
    }|${q.data[0]?.runs ?? 0}`;
    if (sig !== stable.sig) {
      setStable({ rows: q.data, loaded: true, sig });
    }
  }

  const showLoading = q.status === "loading" && !stable.loaded;
  const showError = q.status === "error";

  return (
    <Card
      kicker="STRIKE RATE"
      title="SR vs Avg · qualified"
      padded
      action={
        <TeamDropdown
          value={teamFilter}
          onChange={setTeamFilter}
          teams={teamOptions.map((t) => t.team)}
        />
      }
    >
      {showLoading && <LoadingCell />}
      {showError && q.status === "error" && (
        <ErrorCell message={q.error.message} />
      )}
      {!showLoading && !showError && <ScatterCard rows={stable.rows} />}
    </Card>
  );
}

function TeamDropdown({
  value,
  onChange,
  teams,
  defaultLabel = "Overall",
}: {
  value: string;
  onChange: (v: string) => void;
  teams: string[];
  defaultLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-ipl-line bg-ipl-bg px-2 py-0.5 text-[11px] font-semibold text-ipl-ink hover:bg-ipl-line2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ipl-accent"
    >
      <option value={OVERALL}>{defaultLabel}</option>
      {teams.map((t) => (
        <option key={t} value={t}>
          {teamShort(t) || t}
        </option>
      ))}
    </select>
  );
}

function ScatterCard({ rows }: { rows: ScatterRow[] }) {
  const { resolve } = usePlayerNames();
  const points = useMemo<ScatterPoint[]>(() => {
    return rows
      .filter((r) => r.avg != null && r.sr != null)
      .map((r) => ({
        x: r.avg as number,
        y: r.sr as number,
        label: shortName(resolve(r.batter)),
        color: teamColor(r.team),
        // Full-name + team header, then the two scatter coords with units,
        // then the supporting line (runs/innings/balls) so reader can sanity-
        // check the avg/SR they see.
        tooltip: [
          `${resolve(r.batter)} (${teamShort(r.team) || r.team})`,
          `Avg ${(r.avg as number).toFixed(1)} · SR ${(r.sr as number).toFixed(1)}`,
          `${r.runs} runs · ${r.innings} inn · ${r.balls} balls`,
        ].join("\n"),
      }));
  }, [rows, resolve]);
  if (points.length === 0) {
    return (
      <div className="text-ipl-sub text-sm">
        Not enough qualified batters ({SCATTER_MIN_BALLS}+ balls) yet.
      </div>
    );
  }
  return (
    <Scatter
      data={points}
      xLabel="Average"
      yLabel="Strike rate"
      width={520}
      height={300}
    />
  );
}

/* --------------------------------------------------------------------------
   BEST SINGLE INNINGS · top 10 individual knocks, rendered as a
   ball-by-ball spark per innings. Each cell = one legal delivery the
   striker faced, colored by outcome (dot / 1 / 2-3 / 4 / 6 / wicket).
   -------------------------------------------------------------------------- */

type BestInningsRow = {
  batter: string;
  team: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  opponent: string;
  match_number: number;
  cricsheet_match_id: number | null;
};

type BallRow = {
  batter: string;
  match_number: number;
  over: number;
  ball_seq: number;
  batter_runs: number;
  is_wicket: boolean;
  striker_out: boolean;
};

const TOP_INNINGS_LIMIT = 10;
const SPARK_CELL_W = 4;
const SPARK_CELL_GAP = 1;
const SPARK_CELL_H = 12;

function ballColor(b: BallRow): string {
  if (b.striker_out) return "#dc2626"; // red-600
  if (b.batter_runs === 6) return "var(--color-ipl-orange)";
  if (b.batter_runs === 4) return "var(--color-ipl-accent)";
  if (b.batter_runs >= 2) return "#60a5fa"; // blue-400
  if (b.batter_runs === 1) return "#bfdbfe"; // blue-200
  return "#e4e4e7"; // zinc-200 (dot)
}

function ballTooltip(b: BallRow): string {
  const over = `${b.over}.${b.ball_seq}`;
  if (b.striker_out) return `Over ${over} · OUT`;
  if (b.batter_runs === 0) return `Over ${over} · dot`;
  return `Over ${over} · ${b.batter_runs}`;
}

function BestInningsCard({ year }: { year: number }) {
  // Top 10 innings — same shape as before but limit raised to 10.
  const top = useDuckQuery<BestInningsRow>(
    `SELECT bs.batter,
            bs.team,
            CAST(bs.runs AS BIGINT) AS runs,
            CAST(bs.balls AS BIGINT) AS balls,
            CAST(bs.fours AS BIGINT) AS fours,
            CAST(bs.sixes AS BIGINT) AS sixes,
            CASE WHEN bs.team = m.team_1 THEN m.team_2 ELSE m.team_1 END AS opponent,
            CAST(bs.match_number AS BIGINT) AS match_number,
            m.cricsheet_match_id
     FROM batting_scorecard bs
     JOIN matches m ON bs.season = m.season AND bs.match_number = m.match_number
     WHERE bs.season = ${year} AND bs.batter IS NOT NULL
     ORDER BY bs.runs DESC, bs.balls ASC
     LIMIT ${TOP_INNINGS_LIMIT}`,
  );

  // Build an OR-chain filter on (batter, match_number) so the second query
  // only fetches deliveries belonging to the top 10 innings.
  const innFilter = useMemo(() => {
    if (top.status !== "success") return "";
    return top.data
      .map(
        (r) =>
          `(bbb.batter='${sqlEscape(r.batter)}' AND bbb.match_number=${r.match_number})`,
      )
      .join(" OR ");
  }, [top]);

  const balls = useDuckQuery<BallRow>(
    innFilter
      ? `SELECT bbb.batter,
                CAST(bbb.match_number AS BIGINT) AS match_number,
                CAST(bbb.over AS INTEGER) AS over,
                CAST(bbb.ball AS DOUBLE) AS ball_seq,
                CAST(bbb.batter_runs AS INTEGER) AS batter_runs,
                bbb.is_wicket,
                CASE WHEN bbb.is_wicket AND bbb.player_out = bbb.batter
                     THEN TRUE ELSE FALSE END AS striker_out
         FROM ball_by_ball bbb
         WHERE bbb.season = ${year}
           AND COALESCE(bbb.wides,0)=0 AND COALESCE(bbb.noballs,0)=0
           AND (${innFilter})
         ORDER BY bbb.batter, bbb.match_number, bbb.over, CAST(bbb.ball AS DOUBLE)`
      : `SELECT NULL AS batter, 0 AS match_number, 0 AS over, 0 AS ball_seq,
                0 AS batter_runs, FALSE AS is_wicket, FALSE AS striker_out
         WHERE FALSE`,
  );

  const ballsByInnings = useMemo(() => {
    const m = new Map<string, BallRow[]>();
    if (balls.status !== "success") return m;
    for (const r of balls.data) {
      const k = `${r.batter}|${r.match_number}`;
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return m;
  }, [balls]);

  const maxBalls = useMemo(() => {
    if (top.status !== "success" || top.data.length === 0) return 0;
    return Math.max(...top.data.map((r) => r.balls));
  }, [top]);

  const { resolve } = usePlayerNames();

  return (
    <Card kicker="STANDOUT" title="Top 10 individual innings" padded>
      {top.status === "loading" && <LoadingCell />}
      {top.status === "error" && <ErrorCell message={top.error.message} />}
      {top.status === "success" && top.data.length === 0 && (
        <div className="text-ipl-sub text-sm">No innings yet.</div>
      )}
      {top.status === "success" && top.data.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <SparkLegend />
          <div className="flex flex-col gap-2">
            {top.data.map((r, i) => {
              const key = `${r.batter}|${r.match_number}`;
              return (
                <BestInningsSparkRow
                  key={key}
                  rank={i + 1}
                  row={r}
                  balls={ballsByInnings.get(key) ?? []}
                  maxBalls={maxBalls}
                  resolveName={resolve}
                />
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function SparkLegend() {
  const items: { label: string; color: string }[] = [
    { label: "dot", color: "#e4e4e7" },
    { label: "1", color: "#bfdbfe" },
    { label: "2/3", color: "#60a5fa" },
    { label: "4", color: "var(--color-ipl-accent)" },
    { label: "6", color: "var(--color-ipl-orange)" },
    { label: "W", color: "#dc2626" },
  ];
  return (
    <div className="flex items-center gap-3 text-[10px] text-ipl-sub font-mono">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span
            className="inline-block rounded-[1px]"
            style={{ width: 8, height: 8, background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function BestInningsSparkRow({
  rank,
  row,
  balls,
  maxBalls,
  resolveName,
}: {
  rank: number;
  row: BestInningsRow;
  balls: BallRow[];
  maxBalls: number;
  resolveName: (name: string) => string;
}) {
  const matchLink = row.cricsheet_match_id
    ? `/match/${row.cricsheet_match_id}`
    : null;
  const stripWidth =
    maxBalls > 0
      ? maxBalls * SPARK_CELL_W + (maxBalls - 1) * SPARK_CELL_GAP
      : 0;
  return (
    <div className="flex flex-col gap-1 animate-fade-in">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-mono w-3.5 text-right text-ipl-sub font-semibold">
          {rank}
        </span>
        <TeamBadge team={row.team} size={18} />
        <Link
          href={`/player/${encodeURIComponent(row.batter)}`}
          className="font-semibold text-ipl-ink hover:text-ipl-accent truncate text-[12px]"
        >
          {resolveName(row.batter)}
        </Link>
        <span className="text-[10px] text-ipl-sub inline-flex items-center gap-1 truncate">
          vs <TeamBadge team={row.opponent} size={10} />
          {teamShort(row.opponent)}
          {matchLink && (
            <>
              <span>·</span>
              <Link
                href={matchLink}
                className="hover:text-ipl-accent underline-offset-2 hover:underline"
              >
                M{row.match_number}
              </Link>
            </>
          )}
        </span>
        <div className="ml-auto font-mono font-bold text-[14px] text-ipl-ink leading-none tracking-[-0.02em]">
          {row.runs}
          <span className="text-[10px] text-ipl-sub font-medium">
            {" "}
            ({row.balls})
          </span>
        </div>
      </div>
      <div className="pl-[26px]">
        <div
          className="flex items-center"
          style={{
            gap: `${SPARK_CELL_GAP}px`,
            height: SPARK_CELL_H,
            width: stripWidth,
          }}
        >
          {balls.map((b, i) => (
            <div
              key={i}
              className="rounded-[1px]"
              style={{
                width: SPARK_CELL_W,
                height: SPARK_CELL_H,
                background: ballColor(b),
              }}
              title={ballTooltip(b)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   STRIKE RATE LEADERS · min 7 matches, 100 balls
   -------------------------------------------------------------------------- */

type StrikeRateRow = {
  batter: string;
  team: string;
  matches: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  sr: number | null;
};

const SR_MIN_MATCHES = 7;
const SR_MIN_BALLS = 100;
const SR_LIMIT = 10;

function StrikeRateCard({ year }: { year: number }) {
  const q = useDuckQuery<StrikeRateRow>(
    `SELECT batter,
            ANY_VALUE(team) AS team,
            CAST(COUNT(*) AS BIGINT)   AS matches,
            CAST(SUM(runs)  AS BIGINT) AS runs,
            CAST(SUM(balls) AS BIGINT) AS balls,
            CAST(SUM(fours) AS BIGINT) AS fours,
            CAST(SUM(sixes) AS BIGINT) AS sixes,
            100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
     FROM batting_scorecard
     WHERE season = ${year} AND batter IS NOT NULL
     GROUP BY batter
     HAVING COUNT(*) >= ${SR_MIN_MATCHES} AND SUM(balls) >= ${SR_MIN_BALLS}
     ORDER BY sr DESC
     LIMIT ${SR_LIMIT}`,
  );
  const { resolve } = usePlayerNames();

  return (
    <Card
      kicker="TEMPO"
      title={`Top strike rates · min ${SR_MIN_MATCHES} matches, ${SR_MIN_BALLS} balls`}
      padded={false}
    >
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorCell message={q.error.message} />}
      {q.status === "success" && q.data.length === 0 && (
        <div className="p-6 text-ipl-sub text-sm">
          No batters meet the threshold yet.
        </div>
      )}
      {q.status === "success" && q.data.length > 0 && (
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-ipl-sub">
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
                #
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
                Batter
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                M
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                Runs
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                Balls
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                SR
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                4s
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                6s
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((r, i) => (
              <tr
                key={r.batter}
                className="border-b border-ipl-line2 last:border-b-0 hover:bg-ipl-line2/40 animate-fade-in"
              >
                <td className="px-2.5 py-2.5 font-mono text-ipl-sub font-semibold">
                  {i + 1}
                </td>
                <td className="px-2.5 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <TeamBadge team={r.team} size={18} />
                    <Link
                      href={`/player/${encodeURIComponent(r.batter)}`}
                      className="font-semibold text-ipl-ink hover:text-ipl-accent truncate"
                    >
                      {resolve(r.batter)}
                    </Link>
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.matches}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono">
                  {r.runs.toLocaleString()}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.balls}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono font-bold text-[13px] text-ipl-ink">
                  {r.sr != null ? r.sr.toFixed(1) : "—"}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.fours}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.sixes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------------------
   HELPERS
   -------------------------------------------------------------------------- */

function LoadingCell() {
  return <div className="p-6 text-center text-ipl-sub text-sm">Loading…</div>;
}

function ErrorCell({ message }: { message: string }) {
  return <pre className="p-3 text-ipl-neg text-xs whitespace-pre-wrap">{message}</pre>;
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/** Compact a long display name like "Virat Kohli" → "V Kohli". */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const first = parts[0].charAt(0).toUpperCase();
  return `${first} ${last}`;
}
