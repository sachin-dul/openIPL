"""
Pre-aggregate per-player rollups for the React dashboard.

The player page used to compute career totals, season-by-season, dismissals,
venues, bowler matchups, and skill profile on the fly from `batting_scorecard`,
`bowling_scorecard`, and (mostly) `ball_by_ball`. Each navigation re-scanned
those parquets in DuckDB-WASM. Pre-computing once per ETL refresh turns those
scans into single-row lookups keyed on `player`.

Inputs (already produced by aggregator.py):
  data/aggregated/batting_scorecard.parquet
  data/aggregated/bowling_scorecard.parquet
  data/aggregated/ball_by_ball.parquet
  data/aggregated/matches.parquet
  data/aggregated/players_meta.parquet  (only used to align bowling_kind)

Outputs:
  player_career_bat.parquet         career batting totals, 1 row / player
  player_career_bowl.parquet        career bowling totals, 1 row / bowler
  player_season_bat.parquet         per (player × season) batting
  player_season_bowl.parquet        per (player × season) bowling
  orange_cap_winners.parquet        top scorer per season, ~19 rows
  player_dismissals.parquet         wicket_kind tallies per batter
  player_wicket_types.parquet       wicket_kind tallies per bowler
  player_venues.parquet             runs + sr per (batter × venue)
  player_bowl_venues.parquet        balls/runs/wkts/econ per (bowler × venue)
  player_bowler_matchups.parquet    per (batter × bowler) totals
  player_batter_matchups.parquet    per (bowler × batter) totals
  player_skill_profile.parquet      pace/spin/pp/mid/death sr per batter
  player_bowl_skill_profile.parquet lhb/rhb/pp/mid/death econ per bowler

NOTE: web/src/lib/db.ts holds the TABLES allow-list of parquets registered as
DuckDB-WASM views. New outputs here must also be added there or the React
queries will silently fail with a missing-view error.

web/public/data is a symlink to data/aggregated, so the Next.js app picks up
the new parquets immediately.

Usage:
    python scripts/build_player_aggregates.py
"""

import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
AGG_DIR = ROOT / "data" / "aggregated"
# Note: web/public/data is a symlink to data/aggregated, so writes here are
# automatically picked up by the Next.js app. No mirror step needed.

WICKET_EXCLUDE = (
    "LOWER(COALESCE(wicket_kind, '')) NOT IN "
    "('run out','retired hurt','retired out','obstructing the field','timed out')"
)


def _src(name: str) -> str:
    """Forward-slash absolute path string for DuckDB's read_parquet()."""
    return str(AGG_DIR / f"{name}.parquet").replace("\\", "/")


def write_table(con: duckdb.DuckDBPyConnection, name: str, sql: str) -> tuple[int, int]:
    out_path = AGG_DIR / f"{name}.parquet"
    out_path.unlink(missing_ok=True)
    con.execute(
        f"COPY ({sql}) TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD)"
    )
    rows = con.execute(f"SELECT COUNT(*) FROM '{out_path}'").fetchone()[0]
    size = out_path.stat().st_size
    return rows, size


def build_career_bat(con):
    return write_table(
        con,
        "player_career_bat",
        f"""
        SELECT
          batter AS player,
          CAST(SUM(runs) AS BIGINT)  AS runs,
          CAST(SUM(balls) AS BIGINT) AS balls,
          CAST(COUNT(*) AS BIGINT)   AS innings,
          CAST(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END) AS BIGINT) AS outs,
          CAST(SUM(CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END) AS BIGINT) AS fifties,
          CAST(SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) AS BIGINT)           AS hundreds,
          CAST(COALESCE(MAX(runs), 0) AS BIGINT) AS hs,
          CAST(SUM(fours) AS BIGINT)             AS fours,
          CAST(SUM(sixes) AS BIGINT)             AS sixes,
          CAST(SUM(runs) AS DOUBLE) /
            NULLIF(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END), 0)
            AS avg,
          100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
        FROM '{_src("batting_scorecard")}'
        WHERE batter IS NOT NULL
        GROUP BY batter
        """,
    )


def build_career_bowl(con):
    # The original page query reconstructed total overs from `overs` decoded as
    # x.y (FLOOR + 10*fractional/6). We replicate it verbatim so econ / SR /
    # avg match what the page used to show. Boundaries conceded join in from
    # ball_by_ball — bowling_scorecard doesn't track 4s/6s allowed.
    return write_table(
        con,
        "player_career_bowl",
        f"""
        WITH agg AS (
          SELECT
            bowler AS player,
            CAST(SUM(wickets) AS BIGINT) AS wickets,
            CAST(SUM(runs) AS BIGINT)    AS runs,
            SUM(FLOOR(overs)) + (SUM(overs - FLOOR(overs)) * 10) / 6 AS overs
          FROM '{_src("bowling_scorecard")}'
          WHERE bowler IS NOT NULL
          GROUP BY bowler
        ),
        bnd AS (
          SELECT
            bowler AS player,
            CAST(SUM(CASE WHEN batter_runs = 4 THEN 1 ELSE 0 END) AS BIGINT) AS fours_conceded,
            CAST(SUM(CASE WHEN batter_runs = 6 THEN 1 ELSE 0 END) AS BIGINT) AS sixes_conceded
          FROM '{_src("ball_by_ball")}'
          WHERE bowler IS NOT NULL
          GROUP BY bowler
        )
        SELECT
          a.player,
          a.wickets,
          a.runs,
          a.overs,
          CASE WHEN a.overs > 0 THEN a.runs / a.overs ELSE NULL END                   AS econ,
          CASE WHEN a.wickets > 0 THEN CAST(a.runs AS DOUBLE) / a.wickets ELSE NULL END AS avg,
          CASE WHEN a.wickets > 0 THEN (a.overs * 6) / a.wickets ELSE NULL END         AS sr,
          COALESCE(b.fours_conceded, 0) AS fours_conceded,
          COALESCE(b.sixes_conceded, 0) AS sixes_conceded
        FROM agg a LEFT JOIN bnd b USING (player)
        """,
    )


def build_season_bat(con):
    return write_table(
        con,
        "player_season_bat",
        f"""
        WITH bs AS (
          SELECT
            batter,
            season,
            match_number,
            runs,
            balls,
            fours,
            sixes,
            dismissal,
            MAX(runs) OVER (PARTITION BY batter, season) AS season_max
          FROM '{_src("batting_scorecard")}'
          WHERE batter IS NOT NULL
        )
        SELECT
          batter AS player,
          CAST(season AS BIGINT) AS season,
          CAST(COUNT(DISTINCT match_number) AS BIGINT) AS matches,
          CAST(SUM(runs) AS BIGINT)  AS runs,
          CAST(MAX(runs) AS BIGINT)  AS hs,
          CAST(MAX(CASE WHEN runs = season_max
                        AND (dismissal IS NULL OR dismissal = 'not out')
                   THEN 1 ELSE 0 END) AS BIGINT) AS hs_not_out,
          CAST(COUNT(*) AS BIGINT)   AS innings,
          CAST(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END) AS BIGINT) AS outs,
          CAST(SUM(balls) AS BIGINT) AS balls,
          CAST(SUM(CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END) AS BIGINT) AS fifties,
          CAST(SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) AS BIGINT) AS hundreds,
          CAST(SUM(fours) AS BIGINT) AS fours,
          CAST(SUM(sixes) AS BIGINT) AS sixes,
          CAST(SUM(runs) AS DOUBLE) /
            NULLIF(SUM(CASE WHEN dismissal IS NULL OR dismissal = 'not out' THEN 0 ELSE 1 END), 0)
            AS avg,
          100.0 * SUM(runs) / NULLIF(SUM(balls), 0) AS sr
        FROM bs
        GROUP BY batter, season
        """,
    )


def build_orange_caps(con):
    # The top scorer per season (handles ties via ROW_NUMBER — only one winner
    # is emitted, matching the prior ocQ behavior).
    return write_table(
        con,
        "orange_cap_winners",
        f"""
        SELECT season, batter, runs
        FROM (
          SELECT
            CAST(season AS BIGINT) AS season,
            batter,
            CAST(SUM(runs) AS BIGINT) AS runs,
            ROW_NUMBER() OVER (PARTITION BY season ORDER BY SUM(runs) DESC) AS rk
          FROM '{_src("batting_scorecard")}'
          WHERE batter IS NOT NULL
          GROUP BY season, batter
        )
        WHERE rk = 1
        """,
    )


def build_dismissals(con):
    return write_table(
        con,
        "player_dismissals",
        f"""
        SELECT
          player_out AS player,
          wicket_kind,
          CAST(COUNT(*) AS BIGINT) AS n
        FROM '{_src("ball_by_ball")}'
        WHERE player_out IS NOT NULL AND wicket_kind IS NOT NULL
        GROUP BY player_out, wicket_kind
        """,
    )


def build_venues(con):
    return write_table(
        con,
        "player_venues",
        f"""
        SELECT
          b.batter AS player,
          m.venue,
          CAST(SUM(b.batter_runs) AS BIGINT) AS runs,
          CAST(SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
          100.0 * SUM(b.batter_runs) /
            NULLIF(SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END), 0) AS sr
        FROM '{_src("ball_by_ball")}' b
        JOIN '{_src("matches")}' m
          ON b.season = m.season AND b.match_number = m.match_number
        WHERE b.batter IS NOT NULL AND m.venue IS NOT NULL
        GROUP BY b.batter, m.venue
        """,
    )


def build_matchups(con):
    return write_table(
        con,
        "player_bowler_matchups",
        f"""
        SELECT
          batter,
          bowler,
          CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
          CAST(SUM(batter_runs) AS BIGINT) AS runs,
          CAST(SUM(CASE WHEN is_wicket AND {WICKET_EXCLUDE} THEN 1 ELSE 0 END) AS BIGINT) AS outs,
          100.0 * SUM(batter_runs) /
            NULLIF(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END), 0) AS sr
        FROM '{_src("ball_by_ball")}'
        WHERE batter IS NOT NULL AND bowler IS NOT NULL
        GROUP BY batter, bowler
        """,
    )


def build_skill_profile(con):
    # Per (batter, axis) where axis ∈ {'pace','spin','pp','mid','death'}.
    # 'pace'/'spin' filter by bowling_kind, the phase axes filter by phase.
    # Output schema: player, axis, runs, balls, sr.
    return write_table(
        con,
        "player_skill_profile",
        f"""
        WITH bbb AS (
          SELECT
            bbb.batter,
            bbb.batter_runs,
            bbb.phase,
            COALESCE(pm.bowling_kind, 'unknown') AS bowling_kind,
            (COALESCE(bbb.wides, 0) = 0 AND COALESCE(bbb.noballs, 0) = 0)::INT AS legal
          FROM '{_src("ball_by_ball")}' bbb
          LEFT JOIN '{_src("players_meta")}' pm
            ON pm.unique_name = bbb.bowler
          WHERE bbb.batter IS NOT NULL
        )
        SELECT player, axis, runs, balls,
               CASE WHEN balls > 0 THEN 100.0 * runs / balls ELSE NULL END AS sr
        FROM (
          SELECT batter AS player, 'pace' AS axis,
                 CAST(SUM(batter_runs) AS BIGINT) AS runs,
                 CAST(SUM(legal) AS BIGINT)       AS balls
          FROM bbb WHERE bowling_kind = 'pace' GROUP BY batter
          UNION ALL
          SELECT batter, 'spin',
                 CAST(SUM(batter_runs) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE bowling_kind = 'spin' GROUP BY batter
          UNION ALL
          SELECT batter, 'pp',
                 CAST(SUM(batter_runs) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE phase = 'powerplay' GROUP BY batter
          UNION ALL
          SELECT batter, 'mid',
                 CAST(SUM(batter_runs) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE phase = 'middle' GROUP BY batter
          UNION ALL
          SELECT batter, 'death',
                 CAST(SUM(batter_runs) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE phase = 'death' GROUP BY batter
        )
        WHERE balls > 0
        """,
    )


def build_season_bowl(con):
    # Per (bowler × season). Overs are stored in cricket x.y notation
    # (4.2 = 4 overs 2 balls); we follow the build_career_bowl pattern and
    # carry the fractional ball-count over via SUM(FLOOR) + balls/6.
    return write_table(
        con,
        "player_season_bowl",
        f"""
        WITH bs AS (
          SELECT
            bowler,
            season,
            match_number,
            overs,
            maidens,
            runs,
            wickets,
            MAX(wickets) OVER (PARTITION BY bowler, season) AS season_max_w
          FROM '{_src("bowling_scorecard")}'
          WHERE bowler IS NOT NULL
        ),
        agg AS (
          SELECT
            bowler AS player,
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
          GROUP BY bowler, season
        )
        SELECT
          player, season, matches, innings, overs, maidens, runs, wickets,
          bbi_w, bbi_r, four_w, five_w,
          CASE WHEN wickets > 0 THEN CAST(runs AS DOUBLE) / wickets ELSE NULL END AS avg,
          CASE WHEN overs > 0   THEN runs / overs                ELSE NULL END AS econ,
          CASE WHEN wickets > 0 THEN (overs * 6) / wickets       ELSE NULL END AS sr
        FROM agg
        """,
    )


def build_wicket_types(con):
    # Bowler-credited dismissals only — run outs / retirements never count
    # against a bowler. WICKET_EXCLUDE keeps this in sync with player_dismissals.
    return write_table(
        con,
        "player_wicket_types",
        f"""
        SELECT
          bowler AS player,
          LOWER(wicket_kind) AS wicket_kind,
          CAST(COUNT(*) AS BIGINT) AS n
        FROM '{_src("ball_by_ball")}'
        WHERE bowler IS NOT NULL AND is_wicket
          AND wicket_kind IS NOT NULL
          AND {WICKET_EXCLUDE}
        GROUP BY bowler, LOWER(wicket_kind)
        """,
    )


def build_bowl_skill_profile(con):
    # Bowler radar: axes = vs LHB / vs RHB / PP / Middle / Death. Metric is
    # economy (runs charged to bowler per over). 'conceded' includes batter
    # runs + wides + noballs; byes/legbyes are not charged to the bowler.
    return write_table(
        con,
        "player_bowl_skill_profile",
        f"""
        WITH bbb AS (
          SELECT
            bbb.bowler,
            (bbb.batter_runs + COALESCE(bbb.wides, 0) + COALESCE(bbb.noballs, 0)) AS conceded,
            (COALESCE(bbb.wides, 0) = 0 AND COALESCE(bbb.noballs, 0) = 0)::INT AS legal,
            bbb.phase,
            COALESCE(pm.batting_hand, 'unknown') AS bat_hand
          FROM '{_src("ball_by_ball")}' bbb
          LEFT JOIN '{_src("players_meta")}' pm
            ON pm.unique_name = bbb.batter
          WHERE bbb.bowler IS NOT NULL
        )
        SELECT player, axis, runs, balls,
               CASE WHEN balls > 0 THEN 6.0 * runs / balls ELSE NULL END AS econ
        FROM (
          SELECT bowler AS player, 'lhb' AS axis,
                 CAST(SUM(conceded) AS BIGINT) AS runs,
                 CAST(SUM(legal)    AS BIGINT) AS balls
          FROM bbb WHERE bat_hand = 'LHB' GROUP BY bowler
          UNION ALL
          SELECT bowler, 'rhb',
                 CAST(SUM(conceded) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE bat_hand = 'RHB' GROUP BY bowler
          UNION ALL
          SELECT bowler, 'pp',
                 CAST(SUM(conceded) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE phase = 'powerplay' GROUP BY bowler
          UNION ALL
          SELECT bowler, 'mid',
                 CAST(SUM(conceded) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE phase = 'middle' GROUP BY bowler
          UNION ALL
          SELECT bowler, 'death',
                 CAST(SUM(conceded) AS BIGINT),
                 CAST(SUM(legal) AS BIGINT)
          FROM bbb WHERE phase = 'death' GROUP BY bowler
        )
        WHERE balls > 0
        """,
    )


def build_batter_matchups(con):
    # Mirror of player_bowler_matchups but keyed on the bowler. 'outs' counts
    # only bowler-credited dismissals.
    return write_table(
        con,
        "player_batter_matchups",
        f"""
        SELECT
          bowler,
          batter,
          CAST(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
          CAST(SUM(batter_runs + COALESCE(wides,0) + COALESCE(noballs,0)) AS BIGINT) AS runs,
          CAST(SUM(CASE WHEN is_wicket AND {WICKET_EXCLUDE} THEN 1 ELSE 0 END) AS BIGINT) AS wickets,
          CASE
            WHEN SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END) > 0
            THEN 6.0 * SUM(batter_runs + COALESCE(wides,0) + COALESCE(noballs,0))
                 / NULLIF(SUM(CASE WHEN COALESCE(wides,0)=0 AND COALESCE(noballs,0)=0 THEN 1 ELSE 0 END), 0)
            ELSE NULL
          END AS econ
        FROM '{_src("ball_by_ball")}'
        WHERE batter IS NOT NULL AND bowler IS NOT NULL
        GROUP BY bowler, batter
        """,
    )


def build_bowl_venues(con):
    return write_table(
        con,
        "player_bowl_venues",
        f"""
        SELECT
          b.bowler AS player,
          m.venue,
          CAST(SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END) AS BIGINT) AS balls,
          CAST(SUM(b.batter_runs + COALESCE(b.wides,0) + COALESCE(b.noballs,0)) AS BIGINT) AS runs,
          CAST(SUM(CASE WHEN b.is_wicket AND {WICKET_EXCLUDE} THEN 1 ELSE 0 END) AS BIGINT) AS wickets,
          CASE
            WHEN SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END) > 0
            THEN 6.0 * SUM(b.batter_runs + COALESCE(b.wides,0) + COALESCE(b.noballs,0))
                 / NULLIF(SUM(CASE WHEN COALESCE(b.wides,0)=0 AND COALESCE(b.noballs,0)=0 THEN 1 ELSE 0 END), 0)
            ELSE NULL
          END AS econ
        FROM '{_src("ball_by_ball")}' b
        JOIN '{_src("matches")}' m
          ON b.season = m.season AND b.match_number = m.match_number
        WHERE b.bowler IS NOT NULL AND m.venue IS NOT NULL
        GROUP BY b.bowler, m.venue
        """,
    )


def main():
    if not AGG_DIR.exists():
        print(f"ERROR: aggregated dir missing: {AGG_DIR}", file=sys.stderr)
        sys.exit(1)
    print(f"Reading source parquets from: {AGG_DIR}")
    print(f"Writing aggregates back to:   {AGG_DIR}\n")

    con = duckdb.connect()

    builders = [
        ("player_career_bat",       build_career_bat),
        ("player_career_bowl",      build_career_bowl),
        ("player_season_bat",       build_season_bat),
        ("player_season_bowl",      build_season_bowl),
        ("orange_cap_winners",      build_orange_caps),
        ("player_dismissals",       build_dismissals),
        ("player_wicket_types",     build_wicket_types),
        ("player_venues",           build_venues),
        ("player_bowl_venues",      build_bowl_venues),
        ("player_bowler_matchups",  build_matchups),
        ("player_batter_matchups",  build_batter_matchups),
        ("player_skill_profile",    build_skill_profile),
        ("player_bowl_skill_profile", build_bowl_skill_profile),
    ]

    print(f"{'table':<28} {'rows':>8}  {'size':>10}")
    print("-" * 54)
    total_bytes = 0
    for name, fn in builders:
        rows, size = fn(con)
        size_str = f"{size/1024:>7.1f} KB" if size < 1024 * 1024 else f"{size/1024/1024:>7.2f} MB"
        print(f"  {name:<26} {rows:>8,}  {size_str:>10}")
        total_bytes += size
    print("-" * 54)
    print(f"  {'TOTAL':<26} {'':>8}  {total_bytes/1024:>7.1f} KB")


if __name__ == "__main__":
    main()
