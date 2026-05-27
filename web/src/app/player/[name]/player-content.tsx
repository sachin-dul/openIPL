"use client";

import { useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { usePlayerNames } from "@/lib/player-names";
import { canonicalTeam, teamAliases, teamColor, teamInk, teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";
import { PlayerLink } from "@/components/player-link";
import { Card } from "@/components/card";
import { Stat } from "@/components/stat";
import { CareerChart } from "@/components/charts/career-chart";
import { RadarChart, type RadarSeries } from "@/components/charts/radar-chart";
import {
  DismissalBar,
  type DismissalRow,
} from "@/components/charts/dismissal-bar";

type Profile = {
  team: string | null;
  role: string | null;
  first_season: number;
  last_season: number;
  matches: number;
  batting_hand: string | null;
  bowling_style: string | null;
  bowling_kind: string | null;
};

type TeamStintRow = {
  season: number;
  team: string;
  matches: number;
};

type BatTotals = {
  runs: number;
  balls: number;
  innings: number;
  outs: number;
  fifties: number;
  hundreds: number;
  hs: number;
  fours: number;
  sixes: number;
  avg: number | null;
  sr: number | null;
};

type BowlTotals = {
  wickets: number;
  runs: number;
  overs: number;
  econ: number | null;
  avg: number | null;
  sr: number | null;
  // Containment / milestone signals shown in the bowling breakdown card.
  // `legal_balls` is balls actually bowled (excluding wides + no-balls) and
  // serves as the denominator for dot-ball %. `four_wkts` counts innings
  // with exactly 4 wickets; 5+ are tracked separately as 5-fers.
  dots: number;
  legal_balls: number;
  maidens: number;
  four_wkts: number;
};

type CareerSeasonBat = {
  season: number;
  matches: number;
  runs: number;
  hs: number;
  hs_not_out: number;
  innings: number;
  outs: number;
  balls: number;
  fifties: number;
  hundreds: number;
  fours: number;
  sixes: number;
  avg: number | null;
  sr: number | null;
};

type SkillRow = {
  metric: string;
  value: number;
  balls: number;
};

type MatchupRow = {
  bowler: string;
  balls: number;
  runs: number;
  outs: number;
  sr: number | null;
};

type VenueRow = { venue: string; runs: number; sr: number | null };

type BowlVenueRow = {
  venue: string;
  balls: number;
  runs: number;
  wickets: number;
  econ: number | null;
};

type BatterMatchupRow = {
  batter: string;
  balls: number;
  runs: number;
  wickets: number;
  econ: number | null;
};

type DismissalRaw = { wicket_kind: string; n: number };

type WicketTypeRow = { wicket_kind: string; n: number };

type CareerSeasonBowl = {
  season: number;
  matches: number;
  innings: number;
  overs: number;
  maidens: number;
  runs: number;
  wickets: number;
  bbi_w: number;
  bbi_r: number | null;
  four_w: number;
  five_w: number;
  avg: number | null;
  econ: number | null;
  sr: number | null;
};

type OcRow = { season: number; runs: number; rk: number };

const EMPTY_STINTS: TeamStintRow[] = [];
const EMPTY_SEASONS: CareerSeasonBat[] = [];

type Filter = {
  team: string | null;
  year: number | null;
};


const NO_FILTER: Filter = { team: null, year: null };

function isDefaultFilter(f: Filter): boolean {
  return f.team === null && f.year === null;
}

/* Build the AND-prefixed WHERE clause for `filter`. teamCol selects which
 * column the team predicate should target:
 *   string  → literal column (`team = '...'`)
 *   null    → no team column; constrain via season-IN(players-of-team)
 *   undef   → omit team predicate entirely (e.g. cross-team views)
 */
function whereFilter(
  f: Filter,
  escaped: string,
  opts: { teamCol?: string | null; seasonCol?: string } = {},
): string {
  const season = opts.seasonCol ?? "season";
  const parts: string[] = [];
  if (f.year !== null) parts.push(`${season} = ${f.year}`);
  if (f.team) {
    // Include every alias of the selected franchise so historical names
    // (e.g. "Royal Challengers Bangalore" for 2008–2023) still match when
    // the dropdown only shows the latest form ("Royal Challengers Bengaluru").
    const aliasList = teamAliases(f.team)
      .map((n) => `'${sqlEscape(n)}'`)
      .join(", ");
    if (opts.teamCol === null) {
      parts.push(
        `${season} IN (SELECT season FROM players WHERE player = '${escaped}' AND team IN (${aliasList}))`,
      );
    } else if (opts.teamCol !== undefined) {
      parts.push(`${opts.teamCol} IN (${aliasList})`);
    }
  }
  return parts.length ? `AND ${parts.join(" AND ")}` : "";
}

export function PlayerContent({ name }: { name: string }) {
  const escaped = sqlEscape(name);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const filtered = !isDefaultFilter(filter);
  const wfBatScore = whereFilter(filter, escaped, { teamCol: "team" });
  const wfBowlScore = whereFilter(filter, escaped, { teamCol: "team" });
  const wfBall = whereFilter(filter, escaped, { teamCol: "team" });
  const wfNoTeam = whereFilter(filter, escaped, { teamCol: null });

  /* Profile (team + role + span + matches + handedness + bowling style).
     Role priority: players_meta.role (carries Wicket-keeper) > players.role
     (which only ever holds Batter/Bowler/All-rounder). */
  const profileQ = useDuckQuery<Profile>(
    `WITH latest AS (
        SELECT team FROM (
          SELECT team, season,
                 ROW_NUMBER() OVER (PARTITION BY 1 ORDER BY season DESC, matches DESC) AS rk
          FROM players WHERE player = '${escaped}' AND team IS NOT NULL
        ) WHERE rk = 1
      ),
      meta AS (
        SELECT role, batting_hand, bowling_style, bowling_kind
        FROM players_meta
        WHERE unique_name = '${escaped}'
        LIMIT 1
      )
      SELECT
        (SELECT team FROM latest) AS team,
        COALESCE(
          (SELECT role FROM meta),
          (SELECT ANY_VALUE(role) FROM players WHERE player = '${escaped}')
        ) AS role,
        CAST((SELECT MIN(season) FROM players WHERE player = '${escaped}') AS BIGINT) AS first_season,
        CAST((SELECT MAX(season) FROM players WHERE player = '${escaped}') AS BIGINT) AS last_season,
        CAST((SELECT SUM(matches) FROM players WHERE player = '${escaped}') AS BIGINT) AS matches,
        (SELECT batting_hand  FROM meta) AS batting_hand,
        (SELECT bowling_style FROM meta) AS bowling_style,
        (SELECT bowling_kind  FROM meta) AS bowling_kind`,
  );

  /* Every season the player turned out for (one row per season × team) */
  const stintsQ = useDuckQuery<TeamStintRow>(
    `SELECT
        CAST(season AS BIGINT)  AS season,
        team,
        CAST(matches AS BIGINT) AS matches
     FROM players
     WHERE player = '${escaped}' AND team IS NOT NULL
     ORDER BY season, matches DESC`,
  );

  /* Seasons where the player has any batting OR bowling data. Used to gate
     the year dropdown so we don't offer years that would empty every card
     (e.g. squad-listed but DNB / Did-not-bowl across the season). */
  const activeSeasonsQ = useDuckQuery<{ season: number }>(
    `SELECT CAST(season AS BIGINT) AS season FROM (
       SELECT season FROM batting_scorecard WHERE batter = '${escaped}'
       UNION
       SELECT season FROM bowling_scorecard WHERE bowler = '${escaped}'
     ) GROUP BY season ORDER BY season`,
  );

  /* All of the following queries hit pre-aggregated parquets keyed on the
     player's `unique_name`. Each is a single-row (or short) lookup —
     scripts/build_player_aggregates.py computes them once per ETL run so the
     page no longer scans batting_scorecard, bowling_scorecard, or ball_by_ball
     on every navigation. */

  const batQ = useDuckQuery<BatTotals>(
    filtered
      ? `SELECT
           CAST(SUM(runs) AS BIGINT)  AS runs,
           CAST(SUM(balls) AS BIGINT) AS balls,
           CAST(COUNT(*) AS BIGINT)   AS innings,
           CAST(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END) AS BIGINT) AS outs,
           CAST(SUM(CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END) AS BIGINT) AS fifties,
           CAST(SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) AS BIGINT) AS hundreds,
           CAST(COALESCE(MAX(runs), 0) AS BIGINT) AS hs,
           CAST(SUM(fours) AS BIGINT) AS fours,
           CAST(SUM(sixes) AS BIGINT) AS sixes,
           CAST(SUM(runs) AS DOUBLE) /
             NULLIF(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END), 0) AS avg,
           100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
         FROM batting_scorecard
         WHERE batter = '${escaped}' ${wfBatScore}`
      : `SELECT runs, balls, innings, outs, fifties, hundreds, hs, fours, sixes, avg, sr
           FROM player_career_bat WHERE player = '${escaped}'`,
  );

  /* Career-level "has this player ever bowled?" — never filtered. Used for
     the header's bowling-style chip and the layout decision of whether to
     render the bowling stats card. Keeps the player's identity stable when
     filters narrow into windows where they bowled little or not at all. */
  const careerBowlQ = useDuckQuery<{ wickets: number }>(
    `SELECT CAST(wickets AS BIGINT) AS wickets
       FROM player_career_bowl WHERE player = '${escaped}'`,
  );

  /* Symmetric career-level gate for batting. Lets the page hide the batting
     block for a pure bowler who never put bat to ball (rare). */
  const careerBatQ = useDuckQuery<{ runs: number }>(
    `SELECT CAST(runs AS BIGINT) AS runs
       FROM player_career_bat WHERE player = '${escaped}'`,
  );

  const bowlQ = useDuckQuery<BowlTotals>(
    filtered
      ? `WITH agg AS (
           SELECT
             CAST(SUM(wickets) AS BIGINT) AS wickets,
             CAST(SUM(runs) AS BIGINT)    AS runs,
             SUM(FLOOR(overs)) + (SUM(overs - FLOOR(overs)) * 10) / 6 AS overs,
             CAST(SUM(dots) AS BIGINT)    AS dots,
             CAST(SUM(maidens) AS BIGINT) AS maidens,
             CAST(SUM(CASE WHEN wickets >= 4 THEN 1 ELSE 0 END) AS BIGINT) AS four_wkts,
             CAST(SUM(FLOOR(overs) * 6 + ROUND((overs - FLOOR(overs)) * 10)) AS BIGINT) AS legal_balls
           FROM bowling_scorecard
           WHERE bowler = '${escaped}' ${wfBowlScore}
         )
         SELECT
           wickets, runs, overs,
           CASE WHEN overs > 0 THEN runs / overs ELSE NULL END                     AS econ,
           CASE WHEN wickets > 0 THEN CAST(runs AS DOUBLE) / wickets ELSE NULL END AS avg,
           CASE WHEN wickets > 0 THEN (overs * 6) / wickets ELSE NULL END          AS sr,
           dots, legal_balls, maidens, four_wkts
         FROM agg`
      : `WITH extras AS (
           SELECT
             CAST(SUM(dots) AS BIGINT)    AS dots,
             CAST(SUM(maidens) AS BIGINT) AS maidens,
             CAST(SUM(CASE WHEN wickets >= 4 THEN 1 ELSE 0 END) AS BIGINT) AS four_wkts,
             CAST(SUM(FLOOR(overs) * 6 + ROUND((overs - FLOOR(overs)) * 10)) AS BIGINT) AS legal_balls
           FROM bowling_scorecard
           WHERE bowler = '${escaped}'
         )
         SELECT c.wickets, c.runs, c.overs, c.econ, c.avg, c.sr,
                e.dots, e.legal_balls, e.maidens, e.four_wkts
           FROM player_career_bowl c CROSS JOIN extras e
           WHERE c.player = '${escaped}'`,
  );

  const seasonsQ = useDuckQuery<CareerSeasonBat>(
    filtered
      ? `WITH bs AS (
           SELECT *, MAX(runs) OVER (PARTITION BY season) AS season_max
           FROM batting_scorecard
           WHERE batter = '${escaped}' ${wfBatScore}
         )
         SELECT
           CAST(season AS BIGINT) AS season,
           CAST(COUNT(DISTINCT match_number) AS BIGINT) AS matches,
           CAST(SUM(runs) AS BIGINT) AS runs,
           CAST(MAX(runs) AS BIGINT) AS hs,
           CAST(MAX(CASE WHEN runs = season_max
                         AND (dismissal IS NULL OR dismissal = 'not out')
                    THEN 1 ELSE 0 END) AS BIGINT) AS hs_not_out,
           CAST(COUNT(*) AS BIGINT) AS innings,
           CAST(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END) AS BIGINT) AS outs,
           CAST(SUM(balls) AS BIGINT) AS balls,
           CAST(SUM(CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END) AS BIGINT) AS fifties,
           CAST(SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) AS BIGINT) AS hundreds,
           CAST(SUM(fours) AS BIGINT) AS fours,
           CAST(SUM(sixes) AS BIGINT) AS sixes,
           CAST(SUM(runs) AS DOUBLE) /
             NULLIF(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END), 0) AS avg,
           100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
         FROM bs
         GROUP BY season
         ORDER BY season`
      : `SELECT season, matches, runs, hs, hs_not_out, innings, outs, balls,
                fifties, hundreds, fours, sixes, avg, sr
           FROM player_season_bat
           WHERE player = '${escaped}'
           ORDER BY season`,
  );

  /* Bowling season-by-season — mirrors the batting per-season query. */
  const bowlSeasonsQ = useDuckQuery<CareerSeasonBowl>(
    filtered
      ? `WITH bs AS (
           SELECT *, MAX(wickets) OVER (PARTITION BY season) AS season_max_w
           FROM bowling_scorecard
           WHERE bowler = '${escaped}' ${wfBowlScore}
         ),
         agg AS (
           SELECT
             CAST(season AS BIGINT) AS season,
             CAST(COUNT(DISTINCT match_number) AS BIGINT) AS matches,
             CAST(COUNT(*) AS BIGINT) AS innings,
             SUM(FLOOR(overs)) + (SUM(overs - FLOOR(overs)) * 10) / 6 AS overs,
             CAST(SUM(maidens) AS BIGINT) AS maidens,
             CAST(SUM(runs) AS BIGINT) AS runs,
             CAST(SUM(wickets) AS BIGINT) AS wickets,
             CAST(MAX(wickets) AS BIGINT) AS bbi_w,
             CAST(MIN(CASE WHEN wickets = season_max_w THEN runs END) AS BIGINT) AS bbi_r,
             CAST(SUM(CASE WHEN wickets >= 4 AND wickets < 5 THEN 1 ELSE 0 END) AS BIGINT) AS four_w,
             CAST(SUM(CASE WHEN wickets >= 5 THEN 1 ELSE 0 END) AS BIGINT) AS five_w
           FROM bs
           GROUP BY season
         )
         SELECT season, matches, innings, overs, maidens, runs, wickets,
                bbi_w, bbi_r, four_w, five_w,
                CASE WHEN wickets > 0 THEN CAST(runs AS DOUBLE) / wickets ELSE NULL END AS avg,
                CASE WHEN overs > 0   THEN runs / overs                ELSE NULL END AS econ,
                CASE WHEN wickets > 0 THEN (overs * 6) / wickets       ELSE NULL END AS sr
         FROM agg
         ORDER BY season`
      : `SELECT season, matches, innings, overs, maidens, runs, wickets,
                bbi_w, bbi_r, four_w, five_w, avg, econ, sr
           FROM player_season_bowl
           WHERE player = '${escaped}'
           ORDER BY season`,
  );

  /* Bowling skill radar: economy vs LHB/RHB and across phases. */
  const bowlSkillQ = useDuckQuery<SkillRow>(
    filtered
      ? `WITH bbb AS (
           SELECT
             b.batter_runs,
             b.phase,
             (b.batter_runs + COALESCE(b.wides, 0) + COALESCE(b.noballs, 0)) AS conceded,
             COALESCE(pm.batting_hand, 'unknown') AS bat_hand,
             (COALESCE(b.wides, 0) = 0 AND COALESCE(b.noballs, 0) = 0)::INT AS legal
           FROM ball_by_ball b
           LEFT JOIN players_meta pm ON pm.unique_name = b.batter
           WHERE b.bowler = '${escaped}' ${wfBall}
         )
         SELECT axis AS metric,
                CASE WHEN balls > 0 THEN 6.0 * runs / balls ELSE 0 END AS value,
                balls
         FROM (
           SELECT 'lhb' AS axis,
                  CAST(SUM(conceded) AS BIGINT) AS runs,
                  CAST(SUM(legal) AS BIGINT) AS balls
           FROM bbb WHERE bat_hand = 'LHB'
           UNION ALL
           SELECT 'rhb', CAST(SUM(conceded) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE bat_hand = 'RHB'
           UNION ALL
           SELECT 'pp', CAST(SUM(conceded) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE phase = 'powerplay'
           UNION ALL
           SELECT 'mid', CAST(SUM(conceded) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE phase = 'middle'
           UNION ALL
           SELECT 'death', CAST(SUM(conceded) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE phase = 'death'
         )`
      : `SELECT axis AS metric, COALESCE(econ, 0) AS value, balls
           FROM player_bowl_skill_profile
           WHERE player = '${escaped}'`,
  );

  /* Bowler vs batter matchups. We pull every batter with ≥6 legal balls (low
     bar so wicket-heavy short encounters survive) and let JS partition into
     the bowler's 3 best/worst by economy and the top 3 by wicket count. The
     best/worst split applies a stricter ≥18-ball gate downstream so the rate
     ranking isn't dominated by 1-over samples. */
  const batterMatchupsQ = useDuckQuery<BatterMatchupRow>(
    filtered
      ? `SELECT batter,
                CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
                CAST(SUM(batter_runs + COALESCE(wides,0) + COALESCE(noballs,0)) AS BIGINT) AS runs,
                CAST(SUM(CASE WHEN is_wicket AND LOWER(COALESCE(wicket_kind,'')) NOT IN
                  ('run out','retired hurt','retired out','obstructing the field','timed out')
                  THEN 1 ELSE 0 END) AS BIGINT) AS wickets,
                6.0 * SUM(batter_runs + COALESCE(wides,0) + COALESCE(noballs,0)) /
                  NULLIF(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END), 0) AS econ
           FROM ball_by_ball
           WHERE bowler = '${escaped}' AND batter IS NOT NULL ${wfBall}
           GROUP BY batter
           HAVING SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) >= 6
           ORDER BY balls DESC`
      : `SELECT batter, balls, runs, wickets, econ
           FROM player_batter_matchups
           WHERE bowler = '${escaped}' AND balls >= 6
           ORDER BY balls DESC`,
  );

  /* Bowling-side venues: where they take wickets / where they're economical. */
  const bowlVenuesQ = useDuckQuery<BowlVenueRow>(
    filtered
      ? `SELECT m.venue,
                CAST(SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
                CAST(SUM(b.batter_runs + COALESCE(b.wides,0) + COALESCE(b.noballs,0)) AS BIGINT) AS runs,
                CAST(SUM(CASE WHEN b.is_wicket AND LOWER(COALESCE(b.wicket_kind,'')) NOT IN
                  ('run out','retired hurt','retired out','obstructing the field','timed out')
                  THEN 1 ELSE 0 END) AS BIGINT) AS wickets,
                6.0 * SUM(b.batter_runs + COALESCE(b.wides,0) + COALESCE(b.noballs,0)) /
                  NULLIF(SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END), 0) AS econ
           FROM ball_by_ball b
           JOIN matches m ON b.season = m.season AND b.match_number = m.match_number
           WHERE b.bowler = '${escaped}' AND m.venue IS NOT NULL ${whereFilter(filter, escaped, { teamCol: "b.team", seasonCol: "b.season" })}
           GROUP BY m.venue
           ORDER BY wickets DESC, balls DESC
           LIMIT 6`
      : `SELECT venue, balls, runs, wickets, econ
           FROM player_bowl_venues
           WHERE player = '${escaped}'
           ORDER BY wickets DESC, balls DESC
           LIMIT 6`,
  );

  /* Wicket-type donut for bowlers — bowler-credited dismissals only. */
  const wicketTypesQ = useDuckQuery<WicketTypeRow>(
    filtered
      ? `SELECT LOWER(wicket_kind) AS wicket_kind,
                CAST(COUNT(*) AS BIGINT) AS n
           FROM ball_by_ball
           WHERE bowler = '${escaped}' AND is_wicket AND wicket_kind IS NOT NULL
             AND LOWER(COALESCE(wicket_kind,'')) NOT IN
               ('run out','retired hurt','retired out','obstructing the field','timed out')
             ${wfBall}
           GROUP BY LOWER(wicket_kind)
           ORDER BY n DESC`
      : `SELECT wicket_kind, n
           FROM player_wicket_types
           WHERE player = '${escaped}'
           ORDER BY n DESC`,
  );

  const ocQ = useDuckQuery<OcRow>(
    `SELECT season, runs, 1 AS rk
       FROM orange_cap_winners
       WHERE batter = '${escaped}' ${wfNoTeam}
       ORDER BY season`,
  );

  const skillQ = useDuckQuery<SkillRow>(
    filtered
      ? `WITH bbb AS (
           SELECT
             b.batter_runs,
             b.phase,
             COALESCE(pm.bowling_kind, 'unknown') AS bowling_kind,
             (COALESCE(b.wides, 0) = 0 AND COALESCE(b.noballs, 0) = 0)::INT AS legal
           FROM ball_by_ball b
           LEFT JOIN players_meta pm ON pm.unique_name = b.bowler
           WHERE b.batter = '${escaped}' ${wfBall}
         )
         SELECT axis AS metric,
                CASE WHEN balls > 0 THEN 100.0 * runs / balls ELSE 0 END AS value,
                balls
         FROM (
           SELECT 'pace' AS axis,
                  CAST(SUM(batter_runs) AS BIGINT) AS runs,
                  CAST(SUM(legal) AS BIGINT) AS balls
           FROM bbb WHERE bowling_kind = 'pace'
           UNION ALL
           SELECT 'spin', CAST(SUM(batter_runs) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE bowling_kind = 'spin'
           UNION ALL
           SELECT 'pp', CAST(SUM(batter_runs) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE phase = 'powerplay'
           UNION ALL
           SELECT 'mid', CAST(SUM(batter_runs) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE phase = 'middle'
           UNION ALL
           SELECT 'death', CAST(SUM(batter_runs) AS BIGINT), CAST(SUM(legal) AS BIGINT)
           FROM bbb WHERE phase = 'death'
         )`
      : `SELECT axis AS metric, COALESCE(sr, 0) AS value, balls
           FROM player_skill_profile
           WHERE player = '${escaped}'`,
  );

  /* Batter vs bowler matchups. Mirror of batterMatchupsQ above: ≥6-ball pool
     so dismissal-heavy short encounters survive for the "most dismissals"
     section, with JS applying a ≥18-ball gate for the rate-based best/worst. */
  const matchupsQ = useDuckQuery<MatchupRow>(
    filtered
      ? `SELECT bowler,
                CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
                CAST(SUM(batter_runs) AS BIGINT) AS runs,
                CAST(SUM(CASE WHEN is_wicket AND LOWER(COALESCE(wicket_kind,'')) NOT IN
                  ('run out','retired hurt','retired out','obstructing the field','timed out')
                  THEN 1 ELSE 0 END) AS BIGINT) AS outs,
                100.0 * SUM(batter_runs) /
                  NULLIF(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END), 0) AS sr
           FROM ball_by_ball
           WHERE batter = '${escaped}' AND bowler IS NOT NULL ${wfBall}
           GROUP BY bowler
           HAVING SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) >= 6
           ORDER BY balls DESC`
      : `SELECT bowler, balls, runs, outs, sr
           FROM player_bowler_matchups
           WHERE batter = '${escaped}' AND balls >= 6
           ORDER BY balls DESC`,
  );

  const venuesQ = useDuckQuery<VenueRow>(
    filtered
      ? `SELECT m.venue,
                CAST(SUM(b.batter_runs) AS BIGINT) AS runs,
                100.0 * SUM(b.batter_runs) /
                  NULLIF(SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END), 0) AS sr
           FROM ball_by_ball b
           JOIN matches m ON b.season = m.season AND b.match_number = m.match_number
           WHERE b.batter = '${escaped}' AND m.venue IS NOT NULL ${whereFilter(filter, escaped, { teamCol: "b.team", seasonCol: "b.season" })}
           GROUP BY m.venue
           ORDER BY runs DESC
           LIMIT 6`
      : `SELECT venue, runs, sr
           FROM player_venues
           WHERE player = '${escaped}'
           ORDER BY runs DESC
           LIMIT 6`,
  );

  const dismissalQ = useDuckQuery<DismissalRaw>(
    filtered
      ? `SELECT wicket_kind,
                CAST(COUNT(*) AS BIGINT) AS n
           FROM ball_by_ball
           WHERE player_out = '${escaped}' AND wicket_kind IS NOT NULL ${wfBall}
           GROUP BY wicket_kind
           ORDER BY n DESC`
      : `SELECT wicket_kind, n
           FROM player_dismissals
           WHERE player = '${escaped}'
           ORDER BY n DESC`,
  );

  const profile = profileQ.status === "success" ? profileQ.data[0] : null;
  const stintsData = stintsQ.status === "success" ? stintsQ.data : EMPTY_STINTS;
  const activeSeasons = useMemo(() => {
    if (activeSeasonsQ.status !== "success") return null;
    return new Set(activeSeasonsQ.data.map((r) => r.season));
  }, [activeSeasonsQ]);
  const bat = batQ.status === "success" ? batQ.data[0] : null;
  const bowl = bowlQ.status === "success" ? bowlQ.data[0] : null;
  const seasonsData = seasonsQ.status === "success" ? seasonsQ.data : EMPTY_SEASONS;
  const bowlSeasons = bowlSeasonsQ.status === "success" ? bowlSeasonsQ.data : [];
  const oc = ocQ.status === "success" ? ocQ.data : [];
  const skills = skillQ.status === "success" ? skillQ.data : [];
  const bowlSkills = bowlSkillQ.status === "success" ? bowlSkillQ.data : [];
  const matchups = matchupsQ.status === "success" ? matchupsQ.data : [];
  const batterMatchups = batterMatchupsQ.status === "success" ? batterMatchupsQ.data : [];
  const venues = venuesQ.status === "success" ? venuesQ.data : [];
  const bowlVenues = bowlVenuesQ.status === "success" ? bowlVenuesQ.data : [];
  const dismissals = dismissalQ.status === "success" ? dismissalQ.data : [];
  const wicketTypes = wicketTypesQ.status === "success" ? wicketTypesQ.data : [];

  // Hooks must run on every render before any conditional return — pin them
  // to the top of the component rather than after the early bail-outs below.
  const { resolve } = usePlayerNames();
  const peak = useMemo(() => {
    if (seasonsData.length === 0) return null;
    return seasonsData.reduce((p, c) => (c.runs > p.runs ? c : p), seasonsData[0]);
  }, [seasonsData]);
  const teamStints = useMemo(() => collapseStints(stintsData), [stintsData]);

  /* Count of distinct seasons the player ever played in — derived from the
     unfiltered stints, so the header keeps showing career length even when
     a year/team filter is active below. */
  const careerSeasons = useMemo(() => {
    const seasons = new Set<number>();
    for (const s of stintsData) seasons.add(s.season);
    return seasons.size;
  }, [stintsData]);

  /* Matches in the active window — sum of stint rows that fall inside the
     filter. Lets the cards show the correct "98 M" subline without an extra
     query when filter changes. */
  const filteredMatches = useMemo(() => {
    if (!filtered) return profile?.matches ?? 0;
    const teamCanon = filter.team ? canonicalTeam(filter.team) : null;
    let total = 0;
    for (const s of stintsData) {
      if (filter.year !== null && s.season !== filter.year) continue;
      if (teamCanon && canonicalTeam(s.team) !== teamCanon) continue;
      total += s.matches;
    }
    return total;
  }, [filtered, filter, stintsData, profile]);

  if (profileQ.status === "loading") return <PageLoader />;
  if (profileQ.status === "error")
    return <ErrorBlock message={profileQ.error.message} />;
  if (!profile) return <NotFound name={name} />;

  const displayName = resolve(name);
  const teamName = profile.team ?? "";
  const color = teamName ? teamColor(teamName) : "var(--color-ipl-accent)";
  const role = normalizeRole(profile.role);
  // hasCareerBowled is intentionally derived from the unfiltered career
  // aggregate so the header's role display + bowling card visibility don't
  // flip when the user narrows to a window the player happened not to bowl in.
  const hasCareerBowled =
    careerBowlQ.status === "success" && (careerBowlQ.data[0]?.wickets ?? 0) > 0;
  const hasCareerBatted =
    careerBatQ.status !== "success" || (careerBatQ.data[0]?.runs ?? 0) > 0;
  const showsBowling =
    role === "Bowler" || role === "All-rounder" || hasCareerBowled;
  const showsBatting =
    role === "Batter" ||
    role === "Wicket-keeper" ||
    role === "All-rounder" ||
    role === "Player" ||
    hasCareerBatted;

  const windowLabel = filterLabel(filter);
  const cardKickerBat = `BATTING · ${windowLabel}`;
  const cardKickerBowl = `BOWLING · ${windowLabel}`;

  return (
    <div className="flex flex-col gap-3.5">
      <PlayerHeader
        displayName={displayName}
        role={role}
        battingHand={profile.batting_hand}
        bowlingStyle={profile.bowling_style}
        bowlingKind={profile.bowling_kind}
        firstSeason={profile.first_season}
        lastSeason={profile.last_season}
        seasons={careerSeasons}
        matches={profile.matches}
        color={color}
        showBowling={showsBowling}
      />

      <Card
        kicker="TEAMS"
        title={
          teamStints.length === 1
            ? teamStints[0].team
            : `${profile.first_season}–${profile.last_season}`
        }
        action={
          <PlayerFilters
            stints={stintsData}
            activeSeasons={activeSeasons}
            filter={filter}
            setFilter={setFilter}
          />
        }
        padded
      >
        <TeamsTimeline
          stints={teamStints}
          first={profile.first_season}
          last={profile.last_season}
        />
      </Card>

      {/* Stats hero row: BATTING | BOWLING (one or both, depending on role). */}
      <div
        className="grid gap-3.5"
        style={{
          gridTemplateColumns:
            showsBatting && showsBowling ? "1fr 1fr" : "1fr",
        }}
      >
        {showsBatting && (
          <Card kicker={cardKickerBat} title="Stats" padded>
            <BattingStats
              bat={bat}
              seasons={seasonsData}
              matches={filteredMatches}
              oc={oc}
              peak={peak}
              color={color}
              filtered={filtered}
              windowLabel={windowLabel}
            />
          </Card>
        )}
        {showsBowling && (
          <Card kicker={cardKickerBowl} title="Stats" padded>
            <BowlingStats
              bowl={bowl}
              seasons={bowlSeasons}
              color={color}
              filtered={filtered}
              windowLabel={windowLabel}
            />
          </Card>
        )}
      </div>

      {showsBowling ? (
        /* Paired side-by-side rows — bowling visible, so every batting card
           sits next to its bowling analog. Each row is 1fr/1fr when both
           cards render, full-width otherwise. */
        <>
          <PairedRow show={[showsBatting, showsBowling]}>
            {showsBatting && (
              <Card
                kicker="CAREER ARC · BATTING"
                title={`Runs by season · ${profile.first_season}–${profile.last_season}`}
                padded
              >
                <CareerArc seasons={seasonsData} stints={stintsData} />
              </Card>
            )}
            <Card
              kicker="CAREER ARC · BOWLING"
              title={`Wickets by season · ${profile.first_season}–${profile.last_season}`}
              padded
            >
              <BowlCareerArc seasons={bowlSeasons} stints={stintsData} />
            </Card>
          </PairedRow>

          <PairedRow show={[showsBatting, showsBowling]}>
            {showsBatting && (
              <Card kicker="SEASON-BY-SEASON" title="Batting" padded={false}>
                <SeasonTable seasons={seasonsData} />
              </Card>
            )}
            <Card kicker="SEASON-BY-SEASON" title="Bowling" padded={false}>
              <BowlSeasonTable seasons={bowlSeasons} />
            </Card>
          </PairedRow>

          <PairedRow show={[showsBatting, showsBowling]}>
            {showsBatting && (
              <Card kicker="FINGERPRINT · BATTING" title="Skill profile" padded>
                <SkillRadar rows={skills} color={color} name={displayName} />
              </Card>
            )}
            <Card kicker="FINGERPRINT · BOWLING" title="Skill profile" padded>
              <BowlSkillRadar rows={bowlSkills} color={color} name={displayName} />
            </Card>
          </PairedRow>

          <PairedRow show={[showsBatting, showsBowling]}>
            {showsBatting && (
              <Card kicker="MATCHUPS · CAREER" title="Best & worst vs bowlers" padded>
                <MatchupsTable rows={matchups} />
              </Card>
            )}
            <Card kicker="MATCHUPS · CAREER" title="Best & worst vs batters" padded>
              <BowlMatchupsTable rows={batterMatchups} />
            </Card>
          </PairedRow>

          <PairedRow show={[showsBatting, showsBowling]}>
            {showsBatting && (
              <Card kicker="VENUES · BATTING" title="Where they score" padded>
                <VenuesList rows={venues} color={color} />
              </Card>
            )}
            <Card kicker="VENUES · BOWLING" title="Where they take wickets" padded>
              <BowlVenuesList rows={bowlVenues} color={color} />
            </Card>
          </PairedRow>

          <PairedRow show={[showsBatting, showsBowling]}>
            {showsBatting && (
              <Card kicker="DISMISSALS · CAREER" title="How they get out" padded>
                <CareerDismissals rows={dismissals} color={color} />
              </Card>
            )}
            <Card kicker="WICKET TYPES · CAREER" title="How they take wickets" padded>
              <WicketTypesDonut rows={wicketTypes} color={color} />
            </Card>
          </PairedRow>

          <PairedRow show={[showsBatting, showsBowling]}>
            {showsBatting && (
              <Card kicker="BREAKDOWN · BATTING" title="Boundaries" padded>
                <BoundariesCard fours={bat?.fours ?? 0} sixes={bat?.sixes ?? 0} color={color} />
              </Card>
            )}
            <Card kicker="BREAKDOWN · BOWLING" title="Milestones" padded>
              <BowlMilestonesCard
                dots={bowl?.dots ?? 0}
                legalBalls={bowl?.legal_balls ?? 0}
                fourWkts={bowl?.four_wkts ?? 0}
                maidens={bowl?.maidens ?? 0}
                color={color}
              />
            </Card>
          </PairedRow>
        </>
      ) : (
        /* Pure batter view — keep the original compact 3-col fingerprint row
           and 2-col dismissals/boundaries row. */
        <>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Card
              kicker="CAREER ARC"
              title={`Runs by season · ${profile.first_season}–${profile.last_season}`}
              padded
            >
              <CareerArc seasons={seasonsData} stints={stintsData} />
            </Card>
            <Card kicker="SEASON-BY-SEASON" title="Batting" padded={false}>
              <SeasonTable seasons={seasonsData} />
            </Card>
          </div>

          <div
            className="grid gap-3.5 mt-4"
            style={{ gridTemplateColumns: "1fr 1.6fr" }}
          >
            <div className="flex flex-col gap-3.5">
              <Card kicker="FINGERPRINT" title="Skill profile" padded>
                <SkillRadar rows={skills} color={color} name={displayName} />
              </Card>
              <Card kicker="VENUES" title="Where they score" padded>
                <VenuesList rows={venues} color={color} />
              </Card>
            </div>
            <Card kicker="MATCHUPS · CAREER" title="Best & worst vs bowlers" padded>
              <MatchupsTable rows={matchups} />
            </Card>
          </div>

          <div className="grid gap-3.5 mt-3.5 grid-cols-2">
            <Card kicker="DISMISSALS · CAREER" title="How they get out" padded>
              <CareerDismissals rows={dismissals} color={color} />
            </Card>
            <Card kicker="BREAKDOWN" title="Boundaries" padded>
              <BoundariesCard fours={bat?.fours ?? 0} sixes={bat?.sixes ?? 0} color={color} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* Small wrapper that renders a 2-col grid when both sides are present, or
   full-width when only one side is shown. Children passed in null/false
   are filtered out so we never leave an empty grid column. */
function PairedRow({
  show,
  children,
}: {
  show: [boolean, boolean];
  children: React.ReactNode;
}) {
  const visible = (Array.isArray(children) ? children : [children]).filter(
    Boolean,
  );
  if (visible.length === 0) return null;
  const cols = show[0] && show[1] ? "1fr 1fr" : "1fr";
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: cols }}>
      {visible}
    </div>
  );
}

/* ── Profile header ──────────────────────────────────────────────────── */

function PlayerHeader({
  displayName,
  role,
  battingHand,
  bowlingStyle,
  bowlingKind,
  firstSeason,
  lastSeason,
  seasons,
  matches,
  color,
  showBowling,
}: {
  displayName: string;
  role: NormalRole;
  battingHand: string | null;
  bowlingStyle: string | null;
  bowlingKind: string | null;
  firstSeason: number;
  lastSeason: number;
  seasons: number;
  matches: number;
  color: string;
  showBowling: boolean;
}) {
  const battingLabel =
    battingHand === "LHB"
      ? "Left-hand bat"
      : battingHand === "RHB"
        ? "Right-hand bat"
        : null;
  const bowlingLabel = bowlingStyle
    ? bowlingStyle
    : bowlingKind === "spin"
      ? "Spin"
      : bowlingKind === "pace"
        ? "Pace"
        : null;
  const span =
    lastSeason >= firstSeason ? `${firstSeason}–${lastSeason}` : `${firstSeason}`;
  const isKeeper = role === "Wicket-keeper";
  const showBat = role === "Batter" || role === "All-rounder" || isKeeper;
  const showBowl = showBowling;
  return (
    <div
      className="rounded-[10px] border border-ipl-line bg-ipl-surface px-4 py-3.5 flex items-center gap-4"
      style={{
        background: `linear-gradient(90deg, ${color}10 0%, var(--color-ipl-surface) 35%)`,
      }}
    >
      <div
        className="w-[68px] h-[68px] rounded-full flex items-center justify-center font-mono font-bold text-[24px] shrink-0"
        style={{ background: `${color}22`, color }}
      >
        {initials(displayName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.1em] font-semibold" style={{ color }}>
          {roleLabel(role)}
        </div>
        <div className="text-[30px] font-semibold tracking-[-0.6px] leading-[1.05] text-ipl-ink mt-0.5">
          {displayName}
        </div>
        <div className="text-[12px] text-ipl-sub mt-1 flex items-center gap-2 font-mono">
          <span>{span}</span>
          <span className="text-ipl-line">·</span>
          <span>
            {seasons} season{seasons === 1 ? "" : "s"}
          </span>
          <span className="text-ipl-line">·</span>
          <span>{matches} match{matches === 1 ? "" : "es"}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0 items-start">
        {showBat && battingLabel && (
          <RoleRow icon={<BatIcon />} value={battingLabel} color={color} />
        )}
        {showBowl && bowlingLabel && (
          <RoleRow icon={<BallIcon />} value={bowlingLabel} color={color} />
        )}
        {isKeeper && (
          <RoleRow icon={<GloveIcon />} value="Wicket-keeper" color={color} />
        )}
      </div>
    </div>
  );
}

function RoleRow({
  icon,
  value,
  color,
}: {
  icon: React.ReactNode;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span
        className="flex items-center justify-center shrink-0"
        style={{ color }}
      >
        {icon}
      </span>
      <span className="text-[13px] font-semibold text-ipl-ink">{value}</span>
    </div>
  );
}

function BatIcon() {
  // Cricket bat: angled blade + thin handle with grip
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 3.5l5 5-9.5 9.5L5 18l0-5z" fill="currentColor" fillOpacity="0.12" />
      <path d="M14.5 3.5l5 5" />
      <path d="M14.5 3.5l-9.5 9.5L5 18l5 0L19.5 8.5" />
      <path d="M17 6l-9 9" strokeOpacity="0.35" />
      <path d="M5 18l-2 2" />
    </svg>
  );
}

function BallIcon() {
  // Cricket ball: circle + seam stitching
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="8.5" fill="currentColor" fillOpacity="0.12" />
      <path d="M3.5 12 H 20.5" />
      <path d="M6 10.5 l1 1.5 l-1 1.5" strokeWidth="1.2" strokeOpacity="0.7" />
      <path d="M9 10.5 l1 1.5 l-1 1.5" strokeWidth="1.2" strokeOpacity="0.7" />
      <path d="M12 10.5 l1 1.5 l-1 1.5" strokeWidth="1.2" strokeOpacity="0.7" />
      <path d="M15 10.5 l1 1.5 l-1 1.5" strokeWidth="1.2" strokeOpacity="0.7" />
      <path d="M18 10.5 l1 1.5 l-1 1.5" strokeWidth="1.2" strokeOpacity="0.7" />
    </svg>
  );
}

function GloveIcon() {
  // Wicket-keeping glove: rounded mitt with cuff
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M7 10 c0 -2.5 2 -4 5 -4 c3 0 5 1.5 5 4 v6 c0 1.5 -1 2.5 -2.5 2.5 h-5 c-1.5 0 -2.5 -1 -2.5 -2.5 z"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="M9.5 10.5 v -2.5" strokeOpacity="0.7" />
      <path d="M12 10.5 v -3" strokeOpacity="0.7" />
      <path d="M14.5 10.5 v -2.5" strokeOpacity="0.7" />
      <path d="M7 16 h10" strokeOpacity="0.6" />
    </svg>
  );
}

/* ── Teams timeline ──────────────────────────────────────────────────── */

type Stint = { team: string; start: number; end: number; matches: number };

function TeamsTimeline({
  stints,
  first,
  last,
}: {
  stints: Stint[];
  first: number;
  last: number;
}) {
  if (stints.length === 0) return <Empty />;
  const span = Math.max(1, last - first + 1);
  const yearOffset = (yr: number) => ((yr - first) / span) * 100;
  const yearWidth = (yrs: number) => (yrs / span) * 100;

  /* Tick years: start + end of timeline + the year each new stint begins */
  const tickSet = new Set<number>([first, last]);
  for (let i = 1; i < stints.length; i++) tickSet.add(stints[i].start);
  const ticks = Array.from(tickSet).sort((a, b) => a - b);

  return (
    <div>
      {/* Stint bars */}
      <div
        className="relative h-[52px] rounded-[6px] overflow-hidden"
        style={{ background: "var(--color-ipl-bg)" }}
      >
        {stints.map((s, i) => {
          const c = teamColor(s.team);
          const ink = teamInk(s.team);
          // Render each band edge-to-edge with its neighbor: extend forward
          // until the next stint starts (or the timeline end for the last
          // stint). Gap years — seasons the player didn't appear in — get
          // absorbed into the preceding team's band so the strip stays
          // continuous. The legend below still shows actual years played.
          const nextStart = i + 1 < stints.length ? stints[i + 1].start : last + 1;
          const startPct = yearOffset(s.start);
          const widthPct = yearWidth(nextStart - s.start);
          const showLogo = widthPct >= 4;
          const showName = widthPct >= 14;
          return (
            <div
              key={`${s.team}-${s.start}`}
              className="absolute top-0 bottom-0 flex items-center gap-2 px-2"
              style={{
                left: `${startPct}%`,
                width: `${widthPct}%`,
                background: c,
                color: ink,
                borderRight: "1px solid var(--color-ipl-surface)",
              }}
              title={`${s.team} · ${s.start}${s.end > s.start ? `–${s.end}` : ""} · ${s.matches} matches`}
            >
              {showLogo && (
                <span
                  className="flex items-center justify-center rounded-full shrink-0"
                  style={{
                    width: 32,
                    height: 32,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                  }}
                >
                  <TeamBadge team={s.team} size={26} />
                </span>
              )}
              {showName && (
                <span className="text-[12px] font-semibold tracking-[-0.01em] truncate">
                  {teamShort(s.team)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Year axis — tick at the LEFT edge of each tick year; first anchored
          left, last anchored right at 100% so 2008..N spans flush corner to
          corner. */}
      <div className="relative h-[14px] mt-1.5">
        {ticks.map((yr, i) => {
          const isFirst = i === 0;
          const isLast = i === ticks.length - 1;
          const leftPct = isLast ? 100 : yearOffset(yr);
          const transform = isFirst
            ? "translateX(0)"
            : isLast
              ? "translateX(-100%)"
              : "translateX(-50%)";
          return (
            <span
              key={yr}
              className="absolute top-0 text-[10px] font-mono text-ipl-sub"
              style={{ left: `${leftPct}%`, transform }}
            >
              {yr}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ── Batting / bowling stat panels ───────────────────────────────────── */

function BattingStats({
  bat,
  seasons,
  matches,
  oc,
  peak,
  color,
  filtered,
  windowLabel,
}: {
  bat: BatTotals | null;
  seasons: CareerSeasonBat[];
  matches: number;
  oc: OcRow[];
  peak: CareerSeasonBat | null;
  color: string;
  filtered: boolean;
  windowLabel: string;
}) {
  const didNotBat = filtered && (!bat || bat.innings === 0);
  if (didNotBat) {
    return (
      <div className="text-ipl-sub text-sm">
        Did not bat in {windowLabel}.
      </div>
    );
  }
  if (!bat || !(bat.runs > 0)) return <Empty />;
  return (
    <div className="flex flex-col gap-3">
      <HeroMetric
        label="Runs"
        value={bat.runs.toLocaleString()}
        sub={`${matches} match${matches === 1 ? "" : "es"} · ${seasons.length} season${seasons.length === 1 ? "" : "s"}`}
        color={color}
      />

      <RateRow
        items={[
          {
            label: "Average",
            value: bat.avg != null ? bat.avg.toFixed(1) : "—",
            sub: `${bat.balls.toLocaleString()} balls`,
          },
          {
            label: "Strike rate",
            value: bat.sr != null ? bat.sr.toFixed(1) : "—",
            sub: `${bat.innings} inn · ${bat.outs} out`,
          },
          {
            label: "High score",
            value: bat.hs.toLocaleString(),
            sub: peak ? `Peak season ${peak.season}` : null,
          },
        ]}
        color={color}
      />

      <MilestonesStrip color={color}>
        <MilestoneTile
          label="50s · 100s"
          value={`${bat.fifties} · ${bat.hundreds}`}
        />
        <MilestoneTile
          label="4s · 6s"
          value={`${bat.fours.toLocaleString()} · ${bat.sixes.toLocaleString()}`}
        />
        <MilestoneTile
          label="Orange caps"
          value={`${oc.length}×`}
          sub={
            oc.length > 0
              ? oc.map((r) => `'${String(r.season).slice(2)}`).join(" · ")
              : "none"
          }
        />
      </MilestonesStrip>
    </div>
  );
}

function BowlingStats({
  bowl,
  seasons,
  color,
  filtered,
  windowLabel,
}: {
  bowl: BowlTotals | null;
  seasons: CareerSeasonBowl[];
  color: string;
  filtered: boolean;
  windowLabel: string;
}) {
  // When the user has narrowed to a window and the player has nothing in
  // bowling_scorecard for it, surface that explicitly rather than the older
  // "Hasn't taken a wicket" copy — they didn't bowl at all here.
  if (filtered && (!bowl || seasons.length === 0)) {
    return (
      <div className="text-ipl-sub text-sm">
        Did not bowl in {windowLabel}.
      </div>
    );
  }
  if (!bowl || !(bowl.wickets > 0))
    return (
      <div className="text-ipl-sub text-sm">
        Hasn&apos;t taken a wicket{seasons.length === 0 ? "" : " in this window"}.
      </div>
    );
  const oversWhole = Math.floor(bowl.overs);
  const oversBall = Math.round((bowl.overs - oversWhole) * 6);
  const peak = seasons.length
    ? seasons.reduce((p, c) => (c.wickets > p.wickets ? c : p), seasons[0])
    : null;
  return (
    <div className="flex flex-col gap-3">
      <HeroMetric
        label="Wickets"
        value={bowl.wickets.toLocaleString()}
        sub={`${oversWhole}.${oversBall} overs · ${bowl.runs.toLocaleString()} runs conceded`}
        color={color}
      />

      <RateRow
        items={[
          {
            label: "Average",
            value: bowl.avg != null ? bowl.avg.toFixed(1) : "—",
            sub: "runs / wkt",
          },
          {
            label: "Economy",
            value: bowl.econ != null ? bowl.econ.toFixed(2) : "—",
            sub: "runs / over",
          },
          {
            label: "Strike rate",
            value: bowl.sr != null ? bowl.sr.toFixed(1) : "—",
            sub: "balls / wkt",
          },
        ]}
        color={color}
      />

      <MilestonesStrip color={color}>
        <MilestoneTile
          label="Overs"
          value={`${oversWhole}.${oversBall}`}
        />
        <MilestoneTile
          label="Runs conceded"
          value={bowl.runs.toLocaleString()}
        />
        <MilestoneTile
          label="Best season"
          value={peak ? `${peak.wickets} wkts` : "—"}
          sub={peak ? String(peak.season) : null}
        />
      </MilestonesStrip>
    </div>
  );
}

/* ── Hero + sparkline + milestones primitives ────────────────────────── */

function HeroMetric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div
      className="rounded-[8px] px-4 py-3"
      style={{
        background: `linear-gradient(90deg, ${color}14 0%, ${color}06 100%)`,
        border: `1px solid ${color}22`,
      }}
    >
      <div
        className="text-[10px] uppercase font-semibold tracking-[0.1em]"
        style={{ color }}
      >
        {label}
      </div>
      <div className="font-mono font-bold leading-none mt-1 text-ipl-ink tracking-[-0.025em] text-[44px]">
        {value}
      </div>
      <div className="text-[11px] text-ipl-sub mt-1.5 font-mono">{sub}</div>
    </div>
  );
}

function RateRow({
  items,
  color,
}: {
  items: Array<{ label: string; value: string; sub: string | null }>;
  color: string;
}) {
  return (
    <div
      className="grid grid-cols-3 rounded-[6px] overflow-hidden"
      style={{ border: `1px solid ${color}1a` }}
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          className={
            "px-3 py-2.5 " +
            (i > 0 ? "border-l " : "")
          }
          style={i > 0 ? { borderColor: `${color}1a` } : undefined}
        >
          <div className="text-[10px] uppercase font-semibold tracking-[0.08em] text-ipl-sub">
            {it.label}
          </div>
          <div className="font-mono font-semibold text-[24px] leading-none mt-1 text-ipl-ink tracking-[-0.02em]">
            {it.value}
          </div>
          {it.sub && (
            <div className="text-[10px] text-ipl-sub mt-1 font-mono truncate">
              {it.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MilestonesStrip({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="text-[9px] uppercase font-semibold tracking-[0.12em] mb-1.5"
        style={{ color: `${color}` }}
      >
        Milestones
      </div>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

function MilestoneTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div
      className="rounded-[6px] px-2.5 py-2 bg-ipl-bg"
      style={{ border: "1px solid var(--color-ipl-line2)" }}
    >
      <div className="text-[9px] uppercase font-semibold tracking-[0.08em] text-ipl-sub">
        {label}
      </div>
      <div className="font-mono font-bold text-[15px] leading-tight mt-0.5 text-ipl-ink tracking-[-0.01em]">
        {value}
      </div>
      {sub && (
        <div className="text-[9px] text-ipl-sub mt-0.5 font-mono truncate">
          {sub}
        </div>
      )}
    </div>
  );
}


/* ── Career arc + season table ────────────────────────────────────────── */

function CareerArc({
  seasons,
  stints,
}: {
  seasons: CareerSeasonBat[];
  stints: TeamStintRow[];
}) {
  if (seasons.length === 0) return <Empty />;
  /* Pick a single team per season — the franchise the player turned out for
     in the most matches that year. Handles mid-season trades by tinting the
     bar with the dominant team. */
  const teamBySeason = new Map<number, string>();
  const matchesBySeasonTeam = new Map<number, Map<string, number>>();
  for (const s of stints) {
    if (!matchesBySeasonTeam.has(s.season)) matchesBySeasonTeam.set(s.season, new Map());
    const m = matchesBySeasonTeam.get(s.season)!;
    m.set(s.team, (m.get(s.team) ?? 0) + s.matches);
  }
  for (const [season, m] of matchesBySeasonTeam) {
    let best: string | null = null;
    let bestCount = -1;
    for (const [team, count] of m) {
      if (count > bestCount) {
        best = team;
        bestCount = count;
      }
    }
    if (best) teamBySeason.set(season, best);
  }
  const data = seasons.map((s) => ({
    season: s.season,
    runs: s.runs,
    color: teamBySeason.has(s.season) ? teamColor(teamBySeason.get(s.season)!) : undefined,
  }));
  return <CareerChart data={data} />;
}

function SeasonTable({ seasons }: { seasons: CareerSeasonBat[] }) {
  if (seasons.length === 0) return <Empty />;
  const reversed = [...seasons].reverse();
  const headers = ["Yr", "Mat", "Inns", "NO", "Runs", "HS", "Ave", "BF", "SR", "100s", "50s", "4s", "6s"];
  return (
    <div className="max-h-[260px] overflow-x-auto overflow-y-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead className="sticky top-0 bg-ipl-surface">
          <tr className="text-ipl-sub">
            {headers.map((h, i) => (
              <th
                key={h}
                className={
                  "px-2 py-2 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line " +
                  (i ? "text-right" : "text-left")
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reversed.map((r) => {
            const notOuts = r.innings - r.outs;
            return (
              <tr key={r.season} className="border-b border-ipl-line2 last:border-b-0">
                <td className="px-2 py-1.5 font-mono text-ipl-sub">{r.season}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.matches}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.innings}</td>
                <td className="px-2 py-1.5 font-mono text-right">{notOuts}</td>
                <td className="px-2 py-1.5 font-mono text-right font-bold text-ipl-ink">
                  {r.runs.toLocaleString()}
                </td>
                <td className="px-2 py-1.5 font-mono text-right">
                  {r.hs}
                  {r.hs_not_out ? "*" : ""}
                </td>
                <td className="px-2 py-1.5 font-mono text-right">{r.avg != null ? r.avg.toFixed(1) : "—"}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.balls.toLocaleString()}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.sr != null ? r.sr.toFixed(1) : "—"}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.hundreds}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.fifties}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.fours}</td>
                <td className="px-2 py-1.5 font-mono text-right">{r.sixes}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Skill radar ──────────────────────────────────────────────────────── */

function SkillRadar({
  rows,
  color,
  name,
}: {
  rows: SkillRow[];
  color: string;
  name: string;
}) {
  // Normalize each SR to [0, 1] using 200 as the cap (a 200 SR axis maxes out
  // at the outer edge). Axes with too few balls (< 30) are hard-zeroed so noise
  // doesn't dominate the polygon shape.
  const SR_CAP = 200;
  const axesKeys = ["pace", "spin", "pp", "mid", "death"] as const;
  const lookup = (k: string) => rows.find((x) => x.metric === k);
  const series: RadarSeries[] = [
    {
      name,
      color,
      values: axesKeys.map((k) => {
        const r = lookup(k);
        if (!r || r.balls < 30) return 0;
        return Math.max(0, Math.min(1, r.value / SR_CAP));
      }),
      displayValues: axesKeys.map((k) => {
        const r = lookup(k);
        if (!r || r.balls < 30) return null;
        return r.value.toFixed(1);
      }),
      samples: axesKeys.map((k) => lookup(k)?.balls ?? 0),
    },
  ];
  if (rows.length === 0) return <Empty />;
  return (
    <div className="flex justify-center">
      <RadarChart
        axes={[
          { label: "Pace" },
          { label: "Spin" },
          { label: "PP" },
          { label: "Mid" },
          { label: "Death" },
        ]}
        series={series}
        ticks={[
          { value: 0.25, label: "50" },
          { value: 0.5, label: "100" },
          { value: 0.75, label: "150" },
          { value: 1, label: "200" },
        ]}
        scaleLabel="strike rate"
        width={240}
        height={240}
      />
    </div>
  );
}

/* ── Matchups vs notable bowlers ─────────────────────────────────────── */

function MatchupsTable({ rows }: { rows: MatchupRow[] }) {
  const { resolve } = usePlayerNames();
  // Rate-based sections gate on ≥18 legal balls so 1-over flukes don't top
  // the SR ranking. The dismissals section uses the full ≥6-ball pool because
  // wicket count is meaningful even on smaller samples. All three sections
  // always render — short rows are padded so the card preserves its layout
  // even when the eligible pool is small.
  const rateEligible = rows.filter((r) => r.balls >= 18);
  const bySr = [...rateEligible].sort(
    (a, b) => (b.sr ?? -Infinity) - (a.sr ?? -Infinity),
  );
  const best = bySr.slice(0, 3);
  const bestKeys = new Set(best.map((r) => r.bowler));
  const worst = bySr
    .slice()
    .reverse()
    .filter((r) => !bestKeys.has(r.bowler))
    .slice(0, 3);
  const mostOuts = [...rows]
    .filter((r) => r.outs > 0)
    .sort((a, b) => b.outs - a.outs || a.balls - b.balls)
    .slice(0, 3);
  return (
    <div className="flex flex-col gap-3">
      <MatchupSection label="Best" tone="pos" rows={best} resolve={resolve} />
      <MatchupSection label="Worst" tone="neg" rows={worst} resolve={resolve} />
      <MatchupSection
        label="Most dismissals"
        tone="neg"
        rows={mostOuts}
        resolve={resolve}
      />
    </div>
  );
}

function MatchupSection({
  label,
  tone,
  rows,
  resolve,
}: {
  label: string;
  tone: "pos" | "neg";
  rows: MatchupRow[];
  resolve: (raw: string) => string;
}) {
  // Pad to 3 rows so every section keeps the same height regardless of how
  // many matchups qualified. Padded rows render an em-dash placeholder.
  const padded: (MatchupRow | null)[] = [...rows];
  while (padded.length < 3) padded.push(null);
  return (
    <div>
      <div
        className={
          "text-[9px] uppercase tracking-[0.08em] font-semibold mb-1 " +
          (tone === "pos" ? "text-ipl-pos" : "text-ipl-neg")
        }
      >
        {label}
      </div>
      <table className="w-full text-[11px] border-collapse table-fixed">
        <colgroup>
          <col />
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-24" />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="text-ipl-sub">
            {["Bowler", "Balls", "Runs", "SR", "Out"].map((h, i) => (
              <th
                key={h}
                className={
                  "px-1 py-1 text-[9px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line2 " +
                  (i === 0 ? "text-left" : "text-right")
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padded.map((r, idx) =>
            r === null ? (
              <tr
                key={`empty-${idx}`}
                className="border-b border-ipl-line2 last:border-b-0"
              >
                <td className="px-1 py-1.5 text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
              </tr>
            ) : (
              <tr key={r.bowler} className="border-b border-ipl-line2 last:border-b-0">
                <td className="px-1 py-1.5 font-semibold text-ipl-ink truncate">
                  <PlayerLink name={r.bowler} className="hover:text-ipl-accent">
                    {resolve(r.bowler)}
                  </PlayerLink>
                </td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-sub">
                  {r.balls}
                </td>
                <td className="px-1 py-1.5 font-mono text-right font-semibold">
                  {r.runs}
                </td>
                <td
                  className={
                    "px-1 py-1.5 font-mono text-right " +
                    (tone === "pos" ? "text-ipl-pos" : "text-ipl-sub")
                  }
                >
                  {r.sr != null ? r.sr.toFixed(1) : "—"}
                </td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-neg">
                  {r.outs}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Venues ───────────────────────────────────────────────────────────── */

function VenuesList({ rows, color }: { rows: VenueRow[]; color: string }) {
  if (rows.length === 0) return <Empty />;
  const max = Math.max(...rows.map((r) => r.runs), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((v) => (
        <div key={v.venue} className="flex items-center gap-2 text-[11px]">
          <span className="flex-1 truncate" title={v.venue}>
            {shortenVenue(v.venue)}
          </span>
          <div className="w-[70px] h-[5px] bg-ipl-line2 rounded-sm">
            <div
              className="h-full rounded-sm"
              style={{ width: `${(v.runs / max) * 100}%`, background: color }}
            />
          </div>
          <span className="font-mono w-11 text-right font-semibold">
            {v.runs.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Career dismissals ────────────────────────────────────────────────── */

function CareerDismissals({
  rows,
  color,
}: {
  rows: DismissalRaw[];
  color: string;
}) {
  if (rows.length === 0) return <Empty />;
  const total = rows.reduce((s, r) => s + r.n, 0);
  const top = rows[0];
  const pct = total > 0 ? Math.round((top.n / total) * 100) : 0;
  const data: DismissalRow[] = rows.map((r) => ({
    kind: titleCase(r.wicket_kind),
    n: r.n,
  }));
  return (
    <>
      <DismissalBar rows={data} color={color} />
      <div className="mt-auto pt-2.5">
        <div
          className="text-[11px] text-ipl-sub p-2 rounded-md"
          style={{ background: "var(--color-ipl-bg)" }}
        >
          {total} career dismissals ·{" "}
          <span className="font-mono text-ipl-ink font-semibold">
            {pct}% {titleCase(top.wicket_kind).toLowerCase()}
          </span>
        </div>
      </div>
    </>
  );
}

/* ── Boundaries split ────────────────────────────────────────────────── */

function BoundariesCard({
  fours,
  sixes,
  color,
}: {
  fours: number;
  sixes: number;
  color: string;
}) {
  const total = fours + sixes;
  if (total === 0) return <Empty />;
  const fPct = (fours / total) * 100;
  return (
    <>
      <div className="grid grid-cols-2 gap-3.5">
        <Stat label="Career fours" value={fours.toLocaleString()} />
        <Stat label="Career sixes" value={sixes.toLocaleString()} />
      </div>
      <div className="mt-auto pt-3">
        <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold mb-1">
          Boundary mix
        </div>
        <div className="h-3 bg-ipl-line2 rounded-sm overflow-hidden flex">
          <div style={{ width: `${fPct}%`, background: color }} />
          <div
            style={{
              width: `${100 - fPct}%`,
              background: "var(--color-ipl-neg)",
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-ipl-sub mt-1 font-mono">
          <span>4s {Math.round(fPct)}%</span>
          <span>6s {Math.round(100 - fPct)}%</span>
        </div>
      </div>
    </>
  );
}

/* ── Bowling milestones (dot %, 4-fers, maidens) ─────────────────────── */

function BowlMilestonesCard({
  dots,
  legalBalls,
  fourWkts,
  maidens,
  color,
}: {
  dots: number;
  legalBalls: number;
  fourWkts: number;
  maidens: number;
  color: string;
}) {
  if (legalBalls === 0) return <Empty />;
  const dotPct = (dots / legalBalls) * 100;
  const scoringPct = 100 - dotPct;
  return (
    <>
      <div className="grid grid-cols-2 gap-3.5">
        <Stat
          label="4-wkt hauls"
          value={fourWkts.toLocaleString()}
          sub="4 or more in an inning"
        />
        <Stat
          label="Maidens"
          value={maidens.toLocaleString()}
          sub={maidens === 1 ? "career over" : "career overs"}
        />
      </div>
      <div className="mt-auto pt-3">
        <div className="text-[10px] uppercase tracking-[0.08em] text-ipl-sub font-semibold mb-1">
          Dot ball share
        </div>
        <div
          className="h-3 bg-ipl-line2 rounded-sm overflow-hidden flex"
          title={`${dots.toLocaleString()} dot balls of ${legalBalls.toLocaleString()} legal deliveries`}
        >
          <div style={{ width: `${dotPct}%`, background: color }} />
          <div
            style={{
              width: `${scoringPct}%`,
              background: "var(--color-ipl-line2)",
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-ipl-sub mt-1 font-mono">
          <span>Dots {dotPct.toFixed(1)}%</span>
          <span>Scoring {scoringPct.toFixed(1)}%</span>
        </div>
      </div>
    </>
  );
}

/* ── Bowling-side analogs ────────────────────────────────────────────── */

function BowlCareerArc({
  seasons,
  stints,
}: {
  seasons: CareerSeasonBowl[];
  stints: TeamStintRow[];
}) {
  if (seasons.length === 0) return <Empty />;
  const teamBySeason = new Map<number, string>();
  const matchesBySeasonTeam = new Map<number, Map<string, number>>();
  for (const s of stints) {
    if (!matchesBySeasonTeam.has(s.season)) matchesBySeasonTeam.set(s.season, new Map());
    const m = matchesBySeasonTeam.get(s.season)!;
    m.set(s.team, (m.get(s.team) ?? 0) + s.matches);
  }
  for (const [season, m] of matchesBySeasonTeam) {
    let best: string | null = null;
    let bestCount = -1;
    for (const [team, count] of m) {
      if (count > bestCount) {
        best = team;
        bestCount = count;
      }
    }
    if (best) teamBySeason.set(season, best);
  }
  // CareerChart reads a `runs` field; we feed wickets into that slot since
  // the chart is metric-agnostic (just renders bars + a peak label).
  const data = seasons.map((s) => ({
    season: s.season,
    runs: s.wickets,
    color: teamBySeason.has(s.season) ? teamColor(teamBySeason.get(s.season)!) : undefined,
  }));
  return <CareerChart data={data} />;
}

function BowlSeasonTable({ seasons }: { seasons: CareerSeasonBowl[] }) {
  if (seasons.length === 0) return <Empty />;
  const reversed = [...seasons].reverse();
  const headers = ["Yr", "Mat", "Inns", "Ov", "Mdn", "Runs", "Wkts", "BBI", "Ave", "Econ", "SR", "4w", "5w"];
  return (
    <div className="max-h-[260px] overflow-x-auto overflow-y-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead className="sticky top-0 bg-ipl-surface">
          <tr className="text-ipl-sub">
            {headers.map((h, i) => (
              <th
                key={h}
                className={
                  "px-2 py-2 text-[10px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line " +
                  (i ? "text-right" : "text-left")
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reversed.map((r) => (
            <tr key={r.season} className="border-b border-ipl-line2 last:border-b-0">
              <td className="px-2 py-1.5 font-mono text-ipl-sub">{r.season}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.matches}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.innings}</td>
              <td className="px-2 py-1.5 font-mono text-right">{formatOvers(r.overs)}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.maidens}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.runs.toLocaleString()}</td>
              <td className="px-2 py-1.5 font-mono text-right font-bold text-ipl-ink">
                {r.wickets}
              </td>
              <td className="px-2 py-1.5 font-mono text-right">
                {r.bbi_r != null ? `${r.bbi_w}/${r.bbi_r}` : "—"}
              </td>
              <td className="px-2 py-1.5 font-mono text-right">{r.avg != null ? r.avg.toFixed(1) : "—"}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.econ != null ? r.econ.toFixed(2) : "—"}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.sr != null ? r.sr.toFixed(1) : "—"}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.four_w}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.five_w}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BowlSkillRadar({
  rows,
  color,
  name,
}: {
  rows: SkillRow[];
  color: string;
  name: string;
}) {
  // Economy lives on a "lower is better" scale. Map econ ∈ [4, 13] onto
  // [1.0, 0.0] so the polygon grows for bowlers who keep runs down. Below
  // 30 legal balls on an axis we hard-zero to avoid noisy single-over
  // distortions.
  const axesKeys = ["lhb", "rhb", "pp", "mid", "death"] as const;
  const lookup = (k: string) => rows.find((x) => x.metric === k);
  const series: RadarSeries[] = [
    {
      name,
      color,
      values: axesKeys.map((k) => {
        const r = lookup(k);
        if (!r || r.balls < 30) return 0;
        return Math.max(0, Math.min(1, (13 - r.value) / 9));
      }),
      displayValues: axesKeys.map((k) => {
        const r = lookup(k);
        if (!r || r.balls < 30) return null;
        return r.value.toFixed(2);
      }),
      samples: axesKeys.map((k) => lookup(k)?.balls ?? 0),
    },
  ];
  if (rows.length === 0) return <Empty />;
  return (
    <div className="flex justify-center">
      <RadarChart
        axes={[
          { label: "vs LHB" },
          { label: "vs RHB" },
          { label: "PP" },
          { label: "Mid" },
          { label: "Death" },
        ]}
        series={series}
        // Tick labels map normalized radius back to economy. Outer = best
        // (low econ), inner = worse (high econ); the caption makes that clear.
        ticks={[
          { value: 0.11, label: "12" },
          { value: 0.33, label: "10" },
          { value: 0.56, label: "8" },
          { value: 0.78, label: "6" },
          { value: 1, label: "4" },
        ]}
        scaleLabel="economy"
        width={240}
        height={240}
      />
    </div>
  );
}

function BowlMatchupsTable({ rows }: { rows: BatterMatchupRow[] }) {
  const { resolve } = usePlayerNames();
  // Rate-based sections gate on ≥18 legal balls so a 6-ball cameo can't top
  // the econ ranking. Wickets section uses the full ≥6-ball pool because
  // dismissal counts hold meaning even on smaller samples. All three sections
  // always render and short rows are padded so the card height is consistent.
  const rateEligible = rows.filter((r) => r.balls >= 18);
  const byEcon = [...rateEligible].sort(
    (a, b) => (a.econ ?? Infinity) - (b.econ ?? Infinity),
  );
  const best = byEcon.slice(0, 3);
  const bestKeys = new Set(best.map((r) => r.batter));
  const worst = byEcon
    .slice()
    .reverse()
    .filter((r) => !bestKeys.has(r.batter))
    .slice(0, 3);
  const mostWickets = [...rows]
    .filter((r) => r.wickets > 0)
    .sort((a, b) => b.wickets - a.wickets || a.balls - b.balls)
    .slice(0, 3);
  return (
    <div className="flex flex-col gap-3">
      <BowlMatchupSection label="Best" tone="pos" rows={best} resolve={resolve} />
      <BowlMatchupSection label="Worst" tone="neg" rows={worst} resolve={resolve} />
      <BowlMatchupSection
        label="Most wickets"
        tone="pos"
        rows={mostWickets}
        resolve={resolve}
      />
    </div>
  );
}

function BowlMatchupSection({
  label,
  tone,
  rows,
  resolve,
}: {
  label: string;
  tone: "pos" | "neg";
  rows: BatterMatchupRow[];
  resolve: (raw: string) => string;
}) {
  const padded: (BatterMatchupRow | null)[] = [...rows];
  while (padded.length < 3) padded.push(null);
  return (
    <div>
      <div
        className={
          "text-[9px] uppercase tracking-[0.08em] font-semibold mb-1 " +
          (tone === "pos" ? "text-ipl-pos" : "text-ipl-neg")
        }
      >
        {label}
      </div>
      <table className="w-full text-[11px] border-collapse table-fixed">
        <colgroup>
          <col />
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-24" />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="text-ipl-sub">
            {["Batter", "Balls", "Runs", "Econ", "Wkts"].map((h, i) => (
              <th
                key={h}
                className={
                  "px-1 py-1 text-[9px] uppercase tracking-[0.06em] font-medium border-b border-ipl-line2 " +
                  (i === 0 ? "text-left" : "text-right")
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padded.map((r, idx) =>
            r === null ? (
              <tr
                key={`empty-${idx}`}
                className="border-b border-ipl-line2 last:border-b-0"
              >
                <td className="px-1 py-1.5 text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-soft">—</td>
              </tr>
            ) : (
              <tr key={r.batter} className="border-b border-ipl-line2 last:border-b-0">
                <td className="px-1 py-1.5 font-semibold text-ipl-ink truncate">
                  <PlayerLink name={r.batter} className="hover:text-ipl-accent">
                    {resolve(r.batter)}
                  </PlayerLink>
                </td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-sub">
                  {r.balls}
                </td>
                <td className="px-1 py-1.5 font-mono text-right font-semibold">
                  {r.runs}
                </td>
                <td
                  className={
                    "px-1 py-1.5 font-mono text-right " +
                    (tone === "pos" ? "text-ipl-pos" : "text-ipl-sub")
                  }
                >
                  {r.econ != null ? r.econ.toFixed(2) : "—"}
                </td>
                <td className="px-1 py-1.5 font-mono text-right text-ipl-pos">
                  {r.wickets}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function BowlVenuesList({
  rows,
  color,
}: {
  rows: BowlVenueRow[];
  color: string;
}) {
  if (rows.length === 0) return <Empty />;
  const max = Math.max(...rows.map((r) => r.wickets), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((v) => (
        <div key={v.venue} className="flex items-center gap-2 text-[11px]">
          <span className="flex-1 truncate" title={v.venue}>
            {shortenVenue(v.venue)}
          </span>
          <div className="w-[70px] h-[5px] bg-ipl-line2 rounded-sm">
            <div
              className="h-full rounded-sm"
              style={{ width: `${(v.wickets / max) * 100}%`, background: color }}
            />
          </div>
          <span className="font-mono w-7 text-right font-semibold">{v.wickets}</span>
          <span className="font-mono w-10 text-right text-ipl-sub">
            {v.econ != null ? v.econ.toFixed(1) : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function WicketTypesDonut({
  rows,
  color,
}: {
  rows: WicketTypeRow[];
  color: string;
}) {
  if (rows.length === 0) return <Empty />;
  const total = rows.reduce((s, r) => s + r.n, 0);
  const top = rows[0];
  const pct = total > 0 ? Math.round((top.n / total) * 100) : 0;
  const data: DismissalRow[] = rows.map((r) => ({
    kind: titleCase(r.wicket_kind),
    n: r.n,
  }));
  return (
    <>
      <DismissalBar rows={data} color={color} />
      <div className="mt-auto pt-2.5">
        <div
          className="text-[11px] text-ipl-sub p-2 rounded-md"
          style={{ background: "var(--color-ipl-bg)" }}
        >
          {total} career wickets ·{" "}
          <span className="font-mono text-ipl-ink font-semibold">
            {pct}% {titleCase(top.wicket_kind).toLowerCase()}
          </span>
        </div>
      </div>
    </>
  );
}

function formatOvers(decimal: number): string {
  // Overs are stored as float carrying balls in the fractional ⅙ slot
  // (e.g. 5.166666 → 5.1 = "5 overs, 1 ball"). Convert back for display.
  const whole = Math.floor(decimal);
  const balls = Math.round((decimal - whole) * 6);
  return balls === 0 ? `${whole}` : `${whole}.${balls}`;
}

/* ── Filter bar ───────────────────────────────────────────────────────── */

function PlayerFilters({
  stints,
  activeSeasons,
  filter,
  setFilter,
}: {
  stints: TeamStintRow[];
  activeSeasons: Set<number> | null;
  filter: Filter;
  setFilter: React.Dispatch<React.SetStateAction<Filter>>;
}) {
  /* Dedupe the team list (a player may rejoin the same franchise across
     years). Order matches first-appearance from the stints query, which
     itself is season-ascending. We keep the most-recent display name for each
     canonical franchise so "Royal Challengers Bengaluru" supersedes the older
     Bangalore spelling. */
  const teamOptions = useMemo(() => {
    const latestName = new Map<string, string>();
    const order: string[] = [];
    for (const s of stints) {
      const c = canonicalTeam(s.team);
      if (!latestName.has(c)) order.push(c);
      latestName.set(c, s.team);
    }
    return order.map((c) => latestName.get(c)!);
  }, [stints]);

  /* canonical-team → sorted unique seasons the player turned out for. */
  const yearsByTeam = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const s of stints) {
      const c = canonicalTeam(s.team);
      if (!m.has(c)) m.set(c, new Set());
      m.get(c)!.add(s.season);
    }
    return m;
  }, [stints]);

  /* season → canonical-teams the player was on that year. Used to auto-pick
     a team when a year is selected and that year is unambiguous. */
  const teamsByYear = useMemo(() => {
    const m = new Map<number, Set<string>>();
    for (const s of stints) {
      if (!m.has(s.season)) m.set(s.season, new Set());
      m.get(s.season)!.add(canonicalTeam(s.team));
    }
    return m;
  }, [stints]);

  /* The year-dropdown list. Restricted to the selected team's seasons when a
     team is active; otherwise every season the player ever played. Sorted
     newest-first to match the typical "what did they do recently" mental
     model. */
  const yearOptions = useMemo(() => {
    const teamCanon = filter.team ? canonicalTeam(filter.team) : null;
    const set = new Set<number>();
    if (teamCanon) {
      for (const y of yearsByTeam.get(teamCanon) ?? []) set.add(y);
    } else {
      for (const s of stints) set.add(s.season);
    }
    // Drop seasons where the player has neither batting nor bowling rows —
    // these are squad-only appearances that would empty every panel below.
    const filtered = activeSeasons
      ? Array.from(set).filter((y) => activeSeasons.has(y))
      : Array.from(set);
    return filtered.sort((a, b) => b - a);
  }, [stints, filter.team, yearsByTeam, activeSeasons]);

  const isDefault = isDefaultFilter(filter);

  /* Picking a year may auto-select a team (when the year is unambiguous —
     i.e. the player only turned out for one franchise that season). */
  const onYear = (v: string) => {
    const year = v === "" ? null : Number(v);
    setFilter((prev) => {
      const next: Filter = { ...prev, year };
      if (year !== null && prev.team === null) {
        const teams = teamsByYear.get(year);
        if (teams && teams.size === 1) {
          const onlyCanon = teams.values().next().value as string;
          // Map canonical back to a display name from teamOptions so the
          // <select> can find the matching <option value=...>.
          const displayName =
            teamOptions.find((t) => canonicalTeam(t) === onlyCanon) ?? null;
          if (displayName) next.team = displayName;
        }
      }
      return next;
    });
  };

  /* Picking a team narrows the year dropdown. If the currently-selected year
     isn't in the team's seasons, clear it to avoid showing a stale label. */
  const onTeam = (v: string) => {
    const team = v === "" ? null : v;
    setFilter((prev) => {
      const next: Filter = { ...prev, team };
      if (team !== null && prev.year !== null) {
        const allowed = yearsByTeam.get(canonicalTeam(team));
        if (!allowed || !allowed.has(prev.year)) next.year = null;
      }
      return next;
    });
  };

  const reset = () => setFilter(NO_FILTER);

  return (
    <div className="flex items-center gap-3">
      <FilterField label="Team">
        <select
          className="text-[11px] font-mono bg-ipl-bg border border-ipl-line2 rounded-[4px] px-1.5 py-0.5 text-ipl-ink focus:outline-none focus:border-ipl-accent"
          value={filter.team ?? ""}
          onChange={(e) => onTeam(e.target.value)}
        >
          <option value="">All teams</option>
          {teamOptions.map((t) => (
            <option key={t} value={t}>
              {teamShort(t)}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Year">
        <select
          className="text-[11px] font-mono bg-ipl-bg border border-ipl-line2 rounded-[4px] px-1.5 py-0.5 text-ipl-ink focus:outline-none focus:border-ipl-accent"
          value={filter.year ?? ""}
          onChange={(e) => onYear(e.target.value)}
        >
          <option value="">All years</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </FilterField>

      {!isDefault && (
        <button
          type="button"
          onClick={reset}
          className="text-[10px] font-semibold tracking-[0.02em] text-ipl-accent hover:underline cursor-pointer"
        >
          Reset
        </button>
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase font-semibold tracking-[0.08em] text-ipl-sub">
        {label}
      </span>
      {children}
    </label>
  );
}

function filterLabel(filter: Filter): string {
  if (isDefaultFilter(filter)) return "CAREER";
  const year = filter.year !== null ? String(filter.year) : null;
  const team = filter.team ? teamShort(filter.team) : null;
  if (team && year) return `${team} · ${year}`;
  return team ?? year ?? "CAREER";
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function PageLoader() {
  return (
    <div className="p-12 text-center text-ipl-sub text-sm">Loading player…</div>
  );
}

function NotFound({ name }: { name: string }) {
  return (
    <div className="p-12 text-center">
      <h1 className="text-2xl font-bold text-ipl-ink">Player not found</h1>
      <p className="text-ipl-sub text-sm mt-2">
        No player named <span className="font-mono">{name}</span> in the dataset.
      </p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <pre className="p-3 text-ipl-neg text-xs whitespace-pre-wrap">{message}</pre>
  );
}

function Empty() {
  return <div className="text-ipl-sub text-sm">Not enough data.</div>;
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

type NormalRole = "Batter" | "Bowler" | "All-rounder" | "Wicket-keeper" | "Player";

function normalizeRole(role: string | null): NormalRole {
  if (!role) return "Player";
  const r = role.toLowerCase().trim();
  if (r.includes("keeper") || r === "wk") return "Wicket-keeper";
  if (r === "all-rounder" || r === "allrounder" || r === "all rounder") return "All-rounder";
  if (r === "bowler") return "Bowler";
  if (r === "batter" || r === "batsman" || r === "batsperson") return "Batter";
  return "Player";
}

function roleLabel(role: NormalRole): string {
  return role;
}

function collapseStints(rows: TeamStintRow[]): Stint[] {
  const out: Stint[] = [];
  for (const r of rows) {
    const canon = canonicalTeam(r.team);
    const tail = out[out.length - 1];
    // Merge into the previous stint whenever the team matches, even across
    // missed seasons (e.g. Shane Watson, RR 2008 → no IPL in 2009 → RR
    // 2010–2015 should read as a single RR tenure). A different team in
    // between naturally breaks the chain because it becomes the new tail.
    if (tail && canonicalTeam(tail.team) === canon) {
      tail.end = r.season;
      tail.matches += r.matches;
      // Prefer the most recent franchise name (handles RCB Bangalore → Bengaluru rename)
      tail.team = r.team;
    } else {
      out.push({ team: r.team, start: r.season, end: r.season, matches: r.matches });
    }
  }
  return out;
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function shortenVenue(v: string): string {
  // "M Chinnaswamy Stadium, Bengaluru" → "M Chinnaswamy Stadium". We keep
  // the stadium name (rather than the city) because cities like Mumbai and
  // Delhi host multiple grounds — collapsing them to the city would erase
  // the distinction. The full "Stadium, City" string lives on the hover
  // title attribute set by the caller.
  if (v.includes(",")) return v.split(",")[0].trim();
  return v;
}

