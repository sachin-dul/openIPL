"""
Aggregate per-season CSV data into a columnar Parquet layer for the React app.

Reads from `data/{season}/...` (the same per-match CSV files the Python pipeline
writes), adds a `season` column, concatenates across seasons, and writes
`data/aggregated/<table>.parquet`.

Defaults to seasons 2008-2026 (2026 is the current live season).

Usage:
    python aggregator.py                          # default: 2008-2026
    python aggregator.py --seasons 2008,2010      # specific seasons
    python aggregator.py --seasons 2015-2026      # inclusive range
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


# Canonical "Name, City" form per raw cricsheet venue string. Renamed grounds
# stay split (e.g. Feroz Shah Kotla vs Arun Jaitley) so each match keeps the
# stadium name it was known by at the time; only formatting duplicates collapse.
VENUE_CANONICAL = {
    # Delhi — Feroz Shah Kotla renamed to Arun Jaitley Stadium in 2018
    "Feroz Shah Kotla": "Feroz Shah Kotla, Delhi",
    "Feroz Shah Kotla, Delhi": "Feroz Shah Kotla, Delhi",
    "Arun Jaitley Stadium": "Arun Jaitley Stadium, Delhi",
    "Arun Jaitley Stadium, Delhi": "Arun Jaitley Stadium, Delhi",
    # Mumbai
    "Wankhede Stadium": "Wankhede Stadium, Mumbai",
    "Wankhede Stadium, Mumbai": "Wankhede Stadium, Mumbai",
    "Brabourne Stadium": "Brabourne Stadium, Mumbai",
    "Brabourne Stadium, Mumbai": "Brabourne Stadium, Mumbai",
    "Dr DY Patil Sports Academy": "Dr DY Patil Sports Academy, Mumbai",
    "Dr DY Patil Sports Academy, Mumbai": "Dr DY Patil Sports Academy, Mumbai",
    # Kolkata
    "Eden Gardens": "Eden Gardens, Kolkata",
    "Eden Gardens, Kolkata": "Eden Gardens, Kolkata",
    # Bengaluru
    "M Chinnaswamy Stadium": "M Chinnaswamy Stadium, Bengaluru",
    "M Chinnaswamy Stadium, Bengaluru": "M Chinnaswamy Stadium, Bengaluru",
    "M.Chinnaswamy Stadium": "M Chinnaswamy Stadium, Bengaluru",
    # Chennai
    "MA Chidambaram Stadium": "MA Chidambaram Stadium, Chennai",
    "MA Chidambaram Stadium, Chepauk": "MA Chidambaram Stadium, Chennai",
    "MA Chidambaram Stadium, Chepauk, Chennai": "MA Chidambaram Stadium, Chennai",
    # Hyderabad
    "Rajiv Gandhi International Stadium": "Rajiv Gandhi International Stadium, Hyderabad",
    "Rajiv Gandhi International Stadium, Uppal": "Rajiv Gandhi International Stadium, Hyderabad",
    "Rajiv Gandhi International Stadium, Uppal, Hyderabad": "Rajiv Gandhi International Stadium, Hyderabad",
    # Mohali / Chandigarh
    "Punjab Cricket Association IS Bindra Stadium": "Punjab Cricket Association IS Bindra Stadium, Mohali",
    "Punjab Cricket Association IS Bindra Stadium, Mohali": "Punjab Cricket Association IS Bindra Stadium, Mohali",
    "Punjab Cricket Association IS Bindra Stadium, Mohali, Chandigarh": "Punjab Cricket Association IS Bindra Stadium, Mohali",
    "Punjab Cricket Association Stadium, Mohali": "Punjab Cricket Association IS Bindra Stadium, Mohali",
    # Jaipur
    "Sawai Mansingh Stadium": "Sawai Mansingh Stadium, Jaipur",
    "Sawai Mansingh Stadium, Jaipur": "Sawai Mansingh Stadium, Jaipur",
    # Pune — Subrata Roy Sahara was the sponsor-era name; both refer to the
    # same ground but stay split per the era-name rule.
    "Subrata Roy Sahara Stadium": "Subrata Roy Sahara Stadium, Pune",
    "Maharashtra Cricket Association Stadium": "Maharashtra Cricket Association Stadium, Pune",
    "Maharashtra Cricket Association Stadium, Pune": "Maharashtra Cricket Association Stadium, Pune",
    # Ahmedabad — Sardar Patel Stadium renamed to Narendra Modi Stadium in 2021
    "Sardar Patel Stadium, Motera": "Sardar Patel Stadium, Ahmedabad",
    "Narendra Modi Stadium, Ahmedabad": "Narendra Modi Stadium, Ahmedabad",
    # Dharamsala
    "Himachal Pradesh Cricket Association Stadium": "Himachal Pradesh Cricket Association Stadium, Dharamsala",
    "Himachal Pradesh Cricket Association Stadium, Dharamsala": "Himachal Pradesh Cricket Association Stadium, Dharamsala",
    # Visakhapatnam
    "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium": "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium, Visakhapatnam",
    "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium, Visakhapatnam": "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium, Visakhapatnam",
    # Raipur
    "Shaheed Veer Narayan Singh International Stadium": "Shaheed Veer Narayan Singh International Stadium, Raipur",
    "Shaheed Veer Narayan Singh International Stadium, Raipur": "Shaheed Veer Narayan Singh International Stadium, Raipur",
    # Mullanpur (New Chandigarh district)
    "Maharaja Yadavindra Singh International Cricket Stadium, Mullanpur": "Maharaja Yadavindra Singh International Cricket Stadium, Mullanpur",
    "Maharaja Yadavindra Singh International Cricket Stadium, New Chandigarh": "Maharaja Yadavindra Singh International Cricket Stadium, Mullanpur",
    # Other Indian grounds — add city suffix where missing
    "Barabati Stadium": "Barabati Stadium, Cuttack",
    "Green Park": "Green Park, Kanpur",
    "Holkar Cricket Stadium": "Holkar Cricket Stadium, Indore",
    "JSCA International Stadium Complex": "JSCA International Stadium Complex, Ranchi",
    "Nehru Stadium": "Nehru Stadium, Kochi",
    "Saurashtra Cricket Association Stadium": "Saurashtra Cricket Association Stadium, Rajkot",
    "Vidarbha Cricket Association Stadium, Jamtha": "Vidarbha Cricket Association Stadium, Nagpur",
    # Indian grounds already canonical
    "Barsapara Cricket Stadium, Guwahati": "Barsapara Cricket Stadium, Guwahati",
    "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium, Lucknow": "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium, Lucknow",
    # UAE — Sheikh Zayed / Zayed Cricket Stadium are the same ground
    "Sheikh Zayed Stadium": "Sheikh Zayed Stadium, Abu Dhabi",
    "Zayed Cricket Stadium, Abu Dhabi": "Sheikh Zayed Stadium, Abu Dhabi",
    "Dubai International Cricket Stadium": "Dubai International Cricket Stadium, Dubai",
    "Sharjah Cricket Stadium": "Sharjah Cricket Stadium, Sharjah",
    # South Africa (IPL 2009 host venues)
    "Kingsmead": "Kingsmead, Durban",
    "Kingsmead, Durban": "Kingsmead, Durban",
    "Newlands": "Newlands, Cape Town",
    "Newlands, Cape Town": "Newlands, Cape Town",
    "Buffalo Park": "Buffalo Park, East London",
    "De Beers Diamond Oval": "De Beers Diamond Oval, Kimberley",
    "New Wanderers Stadium": "New Wanderers Stadium, Johannesburg",
    "OUTsurance Oval": "OUTsurance Oval, Bloemfontein",
    "St George's Park": "St George's Park, Gqeberha",
    "SuperSport Park": "SuperSport Park, Centurion",
}


def _normalize_venues(df, table):
    """Map raw venue strings to canonical 'Name, City' form. Unknown venues
    pass through unchanged with a warning so we notice new ground spellings."""
    if table != "matches" or "venue" not in df.columns:
        return df
    raw = df["venue"]
    mapped = raw.map(lambda v: VENUE_CANONICAL.get(v, v) if isinstance(v, str) else v)
    unknown = sorted({v for v in raw.dropna().unique() if v not in VENUE_CANONICAL})
    if unknown:
        print(f"  ! unknown venues passed through (add to VENUE_CANONICAL): {unknown}",
              file=sys.stderr)
    df = df.copy()
    df["venue"] = mapped
    return df


def parse_seasons(arg):
    """Parse `--seasons` arg. Accepts `2015`, `2015,2018,2020`, `2015-2020`."""
    if arg is None:
        return list(range(2008, 2027))
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
        out = _normalize_venues(out, table)
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
    ap.add_argument("--seasons", help="Comma list or YYYY-YYYY range. Default 2008-2026.")
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

    # Pre-computed per-player rollups (career bat/bowl, season-by-season,
    # orange caps, dismissals, venues, matchups, skill profile). Reads from
    # the parquets we just wrote, so it has to run last.
    print()
    try:
        import build_player_aggregates  # sibling script in scripts/
        build_player_aggregates.main()
    except Exception as e:
        print(f"WARN: player aggregates step failed: {e}")


if __name__ == "__main__":
    main()
