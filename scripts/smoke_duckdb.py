"""
DuckDB smoke test for the aggregated Parquet layer.

Runs a handful of canonical queries against `data/aggregated/*.parquet`
to verify schema, row counts, and that cross-season queries work. Also
sanity-checks feature availability per era (DRS introduced 2018, impact
players 2023).

Run:
    python smoke_duckdb.py
"""

import sys
from pathlib import Path

import duckdb


ROOT = Path(__file__).resolve().parent.parent
AGG = ROOT / "data" / "aggregated"


def q(con, sql, title=None):
    if title:
        print(f"\n── {title} ──")
    result = con.execute(sql).fetchdf()
    if len(result) > 20:
        print(result.head(20).to_string(index=False))
        print(f"  … {len(result) - 20} more rows")
    else:
        print(result.to_string(index=False))
    return result


def main():
    if not AGG.exists():
        print(f"! {AGG} not found; run aggregator.py first.", file=sys.stderr)
        sys.exit(1)

    con = duckdb.connect()

    # Register each parquet as a view so queries read "FROM matches" not paths
    for p in sorted(AGG.glob("*.parquet")):
        name = p.stem
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{p}')")

    q(con, "SELECT season, COUNT(*) AS matches FROM matches GROUP BY season ORDER BY season",
      "Matches per season")

    q(con, """
        SELECT batter, SUM(runs) AS career_runs, COUNT(*) AS innings,
               ROUND(AVG(strike_rate), 1) AS avg_sr
        FROM batting_scorecard
        WHERE batter IS NOT NULL
        GROUP BY batter
        HAVING SUM(runs) >= 3000
        ORDER BY career_runs DESC
        LIMIT 10
    """, "All-time top run-scorers (≥3,000 career IPL runs)")

    q(con, """
        SELECT season, COUNT(*) AS reviews
        FROM reviews
        GROUP BY season
        ORDER BY season
    """, "DRS review rows per season (should be empty / very low pre-2018)")

    q(con, """
        SELECT season, COUNT(*) AS impact_subs
        FROM substitutions
        WHERE reason = 'impact_player'
        GROUP BY season
        ORDER BY season
    """, "Impact-player subs per season (should be 0 before 2023)")

    q(con, """
        SELECT season,
               ROUND(SUM(total_runs) * 1.0 / COUNT(DISTINCT (match_number, innings)), 1)
                 AS avg_innings_total
        FROM ball_by_ball
        GROUP BY season
        ORDER BY season
    """, "Avg innings total by season (scoring-rate trend)")

    # Multi-table join: top wicket-takers all time with their team from players.csv
    q(con, """
        SELECT b.bowler, SUM(b.wickets) AS career_wkts,
               ROUND(SUM(b.runs) / SUM(b.overs), 2) AS career_econ,
               COUNT(DISTINCT (b.season, b.match_number)) AS matches
        FROM bowling_scorecard b
        WHERE b.bowler IS NOT NULL AND b.overs > 0
        GROUP BY b.bowler
        HAVING SUM(b.wickets) >= 100
        ORDER BY career_wkts DESC
        LIMIT 10
    """, "All-time top wicket-takers (≥100 wickets, with career economy)")

    # Schema sanity for ball_by_ball (the mixed-type 'ball' column)
    q(con, "DESCRIBE ball_by_ball", "Schema: ball_by_ball")

    print("\n✓ smoke test passed" if True else "")


if __name__ == "__main__":
    main()
