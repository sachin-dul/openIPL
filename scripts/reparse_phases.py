"""One-shot rebuild of per-match CSVs after the parser phase fix.

Walks every existing match directory under data/{season}/matches/ and re-runs
parse_match + write_match_csvs against the matching Cricsheet JSON. Match
numbers stay anchored to the existing directory names so playoff numbering
isn't disturbed.
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parser import parse_match, write_match_csvs


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE_ROOTS = [ROOT / ".cricsheet_cache" / "all"]


def index_cache_by_date_teams(seasons):
    """{(date, frozenset(teams)): json_path} index across cache dirs.

    Season-specific cache dirs (e.g. .cricsheet_cache/2026/) shadow `all/` so
    the freshest copy wins for in-progress seasons.
    """
    cache_dirs = [ROOT / ".cricsheet_cache" / "all"]
    for s in seasons:
        season_cache = ROOT / ".cricsheet_cache" / str(s)
        if season_cache.exists():
            cache_dirs.append(season_cache)

    index = {}
    for cdir in cache_dirs:
        if not cdir.exists():
            continue
        for fname in os.listdir(cdir):
            if not fname.endswith(".json"):
                continue
            fpath = cdir / fname
            try:
                with open(fpath) as f:
                    data = json.load(f)
                info = data["info"]
                if "Indian Premier League" not in info.get("event", {}).get("name", ""):
                    continue
                date = info.get("dates", [""])[0]
                teams = frozenset(info.get("teams", []))
                index[(date, teams)] = str(fpath)
            except (json.JSONDecodeError, KeyError):
                continue
    return index


def parse_match_dir_name(name):
    """match_71_Sunrisers_Hyderabad_vs_Kolkata_Knight_Riders → (71, {team_a, team_b})"""
    m = re.match(r"match_(\d+)_(.+)_vs_(.+)$", name)
    if not m:
        return None
    num = int(m.group(1))
    t1 = m.group(2).replace("_", " ")
    t2 = m.group(3).replace("_", " ")
    return num, frozenset({t1, t2})


def read_match_date(match_dir):
    """Pull the match date out of an existing matches.csv row (cached lookup)."""
    csv_path = match_dir / "ball_by_ball.csv"
    if not csv_path.exists():
        return None
    return None  # date isn't on ball-by-ball — caller resolves via matches.csv


def load_season_match_dates(season):
    """match_number → date from data/{season}/matches.csv."""
    csv_path = DATA_DIR / str(season) / "matches.csv"
    if not csv_path.exists():
        return {}
    import csv
    out = {}
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                num = int(row["match_number"])
            except (KeyError, ValueError):
                continue
            out[num] = row.get("date", "")
    return out


def main():
    seasons = sorted(
        int(p.name) for p in DATA_DIR.iterdir()
        if p.is_dir() and p.name.isdigit() and (p / "matches").exists()
    )
    print(f"Found {len(seasons)} seasons: {seasons}")

    cache_index = index_cache_by_date_teams(seasons)
    print(f"Indexed {len(cache_index)} Cricsheet JSONs")

    total_matches = 0
    total_reparsed = 0
    total_skipped = 0

    for season in seasons:
        match_dates = load_season_match_dates(season)
        matches_root = DATA_DIR / str(season) / "matches"
        season_reparsed = 0
        season_skipped = 0
        for match_dir in sorted(matches_root.iterdir()):
            if not match_dir.is_dir():
                continue
            total_matches += 1
            parsed_name = parse_match_dir_name(match_dir.name)
            if parsed_name is None:
                print(f"  Skipping unparseable dir: {match_dir.name}")
                season_skipped += 1
                continue
            match_num, teams = parsed_name
            date = match_dates.get(match_num, "")
            if not date:
                season_skipped += 1
                continue
            json_path = cache_index.get((date, teams))
            if json_path is None:
                # Hand-inserted washouts have no Cricsheet JSON — leave them alone.
                season_skipped += 1
                continue
            parsed = parse_match(json_path, match_number_override=match_num)
            write_match_csvs(parsed, str(match_dir))
            season_reparsed += 1

        total_reparsed += season_reparsed
        total_skipped += season_skipped
        print(f"  {season}: reparsed {season_reparsed}, skipped {season_skipped}")

    print()
    print(f"Done: {total_reparsed}/{total_matches} matches reparsed "
          f"({total_skipped} skipped — washouts or missing JSON).")


if __name__ == "__main__":
    main()
