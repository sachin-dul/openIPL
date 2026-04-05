"""
Orchestrator: fetches and processes Cricsheet IPL data for a season.

Usage:
    # Fetch from Cricsheet + process (recommended)
    python orchestrator.py --season 2026
    python orchestrator.py --season 2026 --fetch-mode full

    # Process from a local JSON directory (skip fetch)
    python orchestrator.py --season 2026 --json-dir /path/to/json --no-fetch

Steps:
  1. Fetch new match JSONs from Cricsheet (full or incremental)
  2. Parse each new match into per-match CSVs
  3. Build/update matches.csv
  4. Build/update points_table.csv (with NRR)
  5. Run collector to update player/team aggregates
"""

import argparse
import json
import os
import sys

from parser import parse_match, write_match_csvs, write_csv
from collector import collect_season, safe_name
from fetcher import fetch


def get_season_matches(json_dir, season):
    """Find all IPL match files for a given season."""
    matches = []
    season_str = str(season)
    for fname in sorted(os.listdir(json_dir)):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(json_dir, fname)
        try:
            with open(fpath) as f:
                data = json.load(f)
            info = data["info"]
            if str(info.get("season", "")) == season_str:
                event = info.get("event", {})
                if "Indian Premier League" in event.get("name", ""):
                    match_num = event.get("match_number", 0)
                    matches.append((match_num, fname, fpath))
        except (json.JSONDecodeError, KeyError):
            continue
    matches.sort(key=lambda m: (m[0] == 0, m[0]))
    # Assign sequential match numbers to playoff matches (match_number=0)
    if matches:
        max_num = max(m[0] for m in matches if m[0] != 0) if any(m[0] != 0 for m in matches) else 0
        matches = [
            (m[0], m[1], m[2]) if m[0] != 0 else ((max_num := max_num + 1), m[1], m[2])
            for m in matches
        ]
    return matches


def compute_nrr(team_data):
    """Compute Net Run Rate for a team.

    NRR = (total runs scored / total overs faced) - (total runs conceded / total overs bowled)
    """
    runs_scored = team_data.get("runs_scored", 0)
    overs_faced = team_data.get("overs_faced", 0.0)
    runs_conceded = team_data.get("runs_conceded", 0)
    overs_bowled = team_data.get("overs_bowled", 0.0)

    def overs_to_balls(overs):
        complete = int(overs)
        partial = round((overs - complete) * 10)
        return complete * 6 + partial

    balls_faced = overs_to_balls(overs_faced)
    balls_bowled = overs_to_balls(overs_bowled)

    if balls_faced == 0 or balls_bowled == 0:
        return 0.0

    scoring_rate = runs_scored / (balls_faced / 6)
    conceding_rate = runs_conceded / (balls_bowled / 6)
    return round(scoring_rate - conceding_rate, 3)


def build_points_table(all_match_data, season_dir):
    """Build progressive points table from parsed match data."""
    teams = {}  # team -> stats

    for parsed in all_match_data:
        match_info = parsed["match"]
        team_1 = parsed["team_1"]
        team_2 = parsed["team_2"]
        winner = match_info.get("winner", "")
        result = match_info.get("result", "")
        team_scores = parsed["team_scores"]
        innings_overs = parsed["innings_overs"]

        for team in [team_1, team_2]:
            if team not in teams:
                teams[team] = {
                    "played": 0, "won": 0, "lost": 0, "no_result": 0,
                    "points": 0, "runs_scored": 0, "overs_faced": 0.0,
                    "runs_conceded": 0, "overs_bowled": 0.0,
                }

        for team in [team_1, team_2]:
            teams[team]["played"] += 1

        if result == "no result":
            for team in [team_1, team_2]:
                teams[team]["no_result"] += 1
                teams[team]["points"] += 1
        elif winner:
            loser = team_2 if winner == team_1 else team_1
            teams[winner]["won"] += 1
            teams[winner]["points"] += 2
            teams[loser]["lost"] += 1

        # NRR data — per ICC rules, all-out teams are deemed to have faced 20 overs
        for team, opponent in [(team_1, team_2), (team_2, team_1)]:
            score_str = team_scores.get(team, "0/0")
            parts = score_str.split("/")
            runs = int(parts[0])
            wickets = int(parts[1]) if len(parts) > 1 else 0
            overs = 20.0 if wickets == 10 else innings_overs.get(team, 0.0)

            opp_score_str = team_scores.get(opponent, "0/0")
            opp_parts = opp_score_str.split("/")
            opp_runs = int(opp_parts[0])
            opp_wickets = int(opp_parts[1]) if len(opp_parts) > 1 else 0
            opp_overs = 20.0 if opp_wickets == 10 else innings_overs.get(opponent, 0.0)

            teams[team]["runs_scored"] += runs
            teams[team]["overs_faced"] += overs
            teams[team]["runs_conceded"] += opp_runs
            teams[team]["overs_bowled"] += opp_overs

    # Sort by points, then NRR
    table = []
    for team, stats in teams.items():
        nrr = compute_nrr(stats)
        table.append({
            "team": team,
            "played": stats["played"],
            "won": stats["won"],
            "lost": stats["lost"],
            "no_result": stats["no_result"],
            "net_run_rate": nrr,
            "points": stats["points"],
        })

    table.sort(key=lambda x: (-x["points"], -x["net_run_rate"]))
    for i, row in enumerate(table):
        row["position"] = i + 1

    # Reorder columns
    ordered = []
    for row in table:
        ordered.append({
            "position": row["position"],
            "team": row["team"],
            "played": row["played"],
            "won": row["won"],
            "lost": row["lost"],
            "no_result": row["no_result"],
            "net_run_rate": row["net_run_rate"],
            "points": row["points"],
        })

    write_csv(os.path.join(season_dir, "points_table.csv"), ordered)
    return ordered


def main():
    p = argparse.ArgumentParser(description="openIPL Orchestrator")
    p.add_argument("--season", required=True, help="IPL season (e.g., 2026)")
    p.add_argument("--json-dir", default=None, help="Local directory with Cricsheet JSON files (skips fetch)")
    p.add_argument("--no-fetch", action="store_true", help="Skip fetching from Cricsheet (requires --json-dir)")
    p.add_argument("--fetch-mode", choices=["full", "incremental", "auto"], default="auto",
                   help="Cricsheet fetch mode (default: auto)")
    p.add_argument("--data-dir", default=None, help="Data output directory (default: data/<season>)")
    p.add_argument("--reprocess", action="store_true", help="Reprocess all matches even if already present")
    args = p.parse_args()

    # Resolve paths
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    season_dir = args.data_dir or os.path.join(repo_root, "data", str(args.season))
    os.makedirs(season_dir, exist_ok=True)

    matches_dir = os.path.join(season_dir, "matches")
    os.makedirs(matches_dir, exist_ok=True)

    # Fetch or use local dir
    if args.no_fetch:
        if not args.json_dir:
            print("Error: --json-dir is required when using --no-fetch")
            sys.exit(1)
        json_dir = args.json_dir
    else:
        json_dir = args.json_dir or fetch(args.season, args.fetch_mode)

    # Find matches
    season_matches = get_season_matches(json_dir, args.season)
    if not season_matches:
        print(f"No IPL matches found for season {args.season}")
        sys.exit(1)

    print(f"Found {len(season_matches)} matches for IPL {args.season}")

    # Process each match
    all_parsed = []
    all_match_rows = []
    new_count = 0

    for match_num, fname, fpath in season_matches:
        parsed = parse_match(fpath, match_number_override=match_num)
        all_parsed.append(parsed)

        match_row = parsed["match"]
        all_match_rows.append(match_row)

        # Determine output dir
        t1 = safe_name(parsed["team_1"])
        t2 = safe_name(parsed["team_2"])
        match_dir_name = f"match_{match_num:02d}_{t1}_vs_{t2}"
        match_out_dir = os.path.join(matches_dir, match_dir_name)

        if os.path.exists(match_out_dir) and not args.reprocess:
            print(f"  Skipping match {match_num} ({fname}) — already processed")
            continue

        write_match_csvs(parsed, match_out_dir)
        new_count += 1
        print(f"  Processed match {match_num}: {parsed['team_1']} vs {parsed['team_2']}")

    # Write matches.csv
    write_csv(os.path.join(season_dir, "matches.csv"), all_match_rows)
    print(f"\nWrote matches.csv ({len(all_match_rows)} matches)")

    # Write player_registry.csv (deduplicated across all matches)
    all_registry = {}
    for parsed in all_parsed:
        for name, cricsheet_id in parsed.get("registry", {}).items():
            all_registry[name] = cricsheet_id
    if all_registry:
        registry_rows = [{"player": name, "cricsheet_id": cid} for name, cid in sorted(all_registry.items())]
        write_csv(os.path.join(season_dir, "player_registry.csv"), registry_rows)
        print(f"Wrote player_registry.csv ({len(registry_rows)} entries)")

    # Build points table
    table = build_points_table(all_parsed, season_dir)
    print("Updated points_table.csv")
    print("\nPoints Table:")
    print(f"{'Pos':<4} {'Team':<35} {'P':>3} {'W':>3} {'L':>3} {'NR':>3} {'NRR':>8} {'Pts':>4}")
    print("-" * 65)
    for row in table:
        print(f"{row['position']:<4} {row['team']:<35} {row['played']:>3} {row['won']:>3} "
              f"{row['lost']:>3} {row['no_result']:>3} {row['net_run_rate']:>+8.3f} {row['points']:>4}")

    # Run collector
    print("\nCollecting player and team aggregates...")
    collect_season(season_dir)

    print(f"\nDone! Processed {new_count} new matches. Total: {len(season_matches)} matches.")


if __name__ == "__main__":
    main()
