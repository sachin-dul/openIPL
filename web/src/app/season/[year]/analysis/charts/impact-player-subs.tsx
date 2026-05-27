"use client";

import { useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import {
  Card,
  Loading,
  Empty,
  ErrorBox,
  IMPACT_INTENT_COLORS,
  PHASE_BAND_COLORS,
  type ImpactIntent,
} from "./chart-shell";

type Row = {
  team: string;
  innings: number;
  over: number;
  match_number: number;
  player_in: string;
  player_out: string;
  role_in: string | null;
  role_out: string | null;
  batting_team: string | null;
};

type Sub = {
  team: string;
  over: number;
  match_number: number;
  intent: ImpactIntent;
  lane: "bat" | "bowl";
  player_in: string;
  player_out: string;
  role_in: string | null;
  role_out: string | null;
};

type HoverContent =
  | { kind: "single"; sub: Sub }
  | { kind: "cluster"; team: string; over: number; subs: Sub[] };

type HoverState = {
  content: HoverContent;
  x: number;
  y: number;
  // Rendered SVG width in screen pixels, used to decide whether the tooltip
  // should flip to the left of the cursor when near the right edge.
  containerW: number;
} | null;

// viewBox W is sized so the SVG renders at roughly ~1.5× scale on a wide
// analysis card — a smaller viewBox upscales the chart too much, a larger
// one shrinks the labels below the rest of the page.
const W = 1050;
const LABEL_W = 132;
const PAD_R = 19;
const HIST_H = 80;
const HIST_PAD_TOP = 20;
const HIST_PAD_BOTTOM = 12;
const PHASE_LABEL_H = 22;
const ROW_H = 30;
const AXIS_H = 42;
const OVERS = 20;

// Pulled from globals.css — used as inline fill/stroke values inside SVG
// so the chart picks up the warm theme neutrals instead of cool zinc grays.
const C_SUB = "var(--color-ipl-sub)";
const C_SOFT = "var(--color-ipl-soft)";
const C_LINE = "var(--color-ipl-line)";
const C_LINE2 = "var(--color-ipl-line2)";
const C_SURFACE = "var(--color-ipl-surface)";
const PHASE_BAND_OPACITY = 0.22;

export function ImpactPlayerSubs({ year }: { year: number }) {
  const state = useDuckQuery<Row>(
    `WITH innings_bat AS (
       SELECT match_number, innings, ANY_VALUE(team) AS batting_team
       FROM ball_by_ball WHERE season = ${year}
       GROUP BY match_number, innings
     ),
     roles AS (
       SELECT player, ANY_VALUE(role) AS role
       FROM players WHERE season = ${year}
       GROUP BY player
     )
     SELECT s.team,
            CAST(s.innings AS INTEGER) AS innings,
            CAST(s.over AS INTEGER) AS over,
            CAST(s.match_number AS INTEGER) AS match_number,
            s.player_in,
            s.player_out,
            r_in.role AS role_in,
            r_out.role AS role_out,
            ib.batting_team
     FROM substitutions s
     LEFT JOIN roles r_in ON r_in.player = s.player_in
     LEFT JOIN roles r_out ON r_out.player = s.player_out
     LEFT JOIN innings_bat ib
       ON ib.match_number = s.match_number AND ib.innings = s.innings
     WHERE s.season = ${year} AND LOWER(s.reason) = 'impact_player'`
  );

  const rows = state.status === "success" ? state.data : [];
  const { teams, byTeam, histogram, total } = useMemo(() => classify(rows), [rows]);
  const [hover, setHover] = useState<HoverState>(null);

  const stripH =
    PHASE_LABEL_H + teams.length * ROW_H + AXIS_H + 8;
  const totalH = HIST_PAD_TOP + HIST_H + HIST_PAD_BOTTOM + stripH;

  const xScale = (over: number) =>
    LABEL_W + (over / OVERS) * (W - LABEL_W - PAD_R);
  const rowY = (i: number) => HIST_PAD_TOP + HIST_H + HIST_PAD_BOTTOM + PHASE_LABEL_H + i * ROW_H + ROW_H / 2;

  return (
    <Card title="Impact Player Introductions — by over">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && teams.length === 0 && (
        <Empty message="No impact-player substitutions recorded this season." />
      )}
      {state.status === "success" && teams.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <div className="text-xs text-ipl-sub">
              <span className="text-ipl-ink font-semibold tabular-nums">
                {total}
              </span>{" "}
              impact-player introductions across {teams.length} teams.
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ipl-sub">
              League per over · team strip below
            </div>
          </div>

          <div className="relative">
            <svg viewBox={`0 0 ${W} ${totalH}`} className="w-full h-auto">
              <PhaseBandsHistogram
                histogram={histogram}
                xScale={xScale}
              />
              <PhaseBandsStrip
                top={HIST_PAD_TOP + HIST_H + HIST_PAD_BOTTOM}
                bottom={HIST_PAD_TOP + HIST_H + HIST_PAD_BOTTOM + PHASE_LABEL_H + teams.length * ROW_H}
                xScale={xScale}
              />

              {/* per-team rows */}
              {teams.map((team, i) => (
                <TeamStripRow
                  key={team}
                  team={team}
                  subs={byTeam[team]}
                  y={rowY(i)}
                  xScale={xScale}
                  onHover={(content, ev) => {
                    const svg = (ev.currentTarget as SVGElement).ownerSVGElement;
                    if (!svg) return;
                    const rect = svg.getBoundingClientRect();
                    setHover({
                      content,
                      x: ev.clientX - rect.left,
                      y: ev.clientY - rect.top,
                      containerW: rect.width,
                    });
                  }}
                  onLeave={() => setHover(null)}
                />
              ))}

              {/* over axis at bottom */}
              <OverAxis
                y={HIST_PAD_TOP + HIST_H + HIST_PAD_BOTTOM + PHASE_LABEL_H + teams.length * ROW_H + 4}
                xScale={xScale}
              />
            </svg>

            {hover && <HoverCard hover={hover} />}
          </div>

          <Legend />

          <p className="text-xs text-ipl-sub mt-3">
            Top strip = league-wide histogram of impact-player introductions
            stacked by intent. Per-team rows mark each substitution in the over
            it occurred; clusters of 3+ in the same over collapse into a single
            count-badge — hover for details.
          </p>
        </div>
      )}
    </Card>
  );
}

function PhaseBandsHistogram({
  histogram,
  xScale,
}: {
  histogram: number[][]; // [over][intent_idx], intent_idx 0=bat,1=bowl,2=same
  xScale: (over: number) => number;
}) {
  const totalPerOver = histogram.map((bins) => bins.reduce((a, b) => a + b, 0));
  const maxN = Math.max(1, ...totalPerOver);
  const baseY = HIST_PAD_TOP + HIST_H;
  const top = HIST_PAD_TOP;
  const ymax = baseY - top;

  return (
    <g>
      {/* phase backgrounds */}
      {(
        [
          { phase: "powerplay", x1: 0, x2: 6 },
          { phase: "middle", x1: 6, x2: 15 },
          { phase: "death", x1: 15, x2: 20 },
        ] as const
      ).map((p) => (
        <rect
          key={p.phase}
          x={xScale(p.x1)}
          y={top}
          width={xScale(p.x2) - xScale(p.x1)}
          height={ymax}
          fill={PHASE_BAND_COLORS[p.phase]}
          fillOpacity={PHASE_BAND_OPACITY}
        />
      ))}

      {/* top gridline + max tick */}
      <line
        x1={xScale(0)}
        x2={xScale(OVERS)}
        y1={top}
        y2={top}
        style={{ stroke: C_LINE }}
        strokeWidth={1}
      />
      <text
        x={LABEL_W - 8}
        y={top + 4}
        textAnchor="end"
        fontSize={10}
        style={{ fill: C_SOFT }}
        className="tabular-nums"
      >
        {maxN}
      </text>

      {/* Y-axis label, rotated along the left margin of the histogram */}
      <text
        x={16}
        y={top + (baseY - top) / 2}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        letterSpacing="0.06em"
        style={{ fill: C_SUB }}
        transform={`rotate(-90, 16, ${top + (baseY - top) / 2})`}
      >
        SUBS / OVER
      </text>

      {/* baseline */}
      <line
        x1={xScale(0)}
        x2={xScale(OVERS)}
        y1={baseY}
        y2={baseY}
        style={{ stroke: C_LINE }}
        strokeWidth={1}
      />

      {/* stacked bars per over — sqrt scaling so a single-digit over still
          reads against the powerplay spike. Total bar height ∝ √(n/maxN),
          segments proportional within the total. */}
      {histogram.map((bins, idx) => {
        const over = idx + 1; // overs 1..20
        const slotL = xScale(over - 1);
        const slotR = xScale(over);
        const w = (slotR - slotL) * 0.74;
        const x = slotL + (slotR - slotL - w) / 2;
        const totalN = bins.reduce((a, b) => a + b, 0);
        const totalH = totalN === 0 ? 0 : Math.sqrt(totalN / maxN) * ymax;
        let cy = baseY;
        const intents: ImpactIntent[] = ["bat", "bowl", "same"];
        return (
          <g key={`hist-${over}`}>
            {intents.map((it, ii) => {
              const n = bins[ii];
              if (n === 0) return null;
              const h = (n / totalN) * totalH;
              cy -= h;
              return (
                <rect
                  key={`${over}-${it}`}
                  x={x}
                  y={cy}
                  width={w}
                  height={h}
                  fill={IMPACT_INTENT_COLORS[it]}
                  fillOpacity={0.88}
                  rx={1}
                />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function PhaseBandsStrip({
  top,
  bottom,
  xScale,
}: {
  top: number;
  bottom: number;
  xScale: (over: number) => number;
}) {
  const height = bottom - top;
  return (
    <g>
      {/* Team-column header (sits in the left margin above the team rows) */}
      <text
        x={LABEL_W / 2 + 4}
        y={top + 13}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        letterSpacing="0.06em"
        style={{ fill: C_SUB }}
      >
        TEAM
      </text>
      {(
        [
          { phase: "powerplay", x1: 0, x2: 6, label: "Powerplay" },
          { phase: "middle", x1: 6, x2: 15, label: "Middle" },
          { phase: "death", x1: 15, x2: 20, label: "Death" },
        ] as const
      ).map((p) => (
        <g key={p.phase}>
          <rect
            x={xScale(p.x1)}
            y={top + PHASE_LABEL_H}
            width={xScale(p.x2) - xScale(p.x1)}
            height={height - PHASE_LABEL_H}
            fill={PHASE_BAND_COLORS[p.phase]}
            fillOpacity={PHASE_BAND_OPACITY}
          />
          <text
            x={(xScale(p.x1) + xScale(p.x2)) / 2}
            y={top + 13}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            letterSpacing="0.04em"
            style={{ fill: C_SUB }}
          >
            {p.label.toUpperCase()}
          </text>
        </g>
      ))}
      {/* phase divider lines */}
      {[6, 15].map((x) => (
        <line
          key={x}
          x1={xScale(x)}
          x2={xScale(x)}
          y1={top + PHASE_LABEL_H}
          y2={bottom}
          style={{ stroke: C_SURFACE }}
          strokeWidth={1.5}
        />
      ))}
    </g>
  );
}

const CLUSTER_THRESHOLD = 3;

function TeamStripRow({
  team,
  subs,
  y,
  xScale,
  onHover,
  onLeave,
}: {
  team: string;
  subs: Sub[];
  y: number;
  xScale: (over: number) => number;
  onHover: (content: HoverContent, ev: React.MouseEvent<SVGElement>) => void;
  onLeave: () => void;
}) {
  const groups = new Map<number, Sub[]>();
  for (const s of subs) {
    if (!groups.has(s.over)) groups.set(s.over, []);
    groups.get(s.over)!.push(s);
  }
  const slotW = xScale(1) - xScale(0);

  return (
    <g>
      <foreignObject x={4} y={y - 11} width={LABEL_W - 10} height={22}>
        <div
          className="flex items-center gap-2 text-[12px] text-ipl-ink"
          style={{ height: 22 }}
        >
          <TeamBadge team={team} size="sm" />
          <span className="font-medium truncate">{teamShort(team)}</span>
          <span className="text-ipl-soft ml-auto pr-1 tabular-nums font-mono">
            {subs.length}
          </span>
        </div>
      </foreignObject>
      <line
        x1={xScale(0)}
        x2={xScale(OVERS)}
        y1={y}
        y2={y}
        style={{ stroke: C_LINE2 }}
        strokeWidth={1}
      />
      {[...groups.entries()].map(([over, group]) => {
        const cx = xScale(over - 0.5);
        if (group.length >= CLUSTER_THRESHOLD) {
          const counts: Record<ImpactIntent, number> = { bat: 0, bowl: 0, same: 0 };
          for (const s of group) counts[s.intent] += 1;
          const dominant = (Object.entries(counts).sort(
            (a, b) => b[1] - a[1]
          )[0][0] as ImpactIntent);
          return (
            <g
              key={`c-${over}`}
              onMouseEnter={(e) =>
                onHover({ kind: "cluster", team, over, subs: group }, e)
              }
              onMouseLeave={onLeave}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={cx}
                cy={y}
                r={9}
                fill={IMPACT_INTENT_COLORS[dominant]}
                style={{ stroke: C_SURFACE }}
                strokeWidth={1.5}
              />
              <text
                x={cx}
                y={y + 3}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                style={{ fill: C_SURFACE }}
                pointerEvents="none"
              >
                {group.length}
              </text>
            </g>
          );
        }
        // 1–2 subs: side-by-side, no jitter
        const r = group.length === 1 ? 5 : 4.4;
        const gap = group.length === 2 ? 5.2 : 0;
        const startX = cx - ((group.length - 1) * gap);
        return group.map((s, idx) => {
          const px = startX + idx * gap * 2;
          const isBatLane = s.lane === "bat";
          return isBatLane ? (
            <circle
              key={`${over}-${idx}`}
              cx={px}
              cy={y}
              r={r}
              fill={IMPACT_INTENT_COLORS[s.intent]}
              strokeWidth={1.2}
              onMouseEnter={(e) => onHover({ kind: "single", sub: s }, e)}
              onMouseLeave={onLeave}
              style={{ stroke: C_SURFACE, cursor: "pointer" }}
            />
          ) : (
            <rect
              key={`${over}-${idx}`}
              x={px - r}
              y={y - r}
              width={r * 2}
              height={r * 2}
              fill={IMPACT_INTENT_COLORS[s.intent]}
              strokeWidth={1.2}
              onMouseEnter={(e) => onHover({ kind: "single", sub: s }, e)}
              onMouseLeave={onLeave}
              style={{ stroke: C_SURFACE, cursor: "pointer" }}
            />
          );
        });
      })}
    </g>
  );
}

function OverAxis({
  y,
  xScale,
}: {
  y: number;
  xScale: (over: number) => number;
}) {
  return (
    <g>
      <line
        x1={xScale(0)}
        x2={xScale(OVERS)}
        y1={y}
        y2={y}
        style={{ stroke: C_LINE }}
        strokeWidth={1}
      />
      {[0, 5, 10, 15, 20].map((t) => (
        <g key={t}>
          <line
            x1={xScale(t)}
            x2={xScale(t)}
            y1={y}
            y2={y + 4}
            style={{ stroke: C_SOFT }}
          />
          <text
            x={xScale(t)}
            y={y + 16}
            textAnchor="middle"
            fontSize={10}
            style={{ fill: C_SUB }}
            className="tabular-nums"
          >
            {t}
          </text>
        </g>
      ))}
      {/* X-axis label */}
      <text
        x={(xScale(0) + xScale(OVERS)) / 2}
        y={y + 32}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        letterSpacing="0.06em"
        style={{ fill: C_SUB }}
      >
        OVER
      </text>
    </g>
  );
}

function HoverCard({ hover }: { hover: NonNullable<HoverState> }) {
  const flipLeft = hover.x / hover.containerW > 0.55;
  return (
    <div
      className="absolute pointer-events-none z-10 border border-ipl-line rounded-md shadow-md px-3 py-2 text-xs"
      style={{
        left: hover.x,
        top: hover.y,
        transform: flipLeft
          ? "translate(calc(-100% - 12px), -50%)"
          : "translate(12px, -50%)",
        minWidth: 240,
        maxWidth: 320,
        backgroundColor: "#ffffff",
      }}
    >
      {hover.content.kind === "single" ? (
        <SingleHover sub={hover.content.sub} />
      ) : (
        <ClusterHover
          team={hover.content.team}
          over={hover.content.over}
          subs={hover.content.subs}
        />
      )}
    </div>
  );
}

function SingleHover({ sub }: { sub: Sub }) {
  const { resolve } = usePlayerNames();
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="font-semibold text-ipl-ink">{teamShort(sub.team)}</span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{
            background: `${IMPACT_INTENT_COLORS[sub.intent]}25`,
            color: IMPACT_INTENT_COLORS[sub.intent],
          }}
        >
          {INTENT_LABEL[sub.intent]}
        </span>
      </div>
      <div className="text-ipl-sub mb-1.5">
        Match <span className="font-medium text-ipl-ink">{sub.match_number}</span>
        <span className="text-ipl-line2"> · </span>
        Over <span className="font-medium text-ipl-ink">{sub.over}</span>
        <span className="text-ipl-line2"> · </span>
        <span className="text-ipl-ink">
          {sub.lane === "bat" ? "batting" : "bowling"}
        </span>
      </div>
      <div className="text-ipl-ink leading-snug">
        <span className="text-ipl-soft">In: </span>
        <span className="font-medium">{resolve(sub.player_in)}</span>
        {sub.role_in && <span className="text-ipl-soft"> ({sub.role_in})</span>}
      </div>
      <div className="text-ipl-ink leading-snug">
        <span className="text-ipl-soft">Out: </span>
        <span className="font-medium">{resolve(sub.player_out)}</span>
        {sub.role_out && <span className="text-ipl-soft"> ({sub.role_out})</span>}
      </div>
    </>
  );
}

function ClusterHover({
  team,
  over,
  subs,
}: {
  team: string;
  over: number;
  subs: Sub[];
}) {
  const { resolve } = usePlayerNames();
  const sorted = [...subs].sort((a, b) => a.match_number - b.match_number);
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="font-semibold text-ipl-ink">{teamShort(team)}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ipl-sub">
          {subs.length} subs at over {over}
        </span>
      </div>
      <ul className="space-y-1 mt-1.5 max-h-48 overflow-auto">
        {sorted.map((s, i) => (
          <li
            key={`${s.match_number}-${i}`}
            className="flex items-start gap-2 text-[11px] leading-snug"
          >
            <span
              className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: IMPACT_INTENT_COLORS[s.intent] }}
            />
            <span className="flex-1">
              <span className="text-ipl-soft">M{s.match_number}</span>
              <span className="text-ipl-line2"> · </span>
              <span className="text-ipl-ink font-medium">
                {resolve(s.player_in)}
              </span>
              <span className="text-ipl-soft"> for </span>
              <span className="text-ipl-ink">{resolve(s.player_out)}</span>
              <span className="text-ipl-soft">
                {" "}
                ({s.lane === "bat" ? "batting" : "bowling"})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const INTENT_LABEL: Record<ImpactIntent, string> = {
  bat: "Bring in batter",
  bowl: "Bring in bowler",
  same: "Like-for-like",
};

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      {(["bat", "bowl", "same"] as ImpactIntent[]).map((it) => (
        <span key={it} className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ background: IMPACT_INTENT_COLORS[it] }}
          />
          <span className="text-ipl-ink">{INTENT_LABEL[it]}</span>
        </span>
      ))}
      <span className="h-3 w-px bg-ipl-line2" aria-hidden="true" />
      <span className="inline-flex items-center gap-1.5 text-ipl-sub">
        <span className="w-2.5 h-2.5 rounded-full bg-ipl-soft" />
        team batting
      </span>
      <span className="inline-flex items-center gap-1.5 text-ipl-sub">
        <span className="w-2.5 h-2.5 bg-ipl-soft" />
        team bowling
      </span>
    </div>
  );
}

function classify(rows: Row[]): {
  teams: string[];
  byTeam: Record<string, Sub[]>;
  histogram: number[][]; // [over_idx 0..19][intent_idx 0..2]
  total: number;
} {
  const byTeam: Record<string, Sub[]> = {};
  const histogram: number[][] = Array.from({ length: OVERS }, () => [0, 0, 0]);
  const battingRoles = new Set(["batter", "wicketkeeper", "wicket-keeper"]);
  const bowlingRoles = new Set(["bowler"]);

  const role = (r: string | null): "bat" | "bowl" | "other" => {
    if (!r) return "other";
    const x = r.toLowerCase().trim();
    if (battingRoles.has(x)) return "bat";
    if (bowlingRoles.has(x)) return "bowl";
    return "other";
  };

  let total = 0;
  for (const r of rows) {
    const ri = role(r.role_in);
    const ro = role(r.role_out);
    let intent: ImpactIntent;
    if (ri === "bat" && ro === "bowl") intent = "bat";
    else if (ri === "bowl" && ro === "bat") intent = "bowl";
    else if (ri === "bat") intent = "bat";
    else if (ri === "bowl") intent = "bowl";
    else intent = "same";

    const lane: "bat" | "bowl" =
      r.batting_team && r.team === r.batting_team ? "bat" : "bowl";

    if (!byTeam[r.team]) byTeam[r.team] = [];
    byTeam[r.team].push({
      team: r.team,
      over: r.over,
      match_number: r.match_number,
      intent,
      lane,
      player_in: r.player_in,
      player_out: r.player_out,
      role_in: r.role_in,
      role_out: r.role_out,
    });

    const overIdx = Math.min(OVERS - 1, Math.max(0, r.over - 1));
    const intentIdx = intent === "bat" ? 0 : intent === "bowl" ? 1 : 2;
    histogram[overIdx][intentIdx] += 1;
    total += 1;
  }

  const teams = Object.keys(byTeam).sort(
    (a, b) => byTeam[b].length - byTeam[a].length
  );
  return { teams, byTeam, histogram, total };
}
