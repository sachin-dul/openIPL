"""Insert known league-stage washout / cancelled fixtures into data/{year}/matches.csv.

Cricsheet only publishes JSON for matches where a ball was bowled. Fixtures
abandoned without a toss/ball never appear in matches.csv, so the league points
table under-counts games for the affected teams. This script appends those
fixtures with result='no result' so the points-table builder credits each team
with 1 point and 1 NR per ICC rules.

When a missing match's official match_number collides with the auto-renumbered
playoff stages already in matches.csv (e.g. 2024 #70 vs the current Q1@70),
the playoffs are bumped up to make room.

Usage:
    python scripts/patch_washouts.py            # apply all patches
    python scripts/patch_washouts.py --dry-run  # show what would change
"""
import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Field order mirrors what scripts/parser.py emits.
FIELDS = [
    "cricsheet_match_id", "match_number", "date", "venue",
    "team_1", "team_2", "toss_winner", "toss_decision",
    "winner", "result", "win_by_runs", "win_by_wickets",
    "player_of_match", "team_1_score", "team_2_score",
    "team_1_overs", "team_2_overs", "method", "target_overs",
    "match_stage", "umpire_1", "umpire_2", "tv_umpire", "match_referee",
]

# Researched from Wikipedia / Cricinfo. Each entry is an official league-stage
# fixture that produced no Cricsheet JSON (no ball bowled).
WASHOUTS = [
    # season, match_number, date, venue, team_1, team_2, reason
    (2008, 47, "2008-05-22", "Feroz Shah Kotla, Delhi",
     "Delhi Daredevils", "Kolkata Knight Riders",
     "Abandoned without a ball due to rain"),
    (2009,  7, "2009-04-22", "Kingsmead, Durban",
     "Mumbai Indians", "Rajasthan Royals",
     "Abandoned without a ball due to rain"),
    (2009, 13, "2009-04-25", "Newlands, Cape Town",
     "Chennai Super Kings", "Kolkata Knight Riders",
     "Abandoned without a ball due to rain"),
    (2011, 20, "2011-04-19", "M Chinnaswamy Stadium, Bengaluru",
     "Royal Challengers Bangalore", "Rajasthan Royals",
     "Abandoned without a ball due to rain"),
    (2012, 32, "2012-04-24", "Eden Gardens, Kolkata",
     "Kolkata Knight Riders", "Deccan Chargers",
     "Abandoned without a ball due to rain"),
    (2012, 34, "2012-04-25", "M Chinnaswamy Stadium, Bengaluru",
     "Royal Challengers Bangalore", "Chennai Super Kings",
     "Abandoned without a ball due to rain"),
    (2015, 25, "2015-04-26", "Eden Gardens, Kolkata",
     "Kolkata Knight Riders", "Rajasthan Royals",
     "Abandoned without a ball due to rain"),
    (2017, 29, "2017-04-25", "M Chinnaswamy Stadium, Bengaluru",
     "Royal Challengers Bangalore", "Sunrisers Hyderabad",
     "Abandoned without a ball due to rain"),
    (2024, 63, "2024-05-13", "Narendra Modi Stadium, Ahmedabad",
     "Gujarat Titans", "Kolkata Knight Riders",
     "Abandoned without a ball due to rain and lightning"),
    (2024, 66, "2024-05-16", "Rajiv Gandhi International Stadium, Uppal, Hyderabad",
     "Sunrisers Hyderabad", "Gujarat Titans",
     "Abandoned without a ball due to rain"),
    (2024, 70, "2024-05-19", "Barsapara Cricket Stadium, Guwahati",
     "Rajasthan Royals", "Kolkata Knight Riders",
     "Abandoned without a ball due to rain"),
    # IPL 2025: RCB-KKR (originally May 17, Bengaluru) cancelled outright after
    # the Pahalgam-attack pause; no replay was scheduled. Per official records
    # it still counts as a no-result for both teams. There is no in-sequence
    # gap because BCCI's post-pause schedule renumbered around it — placing it
    # at #71 lets the playoff renumberer push Q1 onward.
    (2025, 71, "2025-05-17", "M Chinnaswamy Stadium, Bengaluru",
     "Royal Challengers Bengaluru", "Kolkata Knight Riders",
     "Cancelled after the IPL 2025 mid-season pause; no replay scheduled"),
]


# Rows whose match_stage should be downgraded from 'league' to 'league_replayed'
# because the fixture was abandoned in flight and later replayed in full. Per
# IPL Playing Conditions the replay is the same fixture, so only one row should
# count toward standings. Ball-by-ball data on the abandoned attempt is kept.
SUPERSEDED = [
    # season, match_number, replayed_as, note
    (2025, 58, 66,
     "PBKS-DC May 8 Dharamshala abandoned after 10.1 overs (sirens); "
     "replayed in full as m66 on May 24 at Jaipur"),
]


def build_washout_row(date, venue, team_1, team_2, match_number, reason):
    """Build a matches.csv row for a fixture that never produced ball data."""
    row = {f: "" for f in FIELDS}
    row["match_number"] = str(match_number)
    row["date"] = date
    row["venue"] = venue
    row["team_1"] = team_1
    row["team_2"] = team_2
    row["result"] = "no result"
    row["match_stage"] = "league"
    row["target_overs"] = "20"
    # Stash the reason in method so it survives downstream tooling without
    # cluttering the visible columns. Empty otherwise.
    row["method"] = reason
    return row


def patch_season(season, fixtures, dry_run=False):
    """Insert the fixtures into data/{season}/matches.csv.

    If the new league match_number collides with an existing playoff row's
    match_number (because earlier orchestrator runs auto-numbered playoffs
    starting just after the Cricsheet-visible league max), bump every
    affected playoff number up by the required offset.
    """
    path = DATA / str(season) / "matches.csv"
    if not path.exists():
        print(f"  {season}: matches.csv not found, skipping")
        return

    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))

    existing_nums = {int(r["match_number"]) for r in rows}
    league_max = max(
        (int(r["match_number"]) for r in rows if (r.get("match_stage") or "") == "league"),
        default=0,
    )
    new_numbers = [n for (_, n, *_rest) in fixtures]
    new_max = max(new_numbers + [league_max])

    # Bump playoff numbers if any new league number collides or exceeds them.
    # Only actual playoff stages (Qualifier 1/2, Eliminator, Final, etc.) are
    # bumpable. 'league' and 'league_replayed' must keep their official numbers.
    non_playoff_stages = {"", "league", "league_replayed"}
    bumped = []
    playoffs = [r for r in rows
                if (r.get("match_stage") or "").strip() not in non_playoff_stages]
    playoffs.sort(key=lambda r: int(r["match_number"]))
    desired_start = new_max + 1
    for i, r in enumerate(playoffs):
        target = desired_start + i
        if int(r["match_number"]) != target:
            bumped.append((r["match_stage"], int(r["match_number"]), target))
            r["match_number"] = str(target)

    # Refresh the occupied-number set after bumping playoffs.
    occupied = {int(r["match_number"]) for r in rows}
    # Rows we'd recognize as our own prior washout inserts (no cricsheet id +
    # league stage). Skip silently if the patch was already applied.
    already_patched = {
        int(r["match_number"]) for r in rows
        if (r.get("match_stage") or "") == "league"
        and not (r.get("cricsheet_match_id") or "").strip()
    }
    new_rows = []
    for (_yr, mn, date, venue, t1, t2, reason) in fixtures:
        if mn in already_patched:
            continue  # idempotent: row was inserted on a prior run
        if mn in occupied:
            print(f"    !! {season} m{mn}: number still occupied after bump; skipping")
            continue
        new_rows.append(build_washout_row(date, venue, t1, t2, mn, reason))

    rows.extend(new_rows)
    rows.sort(key=lambda r: int(r["match_number"]))

    if dry_run:
        for r in new_rows:
            print(f"    + m{r['match_number']:>2}  {r['date']}  {r['team_1']} vs {r['team_2']}")
        for stage, old, new in bumped:
            print(f"    ~ {stage}: m{old} → m{new}")
        return

    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        # csv.DictWriter ignores extra keys not in fieldnames
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})

    for r in new_rows:
        print(f"    + m{r['match_number']:>2}  {r['date']}  {r['team_1']} vs {r['team_2']}")
    for stage, old, new in bumped:
        print(f"    ~ {stage}: m{old} → m{new}")


def mark_superseded(season, entries, dry_run=False):
    """Downgrade match_stage='league' → 'league_replayed' on the abandoned attempt."""
    path = DATA / str(season) / "matches.csv"
    if not path.exists():
        return
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    by_num = {entry[1]: entry for entry in entries}
    changed = []
    for r in rows:
        try:
            mn = int(r["match_number"])
        except ValueError:
            continue
        if mn in by_num and (r.get("match_stage") or "") == "league":
            _, _, replay_num, note = by_num[mn]
            r["match_stage"] = "league_replayed"
            changed.append((mn, replay_num, note))
    if dry_run:
        for mn, repl, note in changed:
            print(f"    ~ m{mn} → league_replayed (replayed as m{repl})")
        return
    if changed:
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in FIELDS})
        for mn, repl, note in changed:
            print(f"    ~ m{mn} → league_replayed (replayed as m{repl})")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Show changes, don't write.")
    args = ap.parse_args()

    by_season_wash = {}
    for entry in WASHOUTS:
        by_season_wash.setdefault(entry[0], []).append(entry)

    by_season_sup = {}
    for entry in SUPERSEDED:
        by_season_sup.setdefault(entry[0], []).append(entry)

    # Apply supersede markers first so playoff renumbering can be based on the
    # most current league-stage rows.
    seasons = sorted(set(by_season_wash) | set(by_season_sup))
    for season in seasons:
        print(f"\n{season}:")
        if season in by_season_sup:
            mark_superseded(season, by_season_sup[season], dry_run=args.dry_run)
        if season in by_season_wash:
            patch_season(season, by_season_wash[season], dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
