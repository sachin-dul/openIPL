"use client";

import { useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort, teamColor } from "@/lib/teams";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  Loading,
  Empty,
  ErrorBox,
  PHASE_LABELS,
  PHASE_ORDER,
  type Phase,
} from "./chart-shell";

type Row = {
  team: string;
  phase: Phase;
  runs: number;
  wickets: number;
  balls: number;
  boundaries: number;
  dots: number;
};

type Side = "batting" | "bowling";
type Metric = "run_rate" | "wickets" | "boundaries" | "dots";

const METRIC_LABELS: Record<Side, Record<Metric, string>> = {
  batting: {
    run_rate: "Run rate",
    wickets: "Wickets lost",
    boundaries: "Boundaries hit",
    dots: "Dots faced",
  },
  bowling: {
    run_rate: "Economy",
    wickets: "Wickets taken",
    boundaries: "Boundaries conceded",
    dots: "Dots bowled",
  },
};

export function TeamPhaseComparison({ year }: { year: number }) {
  const [side, setSide] = useState<Side>("batting");
  const [metric, setMetric] = useState<Metric>("run_rate");

  const battingState = useDuckQuery<Row>(
    `SELECT team,
            LOWER(phase) AS phase,
            CAST(SUM(runs) AS INTEGER) AS runs,
            CAST(SUM(wickets) AS INTEGER) AS wickets,
            CAST(SUM(balls) AS INTEGER) AS balls,
            CAST(SUM(boundaries) AS INTEGER) AS boundaries,
            CAST(SUM(dots) AS INTEGER) AS dots
     FROM phase_summary
     WHERE season = ${year}
     GROUP BY team, LOWER(phase)`
  );

  const bowlingState = useDuckQuery<Row>(
    `WITH labeled AS (
       SELECT CASE WHEN bbb.team = m.team_1 THEN m.team_2 ELSE m.team_1 END AS bowl_team,
              LOWER(bbb.phase) AS phase,
              bbb.total_runs,
              bbb.batter_runs,
              bbb.is_wicket,
              bbb.wides,
              bbb.noballs,
              bbb.wicket_kind
       FROM ball_by_ball bbb
       LEFT JOIN matches m ON bbb.season = m.season AND bbb.match_number = m.match_number
       WHERE bbb.season = ${year} AND bbb.phase IS NOT NULL
     )
     SELECT bowl_team AS team,
            phase,
            CAST(SUM(total_runs) AS INTEGER) AS runs,
            CAST(SUM(CASE WHEN is_wicket
                          AND LOWER(COALESCE(wicket_kind,'')) NOT IN ('run out','retired hurt','retired out','obstructing the field','timed out')
                          THEN 1 ELSE 0 END) AS INTEGER) AS wickets,
            CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS INTEGER) AS balls,
            CAST(SUM(CASE WHEN batter_runs IN (4,6) THEN 1 ELSE 0 END) AS INTEGER) AS boundaries,
            CAST(SUM(CASE WHEN batter_runs = 0 AND COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS INTEGER) AS dots
     FROM labeled
     WHERE bowl_team IS NOT NULL
     GROUP BY bowl_team, phase`
  );

  const state = side === "batting" ? battingState : bowlingState;
  const rows = state.status === "success" ? state.data : [];
  const yLabel = METRIC_LABELS[side][metric];
  const { chartData, teams, yMax } = useMemo(
    () => buildPhaseData(rows, metric),
    [rows, metric]
  );

  const controls = (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-md border border-ipl-line overflow-hidden text-xs">
        {(["batting", "bowling"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className="px-2.5 py-1 border-r border-ipl-line last:border-r-0 transition-colors capitalize"
            style={{
              background: side === s ? "#18181b" : "#fff",
              color: side === s ? "#fff" : "#52525b",
              fontWeight: side === s ? 600 : 400,
            }}
            aria-pressed={side === s}
          >
            {s}
          </button>
        ))}
      </div>
      <select
        value={metric}
        onChange={(e) => setMetric(e.target.value as Metric)}
        className="text-xs border border-ipl-line rounded px-2 py-1 bg-ipl-surface"
      >
        {(Object.keys(METRIC_LABELS[side]) as Metric[]).map((m) => (
          <option key={m} value={m}>
            {METRIC_LABELS[side][m]}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Card title="Team Phase Comparison" right={controls}>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && teams.length === 0 && <Empty />}
      {state.status === "success" && teams.length > 0 && (
        <div>
          <div className="w-full h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 16, right: 16, bottom: 24, left: 0 }}
                barGap={2}
                barCategoryGap={24}
              >
                <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="phase"
                  tick={{ fontSize: 12, fill: "#52525b" }}
                />
                <YAxis
                  domain={[0, yMax]}
                  tick={{ fontSize: 11, fill: "#52525b" }}
                  label={{
                    value: yLabel,
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 12,
                    fill: "#52525b",
                  }}
                />
                <Tooltip
                  content={<PhaseTooltip metric={metric} yLabel={yLabel} />}
                  wrapperStyle={{ outline: "none" }}
                />
                {teams.map((t) => (
                  <Bar
                    key={t}
                    dataKey={t}
                    fill={teamColor(t)}
                    name={teamShort(t)}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center mt-3 text-xs">
            {teams.map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-sm"
                  style={{ background: teamColor(t) }}
                />
                <span className="text-ipl-ink">{teamShort(t)}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-ipl-sub mt-3">
            {side === "batting"
              ? "Each team's batting performance across phases."
              : "Each team's bowling performance — what they conceded / took when bowling. Wickets exclude run-outs."}
          </p>
        </div>
      )}
    </Card>
  );
}

type ChartRow = Record<string, string | number>;

function buildPhaseData(rows: Row[], metric: Metric): {
  chartData: ChartRow[];
  teams: string[];
  yMax: number;
} {
  if (rows.length === 0) return { chartData: [], teams: [], yMax: 0 };

  const teams = [...new Set(rows.map((r) => r.team))].sort((a, b) =>
    a.localeCompare(b)
  );

  const lookup: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    let v: number;
    if (metric === "run_rate") {
      v = r.balls > 0 ? Math.round((r.runs / r.balls) * 6 * 100) / 100 : 0;
    } else {
      v = r[metric];
    }
    if (!lookup[r.phase]) lookup[r.phase] = {};
    lookup[r.phase][r.team] = v;
  }

  const chartData: ChartRow[] = PHASE_ORDER.map((p) => {
    const row: ChartRow = { phase: PHASE_LABELS[p] };
    for (const t of teams) row[t] = lookup[p]?.[t] ?? 0;
    return row;
  });

  let yMax = 0;
  for (const row of chartData) {
    for (const t of teams) {
      const v = Number(row[t]) || 0;
      if (v > yMax) yMax = v;
    }
  }
  yMax = Math.ceil(yMax * 1.1);
  return { chartData, teams, yMax };
}

type TooltipPayload = {
  name: string;
  value: number;
  color: string;
  dataKey: string;
};

function PhaseTooltip({
  active,
  payload,
  label,
  metric,
  yLabel,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  metric: Metric;
  yLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div
      className="border border-ipl-line rounded shadow-sm px-3 py-2 text-xs"
      style={{ backgroundColor: "#ffffff" }}
    >
      <div className="font-semibold text-ipl-ink">{label}</div>
      <div className="text-[10px] uppercase tracking-wider text-ipl-soft mb-1">
        {yLabel}
      </div>
      <ul className="space-y-0.5">
        {sorted.map((p) => (
          <li key={p.dataKey} className="flex items-center gap-2 tabular-nums">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ background: p.color }}
            />
            <span className="text-ipl-ink">{p.name}</span>
            <span className="ml-auto text-ipl-ink font-medium">
              {metric === "run_rate" ? p.value.toFixed(2) : p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
