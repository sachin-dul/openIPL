"""Rebuild data/{season}/points_table.csv from matches.csv, league stage only.

Mirrors scripts/orchestrator.py:build_points_table but sources match rows from
the already-written matches.csv, so it doesn't need to re-fetch or re-parse
Cricsheet JSON. Use this to retrofit historical seasons after the league-only
filter was introduced.

Usage:
    python scripts/regen_points_table.py                 # all seasons present
    python scripts/regen_points_table.py --seasons 2024,2025
"""
import argparse
import csv
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

FIELDNAMES = [
    "position", "team", "played", "won", "lost",
    "no_result", "net_run_rate", "points",
]


def overs_to_balls(overs: float) -> int:
    full = int(overs)
    balls = round((overs - full) * 10)
    return full * 6 + balls


def parse_score(s: str) -> tuple[int, int]:
    if not s:
        return 0, 0
    parts = s.split("/")
    runs = int(parts[0]) if parts[0] else 0
    wkts = int(parts[1]) if len(parts) > 1 and parts[1] else 0
    return runs, wkts


def build_table_for_season(season_dir: Path) -> list[dict]:
    matches_csv = season_dir / "matches.csv"
    if not matches_csv.exists():
        return []

    teams: dict[str, dict] = {}

    def ensure(team: str):
        if team and team not in teams:
            teams[team] = {
                "played": 0, "won": 0, "lost": 0, "no_result": 0, "points": 0,
                "runs_scored": 0, "balls_faced": 0,
                "runs_conceded": 0, "balls_bowled": 0,
            }

    with open(matches_csv, newline="") as f:
        for row in csv.DictReader(f):
            stage = (row.get("match_stage") or "league").strip()
            if stage != "league":
                continue

            team_1 = row.get("team_1", "").strip()
            team_2 = row.get("team_2", "").strip()
            if not team_1 or not team_2:
                continue
            ensure(team_1)
            ensure(team_2)

            result = (row.get("result") or "").strip()
            winner = (row.get("winner") or "").strip()

            teams[team_1]["played"] += 1
            teams[team_2]["played"] += 1

            if result == "no result":
                teams[team_1]["no_result"] += 1
                teams[team_1]["points"] += 1
                teams[team_2]["no_result"] += 1
                teams[team_2]["points"] += 1
            elif winner:
                loser = team_2 if winner == team_1 else team_1
                teams[winner]["won"] += 1
                teams[winner]["points"] += 2
                teams[loser]["lost"] += 1

            if result == "no result":
                continue

            try:
                target_overs = float(row.get("target_overs") or 20)
            except ValueError:
                target_overs = 20.0
            full_innings_balls = overs_to_balls(target_overs)

            for team, opp in ((team_1, team_2), (team_2, team_1)):
                runs, wkts = parse_score(row.get(f"{'team_1' if team == team_1 else 'team_2'}_score", ""))
                try:
                    overs = float(row.get(f"{'team_1' if team == team_1 else 'team_2'}_overs") or 0)
                except ValueError:
                    overs = 0.0
                balls = full_innings_balls if wkts == 10 else overs_to_balls(overs)

                opp_runs, opp_wkts = parse_score(row.get(f"{'team_1' if opp == team_1 else 'team_2'}_score", ""))
                try:
                    opp_overs = float(row.get(f"{'team_1' if opp == team_1 else 'team_2'}_overs") or 0)
                except ValueError:
                    opp_overs = 0.0
                opp_balls = full_innings_balls if opp_wkts == 10 else overs_to_balls(opp_overs)

                teams[team]["runs_scored"] += runs
                teams[team]["balls_faced"] += balls
                teams[team]["runs_conceded"] += opp_runs
                teams[team]["balls_bowled"] += opp_balls

    table = []
    for team, s in teams.items():
        if s["balls_faced"] and s["balls_bowled"]:
            nrr = round(
                (s["runs_scored"] / (s["balls_faced"] / 6.0))
                - (s["runs_conceded"] / (s["balls_bowled"] / 6.0)),
                3,
            )
        else:
            nrr = 0.0
        table.append({
            "team": team,
            "played": s["played"],
            "won": s["won"],
            "lost": s["lost"],
            "no_result": s["no_result"],
            "net_run_rate": nrr,
            "points": s["points"],
        })

    table.sort(key=lambda x: (-x["points"], -x["net_run_rate"]))
    for i, r in enumerate(table):
        r["position"] = i + 1

    return [{k: r[k] for k in FIELDNAMES} for r in table]


def write_table(season_dir: Path, rows: list[dict]):
    out = season_dir / "points_table.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(rows)


def parse_seasons_arg(arg: str | None) -> list[int]:
    if not arg:
        return sorted(int(p.name) for p in DATA_DIR.iterdir()
                      if p.is_dir() and p.name.isdigit())
    if "-" in arg and "," not in arg:
        lo, hi = arg.split("-", 1)
        return list(range(int(lo), int(hi) + 1))
    return [int(s) for s in arg.split(",") if s.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seasons", default=None,
                    help="Comma list (2024,2025), range (2008-2025), or omit for all.")
    args = ap.parse_args()

    seasons = parse_seasons_arg(args.seasons)
    if not seasons:
        print("No seasons found.", file=sys.stderr)
        return 1

    for yr in seasons:
        sd = DATA_DIR / str(yr)
        rows = build_table_for_season(sd)
        if not rows:
            print(f"  {yr}: skipped (no matches.csv or no league rows)")
            continue
        write_table(sd, rows)
        print(f"  {yr}: wrote {len(rows)} teams")
    return 0


if __name__ == "__main__":
    sys.exit(main())
