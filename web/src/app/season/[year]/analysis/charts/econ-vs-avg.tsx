"use client";

import { useEffect, useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { teamShort, teamColor } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Cell,
} from "recharts";
import { Card, Loading, Empty, ErrorBox } from "./chart-shell";

type Row = {
  bowler: string;
  team: string;
  phase: PhaseKey;
  balls: number;
  runs: number;
  wickets: number;
};

type Point = {
  bowler: string;
  team: string;
  economy: number;
  average: number | null;
  plotY: number;
  wickets: number;
  overs: number;
  isWicketless: boolean;
};

type PhaseKey = "powerplay" | "middle" | "death";
type PhaseFilter = "all" | PhaseKey;

const PHASE_OPTIONS: { value: PhaseFilter; label: string }[] = [
  { value: "all", label: "All phases" },
  { value: "powerplay", label: "Powerplay (1–6)" },
  { value: "middle", label: "Middle (7–15)" },
  { value: "death", label: "Death (16–20)" },
];

const MIN_OVERS_BY_PHASE: Record<PhaseFilter, number> = {
  all: 4,
  powerplay: 2,
  middle: 2,
  death: 2,
};

export function EconVsAvg({ year }: { year: number }) {
  const [phase, setPhase] = useState<PhaseFilter>("all");

  const state = useDuckQuery<Row>(
    `WITH labeled AS (
       SELECT bbb.bowler,
              CASE WHEN bbb.team = m.team_1 THEN m.team_2 ELSE m.team_1 END AS bowl_team,
              bbb.phase,
              bbb.total_runs,
              bbb.is_wicket,
              bbb.wides,
              bbb.noballs,
              bbb.wicket_kind
       FROM ball_by_ball bbb
       LEFT JOIN matches m ON bbb.season = m.season AND bbb.match_number = m.match_number
       WHERE bbb.season = ${year} AND bbb.phase IS NOT NULL
     )
     SELECT bowler,
            ANY_VALUE(bowl_team) AS team,
            phase,
            CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS INTEGER) AS balls,
            CAST(SUM(total_runs) AS INTEGER) AS runs,
            CAST(SUM(CASE WHEN is_wicket
                          AND LOWER(COALESCE(wicket_kind,'')) NOT IN ('run out','retired hurt','retired out','obstructing the field','timed out')
                          THEN 1 ELSE 0 END) AS INTEGER) AS wickets
     FROM labeled
     GROUP BY bowler, phase`
  );

  const rows = state.status === "success" ? state.data : [];
  const minOvers = MIN_OVERS_BY_PHASE[phase];
  const { points, byTeam, medEcon, medAvg, plotMaxY, axMaxX } = useMemo(
    () => buildScatter(rows, phase, minOvers),
    [rows, phase, minOvers]
  );

  const allTeams = useMemo(
    () => Object.keys(byTeam).sort((a, b) => teamShort(a).localeCompare(teamShort(b))),
    [byTeam]
  );
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setVisible((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const t of allTeams) {
        const v = prev[t] ?? true;
        next[t] = v;
        if (prev[t] === undefined) changed = true;
      }
      if (!changed && Object.keys(prev).length === allTeams.length) return prev;
      return next;
    });
  }, [allTeams]);

  const toggleTeam = (team: string) =>
    setVisible((prev) => ({ ...prev, [team]: !(prev[team] ?? true) }));
  const showAll = () =>
    setVisible(() => Object.fromEntries(allTeams.map((t) => [t, true])));
  const allVisible = allTeams.every((t) => visible[t] ?? true);

  return (
    <Card
      title={`Economy vs Bowling Average (min ${minOvers} overs)`}
      right={<PhaseSelect value={phase} onChange={setPhase} />}
    >
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && points.length === 0 && <Empty />}
      {state.status === "success" && points.length > 0 && (
        <div>
          <div className="w-full h-[440px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 24, bottom: 36, left: 36 }}>
                <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="economy"
                  name="Economy"
                  domain={[0, axMaxX]}
                  tick={{ fontSize: 11, fill: "#52525b" }}
                  label={{
                    value: "Economy (runs / over)",
                    position: "insideBottom",
                    offset: -16,
                    fontSize: 12,
                    fill: "#52525b",
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="plotY"
                  name="Average"
                  domain={[0, plotMaxY]}
                  reversed
                  tick={{ fontSize: 11, fill: "#52525b" }}
                  label={{
                    value: "Bowling average (runs / wicket)",
                    angle: -90,
                    position: "insideLeft",
                    offset: 10,
                    fontSize: 12,
                    fill: "#52525b",
                  }}
                />
                <ZAxis
                  type="number"
                  dataKey="wickets"
                  range={[40, 320]}
                  name="Wickets"
                />
                <ReferenceArea
                  x1={0}
                  x2={medEcon}
                  y1={0}
                  y2={medAvg}
                  fill="transparent"
                  label={quadrantLabel("Elite", "#16a34a", "insideTopLeft")}
                />
                <ReferenceArea
                  x1={medEcon}
                  x2={axMaxX}
                  y1={0}
                  y2={medAvg}
                  fill="transparent"
                  label={quadrantLabel("Strike", "#0284c7", "insideTopRight")}
                />
                <ReferenceArea
                  x1={0}
                  x2={medEcon}
                  y1={medAvg}
                  y2={plotMaxY}
                  fill="transparent"
                  label={quadrantLabel("Stingy", "#ca8a04", "insideBottomLeft")}
                />
                <ReferenceArea
                  x1={medEcon}
                  x2={axMaxX}
                  y1={medAvg}
                  y2={plotMaxY}
                  fill="transparent"
                  label={quadrantLabel("Struggles", "#dc2626", "insideBottomRight")}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={<ScatterTooltip />}
                  wrapperStyle={{ outline: "none" }}
                />
                <ReferenceLine
                  x={medEcon}
                  stroke="#a1a1aa"
                  strokeDasharray="4 3"
                  label={{
                    value: `median econ ${medEcon.toFixed(2)}`,
                    position: "top",
                    fontSize: 10,
                    fill: "#71717a",
                  }}
                />
                <ReferenceLine
                  y={medAvg}
                  stroke="#a1a1aa"
                  strokeDasharray="4 3"
                  label={{
                    value: `median avg ${medAvg.toFixed(1)}`,
                    position: "right",
                    fontSize: 10,
                    fill: "#71717a",
                  }}
                />
                {Object.entries(byTeam)
                  .filter(([team]) => visible[team] ?? true)
                  .map(([team, pts]) => (
                    <Scatter
                      key={team}
                      name={teamShort(team)}
                      data={pts}
                      fill={teamColor(team)}
                      fillOpacity={0.75}
                      stroke={teamColor(team)}
                      strokeWidth={1}
                      shape={(props: PointShapeProps) => (
                        <PointShape {...props} color={teamColor(team)} />
                      )}
                    >
                      {pts.map((_, i) => (
                        <Cell key={i} fill={teamColor(team)} />
                      ))}
                    </Scatter>
                  ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <TeamFilterLegend
            teams={allTeams}
            visible={visible}
            onToggle={toggleTeam}
            onShowAll={showAll}
            allVisible={allVisible}
          />
          <p className="text-xs text-ipl-sub mt-2">
            ◆ Wicketless bowlers shown along the top edge. Bubble size = wickets
            taken. Click a team to toggle.
          </p>
        </div>
      )}
    </Card>
  );
}

function quadrantLabel(
  text: string,
  color: string,
  position:
    | "insideTopLeft"
    | "insideTopRight"
    | "insideBottomLeft"
    | "insideBottomRight"
) {
  return {
    value: text,
    position,
    fontSize: 11,
    fontWeight: 700,
    fill: color,
    fillOpacity: 0.55,
    offset: 8,
  };
}

function PhaseSelect({
  value,
  onChange,
}: {
  value: PhaseFilter;
  onChange: (v: PhaseFilter) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-ipl-line overflow-hidden text-[11px]">
      {PHASE_OPTIONS.map((opt) => {
        const on = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="px-2.5 py-1 border-r border-ipl-line last:border-r-0 transition-colors"
            style={{
              background: on ? "#18181b" : "#fff",
              color: on ? "#fff" : "#52525b",
              fontWeight: on ? 600 : 400,
            }}
            aria-pressed={on}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function TeamFilterLegend({
  teams,
  visible,
  onToggle,
  onShowAll,
  allVisible,
}: {
  teams: string[];
  visible: Record<string, boolean>;
  onToggle: (t: string) => void;
  onShowAll: () => void;
  allVisible: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-3">
      <button
        type="button"
        onClick={onShowAll}
        disabled={allVisible}
        className="text-[11px] px-2 py-1 rounded-md border border-ipl-line text-ipl-ink hover:bg-ipl-line2/30 disabled:opacity-40 disabled:cursor-default"
      >
        Show all
      </button>
      {teams.map((t) => {
        const on = visible[t] ?? true;
        const c = teamColor(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border transition-colors"
            style={{
              borderColor: on ? c : "#e4e4e7",
              background: on ? `${c}15` : "#fff",
              color: on ? "#18181b" : "#a1a1aa",
              opacity: on ? 1 : 0.65,
            }}
            aria-pressed={on}
          >
            <TeamBadge team={t} size="xs" />
            <span className="font-medium">{teamShort(t)}</span>
          </button>
        );
      })}
    </div>
  );
}

type PointShapeProps = {
  cx?: number;
  cy?: number;
  size?: number;
  payload?: Point;
};

function PointShape({ cx, cy, size, payload, color }: PointShapeProps & { color: string }) {
  if (cx == null || cy == null || !payload) return null;
  const s = Math.max(6, Math.sqrt(size ?? 60));
  if (payload.isWicketless) {
    // Diamond marker for wicketless bowlers
    const half = s * 0.7;
    return (
      <polygon
        points={`${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`}
        fill={color}
        fillOpacity={0.55}
        stroke={color}
        strokeWidth={1}
      />
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={s / 2}
      fill={color}
      fillOpacity={0.75}
      stroke={color}
      strokeWidth={1}
    />
  );
}

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
}) {
  const { resolve } = usePlayerNames();
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="border border-ipl-line rounded shadow-sm px-3 py-2 text-xs"
      style={{ backgroundColor: "#ffffff" }}
    >
      <div className="font-semibold text-ipl-ink">{resolve(p.bowler)}</div>
      <div className="text-ipl-sub mb-1">{teamShort(p.team)}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-ipl-sub">Economy</span>
        <span className="text-ipl-ink font-medium">{p.economy.toFixed(2)}</span>
        <span className="text-ipl-sub">Average</span>
        <span className="text-ipl-ink font-medium">
          {p.average == null ? "—" : p.average.toFixed(1)}
        </span>
        <span className="text-ipl-sub">Wickets</span>
        <span className="text-ipl-ink font-medium">{p.wickets}</span>
        <span className="text-ipl-sub">Overs</span>
        <span className="text-ipl-ink font-medium">{p.overs.toFixed(1)}</span>
      </div>
    </div>
  );
}

function buildScatter(
  rows: Row[],
  phase: PhaseFilter,
  minOvers: number
): {
  points: Point[];
  byTeam: Record<string, Point[]>;
  medEcon: number;
  medAvg: number;
  plotMaxY: number;
  axMaxX: number;
} {
  if (rows.length === 0)
    return {
      points: [],
      byTeam: {},
      medEcon: 0,
      medAvg: 0,
      plotMaxY: 0,
      axMaxX: 0,
    };

  // Collapse phase rows per bowler — keep only the selected phase, or sum all.
  type Agg = { team: string; balls: number; runs: number; wickets: number };
  const byBowler: Record<string, Agg> = {};
  for (const r of rows) {
    if (phase !== "all" && r.phase !== phase) continue;
    const a = byBowler[r.bowler] ?? { team: r.team, balls: 0, runs: 0, wickets: 0 };
    a.balls += r.balls;
    a.runs += r.runs;
    a.wickets += r.wickets;
    a.team = r.team;
    byBowler[r.bowler] = a;
  }

  const minBalls = minOvers * 6;
  const pre: Omit<Point, "plotY">[] = [];
  for (const [bowler, a] of Object.entries(byBowler)) {
    if (a.balls < minBalls) continue;
    const overs = a.balls / 6;
    const economy = overs > 0 ? a.runs / overs : 0;
    const average = a.wickets > 0 ? a.runs / a.wickets : null;
    pre.push({
      bowler,
      team: a.team,
      economy,
      average,
      wickets: a.wickets,
      overs,
      isWicketless: a.wickets === 0,
    });
  }
  if (pre.length === 0)
    return { points: [], byTeam: {}, medEcon: 0, medAvg: 0, plotMaxY: 0, axMaxX: 0 };

  const withWickets = pre.filter((p) => p.average != null) as (Omit<Point, "plotY"> & { average: number })[];
  const maxAvg = withWickets.length > 0 ? Math.max(...withWickets.map((p) => p.average)) : 30;
  const plotMaxY = Math.ceil(maxAvg * 1.1);

  const points: Point[] = pre.map((p) => ({
    ...p,
    plotY: p.average ?? plotMaxY * 0.97,
  }));

  const byTeam: Record<string, Point[]> = {};
  for (const p of points) {
    if (!byTeam[p.team]) byTeam[p.team] = [];
    byTeam[p.team].push(p);
  }

  const medEcon = median(pre.map((p) => p.economy));
  const medAvg = withWickets.length > 0 ? median(withWickets.map((p) => p.average)) : 0;
  const axMaxX = Math.ceil(Math.max(...pre.map((p) => p.economy), 10) * 1.05);

  return { points, byTeam, medEcon, medAvg, plotMaxY, axMaxX };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
