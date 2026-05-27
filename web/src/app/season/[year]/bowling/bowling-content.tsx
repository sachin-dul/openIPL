"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { teamColor, teamShort } from "@/lib/teams";
import { WICKET_EXCLUDE } from "@/lib/cricket-sql";
import { TeamBadge } from "@/components/team-badge";
import { Card } from "@/components/card";
import { PageHead } from "@/components/page-head";
import { Scatter, type ScatterPoint } from "@/components/charts/scatter";

const LEADERBOARD_LIMIT = 10;
// Hardcoded floor that keeps part-time bowlers from cluttering the scatter.
// 12 overs ≈ three full spells, the conventional qualifier for econ/avg.
const SCATTER_MIN_OVERS = 12;
const TOP_FIGURES_LIMIT = 10;
const ECON_MIN_MATCHES = 7;
const ECON_MIN_OVERS = 12;

type BowlRow = {
  bowler: string;
  team: string;
  wickets: number;
  innings: number;
  overs: number;
  runs: number;
  econ: number | null;
  avg: number | null;
  sr: number | null;
  best_w: number;
  best_r: number;
};

type SparkRow = {
  match_number: number;
  wickets: number;
  runs: number;
  overs: number;
  opponent: string;
};

type PhaseRaw = {
  bowler: string;
  phase: string;
  wkts: number;
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

export function BowlingContent({ year }: { year: number }) {
  // Career-by-season leaderboard: per-bowler aggregates plus the best single
  // innings figure (joined in via `best_inn`). Bowler "overs" need to come
  // from a sum of overs+balls, not a naive SUM(overs) — a bowler with 3.4+2.2
  // has 6.0 overs, not 5.6.
  const leaderboard = useDuckQuery<BowlRow>(
    `WITH per_bowler AS (
        SELECT
          bowler,
          ANY_VALUE(team) AS team,
          CAST(SUM(wickets) AS BIGINT) AS wickets,
          CAST(COUNT(*) AS BIGINT) AS innings,
          CAST(SUM(runs) AS BIGINT) AS runs,
          CAST(SUM(FLOOR(overs)) + FLOOR((SUM(overs - FLOOR(overs)) * 10 + 0.0001) / 6.0) AS BIGINT) AS full_overs,
          CAST(MOD(SUM(overs - FLOOR(overs)) * 10 + 0.0001, 6.0) AS DOUBLE) AS extra_balls
        FROM bowling_scorecard
        WHERE season = ${year} AND bowler IS NOT NULL
        GROUP BY bowler
      ),
      best_inn AS (
        SELECT bowler, wickets, runs FROM (
          SELECT bowler, wickets, runs,
                 ROW_NUMBER() OVER (
                   PARTITION BY bowler
                   ORDER BY wickets DESC, runs ASC
                 ) AS rk
          FROM bowling_scorecard
          WHERE season = ${year} AND bowler IS NOT NULL
        ) WHERE rk = 1
      )
      SELECT
        p.bowler,
        p.team,
        p.wickets,
        p.innings,
        CAST(p.full_overs + p.extra_balls / 6.0 AS DOUBLE) AS overs,
        p.runs,
        CASE WHEN p.full_overs + p.extra_balls / 6.0 > 0
             THEN p.runs / (p.full_overs + p.extra_balls / 6.0)
             ELSE NULL END                       AS econ,
        CASE WHEN p.wickets > 0
             THEN CAST(p.runs AS DOUBLE) / p.wickets
             ELSE NULL END                       AS avg,
        CASE WHEN p.wickets > 0
             THEN ((p.full_overs * 6) + p.extra_balls) / CAST(p.wickets AS DOUBLE)
             ELSE NULL END                       AS sr,
        CAST(b.wickets AS BIGINT) AS best_w,
        CAST(b.runs    AS BIGINT) AS best_r
      FROM per_bowler p
      LEFT JOIN best_inn b ON b.bowler = p.bowler
      ORDER BY p.wickets DESC, p.runs ASC
      LIMIT ${LEADERBOARD_LIMIT}`,
  );

  // Phase-level wickets + legal balls for the leaderboard bowlers. Runs in
  // parallel with the leaderboard query; the table renders empty bars until
  // this resolves, so the leaderboard isn't blocked on phase data.
  const phaseQ = useDuckQuery<PhaseRaw>(
    `WITH topN AS (
        SELECT bowler FROM bowling_scorecard
        WHERE season = ${year} AND bowler IS NOT NULL
        GROUP BY bowler
        ORDER BY SUM(wickets) DESC, SUM(runs) ASC
        LIMIT ${LEADERBOARD_LIMIT}
      )
      SELECT bowler, phase,
             CAST(SUM(CASE WHEN is_wicket AND ${WICKET_EXCLUDE}
                           THEN 1 ELSE 0 END) AS BIGINT) AS wkts,
             CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0
                           THEN 1 ELSE 0 END) AS BIGINT) AS balls
      FROM ball_by_ball
      WHERE season = ${year}
        AND bowler IN (SELECT bowler FROM topN)
        AND phase IS NOT NULL
      GROUP BY bowler, phase`,
  );

  const rows = leaderboard.status === "success" ? leaderboard.data : [];
  const top = rows[0];

  const phaseMap = useMemo(() => {
    const m = new Map<string, PhaseBreakdown>();
    if (phaseQ.status !== "success") return m;
    for (const r of phaseQ.data) {
      const cur =
        m.get(r.bowler) ??
        ({
          pp: 0,
          mid: 0,
          death: 0,
          ppBalls: 0,
          midBalls: 0,
          deathBalls: 0,
        } satisfies PhaseBreakdown);
      if (r.phase === "powerplay") {
        cur.pp = r.wkts;
        cur.ppBalls = r.balls;
      } else if (r.phase === "middle") {
        cur.mid = r.wkts;
        cur.midBalls = r.balls;
      } else if (r.phase === "death") {
        cur.death = r.wkts;
        cur.deathBalls = r.balls;
      }
      m.set(r.bowler, cur);
    }
    return m;
  }, [phaseQ]);

  return (
    <div>
      <PageHead title={`IPL ${year}`} />

      <div className="grid grid-cols-[1fr_1.6fr] gap-3.5">
        <PurpleCapHero
          year={year}
          top={top}
          loading={leaderboard.status === "loading"}
        />
        <Card
          kicker="LEADERBOARD"
          title={`Top ${LEADERBOARD_LIMIT} bowlers · all metrics`}
          padded={false}
        >
          {leaderboard.status === "loading" && <LoadingCell />}
          {leaderboard.status === "error" && (
            <ErrorCell message={leaderboard.error.message} />
          )}
          {leaderboard.status === "success" && (
            <BowlerTable rows={rows} phaseMap={phaseMap} />
          )}
        </Card>
      </div>

      <div className="mt-3.5 grid grid-cols-[1fr_1.6fr] gap-3.5">
        <BowlingByPhaseCard year={year} />
        <ScatterCardShell year={year} />
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3.5 items-start">
        <BestBowlingCard year={year} />
        <EconomyCard year={year} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   PURPLE CAP HERO
   -------------------------------------------------------------------------- */

function PurpleCapHero({
  year,
  top,
  loading,
}: {
  year: number;
  top: BowlRow | undefined;
  loading: boolean;
}) {
  const spark = useDuckQuery<SparkRow>(
    top
      ? `SELECT
            CAST(bs.match_number AS BIGINT) AS match_number,
            CAST(bs.wickets AS BIGINT) AS wickets,
            CAST(bs.runs AS BIGINT) AS runs,
            CAST(bs.overs AS DOUBLE) AS overs,
            CASE WHEN bs.team = m.team_1 THEN m.team_2 ELSE m.team_1 END AS opponent
         FROM bowling_scorecard bs
         JOIN matches m ON bs.season = m.season AND bs.match_number = m.match_number
         WHERE bs.season = ${year} AND bs.bowler = '${sqlEscape(top.bowler)}'
         ORDER BY bs.match_number`
      : `SELECT 0 AS match_number, 0 AS wickets, 0 AS runs, 0 AS overs,
                '' AS opponent WHERE FALSE`,
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
          No bowling data for IPL {year} yet.
        </div>
      </div>
    );
  }

  // X-axis is the player's own match count (1..N), not the IPL match number,
  // so gaps in their schedule don't leave dead space on the chart. Each point
  // carries wickets + economy (null when 0 balls) plus a multi-line tooltip
  // showing opponent, figures and economy.
  const sparkData =
    spark.status === "success"
      ? spark.data.map((r, i) => {
          const econ =
            r.overs > 0 ? r.runs / (Math.floor(r.overs) + (r.overs - Math.floor(r.overs)) * 10 / 6) : null;
          const oppShort = teamShort(r.opponent) || r.opponent;
          const tooltip = [
            `Match ${i + 1} vs ${oppShort}`,
            `${r.wickets}/${r.runs} in ${r.overs.toFixed(1)}`,
            econ != null ? `Econ ${econ.toFixed(2)}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          return { match: i + 1, primary: r.wickets, secondary: econ, tooltip };
        })
      : [];

  return (
    <div className="bg-ipl-surface border border-ipl-line rounded-[12px] p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-[11px] font-bold"
          style={{ background: "var(--color-ipl-purple)" }}
        >
          ★
        </span>
        <span className="text-[11px] tracking-[0.1em] text-ipl-sub font-semibold uppercase">
          Purple Cap · IPL {year}
        </span>
      </div>
      <div>
        <div className="text-[13px] text-ipl-sub flex items-center gap-1.5">
          <Link
            href={`/player/${encodeURIComponent(top.bowler)}`}
            className="hover:text-ipl-accent font-medium"
          >
            {resolve(top.bowler)}
          </Link>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <TeamBadge team={top.team} size={16} />
            {teamShort(top.team)}
          </span>
        </div>
        <div className="font-mono font-semibold leading-[0.9] tracking-[-0.05em] text-ipl-ink text-[72px] mt-1.5">
          {top.wickets}
        </div>
        <div className="text-[12px] text-ipl-sub mt-1">
          wickets in {top.innings} innings · best {top.best_w}/{top.best_r}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <HeroStat label="Economy" value={top.econ != null ? top.econ.toFixed(2) : "—"} />
        <HeroStat label="Average" value={top.avg != null ? top.avg.toFixed(1) : "—"} />
        <HeroStat label="Strike rate" value={top.sr != null ? top.sr.toFixed(1) : "—"} />
        <HeroStat label="Runs given" value={top.runs.toLocaleString()} />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold">
            Wickets &amp; econ per match
          </div>
          <div className="flex gap-2 text-[9px] font-mono text-ipl-sub">
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-[2px]"
                style={{ background: "var(--color-ipl-purple)" }}
              />
              Wkts
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-[2px]"
                style={{
                  background: "var(--color-ipl-accent)",
                  opacity: 0.85,
                }}
              />
              Econ
            </span>
          </div>
        </div>
        <MatchLineChart
          data={sparkData}
          color="var(--color-ipl-purple)"
          secondaryColor="var(--color-ipl-accent)"
          primaryLabel="Wkts"
          secondaryLabel="Econ"
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
  primary: number;
  /** Optional secondary value plotted on a right Y axis. */
  secondary?: number | null;
  /** Multi-line tooltip text. */
  tooltip?: string;
};

function MatchLineChart({
  data,
  color,
  secondaryColor = "var(--color-ipl-accent)",
  width = 280,
  height = 150,
  primaryLabel,
  secondaryLabel,
}: {
  data: MatchLineDatum[];
  color: string;
  secondaryColor?: string;
  width?: number;
  height?: number;
  primaryLabel: string;
  secondaryLabel: string;
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
  const hasSec = data.some((d) => d.secondary != null);
  const pad = { t: 10, r: hasSec ? 30 : 12, b: 22, l: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  // Primary scale: wickets are small integers (0..6). Round up to a clean
  // tick of 2.
  const maxPrim = Math.max(...data.map((d) => d.primary), 0);
  const primMax = Math.max(2, Math.ceil(maxPrim / 2) * 2);

  // Secondary scale: economy typically 4..15. Round up to multiple of 5,
  // floor at 10 so a low-econ player still leaves headroom above the line.
  const maxSec = Math.max(
    ...data.map((d) => (d.secondary != null ? d.secondary : 0)),
    0,
  );
  const secMax = Math.max(10, Math.ceil(maxSec / 5) * 5);

  const minMatch = data[0].match;
  const maxMatch = data[data.length - 1].match;
  const matchSpan = Math.max(1, maxMatch - minMatch);

  const x = (m: number) => pad.l + ((m - minMatch) / matchSpan) * innerW;
  const yPrim = (v: number) => pad.t + innerH - (v / primMax) * innerH;
  const ySec = (v: number) => pad.t + innerH - (v / secMax) * innerH;

  const primStep = primMax / 4;
  const primTicks = [0, primStep, primStep * 2, primStep * 3, primMax];
  const secStep = secMax / 4;
  const secTicks = [0, secStep, secStep * 2, secStep * 3, secMax];

  const xLabelStride = Math.max(1, Math.ceil(data.length / 5));
  const xLabels = data
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % xLabelStride === 0 || i === data.length - 1)
    .map(({ d }) => d.match);

  const primLine = data
    .map((d) => `${x(d.match)},${yPrim(d.primary)}`)
    .join(" ");
  const primArea = `${x(data[0].match)},${pad.t + innerH} ${primLine} ${x(
    data[data.length - 1].match,
  )},${pad.t + innerH}`;

  // Secondary line: skip null points by splitting into contiguous segments.
  const secSegments: string[][] = [];
  let segCur: string[] = [];
  for (const d of data) {
    if (d.secondary == null) {
      if (segCur.length > 1) secSegments.push(segCur);
      segCur = [];
    } else {
      segCur.push(`${x(d.match)},${ySec(d.secondary)}`);
    }
  }
  if (segCur.length > 1) secSegments.push(segCur);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      className="block"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {primTicks.map((t) => (
        <line
          key={`g-${t}`}
          x1={pad.l}
          x2={pad.l + innerW}
          y1={yPrim(t)}
          y2={yPrim(t)}
          stroke="var(--color-ipl-line2)"
          strokeWidth={1}
        />
      ))}

      <polygon points={primArea} fill={color} fillOpacity={0.12} />

      {hasSec &&
        secSegments.map((s, i) => (
          <polyline
            key={`sec-${i}`}
            points={s.join(" ")}
            fill="none"
            stroke={secondaryColor}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

      <polyline
        points={primLine}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {hasSec &&
        data.map(
          (d) =>
            d.secondary != null && (
              <circle
                key={`secpt-${d.match}`}
                cx={x(d.match)}
                cy={ySec(d.secondary)}
                r={2.25}
                fill="#fff"
                stroke={secondaryColor}
                strokeWidth={1.25}
              />
            ),
        )}

      {data.map((d) => (
        <g key={`pt-${d.match}`} style={{ cursor: "default" }}>
          <circle
            cx={x(d.match)}
            cy={yPrim(d.primary)}
            r={3}
            fill={color}
            stroke="#fff"
            strokeWidth={1.25}
          />
          <circle
            cx={x(d.match)}
            cy={yPrim(d.primary)}
            r={10}
            fill={color}
            fillOpacity={0.001}
          >
            <title>{d.tooltip ?? `Match ${d.match} · ${d.primary} ${primaryLabel}`}</title>
          </circle>
        </g>
      ))}

      {primTicks.map((t) => (
        <text
          key={`yl-${t}`}
          x={pad.l - 6}
          y={yPrim(t) + 3}
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

      {hasSec &&
        secTicks.map((t) => (
          <text
            key={`sl-${t}`}
            x={pad.l + innerW + 6}
            y={ySec(t) + 3}
            textAnchor="start"
            fontSize={9}
            fill={secondaryColor}
            style={{
              fontFamily: "var(--font-mono)",
              fontFeatureSettings: '"tnum", "zero"',
            }}
          >
            {Math.round(t)}
          </text>
        ))}

      <line
        x1={pad.l}
        x2={pad.l + innerW}
        y1={pad.t + innerH}
        y2={pad.t + innerH}
        stroke="var(--color-ipl-line)"
        strokeWidth={1}
      />

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
        Matches played · {primaryLabel} / {secondaryLabel}
      </text>
    </svg>
  );
}

/* --------------------------------------------------------------------------
   LEADERBOARD TABLE · sortable, with mini phase-wickets bar
   -------------------------------------------------------------------------- */

type SortKey =
  | "innings"
  | "overs"
  | "wickets"
  | "runs"
  | "avg"
  | "econ"
  | "sr";

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "innings", label: "Inn" },
  { key: "overs", label: "Ov" },
  { key: "wickets", label: "Wkts" },
  { key: "runs", label: "Runs" },
  { key: "avg", label: "Avg" },
  { key: "econ", label: "Econ" },
  { key: "sr", label: "SR" },
];

function BowlerTable({
  rows,
  phaseMap,
}: {
  rows: BowlRow[];
  phaseMap: Map<string, PhaseBreakdown>;
}) {
  const { resolve } = usePlayerNames();
  // Default to wickets ↓ (matches the SQL ORDER BY so the initial paint is identical).
  const [sortKey, setSortKey] = useState<SortKey>("wickets");
  // Lower-is-better metrics flip the default direction so the user's first
  // click on Avg / Econ / SR puts the *best* bowlers at the top.
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
      // Lower-is-better metrics start ascending so click→best on top.
      const lowerIsBetter = k === "avg" || k === "econ" || k === "sr";
      setSortDir(lowerIsBetter ? "asc" : "desc");
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
            Bowler
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
          <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
            Best
          </th>
          <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
            Phase
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => {
          const econColor =
            r.econ == null
              ? "text-ipl-ink"
              : r.econ < 7.5
                ? "text-ipl-pos"
                : r.econ > 8.5
                  ? "text-ipl-neg"
                  : "text-ipl-ink";
          return (
            <tr
              key={r.bowler}
              className="border-b border-ipl-line2 last:border-b-0 hover:bg-ipl-line2/40 animate-fade-in"
            >
              <td className="px-2.5 py-2.5 font-mono text-ipl-sub font-semibold">
                {i + 1}
              </td>
              <td className="px-2.5 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <TeamBadge team={r.team} size={20} />
                  <Link
                    href={`/player/${encodeURIComponent(r.bowler)}`}
                    className="font-semibold text-ipl-ink hover:text-ipl-accent"
                  >
                    {resolve(r.bowler)}
                  </Link>
                </span>
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.innings}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.overs.toFixed(1)}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono font-bold text-[13px]">
                {r.wickets}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.runs.toLocaleString()}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono">
                {r.avg != null ? r.avg.toFixed(1) : "—"}
              </td>
              <td className={"px-2.5 py-2.5 text-right font-mono font-semibold " + econColor}>
                {r.econ != null ? r.econ.toFixed(2) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono">
                {r.sr != null ? r.sr.toFixed(1) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.best_w}/{r.best_r}
              </td>
              <td className="px-2.5 py-2.5">
                <MiniPhaseBar phase={phaseMap.get(r.bowler)} />
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
  // Renders a 90×10 stacked bar with PP / Middle / Death wickets and a multi-
  // line native tooltip listing each phase's wickets, balls bowled, and SR.
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
  const sr = (wkts: number, balls: number) =>
    wkts > 0 ? (balls / wkts).toFixed(1) : "—";
  const segs = [
    { key: "pp" as const, label: "Powerplay", wkts: phase.pp, balls: phase.ppBalls },
    { key: "mid" as const, label: "Middle", wkts: phase.mid, balls: phase.midBalls },
    { key: "death" as const, label: "Death", wkts: phase.death, balls: phase.deathBalls },
  ];
  const tooltip = segs
    .map(
      (s) =>
        `${s.label}: ${s.wkts} wkts · ${s.balls} balls · SR ${sr(s.wkts, s.balls)}`,
    )
    .join("\n");
  return (
    <div
      className="flex rounded-sm overflow-hidden cursor-default"
      style={{ width: W, height: H }}
      title={tooltip}
    >
      {segs.map((s) => {
        const pct = (s.wkts / total) * 100;
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
   BOWLING BY PHASE · econ/dot%/wkt% heatmap + wickets donut
   -------------------------------------------------------------------------- */

type PhaseAggRow = {
  phase: string;
  total_runs: number;
  balls: number;
  wkts: number;
  dots: number;
};

type PhaseKey = "powerplay" | "middle" | "death";

const PHASE_META: { key: PhaseKey; label: string; donutColor: string }[] = [
  { key: "powerplay", label: "Powerplay (1-6)", donutColor: "#3a5cff" },
  { key: "middle", label: "Middle (7-15)", donutColor: "#0ea5e9" },
  { key: "death", label: "Death (16-20)", donutColor: "#bfdbfe" },
];

type TeamRow = { team: string };

const OVERALL = "__overall__";

function BowlingByPhaseCard({ year }: { year: number }) {
  const [teamFilter, setTeamFilter] = useState<string>(OVERALL);

  const teamsQ = useDuckQuery<TeamRow>(
    `SELECT DISTINCT team
     FROM bowling_scorecard
     WHERE season = ${year} AND team IS NOT NULL
     ORDER BY team`,
  );

  // ball_by_ball.team is the BATTING team. To filter by "Team X bowled
  // these balls" we derive the bowling team from `matches` (whichever side
  // isn't batting in that innings) and compare against teamFilter.
  const teamClause =
    teamFilter === OVERALL
      ? ""
      : `AND (CASE WHEN bbb.team = m.team_1 THEN m.team_2 ELSE m.team_1 END) = '${sqlEscape(teamFilter)}'`;

  const q = useDuckQuery<PhaseAggRow>(
    `SELECT bbb.phase,
            CAST(SUM(bbb.total_runs) AS BIGINT) AS total_runs,
            CAST(SUM(CASE WHEN COALESCE(bbb.wides,0)=0 AND COALESCE(bbb.noballs,0)=0
                          THEN 1 ELSE 0 END) AS BIGINT) AS balls,
            CAST(SUM(CASE WHEN bbb.is_wicket AND ${WICKET_EXCLUDE}
                          THEN 1 ELSE 0 END) AS BIGINT) AS wkts,
            CAST(SUM(CASE WHEN bbb.total_runs = 0
                          AND COALESCE(bbb.wides,0)=0
                          AND COALESCE(bbb.noballs,0)=0
                          THEN 1 ELSE 0 END) AS BIGINT) AS dots
     FROM ball_by_ball bbb
     JOIN matches m ON bbb.season = m.season AND bbb.match_number = m.match_number
     WHERE bbb.season = ${year} AND bbb.phase IS NOT NULL ${teamClause}
     GROUP BY bbb.phase`,
  );

  type Metrics = {
    econ: number;
    dotPct: number;
    wktPct: number;
    wkts: number;
  };

  // Stable cache: hold the last successful metrics + the team they belong to,
  // so flipping the dropdown swaps data in place instead of flashing Loading.
  const [stable, setStable] = useState<{
    team: string;
    metrics: Map<PhaseKey, Metrics>;
    loaded: boolean;
    sig: string;
  }>({ team: OVERALL, metrics: new Map(), loaded: false, sig: "" });

  if (q.status === "success") {
    const sig = `${teamFilter}|${q.data.length}|${q.data
      .map((r) => `${r.phase}:${r.total_runs}:${r.balls}:${r.wkts}`)
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
          econ: balls > 0 ? (6 * r.total_runs) / balls : 0,
          dotPct: balls > 0 ? (100 * r.dots) / balls : 0,
          wktPct: balls > 0 ? (100 * r.wkts) / balls : 0,
          wkts: r.wkts,
        });
      }
      setStable({ team: teamFilter, metrics: m, loaded: true, sig });
    }
  }

  const baseColor =
    stable.team === OVERALL ? null : teamColor(stable.team);
  const showLoading = q.status === "loading" && !stable.loaded;
  const showError = q.status === "error";

  return (
    <Card
      kicker="PHASE"
      title="Bowling by Phase"
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
              Wickets by Phase
            </div>
            <PhaseDonut metrics={stable.metrics} baseColor={baseColor} />
          </div>
        </div>
      )}
    </Card>
  );
}

const HEATMAP_COLS: {
  key: "econ" | "dotPct" | "wktPct";
  label: string;
  fmt: (v: number) => string;
}[] = [
  { key: "econ", label: "Economy", fmt: (v) => v.toFixed(2) },
  { key: "dotPct", label: "Dot Ball %", fmt: (v) => v.toFixed(1) },
  { key: "wktPct", label: "Wicket %", fmt: (v) => v.toFixed(2) },
];

const DEFAULT_HEAT_LIGHT = { r: 219, g: 234, b: 254 };
const DEFAULT_HEAT_DARK = { r: 29, g: 78, b: 216 };

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return { r: 113, g: 113, b: 122 };
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

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

function lumaOf(rgb: { r: number; g: number; b: number }) {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

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
    { econ: number; dotPct: number; wktPct: number; wkts: number }
  >;
  baseColor: string | null;
}) {
  // Per-column min/max so each metric's color scale is independent. For
  // economy, lower-is-better — we invert the ramp by flipping the column's
  // min/max so the most economical phase gets the *light* end of the ramp.
  const colRanges = HEATMAP_COLS.map((c) => {
    const vals = PHASE_META.map((p) => metrics.get(p.key)?.[c.key] ?? 0);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  });
  const ramp = rampFor(baseColor);

  return (
    <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-1.5">
      <div />
      {HEATMAP_COLS.map((c) => (
        <div
          key={`h-${c.key}`}
          className="text-center text-[11px] text-ipl-sub font-medium pb-1"
        >
          {c.label}
        </div>
      ))}
      {PHASE_META.map((p) => (
        <Fragment key={p.key}>
          <div className="text-[11px] text-ipl-ink font-medium self-center pr-2">
            {p.label}
          </div>
          {HEATMAP_COLS.map((c, ci) => {
            const m = metrics.get(p.key);
            const v = m?.[c.key] ?? 0;
            const range = colRanges[ci];
            // Economy is lower-is-better for the bowler — invert so the
            // best (lowest) value gets the saturated end of the ramp.
            const rawT =
              range.max === range.min
                ? 0.5
                : (v - range.min) / (range.max - range.min);
            const t = c.key === "econ" ? 1 - rawT : rawT;
            const bg = heatColor(t, ramp);
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
    { econ: number; dotPct: number; wktPct: number; wkts: number }
  >;
  baseColor: string | null;
}) {
  const phaseColors = (() => {
    if (!baseColor) {
      return PHASE_META.map((p) => p.donutColor);
    }
    const base = hexToRgb(baseColor);
    return [
      rgbStr(base),
      rgbStr(mixWithWhite(base, 0.45)),
      rgbStr(mixWithWhite(base, 0.78)),
    ];
  })();

  const segments = PHASE_META.map((p, i) => ({
    key: p.key,
    label: p.label,
    color: phaseColors[i],
    wkts: metrics.get(p.key)?.wkts ?? 0,
  }));
  const total = segments.reduce((s, x) => s + x.wkts, 0) || 1;

  const size = 130;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;

  const cumStarts: number[] = [];
  segments.reduce((acc, s) => {
    cumStarts.push(acc);
    return acc + s.wkts / total;
  }, 0);

  const labels = segments.map((s, i) => {
    const frac = s.wkts / total;
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
            const pct = s.wkts / total;
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
                <title>{`${s.label}: ${s.wkts.toLocaleString()} wkts (${(pct * 100).toFixed(1)}%)`}</title>
              </circle>
            );
          })}
        </g>
        <text
          x={margin + size / 2}
          y={10 + size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={600}
          fill="var(--color-ipl-ink)"
        >
          Wkts
        </text>
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
   ECON vs AVG SCATTER · with team filter + qualifier
   -------------------------------------------------------------------------- */

type ScatterRow = {
  bowler: string;
  team: string;
  overs: number;
  runs: number;
  wickets: number;
  innings: number;
  econ: number | null;
  avg: number | null;
};

function ScatterCardShell({ year }: { year: number }) {
  const [teamFilter, setTeamFilter] = useState<string>(OVERALL);

  const teamsQ = useDuckQuery<TeamRow>(
    `SELECT DISTINCT team
     FROM bowling_scorecard
     WHERE season = ${year} AND team IS NOT NULL
     ORDER BY team`,
  );
  const teamOptions = teamsQ.status === "success" ? teamsQ.data : [];

  const teamClause =
    teamFilter === OVERALL
      ? ""
      : `AND team = '${sqlEscape(teamFilter)}'`;
  // Same overs reconstruction as the leaderboard (sum of integer overs + extra
  // balls / 6) — naive SUM(overs) would treat 3.4+2.2 as 5.6 instead of 6.0.
  const q = useDuckQuery<ScatterRow>(
    `WITH per_bowler AS (
        SELECT
          bowler,
          ANY_VALUE(team) AS team,
          CAST(SUM(wickets) AS BIGINT) AS wickets,
          CAST(COUNT(*) AS BIGINT) AS innings,
          CAST(SUM(runs) AS BIGINT) AS runs,
          CAST(SUM(FLOOR(overs)) + FLOOR((SUM(overs - FLOOR(overs)) * 10 + 0.0001) / 6.0) AS BIGINT) AS full_overs,
          CAST(MOD(SUM(overs - FLOOR(overs)) * 10 + 0.0001, 6.0) AS DOUBLE) AS extra_balls
        FROM bowling_scorecard
        WHERE season = ${year} AND bowler IS NOT NULL ${teamClause}
        GROUP BY bowler
      )
      SELECT
        bowler, team, wickets, innings, runs,
        CAST(full_overs + extra_balls / 6.0 AS DOUBLE) AS overs,
        CASE WHEN full_overs + extra_balls / 6.0 > 0
             THEN runs / (full_overs + extra_balls / 6.0)
             ELSE NULL END AS econ,
        CASE WHEN wickets > 0
             THEN CAST(runs AS DOUBLE) / wickets
             ELSE NULL END AS avg
      FROM per_bowler
      WHERE full_overs + extra_balls / 6.0 >= ${SCATTER_MIN_OVERS}`,
  );

  const [stable, setStable] = useState<{
    rows: ScatterRow[];
    loaded: boolean;
    sig: string;
  }>({ rows: [], loaded: false, sig: "" });

  if (q.status === "success") {
    const sig = `${teamFilter}|${q.data.length}|${
      q.data[0]?.bowler ?? ""
    }|${q.data[0]?.wickets ?? 0}`;
    if (sig !== stable.sig) {
      setStable({ rows: q.data, loaded: true, sig });
    }
  }

  const showLoading = q.status === "loading" && !stable.loaded;
  const showError = q.status === "error";

  return (
    <Card
      kicker="ECONOMY"
      title="Econ vs Avg · qualified"
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

function ScatterCard({ rows }: { rows: ScatterRow[] }) {
  const { resolve } = usePlayerNames();
  const points = useMemo<ScatterPoint[]>(() => {
    return rows
      .filter((r) => r.avg != null && r.econ != null)
      .map((r) => ({
        x: r.avg as number,
        y: r.econ as number,
        label: shortName(resolve(r.bowler)),
        color: teamColor(r.team),
        tooltip: [
          `${resolve(r.bowler)} (${teamShort(r.team) || r.team})`,
          `Avg ${(r.avg as number).toFixed(1)} · Econ ${(r.econ as number).toFixed(2)}`,
          `${r.wickets} wkts · ${r.innings} inn · ${r.overs.toFixed(1)} ov`,
        ].join("\n"),
      }));
  }, [rows, resolve]);
  if (points.length === 0) {
    return (
      <div className="text-ipl-sub text-sm">
        Not enough qualified bowlers ({SCATTER_MIN_OVERS}+ overs) yet.
      </div>
    );
  }
  return (
    <Scatter
      data={points}
      xLabel="Average"
      yLabel="Economy"
      width={520}
      height={300}
    />
  );
}

/* --------------------------------------------------------------------------
   BEST BOWLING FIGURES · top 10 spells, rendered as a ball-by-ball spark
   per spell. Each cell = one legal delivery the bowler bowled, colored by
   outcome (dot / 1 / 2-3 / 4 / 6 / wicket).
   -------------------------------------------------------------------------- */

type BestFiguresRow = {
  bowler: string;
  team: string;
  wickets: number;
  runs_given: number;
  overs: number;
  opponent: string;
  match_number: number;
  cricsheet_match_id: number | null;
};

type BowlBallRow = {
  bowler: string;
  match_number: number;
  over: number;
  ball_seq: number;
  batter_runs: number;
  total_runs: number;
  is_wicket: boolean;
  bowler_wicket: boolean;
  extra_type: string | null;
};

// Cell + row sized so each over-row in the expanded chart matches the
// height of a regular table row in the surrounding miser-style table:
// py-2.5 (10+10) padding around a 20px square totals ~40px, same as a
// text-[12px] table cell.
const SPARK_CELL_W = 20;
const SPARK_CELL_GAP = 1;
const SPARK_CELL_H = 20;
const EXTRA_COLOR = "#a78bfa"; // violet-400

function ballColor(b: BowlBallRow): string {
  if (b.bowler_wicket) return "#dc2626"; // red-600 (wicket overrides runs)
  if (b.extra_type) return EXTRA_COLOR;
  if (b.batter_runs === 6) return "var(--color-ipl-orange)";
  if (b.batter_runs === 4) return "var(--color-ipl-accent)";
  if (b.batter_runs >= 2) return "#60a5fa"; // blue-400
  if (b.batter_runs === 1) return "#bfdbfe"; // blue-200
  return "#e4e4e7"; // zinc-200 (dot)
}

function ballTooltip(b: BowlBallRow): string {
  // ball_seq is integer for legal balls (1-6) and X.5 for extras inserted
  // between legal balls. Floor it for display.
  const seq = Math.floor(b.ball_seq);
  const over = `${b.over}.${seq}`;
  if (b.bowler_wicket) return `Over ${over} · WICKET`;
  if (b.extra_type === "wides") {
    return `Over ${b.over} · wide${b.total_runs > 1 ? ` +${b.total_runs - 1}` : ""}`;
  }
  if (b.extra_type === "noballs") {
    return `Over ${b.over} · no-ball${b.total_runs > 1 ? ` +${b.total_runs - 1}` : ""}`;
  }
  if (b.batter_runs === 0) return `Over ${over} · dot`;
  return `Over ${over} · ${b.batter_runs}`;
}

function BestBowlingCard({ year }: { year: number }) {
  // Track which spells are expanded — click the row header to toggle. Default
  // collapsed; the table reads as a clean leaderboard until the user drills in.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const top = useDuckQuery<BestFiguresRow>(
    `SELECT bs.bowler,
            bs.team,
            CAST(bs.wickets AS BIGINT) AS wickets,
            CAST(bs.runs AS BIGINT) AS runs_given,
            CAST(bs.overs AS DOUBLE) AS overs,
            CASE WHEN bs.team = m.team_1 THEN m.team_2 ELSE m.team_1 END AS opponent,
            CAST(bs.match_number AS BIGINT) AS match_number,
            m.cricsheet_match_id
     FROM bowling_scorecard bs
     JOIN matches m ON bs.season = m.season AND bs.match_number = m.match_number
     WHERE bs.season = ${year} AND bs.bowler IS NOT NULL
     ORDER BY bs.wickets DESC, bs.runs ASC, bs.overs DESC
     LIMIT ${TOP_FIGURES_LIMIT}`,
  );

  const spellFilter = useMemo(() => {
    if (top.status !== "success") return "";
    return top.data
      .map(
        (r) =>
          `(bbb.bowler='${sqlEscape(r.bowler)}' AND bbb.match_number=${r.match_number})`,
      )
      .join(" OR ");
  }, [top]);

  // `bbb.ball` is a VARCHAR — integer ("1".."6") for legal balls and "{N}.{kind}"
  // (e.g., "3.wides") for extras, where N = legal-balls-bowled-before-this-extra + 1.
  // So an extra at "3.wides" should sort BETWEEN legal balls 2 and 3, i.e. at 2.5.
  const ballSeqExpr = `CASE
    WHEN bbb.ball LIKE '%.%'
    THEN CAST(SPLIT_PART(bbb.ball, '.', 1) AS DOUBLE) - 0.5
    ELSE CAST(bbb.ball AS DOUBLE)
  END`;

  const balls = useDuckQuery<BowlBallRow>(
    spellFilter
      ? `SELECT bbb.bowler,
                CAST(bbb.match_number AS BIGINT) AS match_number,
                CAST(bbb.over AS INTEGER) AS over,
                ${ballSeqExpr} AS ball_seq,
                CAST(bbb.batter_runs AS INTEGER) AS batter_runs,
                CAST(bbb.total_runs AS INTEGER) AS total_runs,
                bbb.is_wicket,
                CASE WHEN bbb.is_wicket AND ${WICKET_EXCLUDE}
                     THEN TRUE ELSE FALSE END AS bowler_wicket,
                CASE WHEN COALESCE(bbb.wides,0) > 0   THEN 'wides'
                     WHEN COALESCE(bbb.noballs,0) > 0 THEN 'noballs'
                     ELSE NULL END AS extra_type
         FROM ball_by_ball bbb
         WHERE bbb.season = ${year}
           AND (${spellFilter})
         ORDER BY bbb.bowler, bbb.match_number, bbb.over, ${ballSeqExpr}`
      : `SELECT NULL AS bowler, 0 AS match_number, 0 AS over, 0 AS ball_seq,
                0 AS batter_runs, 0 AS total_runs, FALSE AS is_wicket,
                FALSE AS bowler_wicket, NULL AS extra_type
         WHERE FALSE`,
  );

  const ballsBySpell = useMemo(() => {
    const m = new Map<string, BowlBallRow[]>();
    if (balls.status !== "success") return m;
    for (const r of balls.data) {
      const k = `${r.bowler}|${r.match_number}`;
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return m;
  }, [balls]);

  const { resolve } = usePlayerNames();

  const anyExpanded = expanded.size > 0;
  const COL_COUNT = 6;

  return (
    <Card kicker="STANDOUT" title="Top 10 bowling figures" padded={false}>
      {top.status === "loading" && <LoadingCell />}
      {top.status === "error" && <ErrorCell message={top.error.message} />}
      {top.status === "success" && top.data.length === 0 && (
        <div className="p-6 text-ipl-sub text-sm">No spells yet.</div>
      )}
      {top.status === "success" && top.data.length > 0 && (
        <>
          {anyExpanded && (
            <div className="px-2.5 pt-2.5 pb-1.5">
              <SparkLegend />
            </div>
          )}
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-ipl-sub">
                <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
                  #
                </th>
                <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
                  Bowler
                </th>
                <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
                  vs
                </th>
                <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
                  Match
                </th>
                <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                  Figures
                </th>
                <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                  Ov
                </th>
              </tr>
            </thead>
            <tbody>
              {top.data.map((r, i) => {
                const key = `${r.bowler}|${r.match_number}`;
                const isExpanded = expanded.has(key);
                const matchLink = r.cricsheet_match_id
                  ? `/match/${r.cricsheet_match_id}`
                  : null;
                return (
                  <Fragment key={key}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpand(key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleExpand(key);
                        }
                      }}
                      className="border-b border-ipl-line2 last:border-b-0 hover:bg-ipl-line2/40 cursor-pointer animate-fade-in"
                    >
                      <td className="px-2.5 py-2.5 font-mono text-ipl-sub font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="text-[10px] inline-block transition-transform"
                            style={{
                              transform: isExpanded
                                ? "rotate(90deg)"
                                : "rotate(0deg)",
                            }}
                          >
                            ▸
                          </span>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-2.5 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <TeamBadge team={r.team} size={20} />
                          <Link
                            href={`/player/${encodeURIComponent(r.bowler)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-ipl-ink hover:text-ipl-accent"
                          >
                            {resolve(r.bowler)}
                          </Link>
                        </span>
                      </td>
                      <td className="px-2.5 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <TeamBadge team={r.opponent} size={14} />
                          <span className="text-ipl-sub">
                            {teamShort(r.opponent)}
                          </span>
                        </span>
                      </td>
                      <td className="px-2.5 py-2.5">
                        {matchLink ? (
                          <Link
                            href={matchLink}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-ipl-sub hover:text-ipl-accent underline-offset-2 hover:underline"
                          >
                            M{r.match_number}
                          </Link>
                        ) : (
                          <span className="font-mono text-ipl-sub">
                            M{r.match_number}
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-right font-mono font-bold text-[13px] text-ipl-ink">
                        {r.wickets}/{r.runs_given}
                      </td>
                      <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                        {r.overs.toFixed(1)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-ipl-line2 last:border-b-0 bg-ipl-line2/20">
                        <td colSpan={COL_COUNT} className="px-2.5 py-1.5">
                          <OverChart balls={ballsBySpell.get(key) ?? []} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
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
    { label: "extra", color: EXTRA_COLOR },
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

function OverChart({ balls }: { balls: BowlBallRow[] }) {
  // Group sequential balls by over. Query is already ordered by over+ball,
  // so one pass produces an ordered list of over groups. Each group has up
  // to 6 legal balls (fewer when the innings ended mid-over) plus any
  // wides/no-balls bowled in that over.
  const byOver: { over: number; balls: BowlBallRow[] }[] = [];
  for (const b of balls) {
    const last = byOver[byOver.length - 1];
    if (last && last.over === b.over) {
      last.balls.push(b);
    } else {
      byOver.push({ over: b.over, balls: [b] });
    }
  }
  return (
    <div className="flex flex-col">
      {byOver.map((ov) => (
        // py-2 + 20px cell ≈ 36px — same vertical rhythm as the table's
        // py-2.5 + 12px text rows above. Each over occupies one "row".
        <div key={ov.over} className="flex items-center gap-3 py-2">
          <span className="font-mono text-[10px] text-ipl-sub w-10 text-right tracking-tight">
            Ov {ov.over}
          </span>
          <div
            className="flex items-center"
            style={{
              gap: `${SPARK_CELL_GAP}px`,
              height: SPARK_CELL_H,
            }}
          >
            {ov.balls.map((b, i) => (
              <div
                key={i}
                className="rounded-[2px]"
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
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
   ECONOMY LEADERS · min 7 matches, 12 overs
   -------------------------------------------------------------------------- */

type EconomyRow = {
  bowler: string;
  team: string;
  matches: number;
  overs: number;
  wickets: number;
  runs: number;
  econ: number | null;
  avg: number | null;
};

function EconomyCard({ year }: { year: number }) {
  const q = useDuckQuery<EconomyRow>(
    `WITH per_bowler AS (
        SELECT
          bowler,
          ANY_VALUE(team) AS team,
          CAST(COUNT(*) AS BIGINT)   AS matches,
          CAST(SUM(wickets) AS BIGINT) AS wickets,
          CAST(SUM(runs)  AS BIGINT) AS runs,
          CAST(SUM(FLOOR(overs)) + FLOOR((SUM(overs - FLOOR(overs)) * 10 + 0.0001) / 6.0) AS BIGINT) AS full_overs,
          CAST(MOD(SUM(overs - FLOOR(overs)) * 10 + 0.0001, 6.0) AS DOUBLE) AS extra_balls
        FROM bowling_scorecard
        WHERE season = ${year} AND bowler IS NOT NULL
        GROUP BY bowler
      )
      SELECT bowler, team, matches, wickets, runs,
             CAST(full_overs + extra_balls / 6.0 AS DOUBLE) AS overs,
             CASE WHEN full_overs + extra_balls / 6.0 > 0
                  THEN runs / (full_overs + extra_balls / 6.0)
                  ELSE NULL END AS econ,
             CASE WHEN wickets > 0
                  THEN CAST(runs AS DOUBLE) / wickets
                  ELSE NULL END AS avg
      FROM per_bowler
      WHERE matches >= ${ECON_MIN_MATCHES}
        AND full_overs + extra_balls / 6.0 >= ${ECON_MIN_OVERS}
      ORDER BY econ ASC NULLS LAST
      LIMIT ${TOP_FIGURES_LIMIT}`,
  );
  const { resolve } = usePlayerNames();

  return (
    <Card
      kicker="MISER"
      title={`Most economical · min ${ECON_MIN_MATCHES} matches, ${ECON_MIN_OVERS} overs`}
      padded={false}
    >
      {q.status === "loading" && <LoadingCell />}
      {q.status === "error" && <ErrorCell message={q.error.message} />}
      {q.status === "success" && q.data.length === 0 && (
        <div className="p-6 text-ipl-sub text-sm">
          No bowlers meet the threshold yet.
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
                Bowler
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                M
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                Ov
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                Wkts
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                Runs
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                Econ
              </th>
              <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-right">
                Avg
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((r, i) => (
              <tr
                key={r.bowler}
                className="border-b border-ipl-line2 last:border-b-0 hover:bg-ipl-line2/40 animate-fade-in"
              >
                <td className="px-2.5 py-2.5 font-mono text-ipl-sub font-semibold">
                  {i + 1}
                </td>
                <td className="px-2.5 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <TeamBadge team={r.team} size={18} />
                    <Link
                      href={`/player/${encodeURIComponent(r.bowler)}`}
                      className="font-semibold text-ipl-ink hover:text-ipl-accent truncate"
                    >
                      {resolve(r.bowler)}
                    </Link>
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.matches}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.overs.toFixed(1)}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono">
                  {r.wickets}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.runs.toLocaleString()}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono font-bold text-[13px] text-ipl-ink">
                  {r.econ != null ? r.econ.toFixed(2) : "—"}
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                  {r.avg != null ? r.avg.toFixed(1) : "—"}
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

function LoadingCell() {
  return <div className="p-6 text-center text-ipl-sub text-sm">Loading…</div>;
}

function ErrorCell({ message }: { message: string }) {
  return <pre className="p-3 text-ipl-neg text-xs whitespace-pre-wrap">{message}</pre>;
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const first = parts[0].charAt(0).toUpperCase();
  return `${first} ${last}`;
}
