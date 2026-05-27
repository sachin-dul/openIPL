"use client";

import { useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { Card, Loading, Empty, ErrorBox } from "./chart-shell";

type Row = { team: string; over: number; avg_runs: number; n: number };

type HoverInfo = {
  team: string;
  over: number;
  avg: number | null;
  n: number | null;
  teamAvg: number | null;
  overAvg: number | null;
  x: number;
  y: number;
  placeAbove: boolean;
};

const PHASE_FOR_OVER = (o: number): string => {
  if (o <= 6) return "Powerplay";
  if (o <= 15) return "Middle";
  return "Death";
};

export function TeamDnaHeatmap({ year }: { year: number }) {
  const state = useDuckQuery<Row>(
    `WITH per_match_over AS (
       SELECT match_number, innings, team, over, SUM(total_runs) AS runs
       FROM ball_by_ball
       WHERE season = ${year}
       GROUP BY match_number, innings, team, over
     )
     SELECT team,
            CAST(over AS INTEGER) AS over,
            CAST(AVG(runs) AS DOUBLE) AS avg_runs,
            CAST(COUNT(*) AS BIGINT) AS n
     FROM per_match_over
     WHERE over BETWEEN 1 AND 20
     GROUP BY team, over`
  );

  const rows = state.status === "success" ? state.data : [];
  const grid = buildGrid(rows);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  return (
    <Card title="Scoring Rhythm — Avg runs per over by team">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && grid.teams.length === 0 && <Empty />}
      {state.status === "success" && grid.teams.length > 0 && (
        <div className="relative">
          <div style={{ overflowX: "auto", overflowY: "visible" }}>
            <div
              className="grid gap-px text-[10px] min-w-[640px]"
              style={{
                gridTemplateColumns: `minmax(120px,auto) repeat(20, minmax(28px,1fr))`,
              }}
            >
              <div />
              {Array.from({ length: 20 }, (_, i) => i + 1).map((o) => (
                <div
                  key={`h-${o}`}
                  className="text-center font-medium text-ipl-sub pb-1 tabular-nums"
                >
                  {o}
                </div>
              ))}

              {grid.teams.map((team) => (
                <RowFragment
                  key={team}
                  team={team}
                  cells={grid.byTeam[team]}
                  teamAvg={grid.teamAvg[team] ?? 0}
                  overAvg={grid.overAvg}
                  min={grid.min}
                  max={grid.max}
                  onHover={setHover}
                  hoverKey={hover ? `${hover.team}-${hover.over}` : null}
                />
              ))}
            </div>

            <Legend min={grid.min} max={grid.max} />
          </div>

          {hover && <HoverCard info={hover} />}
        </div>
      )}
    </Card>
  );
}

function HoverCard({ info }: { info: HoverInfo }) {
  const phase = PHASE_FOR_OVER(info.over);
  const phaseColor =
    phase === "Powerplay" ? "#2563eb" : phase === "Middle" ? "#ca8a04" : "#dc2626";
  const vsTeam =
    info.avg != null && info.teamAvg != null ? info.avg - info.teamAvg : null;
  const vsOver =
    info.avg != null && info.overAvg != null ? info.avg - info.overAvg : null;

  const transform = info.placeAbove
    ? "translate(-50%, calc(-100% - 8px))"
    : "translate(-50%, 8px)";

  return (
    <div
      className="absolute pointer-events-none z-10"
      style={{
        left: info.x,
        top: info.y,
        transform,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        padding: "8px 11px",
        fontSize: 11,
        boxShadow: "0 4px 14px rgba(0,0,0,0.10)",
        whiteSpace: "nowrap",
        minWidth: 200,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 600, color: "#111827" }}>{info.team}</span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: phaseColor,
            background: `${phaseColor}1a`,
            padding: "1px 6px",
            borderRadius: 3,
          }}
        >
          {phase}
        </span>
      </div>
      <div style={{ color: "#374151", marginBottom: 4 }}>
        Over <span style={{ fontWeight: 600 }}>{info.over}</span>
      </div>
      {info.avg != null ? (
        <>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#111827",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
              marginBottom: 4,
            }}
          >
            {info.avg.toFixed(2)}{" "}
            <span style={{ fontSize: 10, fontWeight: 500, color: "#6b7280" }}>
              runs/over
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto",
              columnGap: 10,
              rowGap: 1,
              color: "#6b7280",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>vs team avg</span>
            <DeltaSpan delta={vsTeam} />
            <span>vs league at over {info.over}</span>
            <DeltaSpan delta={vsOver} />
            <span>sample size</span>
            <span style={{ color: "#374151", textAlign: "right" }}>
              {info.n} {info.n === 1 ? "match" : "matches"}
            </span>
          </div>
        </>
      ) : (
        <div style={{ color: "#9ca3af" }}>no data</div>
      )}
    </div>
  );
}

function DeltaSpan({ delta }: { delta: number | null }) {
  if (delta == null) {
    return <span style={{ color: "#9ca3af", textAlign: "right" }}>—</span>;
  }
  const sign = delta > 0 ? "+" : "";
  const color = delta > 0.05 ? "#16a34a" : delta < -0.05 ? "#dc2626" : "#6b7280";
  return (
    <span style={{ color, textAlign: "right", fontWeight: 600 }}>
      {sign}
      {delta.toFixed(2)}
    </span>
  );
}

function RowFragment({
  team,
  cells,
  teamAvg,
  overAvg,
  min,
  max,
  onHover,
  hoverKey,
}: {
  team: string;
  cells: (Row | undefined)[];
  teamAvg: number;
  overAvg: number[];
  min: number;
  max: number;
  onHover: (info: HoverInfo | null) => void;
  hoverKey: string | null;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-xs text-ipl-ink font-medium pr-3">
        <TeamBadge team={team} size="xs" />
        <span className="truncate">{teamShort(team)}</span>
      </div>
      {cells.map((c, i) => {
        const over = i + 1;
        const v = c?.avg_runs ?? null;
        const bg =
          v == null ? "#f4f4f5" : ylOrRd((v - min) / Math.max(1e-6, max - min));
        const fg = v != null && (v - min) / Math.max(1e-6, max - min) > 0.6 ? "#fff" : "#27272a";
        const key = `${team}-${over}`;
        const isHover = hoverKey === key;
        return (
          <div
            key={key}
            className="h-7 rounded-sm flex items-center justify-center tabular-nums cursor-pointer"
            style={{
              background: bg,
              color: fg,
              fontSize: 10,
              outline: isHover ? "2px solid #111827" : "none",
              outlineOffset: isHover ? "-1px" : "0",
              transform: isHover ? "scale(1.04)" : "none",
              transformOrigin: over === 20 ? "right center" : over === 1 ? "left center" : "center",
              transition: "transform 80ms",
              position: "relative",
              zIndex: isHover ? 1 : 0,
            }}
            onMouseEnter={(e) => {
              // Walk up: cell → grid → scroll wrapper → outer relative div
              // (the HoverCard's positioning context).
              const containerEl = e.currentTarget.parentElement
                ?.parentElement?.parentElement as HTMLElement | null;
              const containerR = containerEl?.getBoundingClientRect();
              const cellR = e.currentTarget.getBoundingClientRect();
              const rawX = containerR
                ? cellR.left - containerR.left + cellR.width / 2
                : cellR.left;
              // Keep the tooltip (≈220px wide, anchored via translate(-50%))
              // inside the outer container so it can't trigger the scroll
              // wrapper's overflow at the right edge.
              const xRel = containerR
                ? Math.min(Math.max(rawX, 110), containerR.width - 110)
                : rawX;
              const cellMidY = cellR.top + cellR.height / 2;
              const containerMidY = containerR
                ? containerR.top + containerR.height / 2
                : cellMidY;
              const placeAbove = cellMidY > containerMidY;
              const yRel = containerR
                ? (placeAbove ? cellR.top : cellR.bottom) - containerR.top
                : cellR.top;
              onHover({
                team,
                over,
                avg: v,
                n: c?.n ?? null,
                teamAvg,
                overAvg: overAvg[i] ?? null,
                x: xRel,
                y: yRel,
                placeAbove,
              });
            }}
            onMouseLeave={() => onHover(null)}
          >
            {v != null ? v.toFixed(1) : ""}
          </div>
        );
      })}
    </>
  );
}

function Legend({ min, max }: { min: number; max: number }) {
  const stops = Array.from({ length: 21 }, (_, i) => i / 20);
  return (
    <div className="flex items-center gap-2 mt-4 text-xs text-ipl-sub">
      <span className="tabular-nums">{min.toFixed(1)}</span>
      <div className="flex flex-1 h-2.5 rounded overflow-hidden">
        {stops.map((s) => (
          <div key={s} className="flex-1" style={{ background: ylOrRd(s) }} />
        ))}
      </div>
      <span className="tabular-nums">{max.toFixed(1)}</span>
      <span className="ml-2">runs / over</span>
    </div>
  );
}

function buildGrid(rows: Row[]): {
  teams: string[];
  byTeam: Record<string, (Row | undefined)[]>;
  teamAvg: Record<string, number>;
  overAvg: number[];
  min: number;
  max: number;
} {
  if (rows.length === 0)
    return { teams: [], byTeam: {}, teamAvg: {}, overAvg: [], min: 0, max: 0 };

  const byTeam: Record<string, (Row | undefined)[]> = {};
  for (const r of rows) {
    if (!byTeam[r.team]) byTeam[r.team] = Array.from({ length: 20 });
    byTeam[r.team][r.over - 1] = r;
  }

  const teamAvg: Record<string, number> = {};
  for (const t of Object.keys(byTeam)) {
    const vals = byTeam[t].filter((c): c is Row => !!c).map((c) => c.avg_runs);
    teamAvg[t] = vals.length
      ? vals.reduce((a, b) => a + b, 0) / vals.length
      : 0;
  }

  const overAvg: number[] = Array.from({ length: 20 }, () => 0);
  const overCount: number[] = Array.from({ length: 20 }, () => 0);
  for (const r of rows) {
    overAvg[r.over - 1] += r.avg_runs;
    overCount[r.over - 1] += 1;
  }
  for (let i = 0; i < 20; i += 1) {
    if (overCount[i] > 0) overAvg[i] = overAvg[i] / overCount[i];
  }

  const teams = Object.keys(byTeam);
  teams.sort((a, b) => teamAvg[b] - teamAvg[a]);

  const all = rows.map((r) => r.avg_runs);
  const min = Math.min(...all);
  const max = Math.max(...all);
  return { teams, byTeam, teamAvg, overAvg, min, max };
}

// YlOrRd interpolation: 8-stop color ramp from ColorBrewer
const YL_OR_RD = [
  [255, 255, 204],
  [255, 237, 160],
  [254, 217, 118],
  [254, 178, 76],
  [253, 141, 60],
  [252, 78, 42],
  [227, 26, 28],
  [177, 0, 38],
];

function ylOrRd(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (YL_OR_RD.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  if (i >= YL_OR_RD.length - 1) {
    const c = YL_OR_RD[YL_OR_RD.length - 1];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const a = YL_OR_RD[i];
  const b = YL_OR_RD[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}
