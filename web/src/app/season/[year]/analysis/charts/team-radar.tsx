"use client";

import { useEffect, useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort, teamColor } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, Loading, Empty, ErrorBox } from "./chart-shell";

type Row = {
  side: "bat" | "bowl";
  team: string;
  phase: "powerplay" | "middle" | "death";
  runs: number;
  balls: number;
};

type PhaseKey = "powerplay" | "middle" | "death";
const PHASES: PhaseKey[] = ["powerplay", "middle", "death"];
const PHASE_LABEL: Record<PhaseKey, string> = {
  powerplay: "Powerplay",
  middle: "Middle",
  death: "Death",
};

const AXES = [
  { key: "PP Bat", side: "bat", phase: "powerplay" },
  { key: "Mid Bat", side: "bat", phase: "middle" },
  { key: "Death Bat", side: "bat", phase: "death" },
  { key: "Death Bowl", side: "bowl", phase: "death" },
  { key: "Mid Bowl", side: "bowl", phase: "middle" },
  { key: "PP Bowl", side: "bowl", phase: "powerplay" },
] as const;

type AxisRow = Record<string, string | number>;

type TeamStats = {
  bat: Record<PhaseKey, number>;
  bowl: Record<PhaseKey, number>;
};

type RadarData = {
  teams: string[];
  byTeam: Record<string, TeamStats>;
  leagueAvg: TeamStats;
  maxRR: number;
};

export function TeamRadar({ year }: { year: number }) {
  const state = useDuckQuery<Row>(
    `WITH innings_teams AS (
       SELECT match_number, innings, ANY_VALUE(team) AS bat_team
       FROM ball_by_ball WHERE season = ${year}
       GROUP BY match_number, innings
     ),
     labeled AS (
       SELECT bb.team AS bat_team,
              opp.bat_team AS bowl_team,
              bb.phase,
              bb.total_runs,
              CASE WHEN COALESCE(bb.wides,0)=0 AND COALESCE(bb.noballs,0)=0 THEN 1 ELSE 0 END AS legal
       FROM ball_by_ball bb
       JOIN innings_teams opp
         ON opp.match_number = bb.match_number AND opp.innings != bb.innings
       WHERE bb.season = ${year} AND bb.phase IS NOT NULL
     )
     SELECT 'bat' AS side, bat_team AS team, phase,
            CAST(SUM(total_runs) AS BIGINT) AS runs,
            CAST(SUM(legal) AS BIGINT) AS balls
     FROM labeled GROUP BY bat_team, phase
     UNION ALL
     SELECT 'bowl' AS side, bowl_team AS team, phase,
            CAST(SUM(total_runs) AS BIGINT) AS runs,
            CAST(SUM(legal) AS BIGINT) AS balls
     FROM labeled GROUP BY bowl_team, phase`
  );

  const rows = state.status === "success" ? state.data : [];
  const data = useMemo(() => buildRadar(rows), [rows]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (data.teams.length === 0) return;
    if (selected && data.teams.includes(selected)) return;
    setSelected(data.teams[0]);
  }, [data.teams, selected]);

  const niceMax = Math.ceil(data.maxRR);
  const step = Math.max(1, Math.ceil(niceMax / 4));
  const radiusTicks = Array.from(
    new Set([0, step, step * 2, step * 3, niceMax])
  ).sort((a, b) => a - b);

  const axisData = useMemo(() => {
    if (!selected || !data.byTeam[selected]) return [] as AxisRow[];
    return buildAxisData(data, selected);
  }, [data, selected]);

  const identity = useMemo(() => {
    if (!selected || !data.byTeam[selected]) return null;
    return describeTeam(data.byTeam[selected], data.leagueAvg);
  }, [data, selected]);

  return (
    <Card
      title="Team Fingerprint (batting + bowling by phase)"
      right={
        data.teams.length > 0 && selected ? (
          <TeamSelect
            teams={data.teams}
            value={selected}
            onChange={setSelected}
          />
        ) : undefined
      }
    >
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorBox message={state.error.message} />}
      {state.status === "success" && data.teams.length === 0 && <Empty />}
      {state.status === "success" && data.teams.length > 0 && selected && (
        <div>
          <div className="w-full h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={axisData} outerRadius="72%">
                <PolarGrid stroke="#e4e4e7" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fontSize: 11, fill: "#52525b" }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, niceMax]}
                  ticks={radiusTicks}
                  tick={{ fontSize: 9, fill: "#a1a1aa" }}
                />
                <Radar
                  name="League avg"
                  dataKey="league"
                  stroke="#9ca3af"
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  fill="#9ca3af"
                  fillOpacity={0.08}
                  isAnimationActive={false}
                />
                <Radar
                  name={teamShort(selected)}
                  dataKey="team"
                  stroke={teamColor(selected)}
                  strokeWidth={2.5}
                  fill={teamColor(selected)}
                  fillOpacity={0.3}
                  isAnimationActive={false}
                />
                <Tooltip
                  content={<RadarTooltip teamName={selected} />}
                  wrapperStyle={{ outline: "none" }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {identity && <IdentityPanel team={selected} identity={identity} />}

          <p className="text-xs text-ipl-sub mt-3">
            Bat axes are run-rate (further out = higher scoring); bowl axes are
            inverted economy (further out = stingier). Dashed gray = league
            average.
          </p>
        </div>
      )}
    </Card>
  );
}

function TeamSelect({
  teams,
  value,
  onChange,
}: {
  teams: string[];
  value: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <TeamBadge team={value} size="sm" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm border border-ipl-line rounded-md px-2 py-1 bg-ipl-surface text-ipl-ink"
      >
        {teams.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function IdentityPanel({
  team,
  identity,
}: {
  team: string;
  identity: TeamIdentity;
}) {
  const color = teamColor(team);
  return (
    <div className="mt-4 rounded-lg border border-ipl-line bg-ipl-line2/30 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded text-white"
          style={{ background: color }}
        >
          Identity
        </span>
        <span className="text-sm font-semibold text-ipl-ink">
          {identity.headline}
        </span>
      </div>
      {identity.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {identity.tags.map((t) => (
            <span
              key={t.label}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: t.tone === "positive" ? "#dcfce7" : t.tone === "negative" ? "#fee2e2" : "#e5e7eb",
                color: t.tone === "positive" ? "#15803d" : t.tone === "negative" ? "#b91c1c" : "#374151",
              }}
            >
              {t.label}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-ipl-sub leading-relaxed">
        {identity.description}
      </p>
    </div>
  );
}

function buildRadar(rows: Row[]): RadarData {
  if (rows.length === 0) {
    return {
      teams: [],
      byTeam: {},
      leagueAvg: emptyStats(),
      maxRR: 0,
    };
  }

  const rate = (r: Row) => (r.balls > 0 ? (r.runs / r.balls) * 6 : 0);
  const teams = [...new Set(rows.map((r) => r.team))];

  const byTeam: Record<string, TeamStats> = {};
  for (const t of teams) byTeam[t] = emptyStats();
  for (const r of rows) {
    byTeam[r.team][r.side][r.phase] = rate(r);
  }

  // League average per (side, phase)
  const sum = emptyStats();
  const count: { bat: Record<PhaseKey, number>; bowl: Record<PhaseKey, number> } =
    {
      bat: { powerplay: 0, middle: 0, death: 0 },
      bowl: { powerplay: 0, middle: 0, death: 0 },
    };
  for (const t of teams) {
    for (const p of PHASES) {
      if (byTeam[t].bat[p] > 0) {
        sum.bat[p] += byTeam[t].bat[p];
        count.bat[p] += 1;
      }
      if (byTeam[t].bowl[p] > 0) {
        sum.bowl[p] += byTeam[t].bowl[p];
        count.bowl[p] += 1;
      }
    }
  }
  const leagueAvg = emptyStats();
  for (const p of PHASES) {
    leagueAvg.bat[p] = count.bat[p] > 0 ? sum.bat[p] / count.bat[p] : 0;
    leagueAvg.bowl[p] = count.bowl[p] > 0 ? sum.bowl[p] / count.bowl[p] : 0;
  }

  // Max RR (for radius scaling) — based on bat rates, with floor
  let maxBat = 0;
  for (const t of teams) {
    for (const p of PHASES) {
      if (byTeam[t].bat[p] > maxBat) maxBat = byTeam[t].bat[p];
    }
  }
  const maxRR = Math.max(Math.ceil(maxBat), 12);

  teams.sort((a, b) => a.localeCompare(b));
  return { teams, byTeam, leagueAvg, maxRR };
}

function buildAxisData(data: RadarData, selected: string): AxisRow[] {
  const team = data.byTeam[selected];
  return AXES.map((a) => {
    const row: AxisRow = { axis: a.key };
    const teamVal = team[a.side][a.phase];
    const leagueVal = data.leagueAvg[a.side][a.phase];
    if (a.side === "bowl") {
      row.team = Math.max(0, data.maxRR - teamVal);
      row.league = Math.max(0, data.maxRR - leagueVal);
    } else {
      row.team = teamVal;
      row.league = leagueVal;
    }
    return row;
  });
}

function emptyStats(): TeamStats {
  return {
    bat: { powerplay: 0, middle: 0, death: 0 },
    bowl: { powerplay: 0, middle: 0, death: 0 },
  };
}

type IdentityTone = "positive" | "negative" | "neutral";
type IdentityTag = { label: string; tone: IdentityTone };
type TeamIdentity = {
  headline: string;
  tags: IdentityTag[];
  description: string;
};

function describeTeam(team: TeamStats, league: TeamStats): TeamIdentity {
  // Bat: positive delta = above league.   Bowl: NEGATIVE delta vs league = better (lower economy).
  const batDelta: Record<PhaseKey, number> = {
    powerplay: team.bat.powerplay - league.bat.powerplay,
    middle: team.bat.middle - league.bat.middle,
    death: team.bat.death - league.bat.death,
  };
  const bowlAdvantage: Record<PhaseKey, number> = {
    // higher = stingier than league
    powerplay: league.bowl.powerplay - team.bowl.powerplay,
    middle: league.bowl.middle - team.bowl.middle,
    death: league.bowl.death - team.bowl.death,
  };

  const batBest = pickBestPhase(batDelta);
  const bowlBest = pickBestPhase(bowlAdvantage);

  const batSum = batDelta.powerplay + batDelta.middle + batDelta.death;
  const bowlSum =
    bowlAdvantage.powerplay + bowlAdvantage.middle + bowlAdvantage.death;

  const POS = 0.25; // run-rate above league counts as a real edge
  const NEG = -0.25;

  const tags: IdentityTag[] = [];

  // Per-side strength tags
  if (batBest.delta > POS && batBest.gap > 0.3) {
    tags.push({
      label: `${PHASE_LABEL[batBest.phase]} batting threat`,
      tone: "positive",
    });
  } else if (batSum / 3 > POS) {
    tags.push({ label: "All-phase batting", tone: "positive" });
  } else if (batSum / 3 < NEG) {
    tags.push({ label: "Weak batting", tone: "negative" });
  }

  if (bowlBest.delta > POS && bowlBest.gap > 0.3) {
    tags.push({
      label: `${PHASE_LABEL[bowlBest.phase]} bowling threat`,
      tone: "positive",
    });
  } else if (bowlSum / 3 > POS) {
    tags.push({ label: "All-phase bowling", tone: "positive" });
  } else if (bowlSum / 3 < NEG) {
    tags.push({ label: "Leaky attack", tone: "negative" });
  }

  // Side balance
  if (batSum / 3 > POS && bowlSum / 3 > POS) {
    tags.push({ label: "Two-sided force", tone: "positive" });
  } else if (batSum / 3 > POS && bowlSum / 3 < NEG) {
    tags.push({ label: "Bat-reliant", tone: "neutral" });
  } else if (bowlSum / 3 > POS && batSum / 3 < NEG) {
    tags.push({ label: "Bowling-led", tone: "neutral" });
  }

  // Headline
  let headline = "Balanced across phases";
  if (
    batBest.phase === bowlBest.phase &&
    batBest.delta > POS &&
    bowlBest.delta > POS
  ) {
    headline = `${PHASE_LABEL[batBest.phase]} specialists`;
  } else if (batBest.delta > POS && batBest.gap > 0.3 && bowlSum / 3 < NEG) {
    headline = `${PHASE_LABEL[batBest.phase]}-heavy, weak with the ball`;
  } else if (bowlBest.delta > POS && bowlBest.gap > 0.3 && batSum / 3 < NEG) {
    headline = `${PHASE_LABEL[bowlBest.phase]}-bowling specialists, thin batting`;
  } else if (batBest.delta > POS && batBest.gap > 0.3) {
    headline = `${PHASE_LABEL[batBest.phase]}-heavy attack`;
  } else if (bowlBest.delta > POS && bowlBest.gap > 0.3) {
    headline = `${PHASE_LABEL[bowlBest.phase]}-bowling specialists`;
  } else if (batSum / 3 > POS && bowlSum / 3 > POS) {
    headline = "Complete team";
  } else if (batSum / 3 < NEG && bowlSum / 3 < NEG) {
    headline = "Struggling on both fronts";
  }

  // Description: cite the most distinctive number.
  const sentences: string[] = [];

  if (batBest.delta > POS) {
    sentences.push(
      `Score at ${fmt(team.bat[batBest.phase])} rpo in the ${PHASE_LABEL[
        batBest.phase
      ].toLowerCase()}, ${formatDelta(batBest.delta)} the league.`
    );
  } else if (batSum / 3 < NEG) {
    const worst = pickWorstPhase(batDelta);
    sentences.push(
      `Bat ${formatDelta(worst.delta)} the league in the ${PHASE_LABEL[
        worst.phase
      ].toLowerCase()} (${fmt(team.bat[worst.phase])} rpo).`
    );
  }

  if (bowlBest.delta > POS) {
    sentences.push(
      `Concede just ${fmt(
        team.bowl[bowlBest.phase]
      )} rpo in the ${PHASE_LABEL[
        bowlBest.phase
      ].toLowerCase()}, ${formatBowlDelta(bowlBest.delta)} the league.`
    );
  } else if (bowlSum / 3 < NEG) {
    const worst = pickWorstPhase(bowlAdvantage);
    sentences.push(
      `Bleed ${fmt(team.bowl[worst.phase])} rpo in the ${PHASE_LABEL[
        worst.phase
      ].toLowerCase()}, ${formatBowlDelta(worst.delta)} the league.`
    );
  }

  if (sentences.length === 0) {
    sentences.push(
      "Sits within roughly half a run of the league average across every phase."
    );
  }

  return { headline, tags, description: sentences.join(" ") };
}

function pickBestPhase(deltas: Record<PhaseKey, number>): {
  phase: PhaseKey;
  delta: number;
  gap: number;
} {
  const sorted = PHASES.map((p) => ({ phase: p, delta: deltas[p] })).sort(
    (a, b) => b.delta - a.delta
  );
  const gap = sorted[0].delta - (sorted[1]?.delta ?? 0);
  return { phase: sorted[0].phase, delta: sorted[0].delta, gap };
}

function pickWorstPhase(deltas: Record<PhaseKey, number>): {
  phase: PhaseKey;
  delta: number;
} {
  const sorted = PHASES.map((p) => ({ phase: p, delta: deltas[p] })).sort(
    (a, b) => a.delta - b.delta
  );
  return sorted[0];
}

function fmt(v: number): string {
  return v.toFixed(2);
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta.toFixed(2)} above`;
  if (delta < 0) return `${delta.toFixed(2)} below`;
  return "level with";
}

function formatBowlDelta(advantage: number): string {
  // advantage > 0 means stingier than league
  if (advantage > 0) return `${advantage.toFixed(2)} rpo below`;
  if (advantage < 0) return `${Math.abs(advantage).toFixed(2)} rpo above`;
  return "level with";
}

type TooltipPayload = {
  name: string;
  value: number;
  color: string;
  payload: AxisRow;
};

function RadarTooltip({
  active,
  payload,
  label,
  teamName,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  teamName?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const axis = label ?? "";
  const isBowl = axis.includes("Bowl");
  return (
    <div
      className="border border-ipl-line rounded shadow-sm px-3 py-2 text-xs"
      style={{ backgroundColor: "#ffffff" }}
    >
      <div className="font-semibold text-ipl-ink mb-1">{axis}</div>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={p.name} className="flex items-center gap-2 tabular-nums">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ background: p.color }}
            />
            <span className="text-ipl-ink">
              {p.name === teamShort(teamName ?? "") ? teamName : p.name}
            </span>
            <span className="ml-auto text-ipl-ink font-medium">
              {p.value.toFixed(2)}
              <span className="text-ipl-soft ml-1">
                {isBowl ? "stingy idx" : "rpo"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
