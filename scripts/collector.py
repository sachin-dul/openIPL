"""
Collector: aggregates per-match data into per-player and per-team season CSVs.

Reads all match CSVs from data/<season>/matches/ and produces:
  - data/<season>/players/<PlayerName>/batting.csv
  - data/<season>/players/<PlayerName>/bowling.csv
  - data/<season>/players/<PlayerName>/fielding.csv
  - data/<season>/teams/<TeamName>/batting.csv
  - data/<season>/teams/<TeamName>/bowling.csv
  - data/<season>/teams/<TeamName>/results.csv
  - data/<season>/players.csv  (master player list)
"""

import os
import csv
from collections import defaultdict
from parser import write_csv


def safe_name(name):
    """Convert player/team name to filesystem-safe directory name."""
    return name.replace(" ", "_").replace("/", "_").replace(".", "")


def read_csv(filepath):
    """Read CSV file and return list of dicts."""
    if not os.path.exists(filepath):
        return []
    with open(filepath) as f:
        return list(csv.DictReader(f))


def collect_season(season_dir):
    """Aggregate all match data into player and team CSVs."""
    matches_dir = os.path.join(season_dir, "matches")
    if not os.path.isdir(matches_dir):
        print(f"No matches directory found at {matches_dir}")
        return

    # Collect data from all matches
    player_batting = defaultdict(list)    # player -> [rows]
    player_bowling = defaultdict(list)    # player -> [rows]
    player_fielding = defaultdict(dict)   # player -> {match_num -> stats}
    player_teams = {}                     # player -> team
    team_batting = defaultdict(list)      # team -> [rows]
    team_bowling = defaultdict(list)      # team -> [rows]
    team_results = defaultdict(list)      # team -> [rows]
    all_teams = set()

    match_dirs = sorted(
        [d for d in os.listdir(matches_dir) if os.path.isdir(os.path.join(matches_dir, d))]
    )

    for match_dir_name in match_dirs:
        match_path = os.path.join(matches_dir, match_dir_name)

        info_rows = read_csv(os.path.join(match_path, "info.csv"))
        if not info_rows:
            continue
        info = info_rows[0]

        match_num = int(info.get("match_number", 0))
        date = info.get("date", "")
        venue = info.get("venue", "")
        team_1 = info.get("team_1", "")
        team_2 = info.get("team_2", "")
        winner = info.get("winner", "")
        all_teams.update([team_1, team_2])

        # --- Team results ---
        for team, opponent in [(team_1, team_2), (team_2, team_1)]:
            result_str = "won" if team == winner else ("lost" if winner else "no result")
            wbr = int(info.get("win_by_runs", 0))
            wbw = int(info.get("win_by_wickets", 0))
            if wbr > 0:
                margin = f"by {wbr} runs"
            elif wbw > 0:
                margin = f"by {wbw} wickets"
            else:
                margin = ""
            team_results[team].append({
                "match_number": match_num,
                "date": date,
                "opponent": opponent,
                "venue": venue,
                "result": result_str,
                "margin": margin,
            })

        # --- Batting scorecard ---
        batting_rows = read_csv(os.path.join(match_path, "batting_scorecard.csv"))
        for row in batting_rows:
            innings = int(row["innings"])
            team = team_1 if innings == 1 else team_2
            opponent = team_2 if innings == 1 else team_1
            batter = row["batter"]
            player_teams[batter] = team

            player_batting[batter].append({
                "match_number": match_num,
                "date": date,
                "opponent": opponent,
                "venue": venue,
                "runs": int(row["runs"]),
                "balls": int(row["balls"]),
                "fours": int(row["fours"]),
                "sixes": int(row["sixes"]),
                "strike_rate": float(row["strike_rate"]),
                "dismissal": row["dismissal"],
                "batting_position": int(row["batting_position"]),
            })

            team_batting[team].append({
                "match_number": match_num,
                "batter": batter,
                "runs": int(row["runs"]),
                "balls": int(row["balls"]),
                "fours": int(row["fours"]),
                "sixes": int(row["sixes"]),
                "strike_rate": float(row["strike_rate"]),
                "dismissal": row["dismissal"],
            })

        # --- Bowling scorecard ---
        bowling_rows = read_csv(os.path.join(match_path, "bowling_scorecard.csv"))
        for row in bowling_rows:
            innings = int(row["innings"])
            # Bowler's team is the fielding team
            team = team_2 if innings == 1 else team_1
            opponent = team_1 if innings == 1 else team_2
            bowler = row["bowler"]
            player_teams[bowler] = team

            player_bowling[bowler].append({
                "match_number": match_num,
                "date": date,
                "opponent": opponent,
                "venue": venue,
                "overs": float(row["overs"]),
                "maidens": int(row["maidens"]),
                "runs": int(row["runs"]),
                "wickets": int(row["wickets"]),
                "economy": float(row["economy"]),
                "dots": int(row["dots"]),
                "wides": int(row["wides"]),
                "noballs": int(row["noballs"]),
            })

            team_bowling[team].append({
                "match_number": match_num,
                "bowler": bowler,
                "overs": float(row["overs"]),
                "maidens": int(row["maidens"]),
                "runs": int(row["runs"]),
                "wickets": int(row["wickets"]),
                "economy": float(row["economy"]),
                "dots": int(row["dots"]),
            })

        # --- Fielding from phase_summary or ball_by_ball ---
        bbb_rows = read_csv(os.path.join(match_path, "ball_by_ball.csv"))
        match_fielding = defaultdict(lambda: {"catches": 0, "stumpings": 0, "run_outs": 0})
        for row in bbb_rows:
            if row["is_wicket"] == "True":
                fielder = row.get("fielder", "")
                kind = row.get("wicket_kind", "")
                innings = int(row["innings"])
                fielding_team = team_2 if innings == 1 else team_1

                if fielder:
                    for fn in fielder.split(", "):
                        fn = fn.strip()
                        if not fn:
                            continue
                        player_teams.setdefault(fn, fielding_team)
                        if kind in ("caught", "caught and bowled"):
                            match_fielding[fn]["catches"] += 1
                        elif kind == "stumped":
                            match_fielding[fn]["stumpings"] += 1
                        elif kind == "run out":
                            match_fielding[fn]["run_outs"] += 1

        for player, stats in match_fielding.items():
            innings_num = 1  # figure out opponent
            p_team = player_teams.get(player, "")
            opponent = team_1 if p_team == team_2 else team_2

            if player not in player_fielding:
                player_fielding[player] = {}
            player_fielding[player][match_num] = {
                "match_number": match_num,
                "date": date,
                "opponent": opponent,
                "catches": stats["catches"],
                "stumpings": stats["stumpings"],
                "run_outs": stats["run_outs"],
            }

    # --- Write per-player CSVs ---
    players_dir = os.path.join(season_dir, "players")

    all_players = set(list(player_batting.keys()) + list(player_bowling.keys()) + list(player_fielding.keys()))

    for player in sorted(all_players):
        pdir = os.path.join(players_dir, safe_name(player))

        if player in player_batting and player_batting[player]:
            write_csv(
                os.path.join(pdir, "batting.csv"),
                sorted(player_batting[player], key=lambda x: x["match_number"]),
            )

        if player in player_bowling and player_bowling[player]:
            write_csv(
                os.path.join(pdir, "bowling.csv"),
                sorted(player_bowling[player], key=lambda x: x["match_number"]),
            )

        if player in player_fielding and player_fielding[player]:
            write_csv(
                os.path.join(pdir, "fielding.csv"),
                sorted(player_fielding[player].values(), key=lambda x: x["match_number"]),
            )

    # --- Write per-team CSVs ---
    teams_dir = os.path.join(season_dir, "teams")

    for team in sorted(all_teams):
        tdir = os.path.join(teams_dir, safe_name(team))

        if team in team_batting:
            write_csv(os.path.join(tdir, "batting.csv"), team_batting[team])

        if team in team_bowling:
            write_csv(os.path.join(tdir, "bowling.csv"), team_bowling[team])

        if team in team_results:
            write_csv(os.path.join(tdir, "results.csv"), team_results[team])

    # --- Write master players.csv ---
    players_list = []
    for player in sorted(all_players):
        team = player_teams.get(player, "")
        has_batting = player in player_batting and len(player_batting[player]) > 0
        has_bowling = player in player_bowling and len(player_bowling[player]) > 0
        if has_batting and has_bowling:
            role = "all-rounder"
        elif has_bowling:
            role = "bowler"
        else:
            role = "batter"
        players_list.append({
            "player": player,
            "team": team,
            "role": role,
            "matches": len(set(
                [r["match_number"] for r in player_batting.get(player, [])] +
                [r["match_number"] for r in player_bowling.get(player, [])]
            )),
        })
    write_csv(os.path.join(season_dir, "players.csv"), players_list)

    print(f"Collected {len(all_players)} players, {len(all_teams)} teams from {len(match_dirs)} matches")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python collector.py <season_dir>")
        sys.exit(1)

    collect_season(sys.argv[1])
