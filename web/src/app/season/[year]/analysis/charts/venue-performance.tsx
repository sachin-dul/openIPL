"use client";

import { useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { canonicalVenue, venueCity, venueStadium } from "@/lib/venues";
import {
  Card,
  Loading,
  Empty,
  ErrorBox,
  PHASE_ORDER,
  type Phase,
} from "./chart-shell";

type MatchRow = {
  venue: string;
  matches: number;
  full_matches: number;
  sum_1st: number;
  sum_2nd: number;
  chase_wins: number;
  defend_wins: number;
  had_rain: boolean;
};

type PhaseRow = {
  venue: string;
  phase: Phase;
  runs: number;
  balls: number;
  boundaries: number;
  dots: number;
  wickets: number;
};

type StyleRow = {
  venue: string;
  bowling_kind: "spin" | "pace";
  runs: number;
  balls: number;
  wickets: number;
};

type PhaseAgg = Record<
  Phase,
  { runs: number; balls: number; boundaries: number; dots: number; wickets: number }
>;
type StyleAgg = Record<"spin" | "pace", { runs: number; balls: number; wickets: number }>;

type Venue = {
  stadium: string;
  city: string;
  matches: number;
  full_matches: number;
  sum_1st: number;
  sum_2nd: number;
  chase_wins: number;
  defend_wins: number;
  had_rain: boolean;
  phase: PhaseAgg;
  style: StyleAgg;
};

const WICKET_EXCLUDE = `LOWER(COALESCE(wicket_kind,'')) NOT IN ('run out','retired hurt','retired out','obstructing the field','timed out')`;

export function VenuePerformance({ year }: { year: number }) {
  const matchesQ = useDuckQuery<MatchRow>(
    `SELECT venue,
            CAST(COUNT(*) AS BIGINT)                                  AS matches,
            CAST(SUM(CASE WHEN COALESCE(target_overs,20) >= 20 THEN 1 ELSE 0 END) AS BIGINT) AS full_matches,
            SUM(CASE WHEN COALESCE(target_overs,20) >= 20
                     THEN TRY_CAST(SPLIT_PART(team_1_score,'/',1) AS INTEGER) END) AS sum_1st,
            SUM(CASE WHEN COALESCE(target_overs,20) >= 20
                     THEN TRY_CAST(SPLIT_PART(team_2_score,'/',1) AS INTEGER) END) AS sum_2nd,
            CAST(SUM(CASE WHEN COALESCE(win_by_wickets,0) > 0 THEN 1 ELSE 0 END) AS BIGINT) AS chase_wins,
            CAST(SUM(CASE WHEN COALESCE(win_by_runs,0)    > 0 THEN 1 ELSE 0 END) AS BIGINT) AS defend_wins,
            BOOL_OR(COALESCE(target_overs,20) < 20) AS had_rain
     FROM matches
     WHERE season = ${year} AND venue IS NOT NULL
     GROUP BY venue
     ORDER BY matches DESC, venue`
  );

  const phaseQ = useDuckQuery<PhaseRow>(
    `SELECT m.venue,
            LOWER(bbb.phase) AS phase,
            CAST(SUM(bbb.total_runs) AS BIGINT) AS runs,
            CAST(SUM(CASE WHEN COALESCE(bbb.wides,0)=0 AND COALESCE(bbb.noballs,0)=0
                          THEN 1 ELSE 0 END) AS BIGINT) AS balls,
            CAST(SUM(CASE WHEN bbb.batter_runs IN (4,6) THEN 1 ELSE 0 END) AS BIGINT) AS boundaries,
            CAST(SUM(CASE WHEN bbb.total_runs=0 AND COALESCE(bbb.wides,0)=0 AND COALESCE(bbb.noballs,0)=0
                          THEN 1 ELSE 0 END) AS BIGINT) AS dots,
            CAST(SUM(CASE WHEN bbb.is_wicket AND ${WICKET_EXCLUDE}
                          THEN 1 ELSE 0 END) AS BIGINT) AS wickets
     FROM ball_by_ball bbb
     JOIN matches m ON bbb.season = m.season AND bbb.match_number = m.match_number
     WHERE bbb.season = ${year} AND bbb.phase IS NOT NULL AND m.venue IS NOT NULL
     GROUP BY m.venue, LOWER(bbb.phase)`
  );

  const styleQ = useDuckQuery<StyleRow>(
    `SELECT m.venue,
            pm.bowling_kind,
            CAST(SUM(bbb.total_runs) AS BIGINT) AS runs,
            CAST(SUM(CASE WHEN COALESCE(bbb.wides,0)=0 AND COALESCE(bbb.noballs,0)=0
                          THEN 1 ELSE 0 END) AS BIGINT) AS balls,
            CAST(SUM(CASE WHEN bbb.is_wicket AND ${WICKET_EXCLUDE}
                          THEN 1 ELSE 0 END) AS BIGINT) AS wickets
     FROM ball_by_ball bbb
     JOIN matches m ON bbb.season = m.season AND bbb.match_number = m.match_number
     LEFT JOIN players_meta pm ON pm.unique_name = bbb.bowler
     WHERE bbb.season = ${year} AND m.venue IS NOT NULL
       AND pm.bowling_kind IN ('spin','pace')
     GROUP BY m.venue, pm.bowling_kind`
  );

  const venues = useMemo(() => {
    if (
      matchesQ.status !== "success" ||
      phaseQ.status !== "success" ||
      styleQ.status !== "success"
    ) {
      return [];
    }
    return combine(matchesQ.data, phaseQ.data, styleQ.data);
  }, [matchesQ, phaseQ, styleQ]);

  const loading =
    matchesQ.status === "loading" ||
    phaseQ.status === "loading" ||
    styleQ.status === "loading";

  const error =
    matchesQ.status === "error"
      ? matchesQ.error.message
      : phaseQ.status === "error"
        ? phaseQ.error.message
        : styleQ.status === "error"
          ? styleQ.error.message
          : null;

  return (
    <Card title="Venue Performance" padded={false}>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && venues.length === 0 && <Empty />}
      {!loading && !error && venues.length > 0 && (
        <>
          <VenueTable venues={venues} />
          <p className="text-xs text-ipl-sub px-3.5 py-2.5 border-t border-ipl-line2">
            Avg scores use full-length matches only. Phase + bowler-type stats include every legal delivery.
            Spin/pace breakdown covers {classifiedCoverage(venues)}% of deliveries (unclassified bowlers excluded).
          </p>
        </>
      )}
    </Card>
  );
}

type SortKey =
  | "stadium"
  | "matches"
  | "avg1"
  | "avg2"
  | "chasePct"
  | "ppRpo"
  | "midRpo"
  | "deathRpo"
  | "spinEcon"
  | "paceEcon";

type Computed = Venue & {
  avg1: number | null;
  avg2: number | null;
  chasePct: number | null;
  ppRpo: number | null;
  midRpo: number | null;
  deathRpo: number | null;
  spinEcon: number | null;
  paceEcon: number | null;
};

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "stadium", label: "Stadium", align: "left" },
  { key: "matches", label: "M", align: "right" },
  { key: "avg1", label: "1st", align: "right" },
  { key: "avg2", label: "2nd", align: "right" },
  { key: "chasePct", label: "Chase%", align: "right" },
  { key: "ppRpo", label: "PP rpo", align: "right" },
  { key: "midRpo", label: "Mid rpo", align: "right" },
  { key: "deathRpo", label: "Death rpo", align: "right" },
  { key: "spinEcon", label: "Spin econ", align: "right" },
  { key: "paceEcon", label: "Pace econ", align: "right" },
];

function rpo(runs: number, balls: number): number | null {
  return balls > 0 ? (runs / balls) * 6 : null;
}

function compute(v: Venue): Computed {
  const decided = v.chase_wins + v.defend_wins;
  return {
    ...v,
    avg1: v.full_matches > 0 ? v.sum_1st / v.full_matches : null,
    avg2: v.full_matches > 0 ? v.sum_2nd / v.full_matches : null,
    chasePct: decided > 0 ? (v.chase_wins / decided) * 100 : null,
    ppRpo: rpo(v.phase.powerplay.runs, v.phase.powerplay.balls),
    midRpo: rpo(v.phase.middle.runs, v.phase.middle.balls),
    deathRpo: rpo(v.phase.death.runs, v.phase.death.balls),
    spinEcon: rpo(v.style.spin.runs, v.style.spin.balls),
    paceEcon: rpo(v.style.pace.runs, v.style.pace.balls),
  };
}

function VenueTable({ venues }: { venues: Venue[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("matches");
  // Lower-is-better metrics flip the default direction so first click puts
  // the most batting-friendly / spin-friendly venues on top intuitively.
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => venues.map(compute), [venues]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls always sink to the bottom regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return sortDir === "desc"
        ? (bv as number) - (av as number)
        : (av as number) - (bv as number);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const handleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      // Spin/pace economy and chase% — context-specific defaults. For
      // "stadium" alphabetical is more useful so default to asc.
      setSortDir(k === "stadium" ? "asc" : "desc");
    }
  };

  return (
    <table className="w-full text-[12px] border-collapse">
      <thead>
        <tr className="text-ipl-sub">
          <th className="px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line text-left">
            #
          </th>
          {COLUMNS.map((c) => {
            const active = sortKey === c.key;
            return (
              <th
                key={c.key}
                className={
                  "px-2.5 py-2.5 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line " +
                  (c.align === "left" ? "text-left" : "text-right")
                }
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
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => {
          const chaseColor =
            r.chasePct == null
              ? "text-ipl-ink"
              : r.chasePct >= 60
                ? "text-ipl-pos"
                : r.chasePct <= 40
                  ? "text-ipl-neg"
                  : "text-ipl-ink";
          return (
            <tr
              key={`${r.stadium}|${r.city}`}
              className="border-b border-ipl-line2 last:border-b-0 hover:bg-ipl-line2/40 animate-fade-in"
            >
              <td className="px-2.5 py-2.5 font-mono text-ipl-sub font-semibold">
                {i + 1}
              </td>
              <td className="px-2.5 py-2.5 min-w-0">
                <div className="font-semibold text-ipl-ink truncate" title={r.stadium}>
                  {r.stadium}
                  {r.had_rain && (
                    <span
                      className="text-ipl-orange ml-1"
                      title="Rain-shortened match here (excluded from score averages)"
                    >
                      *
                    </span>
                  )}
                </div>
                {r.city && (
                  <div className="text-[10px] text-ipl-sub truncate leading-tight">
                    {r.city}
                  </div>
                )}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.matches}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono">
                {r.avg1 != null ? r.avg1.toFixed(0) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono">
                {r.avg2 != null ? r.avg2.toFixed(0) : "—"}
              </td>
              <td
                className={
                  "px-2.5 py-2.5 text-right font-mono font-semibold " + chaseColor
                }
              >
                {r.chasePct != null ? `${Math.round(r.chasePct)}%` : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.ppRpo != null ? r.ppRpo.toFixed(1) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.midRpo != null ? r.midRpo.toFixed(1) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-ipl-sub">
                {r.deathRpo != null ? r.deathRpo.toFixed(1) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono">
                {r.spinEcon != null ? r.spinEcon.toFixed(2) : "—"}
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono">
                {r.paceEcon != null ? r.paceEcon.toFixed(2) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function combine(
  matches: MatchRow[],
  phases: PhaseRow[],
  styles: StyleRow[]
): Venue[] {
  const map = new Map<string, Venue>();
  const ensure = (canonical: string): Venue => {
    let v = map.get(canonical);
    if (!v) {
      v = {
        stadium: venueStadium(canonical),
        city: venueCity(canonical),
        matches: 0,
        full_matches: 0,
        sum_1st: 0,
        sum_2nd: 0,
        chase_wins: 0,
        defend_wins: 0,
        had_rain: false,
        phase: emptyPhaseAgg(),
        style: emptyStyleAgg(),
      };
      map.set(canonical, v);
    }
    return v;
  };

  for (const r of matches) {
    const v = ensure(canonicalVenue(r.venue));
    v.matches += r.matches;
    v.full_matches += r.full_matches;
    v.sum_1st += r.sum_1st ?? 0;
    v.sum_2nd += r.sum_2nd ?? 0;
    v.chase_wins += r.chase_wins;
    v.defend_wins += r.defend_wins;
    if (r.had_rain) v.had_rain = true;
  }
  for (const r of phases) {
    if (!PHASE_ORDER.includes(r.phase)) continue;
    const v = ensure(canonicalVenue(r.venue));
    const slot = v.phase[r.phase];
    slot.runs += r.runs;
    slot.balls += r.balls;
    slot.boundaries += r.boundaries;
    slot.dots += r.dots;
    slot.wickets += r.wickets;
  }
  for (const r of styles) {
    if (r.bowling_kind !== "spin" && r.bowling_kind !== "pace") continue;
    const v = ensure(canonicalVenue(r.venue));
    const slot = v.style[r.bowling_kind];
    slot.runs += r.runs;
    slot.balls += r.balls;
    slot.wickets += r.wickets;
  }

  return [...map.values()].sort((a, b) => b.matches - a.matches);
}

function emptyPhaseAgg(): PhaseAgg {
  return {
    powerplay: { runs: 0, balls: 0, boundaries: 0, dots: 0, wickets: 0 },
    middle: { runs: 0, balls: 0, boundaries: 0, dots: 0, wickets: 0 },
    death: { runs: 0, balls: 0, boundaries: 0, dots: 0, wickets: 0 },
  };
}

function emptyStyleAgg(): StyleAgg {
  return {
    spin: { runs: 0, balls: 0, wickets: 0 },
    pace: { runs: 0, balls: 0, wickets: 0 },
  };
}

function classifiedCoverage(venues: Venue[]): number {
  let classified = 0;
  let total = 0;
  for (const v of venues) {
    classified += v.style.spin.balls + v.style.pace.balls;
    for (const p of PHASE_ORDER) total += v.phase[p].balls;
  }
  return total > 0 ? Math.round((classified / total) * 100) : 0;
}
