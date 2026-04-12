"""Data loading utilities for the IPL dashboard."""

import pandas as pd
from pathlib import Path
from functools import lru_cache

DATA_DIR = Path(__file__).parent.parent / "data" / "2026"


def _safe_read_csv(path):
    """Read a CSV file, returning empty DataFrame if missing or corrupt."""
    try:
        if path.exists():
            return pd.read_csv(path)
    except Exception:
        pass
    return pd.DataFrame()


@lru_cache(maxsize=1)
def load_matches():
    return _safe_read_csv(DATA_DIR / "matches.csv")


@lru_cache(maxsize=1)
def load_points_table():
    return _safe_read_csv(DATA_DIR / "points_table.csv")


@lru_cache(maxsize=1)
def load_players():
    return _safe_read_csv(DATA_DIR / "players.csv")


@lru_cache(maxsize=None)
def _concat_match_csvs(filename):
    """Concatenate a specific CSV across all match directories."""
    matches_dir = DATA_DIR / "matches"
    if not matches_dir.exists():
        return pd.DataFrame()
    frames = []
    for match_dir in sorted(matches_dir.iterdir()):
        if not match_dir.is_dir():
            continue
        csv_path = match_dir / filename
        if csv_path.exists():
            try:
                df = pd.read_csv(csv_path)
                parts = match_dir.name.split("_")
                df["match_number"] = int(parts[1])
                frames.append(df)
            except Exception:
                continue
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


@lru_cache(maxsize=1)
def load_ball_by_ball():
    return _concat_match_csvs("ball_by_ball.csv")


@lru_cache(maxsize=1)
def load_batting_scorecards():
    return _concat_match_csvs("batting_scorecard.csv")


@lru_cache(maxsize=1)
def load_bowling_scorecards():
    return _concat_match_csvs("bowling_scorecard.csv")


@lru_cache(maxsize=1)
def load_partnerships():
    return _concat_match_csvs("partnerships.csv")


@lru_cache(maxsize=1)
def load_fall_of_wickets():
    return _concat_match_csvs("fall_of_wickets.csv")


@lru_cache(maxsize=1)
def load_phase_summaries():
    return _concat_match_csvs("phase_summary.csv")


@lru_cache(maxsize=1)
def load_reviews():
    return _concat_match_csvs("reviews.csv")


@lru_cache(maxsize=1)
def load_substitutions():
    return _concat_match_csvs("substitutions.csv")


@lru_cache(maxsize=1)
def load_all_fielding():
    """Load and aggregate fielding stats across all players."""
    players_dir = DATA_DIR / "players"
    if not players_dir.exists():
        return pd.DataFrame()
    frames = []
    for pdir in sorted(players_dir.iterdir()):
        if not pdir.is_dir():
            continue
        fpath = pdir / "fielding.csv"
        if fpath.exists():
            df = pd.read_csv(fpath)
            df["player"] = pdir.name.replace("_", " ")
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)
