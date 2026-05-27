"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamColor, teamLogo, teamShort } from "@/lib/teams";
import { Card, Loading, Empty, ErrorBox } from "./chart-shell";

type MatchRow = {
  match_number: number;
  team_1: string;
  team_2: string;
  team_1_score: string | null;
  team_2_score: string | null;
  winner: string | null;
  result: string | null;
};

type BallsRow = { match_number: number; team: string; balls: number };

type TeamStats = { points: number; rs: number; bf: number; rc: number; bb: number };

type RankRow = {
  team: string;
  position: number;
  points: number;
  nrr: number;
  played: number;
};

type MatchSnapshot = {
  matchIdx: number;
  matchNumber: number;
  ranking: RankRow[];
};

type TeamPoint = {
  matchIdx: number;
  position: number;
  points: number;
  nrr: number;
  played: number;
};

const WIDTH = 1600;
const HEIGHT = 640;
const MARGIN = { top: 24, right: 140, bottom: 54, left: 44 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const REST_OPACITY = 1;
const HOVER_DIM_OPACITY = 0.18;

export function StandingsProgression({ year }: { year: number }) {
  const matchesState = useDuckQuery<MatchRow>(
    `SELECT
       CAST(match_number AS BIGINT) AS match_number,
       team_1, team_2, team_1_score, team_2_score, winner, result
     FROM matches WHERE season = ${year}
     ORDER BY match_number`
  );

  const ballsState = useDuckQuery<BallsRow>(
    `SELECT
       CAST(match_number AS BIGINT) AS match_number,
       team,
       CAST(COUNT(*) AS BIGINT) AS balls
     FROM ball_by_ball
     WHERE season = ${year}
       AND COALESCE(extra_type, '') NOT IN ('wides', 'noballs')
     GROUP BY match_number, team`
  );

  const matchesReady = matchesState.status === "success";
  const ballsReady = ballsState.status === "success";

  const built = useMemo(() => {
    if (!matchesReady || !ballsReady) {
      return {
        snapshots: [] as MatchSnapshot[],
        teamSeries: new Map<string, TeamPoint[]>(),
        teamsOrdered: [] as string[],
        numTeams: 0,
        totalMatches: 0,
      };
    }
    return buildPerMatch(matchesState.data, ballsState.data);
  }, [matchesReady, ballsReady, matchesState, ballsState]);

  const loading = matchesState.status === "loading" || ballsState.status === "loading";
  const errMsg =
    matchesState.status === "error"
      ? matchesState.error.message
      : ballsState.status === "error"
        ? ballsState.error.message
        : null;

  const totalMatches = built.totalMatches;
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const lastAutoplayYear = useRef<number | null>(null);

  // Autoplay once per season as soon as data lands.
  useEffect(() => {
    if (totalMatches > 0 && lastAutoplayYear.current !== year) {
      lastAutoplayYear.current = year;
      setPlayhead(0);
      setIsPlaying(true);
    }
  }, [year, totalMatches]);

  // Animation loop: advance a float playhead every frame, so the lines grow
  // smoothly instead of jumping one match at a time. Pace ~8 matches/sec.
  useEffect(() => {
    if (!isPlaying || totalMatches === 0) return;
    const MATCHES_PER_SEC = 5;
    const tick = (ts: number) => {
      if (lastTickRef.current == null) lastTickRef.current = ts;
      const dt = ts - lastTickRef.current;
      lastTickRef.current = ts;
      setPlayhead((p) => {
        const next = p + (dt / 1000) * MATCHES_PER_SEC;
        if (next >= totalMatches) {
          setIsPlaying(false);
          return totalMatches;
        }
        return next;
      });
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
      lastTickRef.current = null;
    };
  }, [isPlaying, totalMatches]);

  function handlePlayClick() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (playhead >= totalMatches) setPlayhead(0);
    setIsPlaying(true);
  }

  const playLabel = isPlaying ? "Pause" : playhead >= totalMatches ? "Replay" : "Play";
  const controls =
    totalMatches > 0 ? (
      <button
        type="button"
        onClick={handlePlayClick}
        className="inline-flex items-center gap-1.5 rounded-md border border-ipl-line bg-ipl-surface px-2.5 py-1 text-xs text-ipl-ink hover:bg-ipl-line2/30 transition-colors"
        aria-label={playLabel}
      >
        <PlayPauseIcon mode={isPlaying ? "pause" : playhead >= totalMatches ? "replay" : "play"} />
        <span>{playLabel}</span>
      </button>
    ) : undefined;

  return (
    <Card title="Standings Progression" right={controls}>
          {loading && <Loading />}
          {errMsg && <ErrorBox message={errMsg} />}
          {!loading && !errMsg && built.snapshots.length === 0 && <Empty />}
          {!loading && !errMsg && built.snapshots.length > 0 && (
            <>
              <BumpSvg
                snapshots={built.snapshots}
                teamSeries={built.teamSeries}
                teamsOrdered={built.teamsOrdered}
                numTeams={built.numTeams}
                totalMatches={built.totalMatches}
                playhead={playhead}
              />
              <p
                className="mt-2"
                style={{
                  fontSize: "11px",
                  color: "#6b7280",
                  paddingTop: "6px",
                  borderTop: "1px solid #e5e7eb",
                }}
              >
                Standings update after every match. Position is determined by points, with NRR as the tiebreaker.
              </p>
            </>
          )}
    </Card>
  );
}

function BumpSvg({
  snapshots,
  teamSeries,
  teamsOrdered,
  numTeams,
  totalMatches,
  playhead,
}: {
  snapshots: MatchSnapshot[];
  teamSeries: Map<string, TeamPoint[]>;
  teamsOrdered: string[];
  numTeams: number;
  totalMatches: number;
  playhead: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverTeam, setHoverTeam] = useState<string | null>(null);

  const xMin = 0.5;
  const xMax = totalMatches + 3.5;
  const yMin = 0.5;
  const yMax = numTeams + 0.5;

  const xScale = (x: number) =>
    MARGIN.left + ((x - xMin) / (xMax - xMin)) * PLOT_W;
  const yScale = (y: number) =>
    MARGIN.top + ((y - yMin) / (yMax - yMin)) * PLOT_H;

  const atEnd = playhead >= totalMatches;
  const labelX = totalMatches + 1.4;
  // While playing, end-of-line markers sit on the playhead so the team logo
  // travels with the line tip; once the animation finishes, they snap out to
  // the right-edge label column.
  const endLabelX = atEnd ? labelX : Math.max(0.1, playhead);

  const clipId = useId();

  // Precompute each team's full-season path once. Stays stable across frames
  // — only the clip-rect width changes during playback, so per-frame React
  // re-renders are essentially free.
  const fullPaths = useMemo(() => {
    const out = new Map<string, string>();
    for (const team of teamsOrdered) {
      const arr = teamSeries.get(team);
      if (!arr || arr.length === 0) continue;
      const last = arr[arr.length - 1];
      const extended: TeamPoint[] = [
        ...arr,
        { ...last, matchIdx: labelX - 0.25 },
      ];
      out.set(team, bumpPath(extended, xScale, yScale));
    }
    return out;
  }, [teamSeries, teamsOrdered, labelX, xScale, yScale]);

  // Each team's current y at the playhead. Mirrors bumpPath exactly: the
  // line stays flat at prev.position for the first half of the segment, then
  // S-curves to the next position over the second half. Anything else and
  // the logo drifts off its line during pause.
  const playheadY = useMemo(() => {
    const out = new Map<string, number>();
    for (const team of teamsOrdered) {
      const arr = teamSeries.get(team);
      if (!arr || arr.length === 0) continue;
      if (atEnd) {
        out.set(team, arr[arr.length - 1].position);
        continue;
      }
      const floor = Math.floor(playhead);
      const t = playhead - floor;
      const prev = arr.find((p) => p.matchIdx === floor);
      const next = arr.find((p) => p.matchIdx === floor + 1);
      if (prev && next) {
        out.set(team, bumpCurveY(prev.position, next.position, t));
      } else if (prev) {
        out.set(team, prev.position);
      } else {
        out.set(team, arr[0].position);
      }
    }
    return out;
  }, [teamSeries, teamsOrdered, playhead, atEnd]);

  type EndPoint = { team: string; y: number };
  // No anti-overlap cascade — every logo sits on its exact line tip, even
  // when two teams share a position (their logos will overlap; that is the
  // accurate read of "they are tied").
  const endPoints: EndPoint[] = [];
  for (const t of teamsOrdered) {
    const y = playheadY.get(t);
    if (y == null) continue;
    endPoints.push({ team: t, y });
  }
  endPoints.sort((a, b) => a.y - b.y);

  const positionLines: number[] = [];
  for (let p = 1; p <= numTeams; p += 1) positionLines.push(p);

  const desiredTicks = 8;
  const rawStep = totalMatches / desiredTicks;
  const niceSteps = [5, 10, 20, 25];
  const xTickStep =
    niceSteps.find((s) => s >= rawStep) ?? Math.max(1, Math.ceil(rawStep));
  const xTicks: number[] = [];
  for (let r = xTickStep; r <= totalMatches; r += xTickStep) xTicks.push(r);

  const hoverSnap = hover !== null ? snapshots[hover - 1] : null;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const dataX = xMin + ((svgX - MARGIN.left) / PLOT_W) * (xMax - xMin);
    const idx = Math.round(dataX);
    if (idx >= 1 && idx <= totalMatches) {
      setHover(idx);
    } else {
      setHover(null);
    }
  }

  function handleLeave() {
    setHover(null);
    setHoverTeam(null);
  }

  return (
    <div className="w-full relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        style={{ background: "#fff" }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {positionLines.map((p) => (
          <line
            key={`pos-${p}`}
            x1={xScale(xMin)}
            x2={xScale(xMax)}
            y1={yScale(p)}
            y2={yScale(p)}
            stroke="rgba(0,0,0,0.045)"
            strokeWidth={1}
          />
        ))}

        {numTeams > 4 && (
          <>
            <line
              x1={xScale(xMin)}
              x2={xScale(xMax)}
              y1={yScale(4.5)}
              y2={yScale(4.5)}
              stroke="#dc2626"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.7}
            />
            <text
              x={xScale(xMax) - 4}
              y={yScale(4.5) - 4}
              fontSize={10}
              fill="#dc2626"
              textAnchor="end"
            >
              Playoff cutoff
            </text>
          </>
        )}

        {xTicks.map((r) => (
          <g key={`x-${r}`}>
            <line
              x1={xScale(r)}
              x2={xScale(r)}
              y1={yScale(yMax) - 4}
              y2={yScale(yMax)}
              stroke="#9ca3af"
              strokeWidth={1}
            />
            <text
              x={xScale(r)}
              y={yScale(yMax) + 14}
              fontSize={11}
              fill="#6b7280"
              textAnchor="middle"
            >
              {r}
            </text>
          </g>
        ))}
        <text
          x={MARGIN.left + PLOT_W / 2}
          y={HEIGHT - 8}
          fontSize={12}
          fill="#374151"
          textAnchor="middle"
          fontWeight={500}
        >
          Match
        </text>

        {positionLines.map((p) => (
          <text
            key={`y-${p}`}
            x={MARGIN.left - 8}
            y={yScale(p)}
            fontSize={12}
            fill="#9ca3af"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {p}
          </text>
        ))}

        <defs>
          <clipPath id={clipId}>
            <rect
              x={xScale(xMin)}
              y={0}
              width={Math.max(0, xScale(endLabelX) - xScale(xMin))}
              height={HEIGHT}
            />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {teamsOrdered.map((team) => {
            const d = fullPaths.get(team);
            if (!d) return null;
            const isActive = hoverTeam === team;
            const isDimmed = hoverTeam !== null && !isActive;
            const opacity = isActive ? 1 : isDimmed ? HOVER_DIM_OPACITY : REST_OPACITY;
            const width = isActive ? 4.5 : 3.25;
            return (
              <g key={`line-${team}`}>
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoverTeam(team)}
                  onMouseLeave={() => setHoverTeam(null)}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={teamColor(team)}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={opacity}
                  style={{
                    transition: "opacity 140ms, stroke-width 140ms",
                    pointerEvents: "none",
                  }}
                >
                  <title>{team}</title>
                </path>
              </g>
            );
          })}
        </g>

        {hoverSnap && (
          <line
            x1={xScale(hoverSnap.matchIdx)}
            x2={xScale(hoverSnap.matchIdx)}
            y1={yScale(yMin)}
            y2={yScale(yMax)}
            stroke="#9ca3af"
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {hoverSnap &&
          hoverSnap.ranking.map((r) => (
            <circle
              key={`hp-${r.team}`}
              cx={xScale(hoverSnap.matchIdx)}
              cy={yScale(r.position)}
              r={hoverTeam === r.team ? 5 : 3.5}
              fill={teamColor(r.team)}
              stroke="#fff"
              strokeWidth={1.5}
              pointerEvents="none"
            />
          ))}

        {endPoints.map((ep) => {
          const logo = teamLogo(ep.team);
          const cx = xScale(endLabelX);
          const cy = yScale(ep.y);
          const size = 26;
          const isDimmed = hoverTeam !== null && hoverTeam !== ep.team;
          if (logo) {
            return (
              <image
                key={`lg-${ep.team}`}
                href={`/${logo}`}
                x={cx}
                y={cy - size / 2}
                width={size}
                height={size}
                preserveAspectRatio="xMidYMid meet"
                opacity={isDimmed ? 0.3 : 1}
                style={{ cursor: "pointer", transition: "opacity 120ms" }}
                onMouseEnter={() => setHoverTeam(ep.team)}
                onMouseLeave={() => setHoverTeam(null)}
              >
                <title>{ep.team}</title>
              </image>
            );
          }
          return (
            <g
              key={`lg-${ep.team}`}
              opacity={isDimmed ? 0.3 : 1}
              style={{ cursor: "pointer", transition: "opacity 120ms" }}
              onMouseEnter={() => setHoverTeam(ep.team)}
              onMouseLeave={() => setHoverTeam(null)}
            >
              <rect
                x={cx}
                y={cy - size / 2}
                width={size + 4}
                height={size}
                rx={4}
                ry={4}
                fill={teamColor(ep.team)}
              />
              <text
                x={cx + (size + 4) / 2}
                y={cy}
                fontSize={10}
                fontWeight={700}
                fill="#fff"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {teamShort(ep.team)}
              </text>
            </g>
          );
        })}
      </svg>

      {hoverSnap && (
        <HoverTooltip
          snap={hoverSnap}
          plotXFrac={(xScale(hoverSnap.matchIdx) - MARGIN.left) / PLOT_W}
          highlightTeam={hoverTeam}
        />
      )}
    </div>
  );
}

function HoverTooltip({
  snap,
  plotXFrac,
  highlightTeam,
}: {
  snap: MatchSnapshot;
  plotXFrac: number;
  highlightTeam: string | null;
}) {
  const placeRight = plotXFrac < 0.55;
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: "8%",
        left: placeRight ? `${(MARGIN.left / WIDTH + plotXFrac * (PLOT_W / WIDTH)) * 100 + 1.5}%` : undefined,
        right: !placeRight ? `${(1 - (MARGIN.left / WIDTH + plotXFrac * (PLOT_W / WIDTH))) * 100 + 1.5}%` : undefined,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        padding: "6px 8px",
        fontSize: 11,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        minWidth: 200,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, color: "#111827" }}>
        After Match {snap.matchNumber}
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          {snap.ranking.map((r) => {
            const isHi = highlightTeam === r.team;
            return (
              <tr key={r.team} style={{ background: isHi ? "#f3f4f6" : undefined }}>
                <td style={{ padding: "1px 6px 1px 0", color: "#9ca3af", textAlign: "right" }}>
                  {r.position}
                </td>
                <td style={{ padding: "1px 6px 1px 0" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: teamColor(r.team),
                      marginRight: 5,
                      verticalAlign: "middle",
                    }}
                  />
                  <span style={{ fontWeight: isHi ? 600 : 500, color: "#374151" }}>
                    {teamShort(r.team)}
                  </span>
                </td>
                <td style={{ padding: "1px 6px 1px 0", textAlign: "right", color: "#111827", fontVariantNumeric: "tabular-nums" }}>
                  {r.points} pts
                </td>
                <td style={{ padding: "1px 0", textAlign: "right", color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
                  {r.nrr >= 0 ? "+" : ""}
                  {r.nrr.toFixed(3)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * y on the bump line at fractional progress `t` (0..1) through the segment
 * from match N to match N+1. Smooth-step cubic spanning the full segment so
 * the transition reads as a gentle sine-like wave instead of snapping near
 * the new column. Same curve `bumpPath` draws.
 */
function bumpCurveY(prevPos: number, nextPos: number, t: number): number {
  if (prevPos === nextPos) return prevPos;
  // Cubic Bezier with horizontal-tangent handles at both endpoints,
  // y(t) = (1-t)^2 (1 + 2t) * prev + t^2 (3 - 2t) * next, t ∈ [0,1].
  return (1 - t) ** 2 * (1 + 2 * t) * prevPos + t ** 2 * (3 - 2 * t) * nextPos;
}

function PlayPauseIcon({ mode }: { mode: "play" | "pause" | "replay" }) {
  if (mode === "pause") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="1.5" y="1" width="2.5" height="8" fill="currentColor" />
        <rect x="6" y="1" width="2.5" height="8" fill="currentColor" />
      </svg>
    );
  }
  if (mode === "replay") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 5a3 3 0 1 0 0.8 -2.1" />
        <polyline points="1.5 1 1.5 3 3.5 3" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <polygon points="2,1 9,5 2,9" fill="currentColor" />
    </svg>
  );
}

function bumpPath(
  arr: TeamPoint[],
  xScale: (x: number) => number,
  yScale: (y: number) => number
): string {
  if (arr.length === 0) return "";
  const start = arr[0];
  let d = `M${xScale(start.matchIdx)},${yScale(start.position)}`;
  if (arr.length === 1) return d;
  for (let i = 1; i < arr.length; i += 1) {
    const prev = arr[i - 1];
    const cur = arr[i];
    if (cur.position === prev.position) {
      d += ` L${xScale(cur.matchIdx)},${yScale(cur.position)}`;
      continue;
    }
    // Cubic Bezier spanning the entire segment with horizontal-tangent
    // handles at both endpoints — reads as a smooth sine-like wave between
    // the two positions. The line stays flat on the column it belongs to,
    // wave-shaped in the gap between columns. When two teams swap places
    // the curves cross at the midpoint with a gentle slope, leaving visible
    // separation around the crossing instead of a hard X.
    const x0 = xScale(prev.matchIdx);
    const y0 = yScale(prev.position);
    const x1 = xScale(cur.matchIdx);
    const y1 = yScale(cur.position);
    const cx1 = x0 + (x1 - x0) * 0.5;
    const cx2 = x1 - (x1 - x0) * 0.5;
    d += ` C${cx1},${y0} ${cx2},${y1} ${x1},${y1}`;
  }
  return d;
}

function parseScore(s: string | null): { runs: number; wickets: number } | null {
  if (!s) return null;
  const str = String(s);
  if (!str.includes("/")) return null;
  const [r, w] = str.split("/");
  const runs = parseInt(r, 10);
  const wickets = parseInt(w, 10);
  if (Number.isNaN(runs) || Number.isNaN(wickets)) return null;
  return { runs, wickets };
}

function buildPerMatch(
  matches: MatchRow[],
  balls: BallsRow[]
): {
  snapshots: MatchSnapshot[];
  teamSeries: Map<string, TeamPoint[]>;
  teamsOrdered: string[];
  numTeams: number;
  totalMatches: number;
} {
  if (matches.length === 0) {
    return {
      snapshots: [],
      teamSeries: new Map(),
      teamsOrdered: [],
      numTeams: 0,
      totalMatches: 0,
    };
  }

  const seasonTeams = new Set<string>();
  for (const m of matches) {
    if (m.team_1) seasonTeams.add(m.team_1);
    if (m.team_2) seasonTeams.add(m.team_2);
  }
  const numTeams = seasonTeams.size;

  const ballsLookup = new Map<string, number>();
  for (const b of balls) {
    ballsLookup.set(`${b.match_number}|${b.team}`, b.balls);
  }

  const stats = new Map<string, TeamStats>();
  const played = new Map<string, number>();

  const ensureTeam = (t: string) => {
    if (!stats.has(t)) {
      stats.set(t, { points: 0, rs: 0, bf: 0, rc: 0, bb: 0 });
      played.set(t, 0);
    }
  };

  const sorted = [...matches].sort((a, b) => a.match_number - b.match_number);
  const snapshots: MatchSnapshot[] = [];
  const teamSeries = new Map<string, TeamPoint[]>();

  sorted.forEach((m, idx) => {
    const result = (m.result ?? "").toLowerCase();
    const noResult = result === "no result";

    for (const [self, opp, selfScore, oppScore] of [
      [m.team_1, m.team_2, m.team_1_score, m.team_2_score] as const,
      [m.team_2, m.team_1, m.team_2_score, m.team_1_score] as const,
    ]) {
      ensureTeam(self);
      played.set(self, (played.get(self) ?? 0) + 1);

      const s = stats.get(self)!;
      if (noResult) {
        s.points += 1;
      } else if (m.winner && m.winner === self) {
        s.points += 2;
      }

      if (!noResult) {
        const my = parseScore(selfScore);
        const op = parseScore(oppScore);
        if (my && op) {
          const myBalls =
            my.wickets >= 10
              ? 120
              : (ballsLookup.get(`${m.match_number}|${self}`) ?? 0);
          const opBalls =
            op.wickets >= 10
              ? 120
              : (ballsLookup.get(`${m.match_number}|${opp}`) ?? 0);
          s.rs += my.runs;
          s.bf += myBalls;
          s.rc += op.runs;
          s.bb += opBalls;
        }
      }
    }

    const ranking = computeRanking(stats, played);
    snapshots.push({
      matchIdx: idx + 1,
      matchNumber: m.match_number,
      ranking,
    });

    for (const r of ranking) {
      if (!teamSeries.has(r.team)) teamSeries.set(r.team, []);
      teamSeries.get(r.team)!.push({
        matchIdx: idx + 1,
        position: r.position,
        points: r.points,
        nrr: r.nrr,
        played: r.played,
      });
    }
  });

  // Keep the full per-match series so callers can look up a team's position
  // at any integer matchIdx. Compressing to position-change events broke the
  // playhead's `arr.find(p => p.matchIdx === floor)` lookup, which then
  // stacked multiple logos on the same default y. bumpPath handles long
  // flat runs fine either way; the few extra path segments are cheap.
  const lastByTeam = new Map<string, TeamPoint>();
  for (const [t, arr] of teamSeries) {
    if (arr.length > 0) lastByTeam.set(t, arr[arr.length - 1]);
  }
  const teamsOrdered = [...lastByTeam.keys()].sort((a, b) => {
    return lastByTeam.get(a)!.position - lastByTeam.get(b)!.position;
  });

  return {
    snapshots,
    teamSeries,
    teamsOrdered,
    numTeams,
    totalMatches: sorted.length,
  };
}

function computeRanking(
  stats: Map<string, TeamStats>,
  played: Map<string, number>
): RankRow[] {
  const rows: RankRow[] = [];
  for (const [team, s] of stats) {
    const games = played.get(team) ?? 0;
    if (games === 0) continue;
    const nrr =
      s.bf > 0 && s.bb > 0 ? s.rs / (s.bf / 6) - s.rc / (s.bb / 6) : 0;
    rows.push({
      team,
      position: 0,
      points: s.points,
      nrr: Math.round(nrr * 1000) / 1000,
      played: games,
    });
  }
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.nrr - a.nrr;
  });
  rows.forEach((r, i) => {
    r.position = i + 1;
  });
  return rows;
}
