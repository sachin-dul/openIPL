"""
Core parser: transforms a single Cricsheet JSON file into per-match CSVs.

Produces (always):
  - ball_by_ball.csv
  - batting_scorecard.csv
  - bowling_scorecard.csv
  - partnerships.csv
  - fall_of_wickets.csv
  - phase_summary.csv

Produces (when data exists):
  - reviews.csv          (DRS reviews)
  - super_over.csv       (super over deliveries)
  - substitutions.csv    (impact player / concussion subs)
"""

import json
import os
import csv


def get_phase_ball_boundaries(total_overs):
    """Return (pp_balls, middle_balls) — cumulative ball counts for phase boundaries.

    For 20-over matches: PP = balls 1-36, Middle = 37-90, Death = 91-120.
    For shortened matches: PP = 30% of total balls (rounded to nearest ball),
    remaining 70% split equally between middle and death.
    """
    if total_overs >= 20:
        return 36, 90  # standard boundaries

    total_balls = int(total_overs) * 6 + round((total_overs % 1) * 10)
    pp_balls = round(total_balls * 0.30)
    remaining_balls = total_balls - pp_balls
    middle_balls = remaining_balls // 2
    return pp_balls, pp_balls + middle_balls


def get_phase(cumulative_legal_ball, total_overs=20):
    """Return phase based on cumulative legal ball number (1-indexed).

    For shortened matches, phase boundaries fall at ball level, not over level.
    """
    pp_end, middle_end = get_phase_ball_boundaries(total_overs)
    if cumulative_legal_ball <= pp_end:
        return "powerplay"
    elif cumulative_legal_ball <= middle_end:
        return "middle"
    else:
        return "death"


def parse_match(json_path, match_number_override=None):
    """Parse a Cricsheet JSON file and return all derived data as dicts."""
    with open(json_path) as f:
        data = json.load(f)

    info = data["info"]
    innings_data = data.get("innings", [])

    cricsheet_match_id = os.path.splitext(os.path.basename(json_path))[0]
    match_number = match_number_override if match_number_override is not None else info.get("event", {}).get("match_number", 0)
    date = info["dates"][0]
    venue = info.get("venue", "")
    teams = info["teams"]
    toss = info.get("toss", {})
    outcome = info.get("outcome", {})
    officials = info.get("officials", {})

    # Determine winner and margin
    winner = outcome.get("winner", "")
    win_by = outcome.get("by", {})
    win_by_runs = win_by.get("runs", 0)
    win_by_wickets = win_by.get("wickets", 0)
    result = outcome.get("result", "")  # "no result", "tie"
    method = outcome.get("method", "")  # "D/L", "DLS", etc.

    # Determine batting first / second
    if toss.get("decision") == "bat":
        team_1 = toss.get("winner", teams[0])
        team_2 = teams[1] if team_1 == teams[0] else teams[0]
    elif toss.get("decision") == "field":
        toss_winner = toss.get("winner", teams[0])
        team_2 = toss_winner
        team_1 = teams[1] if toss_winner == teams[0] else teams[0]
    else:
        team_1, team_2 = teams[0], teams[1]

    # Override with actual innings order if available
    if len(innings_data) >= 1:
        team_1 = innings_data[0]["team"]
        if len(innings_data) >= 2:
            team_2 = innings_data[1]["team"]
        else:
            team_2 = teams[1] if team_1 == teams[0] else teams[0]

    # --- Event metadata ---
    event = info.get("event", {})
    match_stage = event.get("stage", "league")

    # --- Player registry ---
    registry = info.get("registry", {}).get("people", {})

    # --- ball_by_ball.csv ---
    ball_by_ball = []
    # Track state for scorecards
    batting_stats = {}   # (innings, batter) -> stats
    bowling_stats = {}   # (innings, bowler) -> stats
    batting_order = {}   # (innings, batter) -> position
    fielding_stats = {}  # player -> {catches, stumpings, run_outs}
    fow = []             # fall of wickets
    partnerships = []    # partnership data
    phase_stats = {}     # (innings, team, phase) -> stats
    reviews = []         # DRS reviews
    super_over = []      # super over deliveries
    substitutions = []   # impact player / concussion subs

    innings_teams = {}  # inn_num -> (batting_team, bowling_team)

    # Pre-compute actual overs per innings for phase boundary calculation
    innings_actual_overs = {}  # inn_num (1-based) -> float overs
    _pre_inn = 0
    for innings in innings_data:
        if innings.get("super_over"):
            continue
        _pre_inn += 1
        _total_balls = 0
        for over_obj in innings["overs"]:
            for delivery in over_obj["deliveries"]:
                extras = delivery.get("extras", {})
                if "wides" not in extras and "noballs" not in extras:
                    _total_balls += 1
        _ov = _total_balls // 6
        _b = _total_balls % 6
        innings_actual_overs[_pre_inn] = float(f"{_ov}.{_b}")

    inn_num = 0  # track actual innings number (excludes super overs)
    for inn_idx, innings in enumerate(innings_data):
        batting_team = innings["team"]
        bowling_team = team_2 if batting_team == team_1 else team_1

        # --- Super over: capture separately and skip regular processing ---
        if innings.get("super_over"):
            so_ball_num = 0
            for over_obj in innings["overs"]:
                for delivery in over_obj["deliveries"]:
                    extras = delivery.get("extras", {})
                    is_legal = "wides" not in extras and "noballs" not in extras
                    if is_legal:
                        so_ball_num += 1
                    is_wicket = "wickets" in delivery
                    wicket_kind = ""
                    player_out = ""
                    if is_wicket:
                        w = delivery["wickets"][0]
                        wicket_kind = w["kind"]
                        player_out = w["player_out"]
                    super_over.append({
                        "team": batting_team,
                        "ball": so_ball_num,
                        "batter": delivery["batter"],
                        "bowler": delivery["bowler"],
                        "non_striker": delivery["non_striker"],
                        "batter_runs": delivery["runs"]["batter"],
                        "extra_runs": delivery["runs"]["extras"],
                        "total_runs": delivery["runs"]["total"],
                        "extra_type": ", ".join(extras.keys()) if extras else "",
                        "is_wicket": is_wicket,
                        "wicket_kind": wicket_kind,
                        "player_out": player_out,
                    })
            continue

        inn_num += 1
        innings_teams[inn_num] = (batting_team, bowling_team)
        position_counter = 0
        team_score = 0
        team_wickets = 0

        # Partnership tracking
        current_pair = None
        partnership_runs = 0
        partnership_balls = 0
        partnership_extras = 0
        pair_stats = {}  # batter -> {runs, balls}
        wicket_number = 0

        innings_total_overs = innings_actual_overs.get(inn_num, 20)
        innings_legal_balls = 0

        for over_obj in innings["overs"]:
            over_num = over_obj["over"]  # 0-indexed
            ball_counter = 0

            for delivery in over_obj["deliveries"]:
                batter = delivery["batter"]
                bowler = delivery["bowler"]
                non_striker = delivery["non_striker"]
                runs = delivery["runs"]
                batter_runs = runs["batter"]
                extra_runs = runs["extras"]
                total_runs = runs["total"]

                extras = delivery.get("extras", {})
                extra_type = ""
                if extras:
                    extra_type = ", ".join(extras.keys())

                is_wide = "wides" in extras
                is_noball = "noballs" in extras

                if not is_wide and not is_noball:
                    innings_legal_balls += 1
                phase = get_phase(max(innings_legal_balls, 1), innings_total_overs)

                # --- DRS reviews ---
                if "review" in delivery:
                    rev = delivery["review"]
                    reviews.append({
                        "innings": inn_num,
                        "over": over_num + 1,
                        "ball": ball_counter + 1,
                        "team": rev.get("by", ""),
                        "batter": rev.get("batter", batter),
                        "bowler": bowler,
                        "umpire": rev.get("umpire", ""),
                        "type": rev.get("type", ""),
                        "decision": rev.get("decision", ""),
                        "umpires_call": bool(rev.get("umpires_call", False)),
                    })

                # --- Substitutions (impact player, concussion, etc.) ---
                if "replacements" in delivery:
                    for sub in delivery["replacements"].get("match", []):
                        substitutions.append({
                            "innings": inn_num,
                            "over": over_num + 1,
                            "ball": ball_counter + 1,
                            "team": sub.get("team", ""),
                            "player_in": sub.get("in", ""),
                            "player_out": sub.get("out", ""),
                            "reason": sub.get("reason", ""),
                        })

                # Ball counting: wides and noballs don't count as legal deliveries
                is_legal = not is_wide and not is_noball
                if is_legal:
                    ball_counter += 1

                # Track batting order
                for b in [batter, non_striker]:
                    if (inn_num, b) not in batting_order:
                        position_counter += 1
                        batting_order[(inn_num, b)] = position_counter

                # Init batting stats
                if (inn_num, batter) not in batting_stats:
                    batting_stats[(inn_num, batter)] = {
                        "runs": 0, "balls": 0, "fours": 0, "sixes": 0,
                        "dismissal": "not out", "batting_position": batting_order[(inn_num, batter)],
                    }

                # Init bowling stats
                if (inn_num, bowler) not in bowling_stats:
                    bowling_stats[(inn_num, bowler)] = {
                        "balls": 0, "runs": 0, "wickets": 0, "maidens": 0,
                        "dots": 0, "wides": 0, "noballs": 0,
                    }

                # Update batting (wides don't count as balls faced)
                if not is_wide:
                    batting_stats[(inn_num, batter)]["balls"] += 1
                batting_stats[(inn_num, batter)]["runs"] += batter_runs
                if batter_runs == 4:
                    batting_stats[(inn_num, batter)]["fours"] += 1
                elif batter_runs == 6:
                    batting_stats[(inn_num, batter)]["sixes"] += 1

                # Update bowling
                if is_legal:
                    bowling_stats[(inn_num, bowler)]["balls"] += 1
                # Bowler concedes: batter runs + wides + noballs (not byes/legbyes)
                bowler_runs = batter_runs + extras.get("wides", 0) + extras.get("noballs", 0)
                bowling_stats[(inn_num, bowler)]["runs"] += bowler_runs
                if is_wide:
                    bowling_stats[(inn_num, bowler)]["wides"] += 1
                if is_noball:
                    bowling_stats[(inn_num, bowler)]["noballs"] += 1
                if total_runs == 0 and is_legal:
                    bowling_stats[(inn_num, bowler)]["dots"] += 1

                # Partnership tracking
                pair_key = tuple(sorted([batter, non_striker]))
                if current_pair is None:
                    current_pair = pair_key
                    pair_stats = {batter: {"runs": 0, "balls": 0}, non_striker: {"runs": 0, "balls": 0}}
                elif current_pair != pair_key:
                    # New partnership started (after a wicket was already recorded)
                    current_pair = pair_key
                    pair_stats = {}
                    for b in [batter, non_striker]:
                        pair_stats[b] = {"runs": 0, "balls": 0}
                    partnership_runs = 0
                    partnership_balls = 0
                    partnership_extras = 0

                if batter not in pair_stats:
                    pair_stats[batter] = {"runs": 0, "balls": 0}
                if non_striker not in pair_stats:
                    pair_stats[non_striker] = {"runs": 0, "balls": 0}

                pair_stats[batter]["runs"] += batter_runs
                if not is_wide:
                    pair_stats[batter]["balls"] += 1
                partnership_runs += total_runs
                if is_legal:
                    partnership_balls += 1
                partnership_extras += extra_runs

                team_score += total_runs

                # Phase stats
                phase_key = (inn_num, batting_team, phase)
                if phase_key not in phase_stats:
                    phase_stats[phase_key] = {
                        "runs": 0, "wickets": 0, "balls": 0,
                        "boundaries": 0, "dots": 0,
                    }
                phase_stats[phase_key]["runs"] += total_runs
                if is_legal:
                    phase_stats[phase_key]["balls"] += 1
                if batter_runs in (4, 6):
                    phase_stats[phase_key]["boundaries"] += 1
                if total_runs == 0 and is_legal:
                    phase_stats[phase_key]["dots"] += 1

                # Wickets
                is_wicket = "wickets" in delivery
                wicket_kind = ""
                player_out = ""
                fielder = ""
                if is_wicket:
                    for w in delivery["wickets"]:
                        wicket_kind = w["kind"]
                        player_out = w["player_out"]
                        fielders = w.get("fielders", [])
                        fielder = ", ".join(fd.get("name", "") for fd in fielders)

                        # Update batting dismissal
                        if (inn_num, player_out) not in batting_stats:
                            batting_stats[(inn_num, player_out)] = {
                                "runs": 0, "balls": 0, "fours": 0, "sixes": 0,
                                "dismissal": "", "batting_position": batting_order.get((inn_num, player_out), 0),
                            }

                        # Build dismissal string
                        if wicket_kind == "caught":
                            if fielder == bowler:
                                batting_stats[(inn_num, player_out)]["dismissal"] = f"c & b {bowler}"
                            else:
                                batting_stats[(inn_num, player_out)]["dismissal"] = f"c {fielder} b {bowler}"
                        elif wicket_kind == "caught and bowled":
                            batting_stats[(inn_num, player_out)]["dismissal"] = f"c & b {bowler}"
                        elif wicket_kind == "bowled":
                            batting_stats[(inn_num, player_out)]["dismissal"] = f"b {bowler}"
                        elif wicket_kind == "lbw":
                            batting_stats[(inn_num, player_out)]["dismissal"] = f"lbw b {bowler}"
                        elif wicket_kind == "stumped":
                            batting_stats[(inn_num, player_out)]["dismissal"] = f"st {fielder} b {bowler}"
                        elif wicket_kind == "run out":
                            batting_stats[(inn_num, player_out)]["dismissal"] = f"run out ({fielder})"
                        elif wicket_kind == "hit wicket":
                            batting_stats[(inn_num, player_out)]["dismissal"] = f"hit wicket b {bowler}"
                        elif wicket_kind in ("retired hurt", "retired out"):
                            batting_stats[(inn_num, player_out)]["dismissal"] = wicket_kind
                        else:
                            batting_stats[(inn_num, player_out)]["dismissal"] = wicket_kind

                        # Bowling wickets (exclude run outs, retired)
                        if wicket_kind not in ("run out", "retired hurt", "retired out"):
                            bowling_stats[(inn_num, bowler)]["wickets"] += 1

                        # Fielding stats
                        if fielder and wicket_kind in ("caught", "caught and bowled"):
                            for fd in fielders:
                                fn = fd.get("name", "")
                                if fn:
                                    fielding_stats.setdefault(fn, {"catches": 0, "stumpings": 0, "run_outs": 0})
                                    fielding_stats[fn]["catches"] += 1
                        elif wicket_kind == "stumped":
                            for fd in fielders:
                                fn = fd.get("name", "")
                                if fn:
                                    fielding_stats.setdefault(fn, {"catches": 0, "stumpings": 0, "run_outs": 0})
                                    fielding_stats[fn]["stumpings"] += 1
                        elif wicket_kind == "run out":
                            for fd in fielders:
                                fn = fd.get("name", "")
                                if fn:
                                    fielding_stats.setdefault(fn, {"catches": 0, "stumpings": 0, "run_outs": 0})
                                    fielding_stats[fn]["run_outs"] += 1

                        # Fall of wickets
                        team_wickets += 1
                        if ball_counter == 6:
                            over_ball = f"{over_num + 1}.6"
                        else:
                            over_ball = f"{over_num + 1}.{ball_counter}"
                        fow.append({
                            "innings": inn_num,
                            "team": batting_team,
                            "wicket_number": team_wickets,
                            "player_out": player_out,
                            "score": team_score,
                            "over": over_ball,
                        })

                        # Save completed partnership
                        wicket_number += 1
                        batters = list(pair_stats.keys())
                        b1 = batters[0] if batters else ""
                        b2 = batters[1] if len(batters) > 1 else ""
                        partnerships.append({
                            "innings": inn_num,
                            "team": batting_team,
                            "wicket_number": wicket_number,
                            "batter_1": b1,
                            "batter_1_runs": pair_stats.get(b1, {}).get("runs", 0),
                            "batter_1_balls": pair_stats.get(b1, {}).get("balls", 0),
                            "batter_2": b2,
                            "batter_2_runs": pair_stats.get(b2, {}).get("runs", 0),
                            "batter_2_balls": pair_stats.get(b2, {}).get("balls", 0),
                            "total_runs": partnership_runs,
                            "total_balls": partnership_balls,
                        })

                        phase_stats[phase_key]["wickets"] += 1

                # Ball-by-ball row
                ball_by_ball.append({
                    "innings": inn_num,
                    "team": batting_team,
                    "over": over_num + 1,
                    "ball": ball_counter if is_legal else f"{ball_counter + 1}.{extra_type}",
                    "batter": batter,
                    "bowler": bowler,
                    "non_striker": non_striker,
                    "batter_runs": batter_runs,
                    "extra_runs": extra_runs,
                    "total_runs": total_runs,
                    "extra_type": extra_type,
                    "wides": extras.get("wides", 0),
                    "noballs": extras.get("noballs", 0),
                    "byes": extras.get("byes", 0),
                    "legbyes": extras.get("legbyes", 0),
                    "penalty": extras.get("penalty", 0),
                    "is_wicket": is_wicket,
                    "wicket_kind": wicket_kind,
                    "player_out": player_out,
                    "fielder": fielder,
                    "phase": phase,
                })

        # Compute maiden overs for this innings
        for over_obj in innings["overs"]:
            over_num = over_obj["over"]
            over_runs = 0
            for delivery in over_obj["deliveries"]:
                extras = delivery.get("extras", {})
                is_wide = "wides" in extras
                is_noball = "noballs" in extras
                if is_wide or is_noball:
                    over_runs += 1  # not a maiden if wide/noball
                over_runs += delivery["runs"]["total"]
            if over_runs == 0:
                # Find which bowler bowled this over
                bowler_name = over_obj["deliveries"][0]["bowler"]
                if (inn_num, bowler_name) in bowling_stats:
                    bowling_stats[(inn_num, bowler_name)]["maidens"] += 1

        # Save final unbroken partnership (skip if all out)
        if current_pair and pair_stats and team_wickets < 10:
            batters = list(pair_stats.keys())
            b1 = batters[0] if batters else ""
            b2 = batters[1] if len(batters) > 1 else ""
            partnerships.append({
                "innings": inn_num,
                "team": batting_team,
                "wicket_number": wicket_number + 1,
                "batter_1": b1,
                "batter_1_runs": pair_stats.get(b1, {}).get("runs", 0),
                "batter_1_balls": pair_stats.get(b1, {}).get("balls", 0),
                "batter_2": b2,
                "batter_2_runs": pair_stats.get(b2, {}).get("runs", 0),
                "batter_2_balls": pair_stats.get(b2, {}).get("balls", 0),
                "total_runs": partnership_runs,
                "total_balls": partnership_balls,
            })

    # --- Build batting scorecard ---
    batting_scorecard = []
    for (inn_num, batter), stats in sorted(batting_stats.items(), key=lambda x: (x[0][0], x[1]["batting_position"])):
        balls = stats["balls"]
        sr = round((stats["runs"] / balls) * 100, 2) if balls > 0 else 0.0
        batting_scorecard.append({
            "innings": inn_num,
            "team": innings_teams[inn_num][0],
            "batter": batter,
            "runs": stats["runs"],
            "balls": balls,
            "fours": stats["fours"],
            "sixes": stats["sixes"],
            "strike_rate": sr,
            "dismissal": stats["dismissal"],
            "batting_position": stats["batting_position"],
        })

    # --- Build bowling scorecard ---
    bowling_scorecard = []
    for (inn_num, bowler), stats in sorted(bowling_stats.items(), key=lambda x: x[0]):
        balls = stats["balls"]
        overs_complete = balls // 6
        overs_partial = balls % 6
        overs = float(f"{overs_complete}.{overs_partial}")
        economy = round(stats["runs"] / (balls / 6), 2) if balls > 0 else 0.0
        bowling_scorecard.append({
            "innings": inn_num,
            "team": innings_teams[inn_num][1],
            "bowler": bowler,
            "overs": overs,
            "maidens": stats["maidens"],
            "runs": stats["runs"],
            "wickets": stats["wickets"],
            "economy": economy,
            "dots": stats["dots"],
            "wides": stats["wides"],
            "noballs": stats["noballs"],
        })

    # --- Build phase summary ---
    phase_summary = []
    for (inn_num, team, phase), stats in sorted(phase_stats.items()):
        balls = stats["balls"]
        rr = round(stats["runs"] / (balls / 6), 2) if balls > 0 else 0.0
        phase_summary.append({
            "innings": inn_num,
            "team": team,
            "phase": phase,
            "runs": stats["runs"],
            "wickets": stats["wickets"],
            "balls": balls,
            "run_rate": rr,
            "boundaries": stats["boundaries"],
            "dots": stats["dots"],
        })

    # --- Compute team scores for matches.csv (exclude super overs) ---
    team_scores = {}
    for inn_idx, innings in enumerate(innings_data):
        if innings.get("super_over"):
            continue
        team = innings["team"]
        total = 0
        wickets = 0
        for over_obj in innings["overs"]:
            for delivery in over_obj["deliveries"]:
                total += delivery["runs"]["total"]
                if "wickets" in delivery:
                    for w in delivery["wickets"]:
                        if w["kind"] not in ("retired hurt", "retired out"):
                            wickets += 1
        team_scores[team] = f"{total}/{wickets}"

    # Compute overs bowled per innings (for NRR, exclude super overs)
    innings_overs = {}
    # Extract target overs for 2nd innings (< 20 means rain-shortened)
    target_overs = 20
    for inn_idx, innings in enumerate(innings_data):
        if innings.get("super_over"):
            continue
        team = innings["team"]
        target = innings.get("target", {})
        if target.get("overs") and target["overs"] < 20:
            target_overs = target["overs"]
        total_balls = 0
        for over_obj in innings["overs"]:
            for delivery in over_obj["deliveries"]:
                extras = delivery.get("extras", {})
                if "wides" not in extras and "noballs" not in extras:
                    total_balls += 1
        overs_complete = total_balls // 6
        overs_partial = total_balls % 6
        innings_overs[team] = float(f"{overs_complete}.{overs_partial}")

    umpires = officials.get("umpires", [])
    match_row = {
        "cricsheet_match_id": cricsheet_match_id,
        "match_number": match_number,
        "date": date,
        "venue": venue,
        "team_1": team_1,
        "team_2": team_2,
        "toss_winner": toss.get("winner", ""),
        "toss_decision": toss.get("decision", ""),
        "winner": winner,
        "result": result,
        "win_by_runs": win_by_runs,
        "win_by_wickets": win_by_wickets,
        "player_of_match": ", ".join(info.get("player_of_match", [])),
        "team_1_score": team_scores.get(team_1, ""),
        "team_2_score": team_scores.get(team_2, ""),
        "team_1_overs": innings_overs.get(team_1, 0.0),
        "team_2_overs": innings_overs.get(team_2, 0.0),
        "method": method,
        "target_overs": target_overs,
        "match_stage": match_stage,
        "umpire_1": umpires[0] if len(umpires) > 0 else "",
        "umpire_2": umpires[1] if len(umpires) > 1 else "",
        "tv_umpire": ", ".join(officials.get("tv_umpires", [])),
        "match_referee": ", ".join(officials.get("match_referees", [])),
    }

    return {
        "match": match_row,
        "ball_by_ball": ball_by_ball,
        "batting_scorecard": batting_scorecard,
        "bowling_scorecard": bowling_scorecard,
        "partnerships": partnerships,
        "fall_of_wickets": fow,
        "phase_summary": phase_summary,
        "fielding_stats": fielding_stats,
        "reviews": reviews,
        "super_over": super_over,
        "substitutions": substitutions,
        "registry": registry,
        "team_scores": team_scores,
        "innings_overs": innings_overs,
        "team_1": team_1,
        "team_2": team_2,
    }


def write_csv(filepath, rows, fieldnames=None):
    """Write a list of dicts to CSV."""
    if not rows:
        return
    if fieldnames is None:
        fieldnames = list(rows[0].keys())
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_match_csvs(parsed, output_dir):
    """Write all per-match CSVs to output_dir."""
    write_csv(os.path.join(output_dir, "ball_by_ball.csv"), parsed["ball_by_ball"])
    write_csv(os.path.join(output_dir, "batting_scorecard.csv"), parsed["batting_scorecard"])
    write_csv(os.path.join(output_dir, "bowling_scorecard.csv"), parsed["bowling_scorecard"])
    write_csv(os.path.join(output_dir, "partnerships.csv"), parsed["partnerships"])
    write_csv(os.path.join(output_dir, "fall_of_wickets.csv"), parsed["fall_of_wickets"])
    write_csv(os.path.join(output_dir, "phase_summary.csv"), parsed["phase_summary"])
    # Conditional CSVs — only written when data exists
    if parsed["reviews"]:
        write_csv(os.path.join(output_dir, "reviews.csv"), parsed["reviews"])
    if parsed["super_over"]:
        write_csv(os.path.join(output_dir, "super_over.csv"), parsed["super_over"])
    if parsed["substitutions"]:
        write_csv(os.path.join(output_dir, "substitutions.csv"), parsed["substitutions"])


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python parser.py <json_file> <output_dir>")
        sys.exit(1)

    json_file = sys.argv[1]
    output_dir = sys.argv[2]

    parsed = parse_match(json_file)
    write_match_csvs(parsed, output_dir)
    print(f"Wrote match CSVs to {output_dir}")
