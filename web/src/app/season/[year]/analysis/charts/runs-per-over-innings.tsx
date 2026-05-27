"use client";

import { useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort } from "@/lib/teams";
import { Card, Loading, Empty, ErrorBox } from "./chart-shell";

type Row = { innings: number; team: string; runs_in_over: number };

const ALL = "__all__";
const C_1ST = "#004BA0";
const C_2ND = "#D4171E";

export function RunsPerOverInnings({ year }: { year: number }) {
  const state = useDuckQuery<Row>(
    `SELECT CAST(innings AS INTEGER) AS innings,
            team,
            CAST(SUM(total_runs) AS INTEGER) AS runs_in_over
     FROM ball_by_ball
     WHERE season = ${year}
     GROUP BY match_number, innings, team, over
     HAVING SUM(total_runs) IS NOT NULL`
  );

  const rows = state.status === "success" ? state.data : [];
  const teams = useMemo(
    () => [...new Set(rows.map((r) => r.team))].sort((a, b) => a.localeCompare(b)),
    [rows]
  );
  const [team, setTeam] = useState<string>(ALL);

  const filtered = useMemo(
    () => (team === ALL ? rows : rows.filter((r) => r.team === team)),
    [rows, team]
  );
  const stats = useMemo(() => buildHistogram(filtered), [filtered]);

  const selector = (
    <select
      value={team}
      onChange={(e) => setTeam(e.target.value)}
      className="text-sm border border-ipl-line rounded-md px-2 py-1 bg-ipl-surface text-ipl-ink"
    >
      <option value={ALL}>All Teams</option>
      {teams.map((t) => (
        <option key={t} value={t}>
          {teamShort(t)}
        </option>
      ))}
    </select>
  );

  return (
    <Card title="Runs per over — 1st vs 2nd innings" right={selector}>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && filtered.length === 0 && (
        <Empty
          message={
            team === ALL ? "No data." : `No deliveries for ${teamShort(team)} this season.`
          }
        />
      )}
      {state.status === "success" && filtered.length > 0 && (
        <>
          <div className="flex items-center gap-6 text-xs mb-2">
            <LegendDot color={C_1ST} label="1st innings" count={stats.n1} />
            <LegendDot color={C_2ND} label="2nd innings" count={stats.n2} />
          </div>
          <div className="w-full h-[360px]">
            <HistogramSvg stats={stats} />
          </div>
          <StatsPanel stats={stats} />
          <p className="text-xs text-ipl-sub mt-3">
            Bar height = number of overs that produced exactly that many runs. Dashed
            lines mark the mean for each innings.
          </p>
        </>
      )}
    </Card>
  );
}

type Bin = { runs: number; c1: number; c2: number };
type Stats = {
  bins: Bin[];
  max: number;
  mean1: number;
  mean2: number;
  median1: number;
  median2: number;
  n1: number;
  n2: number;
  mode1: number;
  mode2: number;
  pct1Twelve: number;
  pct2Twelve: number;
};

function buildHistogram(rows: Row[]): Stats {
  if (rows.length === 0)
    return {
      bins: [],
      max: 0,
      mean1: 0,
      mean2: 0,
      median1: 0,
      median2: 0,
      n1: 0,
      n2: 0,
      mode1: 0,
      mode2: 0,
      pct1Twelve: 0,
      pct2Twelve: 0,
    };
  const maxRuns = Math.max(...rows.map((r) => r.runs_in_over), 30);
  const bins: Bin[] = Array.from({ length: maxRuns + 1 }, (_, i) => ({
    runs: i,
    c1: 0,
    c2: 0,
  }));
  const vals1: number[] = [];
  const vals2: number[] = [];
  for (const r of rows) {
    const b = bins[r.runs_in_over];
    if (!b) continue;
    if (r.innings === 1) {
      b.c1 += 1;
      vals1.push(r.runs_in_over);
    } else if (r.innings === 2) {
      b.c2 += 1;
      vals2.push(r.runs_in_over);
    }
  }
  const max = Math.max(...bins.map((b) => Math.max(b.c1, b.c2)), 1);

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const median = (xs: number[]) => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  };
  const mode = (counts: number[]) => {
    let best = 0;
    let arg = 0;
    for (let i = 0; i < counts.length; i += 1) {
      if (counts[i] > best) {
        best = counts[i];
        arg = i;
      }
    }
    return arg;
  };
  const pctAtLeast = (xs: number[], k: number) =>
    xs.length ? xs.filter((v) => v >= k).length / xs.length : 0;

  return {
    bins,
    max,
    mean1: mean(vals1),
    mean2: mean(vals2),
    median1: median(vals1),
    median2: median(vals2),
    n1: vals1.length,
    n2: vals2.length,
    mode1: mode(bins.map((b) => b.c1)),
    mode2: mode(bins.map((b) => b.c2)),
    pct1Twelve: pctAtLeast(vals1, 12),
    pct2Twelve: pctAtLeast(vals2, 12),
  };
}

function HistogramSvg({ stats }: { stats: Stats }) {
  const { bins, max, mean1, mean2 } = stats;
  const w = 720;
  const h = 360;
  const pad = { t: 16, r: 16, b: 40, l: 40 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const xMax = bins.length;
  const slot = innerW / xMax;
  const barW = Math.max(2, slot * 0.9);
  const xBar = (i: number) => pad.l + i * slot + (slot - barW) / 2;
  const meanX = (v: number) => pad.l + (v / xMax) * innerW + slot / 2;
  const yScale = (v: number) => pad.t + innerH - (v / max) * innerH;
  const baseY = pad.t + innerH;

  const xTicks = bins.map((b) => b.runs).filter((r) => r % 2 === 0);
  const yTicks = niceTicks(max, 5);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      {yTicks.map((t) => (
        <g key={`y-${t}`}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="#e4e4e7"
            strokeWidth={1}
          />
          <text
            x={pad.l - 6}
            y={yScale(t) + 4}
            textAnchor="end"
            fontSize={11}
            fill="#71717a"
          >
            {t}
          </text>
        </g>
      ))}

      {/* 1st-innings bars (drawn first so 2nd-innings strokes sit on top) */}
      {bins.map((b, i) =>
        b.c1 > 0 ? (
          <rect
            key={`b1-${i}`}
            x={xBar(i)}
            y={yScale(b.c1)}
            width={barW}
            height={Math.max(0, baseY - yScale(b.c1))}
            fill={C_1ST}
            fillOpacity={0.35}
            stroke={C_1ST}
            strokeWidth={1.25}
            shapeRendering="crispEdges"
          />
        ) : null
      )}
      {/* 2nd-innings bars overlaid */}
      {bins.map((b, i) =>
        b.c2 > 0 ? (
          <rect
            key={`b2-${i}`}
            x={xBar(i)}
            y={yScale(b.c2)}
            width={barW}
            height={Math.max(0, baseY - yScale(b.c2))}
            fill={C_2ND}
            fillOpacity={0.35}
            stroke={C_2ND}
            strokeWidth={1.25}
            shapeRendering="crispEdges"
          />
        ) : null
      )}

      {mean1 > 0 && (
        <MeanLine
          x={meanX(mean1)}
          top={pad.t}
          bottom={pad.t + innerH}
          color={C_1ST}
        />
      )}
      {mean2 > 0 && (
        <MeanLine
          x={meanX(mean2)}
          top={pad.t}
          bottom={pad.t + innerH}
          color={C_2ND}
        />
      )}

      <line
        x1={pad.l}
        x2={w - pad.r}
        y1={pad.t + innerH}
        y2={pad.t + innerH}
        stroke="#a1a1aa"
        strokeWidth={1}
      />
      {xTicks.map((t) => (
        <text
          key={`x-${t}`}
          x={pad.l + (t / xMax) * innerW + slot / 2}
          y={pad.t + innerH + 16}
          textAnchor="middle"
          fontSize={11}
          fill="#52525b"
        >
          {t}
        </text>
      ))}
      <text
        x={pad.l + innerW / 2}
        y={h - 6}
        textAnchor="middle"
        fontSize={12}
        fill="#52525b"
      >
        Runs in over
      </text>
    </svg>
  );
}

function StatsPanel({ stats }: { stats: Stats }) {
  const meanDelta = stats.mean2 - stats.mean1;
  const insight =
    stats.n1 === 0 || stats.n2 === 0
      ? "Single-innings sample only."
      : Math.abs(meanDelta) < 0.05
        ? "Run-rates virtually identical across innings."
        : meanDelta > 0
          ? `Chases score ${meanDelta.toFixed(2)} more rpo on average — pressure tilts batting hands.`
          : `Setters score ${Math.abs(meanDelta).toFixed(2)} more rpo on average — chases throttle the rate.`;

  return (
    <div className="mt-3 rounded-lg border border-ipl-line bg-ipl-line2/30 px-4 py-3">
      <div className="grid grid-cols-3 gap-6">
        <StatBlock
          title="Mean rpo (dashed)"
          color1={C_1ST}
          color2={C_2ND}
          v1={stats.mean1.toFixed(2)}
          v2={stats.mean2.toFixed(2)}
        />
        <StatBlock
          title="Median runs/over"
          color1={C_1ST}
          color2={C_2ND}
          v1={stats.median1.toFixed(0)}
          v2={stats.median2.toFixed(0)}
        />
        <StatBlock
          title="≥ 12-run overs"
          color1={C_1ST}
          color2={C_2ND}
          v1={`${Math.round(stats.pct1Twelve * 100)}%`}
          v2={`${Math.round(stats.pct2Twelve * 100)}%`}
        />
      </div>
      <p className="text-xs text-ipl-sub mt-3">{insight}</p>
    </div>
  );
}

function StatBlock({
  title,
  v1,
  v2,
  color1,
  color2,
}: {
  title: string;
  v1: string;
  v2: string;
  color1: string;
  color2: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ipl-sub mb-1">
        {title}
      </div>
      <div className="flex items-baseline gap-3 tabular-nums">
        <span style={{ color: color1 }} className="text-base font-semibold">
          {v1}
        </span>
        <span className="text-ipl-line2 text-xs">vs</span>
        <span style={{ color: color2 }} className="text-base font-semibold">
          {v2}
        </span>
      </div>
    </div>
  );
}

function MeanLine({
  x,
  top,
  bottom,
  color,
}: {
  x: number;
  top: number;
  bottom: number;
  color: string;
}) {
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={top}
        y2={bottom}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <polygon
        points={`${x - 4},${top - 7} ${x + 4},${top - 7} ${x},${top - 1}`}
        fill={color}
      />
    </g>
  );
}

function LegendDot({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      <span className="text-ipl-ink">{label}</span>
      <span className="text-ipl-soft tabular-nums">({count})</span>
    </span>
  );
}

function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const step = Math.ceil(max / count);
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    const v = i * step;
    if (v <= max + step / 2) ticks.push(v);
  }
  return ticks;
}
