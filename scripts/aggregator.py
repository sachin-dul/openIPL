"""
Aggregate per-season CSV data into a columnar Parquet layer for the React app.

Reads from `data/{season}/...` (the same per-match CSV files the Python pipeline
writes), adds a `season` column, concatenates across seasons, and writes
`data/aggregated/<table>.parquet`.

Defaults to seasons 2008-2025. The live Shiny app (season 2026) is not
included in the Parquet layer — it continues to read CSVs directly.

Usage:
    python aggregator.py                          # default: 2008-2025
    python aggregator.py --seasons 2008,2010      # specific seasons
    python aggregator.py --seasons 2015-2025      # inclusive range
    python aggregator.py --out /path/to/out       # override output dir
"""

import argparse
import os
import re
import sys
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

# Tables that live at the season root: data/{season}/{table}.csv
SEASON_TABLES = [
    "matches",
    "points_table",
    "players",
    "player_registry",
]

# Tables that live per-match: data/{season}/matches/{match_dir}/{table}.csv
# (reviews, super_over, substitutions are optional — only written when data exists)
MATCH_TABLES = [
    "ball_by_ball",
    "batting_scorecard",
    "bowling_scorecard",
    "partnerships",
    "fall_of_wickets",
    "phase_summary",
    "reviews",
    "super_over",
    "substitutions",
]

# Columns whose dtype must be coerced to string to survive Parquet's strict typing.
# `ball_by_ball.ball` is int for legal deliveries but string like "2.wides" for extras.
STRING_COERCE = {
    "ball_by_ball": ["ball"],
}


def parse_seasons(arg):
    """Parse `--seasons` arg. Accepts `2015`, `2015,2018,2020`, `2015-2020`."""
    if arg is None:
        return list(range(2008, 2026))
    if "-" in arg and "," not in arg:
        lo, hi = arg.split("-", 1)
        return list(range(int(lo), int(hi) + 1))
    return [int(s) for s in arg.split(",") if s.strip()]


def _read_csv(path):
    try:
        return pd.read_csv(path)
    except Exception as e:
        print(f"    ! skip {path}: {e}", file=sys.stderr)
        return None


def _coerce_strings(df, table):
    for col in STRING_COERCE.get(table, []):
        if col in df.columns:
            df[col] = df[col].astype("string")
    return df


def load_season_table(season, table):
    """Read a season-root CSV, return DataFrame with season column added."""
    path = DATA_DIR / str(season) / f"{table}.csv"
    if not path.exists():
        return None
    df = _read_csv(path)
    if df is None or df.empty:
        return None
    df["season"] = season
    return _coerce_strings(df, table)


def load_match_table(season, table):
    """Walk data/{season}/matches/*/ and concat `{table}.csv` across all matches."""
    matches_dir = DATA_DIR / str(season) / "matches"
    if not matches_dir.exists():
        return None
    frames = []
    for match_dir in sorted(matches_dir.iterdir()):
        if not match_dir.is_dir():
            continue
        path = match_dir / f"{table}.csv"
        if not path.exists():
            continue
        df = _read_csv(path)
        if df is None or df.empty:
            continue
        # Derive match_number from dir name: match_01_Foo_vs_Bar → 1
        m = re.match(r"match_(\d+)_", match_dir.name)
        if m:
            df["match_number"] = int(m.group(1))
        df["season"] = season
        frames.append(df)
    if not frames:
        return None
    # Use concat(sort=False) to keep first-seen column order; outer join
    combined = pd.concat(frames, ignore_index=True, sort=False)
    return _coerce_strings(combined, table)


def aggregate(seasons, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = []

    for table in SEASON_TABLES:
        frames = []
        for s in seasons:
            df = load_season_table(s, table)
            if df is not None:
                frames.append(df)
        if not frames:
            summary.append((table, 0, 0, "no data"))
            continue
        out = pd.concat(frames, ignore_index=True, sort=False)
        path = out_dir / f"{table}.parquet"
        out.to_parquet(path, engine="pyarrow", compression="zstd", index=False)
        summary.append((table, len(out), path.stat().st_size, "ok"))

    for table in MATCH_TABLES:
        frames = []
        for s in seasons:
            df = load_match_table(s, table)
            if df is not None:
                frames.append(df)
        if not frames:
            summary.append((table, 0, 0, "no data"))
            continue
        out = pd.concat(frames, ignore_index=True, sort=False)
        path = out_dir / f"{table}.parquet"
        out.to_parquet(path, engine="pyarrow", compression="zstd", index=False)
        summary.append((table, len(out), path.stat().st_size, "ok"))

    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--seasons", help="Comma list or YYYY-YYYY range. Default 2008-2025.")
    ap.add_argument("--out", type=Path, default=DATA_DIR / "aggregated",
                    help="Output directory. Default data/aggregated/")
    args = ap.parse_args()

    seasons = parse_seasons(args.seasons)
    print(f"Aggregating {len(seasons)} season(s): {seasons[0]}–{seasons[-1]}")
    print(f"Output: {args.out}\n")

    summary = aggregate(seasons, args.out)

    print("table".ljust(22), "rows".rjust(10), "size".rjust(10), "status")
    print("-" * 60)
    total_bytes = 0
    for t, n, sz, status in summary:
        size_str = f"{sz/1024/1024:.2f} MB" if sz else "-"
        print(f"{t:<22} {n:>10,} {size_str:>10}  {status}")
        total_bytes += sz
    print("-" * 60)
    print(f"{'TOTAL':<22} {'':<10} {total_bytes/1024/1024:>7.2f} MB")


if __name__ == "__main__":
    main()
