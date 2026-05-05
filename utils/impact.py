"""Player impact / contribution score.

Hybrid model designed to track cricinfo's MVP "Smart Stats" methodology while
preserving a small per-ball pressure adjustment for chase / death-over context.

Base (cricinfo formula, season aggregates):

  Batting   B  = (R + 10·N) × S
              R = runs, N = not-outs, S = relative SR
              S = batter SR / league SR (clamped 0.5–2.0, no-op if balls < 30)

  Bowling   B₁ = (O × E) + (W × S₁), then × K_bat-bowl
              O = balls bowled, E = relative econ
              W = league avg wicket cost (league_balls / league_wickets)
              S₁ = relative bowling strike rate
              K = league_bat_total / league_bowl_total (puts both on same scale)

  Fielding  F  = catches × 8 + stumpings × 12 + run_outs × 6

Pressure layer (Option B):

  Each batter / bowler gets a pressure multiplier derived from the average
  pressure of the balls they were active on, divided by the league average.
  Clamped to [0.85, 1.15] so the per-ball nuance (death overs / chases / wickets
  in hand) nudges rankings without overwhelming the cricinfo signal.

This keeps the model transparent (every component has a clean, explainable
meaning) and matches cricinfo's published methodology so rankings track its
MVP table within a few positions.
"""

from __future__ import annotations

import pandas as pd


# Fielding flat weights (cricinfo doesn't publish theirs; these are reasonable
# defaults aligned with Dream11 / common fantasy systems).
W_CATCH = 8
W_STUMPING = 12
W_RUN_OUT = 6

# Multiplier clamps so a 1-over bowler at 0 econ doesn't get a 5× boost.
QUALITY_MIN = 0.5
QUALITY_MAX = 2.0
MIN_BALLS_FOR_BATTER_QUALITY = 30
MIN_BALLS_FOR_BOWLER_QUALITY = 24  # 4 overs

# Pressure adjustment range — kept narrow so it nudges, doesn't overwhelm.
PRESSURE_MIN = 0.85
PRESSURE_MAX = 1.15

# Bat/bowl balance.
#
# Cricinfo's formula has (O × E) + (W × S₁ × wickets) for bowling. Pure volume
# (O × E) rewards every economical over equally, so a frontline bowler bowling
# 240 balls at decent econ banks ~250 points before wickets. That over-rewards
# high-volume bowlers and clusters them tightly at the top of the list.
#
# Balance has two knobs. (1) BOWL_VOLUME_WEIGHT down-weights the volume term so
# wickets carry more of the bowling impact. (2) The homogenisation constant K
# is calibrated against the *top-3 mean* of each side, not season totals — top
# totals would let the broader batting tail mask the head concentration of
# bowlers. (3) An explicit BAT_BOWL_BALANCE multiplier on bowling absorbs any
# residual edge so the bat:bowl mix at the head of the list matches cricinfo.
BOWL_VOLUME_WEIGHT = 0.45
K_TOP_N = 3
BAT_BOWL_BALANCE = 0.80

BOWLER_ATTRIBUTABLE_KINDS = {
    "bowled", "caught", "caught and bowled", "lbw", "stumped", "hit wicket",
}


def _pressure_factor(phase: str, wickets_fallen: int, current_rr: float, rrr: float, innings: int) -> float:
    """Heuristic pressure multiplier for a single ball (0.9–3.9 range)."""
    pf = {"powerplay": 1.1, "middle": 1.0, "death": 1.3}.get(phase, 1.0)
    if wickets_fallen >= 8:
        wf = 2.0
    elif wickets_fallen >= 6:
        wf = 1.5
    elif wickets_fallen >= 3:
        wf = 1.2
    else:
        wf = 1.0
    cf = 1.0
    if innings == 2 and current_rr > 0 and rrr > 0:
        ratio = rrr / current_rr
        if ratio < 0.8:
            cf = 0.9
        elif ratio < 1.1:
            cf = 1.0
        elif ratio < 1.5:
            cf = 1.2
        else:
            cf = 1.5
    return pf * wf * cf


def _running_state(group: pd.DataFrame) -> pd.DataFrame:
    """Add per-ball state used by the pressure factor."""
    g = group.copy()
    g["_legal"] = (~g["extra_type"].astype(str).str.contains("wides|noballs", na=False)).astype(int)
    g["_wkt_int"] = g["is_wicket"].astype(bool).astype(int)
    g["cum_runs_after"] = g["total_runs"].cumsum()
    g["cum_runs_before"] = g["cum_runs_after"] - g["total_runs"]
    g["cum_wickets_before"] = g["_wkt_int"].cumsum() - g["_wkt_int"]
    g["cum_legal_before"] = g["_legal"].cumsum() - g["_legal"]
    legal = g["cum_legal_before"]
    g["current_rr"] = (g["cum_runs_before"] / (legal / 6)).where(legal > 0, 0.0)
    return g


def _overs_to_balls(overs):
    """Cricket overs (e.g. 3.4 = 3 overs + 4 balls = 22 balls) → balls."""
    if pd.isna(overs):
        return 0
    whole = int(overs)
    frac = round((overs - whole) * 10)
    return whole * 6 + frac


def _clamp(x, lo=QUALITY_MIN, hi=QUALITY_MAX):
    return max(lo, min(hi, x))


def _compute_pressure_per_player(bbb_df: pd.DataFrame, matches_df: pd.DataFrame) -> tuple[dict, dict, float]:
    """Return (batter→avg_pressure, bowler→avg_pressure, league_avg_pressure)."""
    if bbb_df.empty:
        return {}, {}, 1.0

    allotted_balls = {}
    if not matches_df.empty and "target_overs" in matches_df.columns:
        for _, m in matches_df.iterrows():
            tov = pd.to_numeric(m.get("target_overs"), errors="coerce")
            allotted_balls[int(m["match_number"])] = int(tov * 6) if pd.notna(tov) and tov > 0 else 120
    inn1_totals = (
        bbb_df[bbb_df["innings"] == 1].groupby("match_number")["total_runs"].sum().to_dict()
    )

    bbb = bbb_df.copy()
    bbb["_ball_order"] = range(len(bbb))
    bbb = bbb.sort_values(["match_number", "innings", "over", "_ball_order"])

    pieces = []
    for (mn, inn), grp in bbb.groupby(["match_number", "innings"], sort=False):
        target_balls = allotted_balls.get(int(mn), 120)
        target_runs = (inn1_totals.get(int(mn)) or 0) + 1 if inn == 2 else None
        gs = _running_state(grp)
        if inn == 2 and target_runs is not None:
            balls_remaining = (target_balls - gs["cum_legal_before"]).clip(lower=1)
            runs_needed = (target_runs - gs["cum_runs_before"]).clip(lower=0)
            gs["rrr"] = runs_needed / (balls_remaining / 6)
        else:
            gs["rrr"] = 0.0
        pieces.append(gs)
    bbb = pd.concat(pieces, ignore_index=True)

    bbb["pressure"] = [
        _pressure_factor(p, w, cr, rr, int(inn))
        for p, w, cr, rr, inn in zip(
            bbb["phase"], bbb["cum_wickets_before"],
            bbb["current_rr"], bbb["rrr"], bbb["innings"],
        )
    ]

    league_avg = float(bbb["pressure"].mean())

    # Batter pressure: weight by runs scored (so death-over runs matter more
    # than dot balls faced in the powerplay).
    bat_grp = bbb.groupby("batter").apply(
        lambda g: (g["pressure"] * g["batter_runs"]).sum() / g["batter_runs"].sum()
        if g["batter_runs"].sum() > 0 else g["pressure"].mean()
    )
    bowler_grp = bbb.groupby("bowler")["pressure"].mean()
    return bat_grp.to_dict(), bowler_grp.to_dict(), league_avg


def compute_impact_scores(
    bbb_df: pd.DataFrame,
    matches_df: pd.DataFrame,
    batting_scorecards: pd.DataFrame,
    bowling_scorecards: pd.DataFrame,
    fielding_df: pd.DataFrame,
    *,
    apply_pressure: bool = True,
    apply_quality: bool = True,
) -> pd.DataFrame:
    """Cricinfo-style MVP impact + per-ball pressure adjustment."""
    if bbb_df.empty and batting_scorecards.empty and bowling_scorecards.empty:
        return pd.DataFrame()

    # ── 1. Batting season aggregates ─────────────────────────────────────────
    if not batting_scorecards.empty:
        bat = batting_scorecards.copy()
        bat["_no"] = bat["dismissal"].astype(str).str.strip().str.lower().eq("not out").astype(int)
        bat_agg = bat.groupby(["batter", "team"]).agg(
            runs=("runs", "sum"),
            balls=("balls", "sum"),
            not_outs=("_no", "sum"),
            fifties=("runs", lambda s: ((s >= 50) & (s < 100)).sum()),
            hundreds=("runs", lambda s: (s >= 100).sum()),
            ducks=("runs", lambda s: ((s == 0) & (~bat.loc[s.index, "dismissal"].astype(str).str.strip().str.lower().isin(["not out", ""]))).sum()),
        ).reset_index().rename(columns={"batter": "player"})
    else:
        bat_agg = pd.DataFrame(columns=["player", "team", "runs", "balls", "not_outs", "fifties", "hundreds", "ducks"])

    # ── 2. Bowling season aggregates ─────────────────────────────────────────
    if not bowling_scorecards.empty:
        bowl = bowling_scorecards.copy()
        bowl["_balls"] = bowl["overs"].apply(_overs_to_balls)
        bowl_agg = bowl.groupby(["bowler", "team"]).agg(
            balls=("_balls", "sum"),
            runs=("runs", "sum"),
            wickets=("wickets", "sum"),
            maiden=("maidens", "sum"),
        ).reset_index().rename(columns={"bowler": "player"})
        # 4w / 5w hauls per innings
        per_inn = bowl.groupby(["bowler", "team", "match_number", "innings"])["wickets"].sum().reset_index()
        hauls = per_inn.groupby(["bowler", "team"]).agg(
            four_w=("wickets", lambda s: (s == 4).sum()),
            five_w=("wickets", lambda s: (s >= 5).sum()),
        ).reset_index().rename(columns={"bowler": "player"})
        bowl_agg = bowl_agg.merge(hauls, on=["player", "team"], how="left")
        bowl_agg[["four_w", "five_w"]] = bowl_agg[["four_w", "five_w"]].fillna(0).astype(int)
    else:
        bowl_agg = pd.DataFrame(columns=["player", "team", "balls", "runs", "wickets", "maiden", "four_w", "five_w"])

    # ── 3. League averages ───────────────────────────────────────────────────
    league_runs = float(bat_agg["runs"].sum()) if not bat_agg.empty else 0.0
    league_bat_balls = float(bat_agg["balls"].sum()) if not bat_agg.empty else 0.0
    league_sr = (league_runs / league_bat_balls * 100) if league_bat_balls > 0 else 130.0

    league_bowl_balls = float(bowl_agg["balls"].sum()) if not bowl_agg.empty else 0.0
    league_bowl_runs = float(bowl_agg["runs"].sum()) if not bowl_agg.empty else 0.0
    league_wickets = float(bowl_agg["wickets"].sum()) if not bowl_agg.empty else 0.0
    league_econ = (league_bowl_runs / league_bowl_balls * 6) if league_bowl_balls > 0 else 8.5
    league_bowl_sr = (league_bowl_balls / league_wickets) if league_wickets > 0 else 24.0

    # ── 4. Cricinfo batting base: B = (R + 10N) × S ──────────────────────────
    if not bat_agg.empty:
        bat_agg["sr"] = (bat_agg["runs"] / bat_agg["balls"].replace(0, pd.NA) * 100).fillna(league_sr)
        bat_agg["rel_sr"] = bat_agg.apply(
            lambda r: _clamp(r["sr"] / league_sr) if r["balls"] >= MIN_BALLS_FOR_BATTER_QUALITY else 1.0,
            axis=1,
        ) if apply_quality else 1.0
        bat_agg["bat_base"] = (bat_agg["runs"] + 10 * bat_agg["not_outs"]) * bat_agg["rel_sr"]

    # ── 5. Cricinfo bowling base: B₁ = (O·E) + (W·S₁) ────────────────────────
    avg_wicket_cost = league_bowl_sr  # W = league avg balls per wicket
    if not bowl_agg.empty:
        bowl_agg["econ"] = (bowl_agg["runs"] / bowl_agg["balls"].replace(0, pd.NA) * 6).fillna(league_econ)
        bowl_agg["rel_econ"] = bowl_agg.apply(
            lambda r: _clamp(league_econ / r["econ"]) if r["balls"] >= MIN_BALLS_FOR_BOWLER_QUALITY else 1.0,
            axis=1,
        ) if apply_quality else 1.0
        bowl_agg["bowl_sr_player"] = (bowl_agg["balls"] / bowl_agg["wickets"].replace(0, pd.NA)).fillna(league_bowl_sr * 2)
        bowl_agg["rel_bsr"] = bowl_agg.apply(
            lambda r: _clamp(league_bowl_sr / r["bowl_sr_player"]) if r["balls"] >= MIN_BALLS_FOR_BOWLER_QUALITY else 1.0,
            axis=1,
        ) if apply_quality else 1.0
        bowl_agg["bowl_base"] = (bowl_agg["balls"] * bowl_agg["rel_econ"] * BOWL_VOLUME_WEIGHT) + (
            bowl_agg["wickets"] * avg_wicket_cost * bowl_agg["rel_bsr"]
        )

    # ── 6. Homogenize bat vs bowl scale (cricinfo's K constant) ──────────────
    # Calibrate against top-N performers so the head of the list aligns. Using
    # season totals would give bowlers a structural edge (fewer specialists, so
    # the same total impact concentrates on fewer players → bowlers cluster at
    # the top).
    if not bat_agg.empty and "bat_base" in bat_agg.columns and not bowl_agg.empty and "bowl_base" in bowl_agg.columns:
        bat_top_mean = float(bat_agg["bat_base"].nlargest(K_TOP_N).mean())
        bowl_top_mean = float(bowl_agg["bowl_base"].nlargest(K_TOP_N).mean())
        K = (bat_top_mean / bowl_top_mean) if bowl_top_mean > 0 else 1.0
    else:
        K = 1.0
    if not bowl_agg.empty:
        bowl_agg["bowl_base_norm"] = bowl_agg["bowl_base"] * K * BAT_BOWL_BALANCE

    # ── 7. Per-ball pressure adjustment (Option B layer) ─────────────────────
    if apply_pressure:
        batter_p, bowler_p, league_avg_p = _compute_pressure_per_player(bbb_df, matches_df)
        if league_avg_p > 0:
            if not bat_agg.empty:
                bat_agg["pressure_mult"] = bat_agg["player"].map(
                    lambda p: _clamp(batter_p.get(p, league_avg_p) / league_avg_p, PRESSURE_MIN, PRESSURE_MAX)
                )
                bat_agg["bat_base"] = bat_agg["bat_base"] * bat_agg["pressure_mult"]
            if not bowl_agg.empty:
                bowl_agg["pressure_mult"] = bowl_agg["player"].map(
                    lambda p: _clamp(bowler_p.get(p, league_avg_p) / league_avg_p, PRESSURE_MIN, PRESSURE_MAX)
                )
                bowl_agg["bowl_base_norm"] = bowl_agg["bowl_base_norm"] * bowl_agg["pressure_mult"]

    # ── 8. Fielding (cricinfo doesn't publish weights; flat per-event) ───────
    if not fielding_df.empty:
        # Need a team for each fielder. Fielding rows lack team — derive from
        # batting/bowling scorecards (one player → one team this season).
        player_team_map = {}
        if not batting_scorecards.empty:
            for p, t in zip(batting_scorecards["batter"], batting_scorecards["team"]):
                player_team_map[p] = t
        if not bowling_scorecards.empty:
            for p, t in zip(bowling_scorecards["bowler"], bowling_scorecards["team"]):
                player_team_map.setdefault(p, t)
        f = fielding_df.copy()
        f["team"] = f["player"].map(player_team_map)
        f = f.dropna(subset=["team", "player"])
        field_agg = f.groupby(["player", "team"]).agg(
            catches=("catches", "sum"),
            stumpings=("stumpings", "sum"),
            run_outs=("run_outs", "sum"),
        ).reset_index()
        field_agg["field_base"] = (
            field_agg["catches"] * W_CATCH
            + field_agg["stumpings"] * W_STUMPING
            + field_agg["run_outs"] * W_RUN_OUT
        )
    else:
        field_agg = pd.DataFrame(columns=["player", "team", "catches", "stumpings", "run_outs", "field_base"])

    # ── 9. Combine bat / bowl / field on player ──────────────────────────────
    bat_min = bat_agg[["player", "team", "runs", "not_outs", "fifties", "hundreds", "ducks", "bat_base"]].rename(columns={"team": "batting_team"}) if not bat_agg.empty else pd.DataFrame(columns=["player", "batting_team", "runs", "not_outs", "fifties", "hundreds", "ducks", "bat_base"])
    bowl_min = bowl_agg[["player", "team", "balls", "wickets", "maiden", "four_w", "five_w", "bowl_base_norm"]].rename(columns={"team": "bowling_team", "balls": "legal_balls", "bowl_base_norm": "bowl_total"}) if not bowl_agg.empty else pd.DataFrame(columns=["player", "bowling_team", "legal_balls", "wickets", "maiden", "four_w", "five_w", "bowl_total"])
    field_min = field_agg.rename(columns={"team": "field_team", "field_base": "field_pts"})

    out = bat_min.merge(bowl_min, on="player", how="outer").merge(field_min, on="player", how="outer")
    out["team"] = out["batting_team"].fillna(out["bowling_team"]).fillna(out["field_team"])
    for col in ("runs", "not_outs", "fifties", "hundreds", "ducks", "wickets", "legal_balls",
                "maiden", "four_w", "five_w", "catches", "stumpings", "run_outs",
                "bat_base", "bowl_total", "field_pts"):
        if col in out.columns:
            out[col] = out[col].fillna(0)
    out["batting_impact"] = out["bat_base"].round(1)
    out["bowling_impact"] = out["bowl_total"].round(1)
    out["fielding_impact"] = out["field_pts"].round(1)
    out["total_impact"] = (out["batting_impact"] + out["bowling_impact"] + out["fielding_impact"]).round(1)
    out = out.dropna(subset=["team", "player"])

    # ── 10. Per-match normalization ──────────────────────────────────────────
    bat_matches = batting_scorecards[["batter", "match_number"]].rename(columns={"batter": "player"}) if not batting_scorecards.empty else pd.DataFrame(columns=["player", "match_number"])
    bowl_matches = bowling_scorecards[["bowler", "match_number"]].rename(columns={"bowler": "player"}) if not bowling_scorecards.empty else pd.DataFrame(columns=["player", "match_number"])
    field_matches = fielding_df[["player", "match_number"]] if not fielding_df.empty and "match_number" in fielding_df.columns else pd.DataFrame(columns=["player", "match_number"])
    all_matches = pd.concat([bat_matches, bowl_matches, field_matches], ignore_index=True).drop_duplicates()
    matches_count = all_matches.groupby("player")["match_number"].nunique().reset_index(name="matches_played")
    out = out.merge(matches_count, on="player", how="left")
    out["matches_played"] = out["matches_played"].fillna(0).astype(int)
    out["impact_per_match"] = out.apply(
        lambda r: round(r["total_impact"] / r["matches_played"], 1) if r["matches_played"] > 0 else 0.0,
        axis=1,
    )

    out = out[["player", "team", "matches_played", "runs", "not_outs", "wickets", "catches", "stumpings", "run_outs",
                "fifties", "hundreds", "ducks", "four_w", "five_w", "maiden",
                "batting_impact", "bowling_impact", "fielding_impact",
                "total_impact", "impact_per_match"]]
    return out.sort_values(["team", "total_impact"], ascending=[True, False]).reset_index(drop=True)
