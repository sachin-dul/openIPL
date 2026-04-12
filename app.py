"""openIPL Dashboard — IPL Analytics (Shiny for Python)."""

from shiny import App, reactive, render, ui
import pandas as pd
import plotly.graph_objects as go

from utils.data_loader import (
    load_matches, load_ball_by_ball, load_batting_scorecards,
    load_bowling_scorecards, load_partnerships, load_fall_of_wickets,
    load_phase_summaries, load_points_table, load_reviews,
    load_substitutions, load_all_fielding,
)
from utils.charts import (
    horizontal_bar, vertical_bar, line_chart, worm_chart,
    phase_comparison_chart, fow_timeline, _apply_style,
    manhattan_chart, run_rate_chart,
    team_dna_heatmap, team_radar_chart,
    runs_per_over_innings_compare,
    economy_vs_average_scatter,
    TEAM_COLORS, LAYOUT_TEMPLATE,
    team_color, team_logo, team_short,
)


def plotly_ui(fig):
    """Render a Plotly figure as HTML. Plotly JS is loaded once in <head>."""
    return ui.HTML(fig.to_html(full_html=False, include_plotlyjs=False, config={"displayModeBar": False}))


def _overs_to_balls(overs):
    """Convert overs (e.g. 11.3) to total legal balls (e.g. 69)."""
    ov = int(overs)
    balls = round((overs - ov) * 10)
    return ov * 6 + balls


def _normalize_score(score, overs, target_overs=20):
    """Normalize a score to 20-over equivalent. Only applies to rain-shortened matches (target_overs < 20)."""
    target_overs = pd.to_numeric(target_overs, errors="coerce")
    overs = pd.to_numeric(overs, errors="coerce")
    if pd.isna(target_overs) or target_overs >= 20 or pd.isna(overs) or overs <= 0:
        return score
    full_balls = int(target_overs * 6)
    balls = _overs_to_balls(overs)
    if balls >= 120 or balls == 0 or balls != full_balls:
        return score
    return score * 120 / balls


def _exclude_no_results(matches_df):
    """Filter out abandoned/no-result matches — these don't count in official stats."""
    if "result" in matches_df.columns:
        return matches_df[matches_df["result"] != "no result"]
    return matches_df


def _nr_match_numbers(matches_df):
    """Return set of match numbers that are no-result."""
    if "result" in matches_df.columns:
        return set(matches_df[matches_df["result"] == "no result"]["match_number"])
    return set()


def _has_rain_shortened(matches_df):
    """Check if any matches were rain-shortened (target_overs < 20)."""
    if "target_overs" not in matches_df.columns:
        return False
    t = pd.to_numeric(matches_df["target_overs"], errors="coerce")
    return (t.dropna() < 20).any()


HOME_VENUES = {
    "Chennai Super Kings": "MA Chidambaram Stadium, Chepauk, Chennai",
    "Mumbai Indians": "Wankhede Stadium, Mumbai",
    "Royal Challengers Bengaluru": "M Chinnaswamy Stadium, Bengaluru",
    "Kolkata Knight Riders": "Eden Gardens, Kolkata",
    "Rajasthan Royals": "Barsapara Cricket Stadium, Guwahati",
    "Sunrisers Hyderabad": "Rajiv Gandhi International Stadium, Uppal, Hyderabad",
    "Delhi Capitals": "Arun Jaitley Stadium, Delhi",
    "Punjab Kings": "Maharaja Yadavindra Singh International Cricket Stadium, New Chandigarh",
    "Gujarat Titans": "Narendra Modi Stadium, Ahmedabad",
    "Lucknow Super Giants": "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium, Lucknow",
}

RAIN_AVG_FOOTNOTE = '<div style="font-size:11px;color:#6b7280;margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb">Rain-shortened matches excluded from averages</div>'
RAIN_PHASE_FOOTNOTE = '<div style="font-size:11px;color:#6b7280;margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb">* Includes rain-shortened match(es) where each ball is assigned to a phase based on adjusted overs (PP = 30% of total balls, remaining 70% split equally between middle and death)</div>'


def empty_state(message="No data available"):
    """Styled empty state placeholder."""
    return ui.HTML(
        f'<div class="empty-state">'
        f'<div class="icon">&#128202;</div>'
        f'<div class="message">{message}</div>'
        f'</div>'
    )


def styled_table(df, highlight_cols=None, bold_cols=None, align_right=None, player_col=None, player_teams=None):
    """Render a DataFrame as a styled HTML table.

    highlight_cols: list of column names to highlight with accent color
    bold_cols: list of column names to render bold
    align_right: list of column names to right-align (numeric cols)
    player_col: column name containing player names (to prepend team logo)
    player_teams: dict mapping player name -> team name
    """
    highlight_cols = highlight_cols or []
    bold_cols = bold_cols or []
    align_right = align_right or []
    player_teams = player_teams or {}

    # Right-align all columns except player/name columns (first col, bold cols, player col)
    if not align_right:
        text_cols = set(bold_cols or [])
        if player_col:
            text_cols.add(player_col)
        for col in df.columns:
            if col not in text_cols:
                align_right.append(col)

    header = "".join(
        f'<th style="padding:8px 12px;text-align:{"right" if c in align_right else "left"};'
        f'border-bottom:2px solid #1a56db;font-weight:700;font-size:12px;color:#1a56db;'
        f'text-transform:uppercase;letter-spacing:0.5px;background:#f8f9fc">{c}</th>'
        for c in df.columns
    )
    rows = ""
    for i, (_, row) in enumerate(df.iterrows()):
        bg = "#f9fafb" if i % 2 == 1 else "transparent"
        cells = ""
        for c in df.columns:
            val = row[c]
            style = f'padding:8px 12px;text-align:{"right" if c in align_right else "left"};color:#1f2937;'
            if c in highlight_cols:
                style += "color:#1a56db;font-weight:700;"
            elif c in bold_cols:
                style += "font-weight:700;"
            if c == player_col and val in player_teams:
                logo_url = team_logo(player_teams[val])
                if logo_url:
                    val = f'<img src="{logo_url}" style="height:18px;width:18px;object-fit:contain;vertical-align:middle;margin-right:6px" onerror="this.style.display=\'none\'">{val}'
            cells += f'<td style="{style}">{val}</td>'
        rows += f'<tr style="background:{bg};border-bottom:1px solid #e5e7eb">{cells}</tr>'

    return ui.HTML(
        f'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;font-family:Figtree,sans-serif">'
        f'<thead><tr>{header}</tr></thead><tbody>{rows}</tbody></table></div>'
    )


# ──────────────────────────────────────────────
# UI
# ──────────────────────────────────────────────
try:
    matches_df = load_matches()
    match_choices = {
        str(int(row["match_number"])): f"Match {int(row['match_number'])}: {row['team_1']} vs {row['team_2']} ({row['date']})"
        for _, row in matches_df.sort_values("match_number").iterrows()
    }
except Exception:
    matches_df = pd.DataFrame()
    match_choices = {"0": "No matches found"}

app_ui = ui.page_navbar(
    ui.nav_spacer(),
    # Overview
    ui.nav_panel("Overview",
        # Stats tabs — compact on mobile, full grid on desktop
        ui.navset_pill(
            ui.nav_panel("Key Stats",
                ui.tags.div(style="margin-top:12px;"),
                ui.layout_columns(
                    ui.value_box(ui.tags.span("Matches Played", style="text-decoration:underline;"), ui.tags.span(ui.output_text("overview_matches"), style="font-weight:700;"), theme="primary"),
                    ui.value_box(ui.tags.span("Highest Total", style="text-decoration:underline;"), ui.tags.span(ui.output_text("overview_highest"), style="font-weight:700;"), ui.output_text("overview_highest_team"), theme="success"),
                    ui.value_box(ui.tags.span("Lowest Total", style="text-decoration:underline;"), ui.tags.span(ui.output_text("overview_lowest"), style="font-weight:700;"), ui.output_text("overview_lowest_team"), theme="warning"),
                    ui.value_box(ui.tags.span("Closest Match", style="text-decoration:underline;"), ui.tags.span(ui.output_text("closest_match"), style="font-weight:700;"), ui.output_text("closest_match_detail"), theme="danger"),
                    col_widths={"sm": [6, 6, 6, 6], "lg": [3, 3, 3, 3]},
                ),
            ),
            ui.nav_panel("Leaders",
                ui.tags.div(style="margin-top:12px;"),
                ui.layout_columns(
                    ui.value_box(ui.tags.span("Leading Run Scorer", style="text-decoration:underline;"), ui.tags.span(ui.output_ui("top_scorer"), style="font-weight:700;"), ui.output_ui("top_scorer_runs"), theme="light"),
                    ui.value_box(ui.tags.span("Leading Wicket Taker", style="text-decoration:underline;"), ui.tags.span(ui.output_ui("top_bowler"), style="font-weight:700;"), ui.output_ui("top_bowler_wkts"), theme="light"),
                    col_widths={"sm": [6, 6], "md": [6, 6]},
                ),
            ),
            ui.nav_panel("Numbers",
                ui.tags.div(style="margin-top:12px;"),
                ui.layout_columns(
                    ui.value_box(ui.tags.span("Total Sixes", style="text-decoration:underline;"), ui.tags.span(ui.output_text("total_sixes"), style="font-weight:700;"), theme="light"),
                    ui.value_box(ui.tags.span("Total Fours", style="text-decoration:underline;"), ui.tags.span(ui.output_text("total_fours"), style="font-weight:700;"), theme="light"),
                    ui.value_box(ui.tags.span("Toss Winner Won", style="text-decoration:underline;"), ui.tags.span(ui.output_ui("toss_win_pct"), style="font-weight:700;"), theme="light"),
                    ui.value_box(ui.tags.span("Chose to Field", style="text-decoration:underline;"), ui.tags.span(ui.output_ui("field_first_pct"), style="font-weight:700;"), theme="light"),
                    col_widths={"sm": [6, 6, 6, 6], "lg": [3, 3, 3, 3]},
                ),
            ),
            id="overview_stats_tabs",
        ),
        # Row 3: Points Table with team colors
        ui.layout_columns(
            ui.card(ui.card_header("Points Table"), ui.output_ui("overview_points_table")),
            col_widths=[12],
        ),
        # Row 4: Recent Results
        ui.layout_columns(
            ui.card(ui.card_header("Recent Results"), ui.output_ui("recent_results")),
            col_widths=[12],
        ),
        # Row 5: Charts
        ui.layout_columns(
            ui.card(ui.card_header("Wins: Bat First vs Chase"), ui.output_ui("overview_pie")),
            ui.card(ui.card_header("Average Score by Innings"), ui.output_ui("overview_avg_innings")),
            col_widths=[6, 6],
        ),
        # Row 6: Explosive performances
        ui.layout_columns(
            ui.card(
                ui.card_header(
                    ui.tags.div(
                        ui.tags.span("Most Sixes", style="font-weight:600;"),
                        ui.input_select("sixes_view", None, {"overall": "Overall", "innings": "Best in an Innings"}, width="160px"),
                        style="display:flex;align-items:center;justify-content:space-between;width:100%;",
                    ),
                ),
                ui.output_ui("most_sixes_chart"),
            ),
            ui.card(
                ui.card_header(
                    ui.tags.div(
                        ui.tags.span("Most Fours", style="font-weight:600;"),
                        ui.input_select("fours_view", None, {"overall": "Overall", "innings": "Best in an Innings"}, width="160px"),
                        style="display:flex;align-items:center;justify-content:space-between;width:100%;",
                    ),
                ),
                ui.output_ui("most_fours_chart"),
            ),
            col_widths=[6, 6],
        ),
    ),

    # Batting
    ui.nav_panel("Batting",
        ui.layout_columns(
            ui.card(ui.card_header("Orange Cap Race"), ui.output_ui("orange_cap_chart")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Batting Leaderboard"), ui.output_ui("batting_leaderboard")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Highest Scores"), ui.output_ui("highest_scores")),
            ui.card(ui.card_header("Best Strike Rates (min 30 balls)"), ui.output_ui("best_sr")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Most Boundaries"), ui.output_ui("boundaries_chart")),
            ui.card(
                ui.card_header(
                    ui.tags.div(
                        ui.tags.span("Batting by Phase", style="font-weight:600;"),
                        ui.input_select("batting_phase_team", None, {"All Teams": "All Teams"}, width="150px"),
                        style="display:flex;align-items:center;justify-content:space-between;width:100%;",
                    ),
                ),
                ui.output_ui("batting_phase_chart"),
            ),
            col_widths=[6, 6],
        ),
    ),

    # Bowling
    ui.nav_panel("Bowling",
        ui.layout_columns(
            ui.card(ui.card_header("Purple Cap Race"), ui.output_ui("purple_cap_chart")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Bowling Leaderboard"), ui.output_ui("bowling_leaderboard")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Best Bowling Figures"), ui.output_ui("best_figures")),
            ui.card(ui.card_header("Best Economy (min 10 overs)"), ui.output_ui("best_economy")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Most Dot Balls"), ui.output_ui("dots_chart")),
            ui.card(
                ui.card_header(
                    ui.tags.div(
                        ui.tags.span("Bowling by Phase", style="font-weight:600;"),
                        ui.input_select("bowling_phase_team", None, {"All Teams": "All Teams"}, width="150px"),
                        style="display:flex;align-items:center;justify-content:space-between;width:100%;",
                    ),
                ),
                ui.output_ui("bowling_phase_chart"),
            ),
            col_widths=[6, 6],
        ),
    ),

    # Fielding & Partnerships
    ui.nav_panel("Fielding & Partnerships",
        ui.h4("Fielding", class_="mt-3 mb-2"),
        ui.layout_columns(
            ui.card(ui.card_header("Fielding Leaderboard"), ui.output_ui("fielding_table")),
            col_widths=[12],
        ),
        ui.h4("Partnerships", class_="mt-3 mb-2"),
        ui.layout_columns(
            ui.card(ui.card_header("Top 10 Partnerships"), ui.output_ui("partnerships_chart")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Best Partnership by Wicket"), ui.output_ui("best_by_wicket_chart")),
            col_widths=[12],
        ),
    ),

    # Team Analysis
    ui.nav_panel("Season Analysis",
        ui.layout_columns(
            ui.card(
                ui.card_header("Standings Progression"),
                ui.output_ui("bump_chart"),
            ),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Scoring Rhythm — Avg runs per over by team"), ui.output_ui("season_team_dna")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Team Fingerprint (batting + bowling by phase)"), ui.output_ui("season_radar")),
            ui.card(ui.card_header("Runs per over — 1st vs 2nd innings"), ui.output_ui("season_runs_innings")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Economy vs Bowling Average (min 4 overs)"), ui.output_ui("season_econ_avg")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Toss Decisions"), ui.output_ui("toss_decision_chart")),
            ui.card(ui.card_header("Toss Win = Match Win?"), ui.output_ui("toss_match_chart")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(
                ui.card_header("Team Phase Comparison"),
                ui.input_select("phase_metric", "Metric", choices={"run_rate": "Run Rate", "wickets": "Wickets", "boundaries": "Boundaries", "dots": "Dots"}),
                ui.output_ui("team_phase_chart"),
            ),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Venue Performance"), ui.output_ui("venue_table"), full_screen=True),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Home vs Away — Overall"), ui.output_ui("home_away_overall")),
            ui.card(ui.card_header("Home vs Away — By Team"), ui.output_ui("home_advantage_chart")),
            col_widths=[4, 8],
        ),
    ),

    # Match Centre
    ui.nav_panel("Match Centre",
        ui.layout_columns(
            ui.card(
                ui.input_select("match_select", "Select Match", choices=match_choices),
                ui.output_ui("match_header"),
            ),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Key Moments"), ui.output_ui("match_key_moments")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Worm Chart"), ui.output_ui("match_worm")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.output_ui("match_manhattan_1_header"), ui.output_ui("match_manhattan_1")),
            ui.card(ui.output_ui("match_manhattan_2_header"), ui.output_ui("match_manhattan_2")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Run Rate — Current vs Required"), ui.output_ui("match_run_rate")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.output_ui("scorecard_bat_1_header"), ui.output_ui("scorecard_bat_1")),
            ui.card(ui.output_ui("scorecard_bat_2_header"), ui.output_ui("scorecard_bat_2")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.output_ui("scorecard_bowl_1_header"), ui.output_ui("scorecard_bowl_1")),
            ui.card(ui.output_ui("scorecard_bowl_2_header"), ui.output_ui("scorecard_bowl_2")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Fall of Wickets"), ui.output_ui("match_fow_chart")),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.output_ui("match_phase_1_header"), ui.output_ui("match_phase_1")),
            ui.card(ui.output_ui("match_phase_2_header"), ui.output_ui("match_phase_2")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.output_ui("match_partnership_1_header"), ui.output_ui("match_partnership_1")),
            ui.card(ui.output_ui("match_partnership_2_header"), ui.output_ui("match_partnership_2")),
            col_widths=[6, 6],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("DRS Reviews"), ui.output_ui("match_reviews")),
            ui.card(ui.card_header("Substitutions"), ui.output_ui("match_subs")),
            col_widths=[6, 6],
        ),
    ),

    title=ui.tags.span("openIPL", style="font-weight:900;"),
    id="nav",
    theme=ui.Theme("flatly"),
    header=ui.head_content(
        ui.tags.script(src="https://cdn.plot.ly/plotly-2.35.2.min.js", type="text/javascript"),

        ui.tags.script("""
            // Close mobile hamburger nav after selecting a page
            document.addEventListener('click', function(e) {
                var link = e.target.closest('a[data-bs-toggle="tab"]');
                if (!link) return;
                var navCollapse = document.querySelector('.navbar-collapse.show');
                if (!navCollapse) return;
                navCollapse.classList.remove('show');
                navCollapse.classList.add('collapse');
                var toggler = document.querySelector('.navbar-toggler');
                if (toggler) toggler.setAttribute('aria-expanded', 'false');
            });
        """),
    ),
)


# ──────────────────────────────────────────────
# SERVER
# ──────────────────────────────────────────────
def server(input, output, session):

    @reactive.calc
    def nr_match_numbers():
        """Match numbers of abandoned/no-result matches — excluded from stats."""
        return _nr_match_numbers(load_matches())

    def _stat_matches():
        """Matches excluding no-result — for all stat calculations."""
        return _exclude_no_results(load_matches())

    def _stat_bbb():
        """Ball-by-ball excluding no-result matches."""
        bbb = load_ball_by_ball()
        nr = nr_match_numbers()
        return bbb[~bbb["match_number"].isin(nr)] if nr and not bbb.empty else bbb

    def _stat_bat():
        """Batting scorecards excluding no-result matches."""
        bat = load_batting_scorecards()
        nr = nr_match_numbers()
        return bat[~bat["match_number"].isin(nr)] if nr and not bat.empty else bat

    def _stat_bowl():
        """Bowling scorecards excluding no-result matches."""
        bowl = load_bowling_scorecards()
        nr = nr_match_numbers()
        return bowl[~bowl["match_number"].isin(nr)] if nr and not bowl.empty else bowl

    def _stat_phase():
        """Phase summaries excluding no-result matches."""
        phase = load_phase_summaries()
        nr = nr_match_numbers()
        return phase[~phase["match_number"].isin(nr)] if nr and not phase.empty else phase

    @reactive.calc
    def player_teams():
        """Map player name -> team for the current season (from scorecards)."""
        mapping = {}
        bat = load_batting_scorecards()
        if not bat.empty and "team" in bat.columns and "batter" in bat.columns:
            for _, r in bat[["batter", "team"]].drop_duplicates("batter").iterrows():
                mapping[r["batter"]] = r["team"]
        bowl = load_bowling_scorecards()
        if not bowl.empty and "team" in bowl.columns and "bowler" in bowl.columns:
            for _, r in bowl[["bowler", "team"]].drop_duplicates("bowler").iterrows():
                if r["bowler"] not in mapping:
                    mapping[r["bowler"]] = r["team"]
        return mapping

    # Populate team filters for phase charts
    @reactive.effect
    def _populate_phase_teams():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return
        teams = sorted(bbb["team"].dropna().unique().tolist())
        choices = {"All Teams": "All Teams"}
        choices.update({t: t for t in teams})
        ui.update_select("batting_phase_team", choices=choices)
        ui.update_select("bowling_phase_team", choices=choices)

    # ── Overview ──────────────────────────────

    @render.text
    def overview_matches():
        m = load_matches()
        return str(len(m))



    @reactive.calc
    def all_scores():
        matches = _stat_matches()
        # Exclude rain-shortened matches from highest/lowest totals
        if "target_overs" in matches.columns:
            matches = matches[pd.to_numeric(matches["target_overs"], errors="coerce").fillna(20) >= 20]
        scores = []
        for _, row in matches.iterrows():
            for col, tcol, opp_col in [("team_1_score", "team_1", "team_2"), ("team_2_score", "team_2", "team_1")]:
                s = str(row[col])
                if "/" in s:
                    scores.append((int(s.split("/")[0]), s, row[tcol], row[opp_col], row["match_number"]))
        return scores

    @render.text
    def overview_highest():
        scores = all_scores()
        if not scores:
            return "-"
        best = max(scores, key=lambda x: x[0])
        return f"{best[1]}"

    @render.text
    def overview_highest_team():
        scores = all_scores()
        if not scores:
            return ""
        best = max(scores, key=lambda x: x[0])
        return f"{team_short(best[2])} vs {team_short(best[3])}, M{best[4]}"

    @render.text
    def overview_lowest():
        scores = all_scores()
        if not scores:
            return "-"
        worst = min(scores, key=lambda x: x[0])
        return f"{worst[1]}"

    @render.text
    def overview_lowest_team():
        scores = all_scores()
        if not scores:
            return ""
        worst = min(scores, key=lambda x: x[0])
        return f"{team_short(worst[2])} vs {team_short(worst[3])}, M{worst[4]}"

    @render.ui
    def overview_points_table():
        pt = load_points_table()
        if pt.empty:
            return empty_state("Points table not available")
        pt = pt.copy()
        rows_html = ""
        for _, r in pt.iterrows():
            logo = team_logo(r["team"])
            short = team_short(r["team"])
            nrr = f"{r['net_run_rate']:+.3f}"
            rows_html += f"""<tr style="border-bottom:1px solid #e5e7eb">
                <td style="text-align:center;padding:6px;color:#6b7280">{int(r['position'])}</td>
                <td style="white-space:nowrap;padding:6px"><img src="{logo}" style="height:22px;width:22px;object-fit:contain;vertical-align:middle;margin-right:8px" onerror="this.style.display='none'"><strong style="color:#1f2937">{short}</strong> <span style="color:#6b7280;font-size:0.85em">{r['team']}</span></td>
                <td style="text-align:center;padding:6px;color:#1f2937">{int(r['played'])}</td>
                <td style="text-align:center;color:#16a34a;font-weight:600;padding:6px">{int(r['won'])}</td>
                <td style="text-align:center;color:#dc2626;padding:6px">{int(r['lost'])}</td>
                <td style="text-align:center;padding:6px;color:#6b7280">{int(r['no_result'])}</td>
                <td style="text-align:center;padding:6px;color:#1f2937">{nrr}</td>
                <td style="text-align:center;padding:6px;color:#1a56db"><strong>{int(r['points'])}</strong></td>
            </tr>"""
        return ui.HTML(f"""<table style="width:100%;border-collapse:collapse;font-size:14px;color:#1f2937">
            <thead><tr style="border-bottom:2px solid #1a56db;text-align:center">
                <th style="padding:8px;color:#1a56db;font-size:12px;text-transform:uppercase">#</th><th style="padding:8px;text-align:left;color:#1a56db;font-size:12px;text-transform:uppercase">Team</th>
                <th style="padding:8px;color:#1a56db;font-size:12px;text-transform:uppercase">P</th><th style="padding:8px;color:#1a56db;font-size:12px;text-transform:uppercase">W</th><th style="padding:8px;color:#1a56db;font-size:12px;text-transform:uppercase">L</th>
                <th style="padding:8px;color:#1a56db;font-size:12px;text-transform:uppercase">NR</th><th style="padding:8px;color:#1a56db;font-size:12px;text-transform:uppercase">NRR</th><th style="padding:8px;color:#1a56db;font-size:12px;text-transform:uppercase">Pts</th>
            </tr></thead><tbody style="line-height:2.2">{rows_html}</tbody></table>""")

    def _toss_matches():
        """Matches for toss stats: exclude abandoned/no-result only."""
        return _exclude_no_results(load_matches())

    def _has_abandoned():
        """Check if any matches were abandoned."""
        m = load_matches()
        return "result" in m.columns and (m["result"] == "no result").any()

    @render.ui
    def toss_win_pct():
        m = _toss_matches()
        if m.empty:
            return ui.HTML("-")
        wins = (m["toss_winner"] == m["winner"]).sum()
        pct = round(wins / len(m) * 100)
        foot = '<div style="font-size:10px;color:#6b7280;margin-top:4px">Abandoned matches excluded</div>' if _has_abandoned() else ""
        return ui.HTML(f'{wins}/{len(m)} <span style="font-size:0.6em;color:#6b7280;">({pct}%)</span>{foot}')

    @render.ui
    def field_first_pct():
        m = _toss_matches()
        if m.empty:
            return ui.HTML("-")
        ff = (m["toss_decision"] == "field").sum()
        pct = round(ff / len(m) * 100)
        foot = '<div style="font-size:10px;color:#6b7280;margin-top:4px">Abandoned matches excluded</div>' if _has_abandoned() else ""
        return ui.HTML(f'{ff}/{len(m)} <span style="font-size:0.6em;color:#6b7280;">({pct}%)</span>{foot}')

    def _player_with_logo(name):
        """Return player name with team logo HTML inline."""
        pt = player_teams()
        if name in pt:
            logo_url = team_logo(pt[name])
            if logo_url:
                return ui.HTML(
                    f'<span style="display:inline-flex;align-items:center;gap:6px">'
                    f'<img src="{logo_url}" style="height:0.85em;width:0.85em;object-fit:contain" onerror="this.style.display=\'none\'">'
                    f'<span>{name}</span></span>'
                )
        return name

    @render.ui
    def top_scorer():
        bat = _stat_bat()
        if bat.empty:
            return "-"
        return _player_with_logo(bat.groupby("batter")["runs"].sum().idxmax())

    @render.ui
    def top_scorer_runs():
        bat = _stat_bat()
        if bat.empty:
            return ""
        return f"{bat.groupby('batter')['runs'].sum().max()} runs"

    @render.ui
    def top_bowler():
        bowl = _stat_bowl()
        if bowl.empty:
            return "-"
        return _player_with_logo(bowl.groupby("bowler")["wickets"].sum().idxmax())

    @render.ui
    def top_bowler_wkts():
        bowl = _stat_bowl()
        if bowl.empty:
            return ""
        return f"{bowl.groupby('bowler')['wickets'].sum().max()} wickets"

    @render.text
    def total_sixes():
        bbb = _stat_bbb()
        return str((bbb["batter_runs"] == 6).sum()) if not bbb.empty else "0"

    @render.text
    def total_fours():
        bbb = _stat_bbb()
        return str((bbb["batter_runs"] == 4).sum()) if not bbb.empty else "0"

    @render.ui
    def overview_pie():
        m = _stat_matches()
        has_rain = _has_rain_shortened(m)
        # Exclude rain-shortened matches — no clear bat-first/chase distinction
        if has_rain and "target_overs" in m.columns:
            m = m[pd.to_numeric(m["target_overs"], errors="coerce").fillna(20) >= 20]
        if m.empty:
            return empty_state()
        bat_wins = len(m[m["win_by_runs"].astype(int) > 0])
        chase_wins = len(m[m["win_by_wickets"].astype(int) > 0])
        fig = go.Figure(go.Pie(
            labels=["Bat First", "Chasing"],
            values=[bat_wins, chase_wins],
            hole=0.45,
            marker=dict(colors=["#dc2626", "#16a34a"], line=dict(color="#ffffff", width=2)),
            textinfo="label+percent",
            textfont=dict(size=13),
        ))
        fig.update_layout(height=300, showlegend=False,
                          margin=dict(l=10, r=10, t=10, b=10),
                          paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font=dict(color="#1f2937"))
        chart = plotly_ui(fig)
        if has_rain:
            return ui.TagList(chart, ui.HTML('<div style="font-size:11px;color:#6b7280;margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb">Rain-shortened matches excluded</div>'))
        return chart

    @render.ui
    def overview_avg_innings():
        m = _stat_matches()
        if m.empty:
            return empty_state()
        has_rain = _has_rain_shortened(m)
        # Exclude rain-shortened matches from averages (they skew unnaturally)
        if has_rain and "target_overs" in m.columns:
            m = m[pd.to_numeric(m["target_overs"], errors="coerce").fillna(20) >= 20]
        m["_s1"] = m["team_1_score"].apply(lambda x: int(str(x).split("/")[0]) if "/" in str(x) else 0)
        m["_s2"] = m["team_2_score"].apply(lambda x: int(str(x).split("/")[0]) if "/" in str(x) else 0)
        avg1 = m["_s1"].mean()
        avg2 = m["_s2"].mean()
        fig = go.Figure(go.Bar(
            x=["1st Innings", "2nd Innings"], y=[avg1, avg2],
            marker=dict(color=["#1a73e8", "#45B7D1"], cornerradius=4),
            text=[f"{avg1:.0f}", f"{avg2:.0f}"], textposition="outside",
            textfont=dict(size=13, color="#374151"), width=0.5,
        ))
        fig.update_layout(height=300, yaxis_title="Avg Score",
                          margin=dict(l=40, r=10, t=50, b=10),
                          paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font=dict(color="#1f2937"))
        fig.update_xaxes(gridcolor="rgba(0,0,0,0.05)", zeroline=False)
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False,
                         range=[0, max(avg1, avg2) * 1.15])
        chart = plotly_ui(fig)
        if has_rain:
            return ui.TagList(chart, ui.HTML(RAIN_AVG_FOOTNOTE))
        return chart

    @reactive.calc
    def closest_match_data():
        """Find the closest match by margin."""
        m = load_matches()
        if m.empty:
            return None
        bat_wins = m[m["win_by_runs"].astype(int) > 0]
        chase_wins = m[m["win_by_wickets"].astype(int) > 0]
        closest = None
        if not bat_wins.empty:
            row = bat_wins.loc[bat_wins["win_by_runs"].astype(int).idxmin()]
            closest = (int(row["win_by_runs"]), f"by {int(row['win_by_runs'])} runs", row)
        if not chase_wins.empty:
            row = chase_wins.loc[chase_wins["win_by_wickets"].astype(int).idxmin()]
            margin = int(row["win_by_wickets"])
            if closest is None or margin <= 2:
                closest = (margin, f"by {margin} wicket{'s' if margin > 1 else ''}", row)
        return closest

    @render.text
    def closest_match():
        data = closest_match_data()
        return data[1] if data else "-"

    @render.text
    def closest_match_detail():
        data = closest_match_data()
        if not data:
            return ""
        row = data[2]
        loser = row["team_1"] if row["winner"] == row["team_2"] else row["team_2"]
        return f"{team_short(row['winner'])} vs {team_short(loser)}, M{row['match_number']}"

    @render.ui
    def recent_results():
        m = load_matches()
        if m.empty:
            return empty_state("No match results available")
        m = m.sort_values("match_number", ascending=False)
        cards_html = ""
        for _, row in m.iterrows():
            t1, t2 = row["team_1"], row["team_2"]
            s1 = str(row["team_1_score"]) if str(row["team_1_score"]) != "nan" else "-"
            s2 = str(row["team_2_score"]) if str(row["team_2_score"]) != "nan" else "-"
            winner = str(row.get("winner", ""))
            result = str(row.get("result", ""))
            is_no_result = result == "no result" or winner == "nan" or winner == ""
            logo1, logo2 = team_logo(t1), team_logo(t2)
            mn = int(row["match_number"])
            if is_no_result:
                w1 = w2 = "opacity:0.6"
                margin = "No Result"
            elif winner == t1:
                w1 = "font-weight:800"
                w2 = "opacity:0.6"
                margin = f"{winner} won by {int(row['win_by_wickets'])} wickets" if int(row["win_by_wickets"]) > 0 else f"{winner} won by {int(row['win_by_runs'])} runs"
            else:
                w1 = "opacity:0.6"
                w2 = "font-weight:800"
                margin = f"{winner} won by {int(row['win_by_wickets'])} wickets" if int(row["win_by_wickets"]) > 0 else f"{winner} won by {int(row['win_by_runs'])} runs"
            cards_html += f"""
            <div class="rr-card" onclick="goToMatch('{mn}')">
                <div style="font-size:11px;color:#6b7280;margin-bottom:8px">Match {mn} &bull; {row['date']}</div>
                <div style="display:flex;align-items:center;margin-bottom:6px;{w1}">
                    <img src="{logo1}" style="height:24px;width:24px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">
                    <span style="margin-left:8px;white-space:nowrap;flex:1;color:#1f2937">{team_short(t1)}</span>
                    <span style="font-family:monospace;font-size:13px;white-space:nowrap;color:#1f2937">{s1}</span>
                </div>
                <div style="display:flex;align-items:center;{w2}">
                    <img src="{logo2}" style="height:24px;width:24px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">
                    <span style="margin-left:8px;white-space:nowrap;flex:1;color:#1f2937">{team_short(t2)}</span>
                    <span style="font-family:monospace;font-size:13px;white-space:nowrap;color:#1f2937">{s2}</span>
                </div>
                <div style="font-size:11px;color:#6b7280;margin-top:8px;border-top:1px solid #e5e7eb;padding-top:4px;white-space:nowrap">{margin}</div>
                {"" if is_no_result else f'<div style="font-size:11px;color:#6b7280;margin-top:4px;white-space:nowrap">POM: <strong style="color:#1a56db">{row["player_of_match"]}</strong></div>'}
            </div>"""
        return ui.HTML(f"""
        <style>
        .rr-scroll {{ display:flex; gap:12px; overflow-x:auto; padding:4px 0; scroll-behavior:smooth; -webkit-overflow-scrolling:touch; }}
        .rr-scroll::-webkit-scrollbar {{ height:6px; }}
        .rr-scroll::-webkit-scrollbar-thumb {{ background:#9ca3af; border-radius:3px; }}
        .rr-scroll::-webkit-scrollbar-track {{ background:transparent; }}
        .rr-card {{ flex:0 0 220px; border:1px solid #e5e7eb; border-radius:10px; padding:14px; background:#ffffff; cursor:pointer; transition:border-color 0.2s, box-shadow 0.2s; }}
        .rr-card:hover {{ border-color:#1a56db; box-shadow:0 2px 8px rgba(26,86,219,0.12); }}
        </style>
        <script>
        function goToMatch(mn) {{
            var sel = document.querySelector('#match_select');
            if (sel) {{ sel.value = mn; sel.dispatchEvent(new Event('change')); }}
            var tabs = document.querySelectorAll('.navbar .nav-link, [data-bs-toggle="tab"]');
            tabs.forEach(function(tab) {{ if (tab.textContent.trim() === 'Match Centre') tab.click(); }});
            window.scrollTo(0, 0);
        }}
        </script>
        <div class="rr-scroll">{cards_html}</div>""")

    def _boundary_chart(stat, view_value, color):
        """Shared logic for most sixes/fours charts."""
        bat = _stat_bat()
        if bat.empty:
            return empty_state()
        pt = player_teams()
        if view_value == "overall":
            top = bat.groupby("batter").agg(count=(stat, "sum"), innings=(stat, "count")).reset_index()
            top = top.nlargest(10, "count")
            top["team_code"] = top["batter"].map(lambda b: f" ({team_short(pt[b])})" if b in pt else "")
            top["label"] = top["batter"] + top["team_code"] + " — " + top["innings"].astype(str) + " inn"
        else:
            matches = _stat_matches()
            top = bat.sort_values([stat, "strike_rate"], ascending=[False, False]).head(10)[["batter", stat, "runs", "balls", "team", "match_number"]].copy()
            top = top.merge(matches[["match_number", "team_1", "team_2"]], on="match_number", how="left")
            top["opponent"] = top.apply(lambda r: team_short(r["team_2"]) if r["team"] == r["team_1"] else team_short(r["team_1"]), axis=1)
            top["team_code"] = top["batter"].map(lambda b: f" ({team_short(pt[b])})" if b in pt else "")
            top["label"] = top["batter"] + top["team_code"] + " vs " + top["opponent"] + ", M" + top["match_number"].astype(str)
            top["count"] = top[stat]
        colors = [team_color(pt.get(b, "")) for b in top["batter"]]
        fig = go.Figure(go.Bar(
            x=top["count"], y=top["label"], orientation="h",
            marker=dict(color=colors, line=dict(width=0), cornerradius=4),
            text=top["count"], textposition="outside", textfont=dict(size=13, color="#374151"),
        ))
        fig.update_layout(yaxis=dict(autorange="reversed"))
        fig.update_xaxes(dtick=1)
        return plotly_ui(_apply_style(fig, height=max(300, len(top) * 40)))

    @render.ui
    def most_sixes_chart():
        return _boundary_chart("sixes", input.sixes_view(), "#FF6B6B")

    @render.ui
    def most_fours_chart():
        return _boundary_chart("fours", input.fours_view(), "#1a73e8")

    # ── Batting ───────────────────────────────

    @reactive.calc
    def batting_agg():
        bat = _stat_bat()
        if bat.empty:
            return pd.DataFrame()
        bat["_dismissed"] = bat["dismissal"].apply(lambda d: 0 if str(d).strip().lower() == "not out" else 1)
        bat["_fifty"] = bat["runs"].apply(lambda r: 1 if 50 <= r < 100 else 0)
        bat["_hundred"] = bat["runs"].apply(lambda r: 1 if r >= 100 else 0)
        agg = bat.groupby("batter").agg(
            runs=("runs", "sum"), innings=("runs", "count"),
            balls=("balls", "sum"), fours=("fours", "sum"), sixes=("sixes", "sum"),
            dismissals=("_dismissed", "sum"),
            fifties=("_fifty", "sum"), hundreds=("_hundred", "sum"),
        ).reset_index()
        agg["avg"] = agg.apply(lambda r: round(r["runs"] / r["dismissals"], 2) if r["dismissals"] > 0 else float("inf"), axis=1)
        agg["sr"] = agg.apply(lambda r: round(r["runs"] / r["balls"] * 100, 2) if r["balls"] > 0 else 0, axis=1)
        return agg.sort_values(["runs", "sr", "innings"], ascending=[False, False, True])

    @render.ui
    def orange_cap_chart():
        agg = batting_agg()
        if agg.empty:
            return empty_state()
        return plotly_ui(horizontal_bar(agg.head(10), x="runs", y="batter", title="", text="runs", player_teams=player_teams()))

    @render.ui
    def batting_leaderboard():
        agg = batting_agg().head(15)
        if agg.empty:
            return empty_state()
        tbl = agg.copy()
        tbl["avg"] = tbl["avg"].apply(lambda x: f"{x:.2f}" if x != float("inf") else "-")
        return styled_table(tbl.drop(columns=["dismissals"]).rename(columns={
            "batter": "Batter", "runs": "Runs", "innings": "Inn",
            "balls": "Balls", "fours": "4s", "sixes": "6s", "fifties": "50s", "hundreds": "100s", "avg": "Avg", "sr": "SR",
        }), highlight_cols=["Runs"], bold_cols=["Batter"], player_col="Batter", player_teams=player_teams())

    @render.ui
    def highest_scores():
        bat = _stat_bat()
        if bat.empty:
            return empty_state()
        matches = load_matches()
        top = bat.nlargest(10, "runs")[["batter", "runs", "balls", "fours", "sixes", "strike_rate", "team", "match_number"]].copy()
        # Add opponent and match info
        def get_opponent(row):
            m = matches[matches["match_number"] == row["match_number"]]
            if m.empty:
                return ""
            m = m.iloc[0]
            return m["team_2"] if row["team"] == m["team_1"] else m["team_1"]
        top["opponent"] = top.apply(get_opponent, axis=1)
        top["opponent"] = top["opponent"].apply(lambda t: team_short(t))
        top["match"] = "M" + top["match_number"].astype(str)
        top = top[["batter", "runs", "balls", "fours", "sixes", "strike_rate", "opponent", "match"]]
        top.columns = ["Batter", "Runs", "Balls", "4s", "6s", "SR", "vs", "Match"]
        return styled_table(top, highlight_cols=["Runs"], bold_cols=["Batter"], player_col="Batter", player_teams=player_teams())

    @render.ui
    def best_sr():
        agg = batting_agg()
        if agg.empty:
            return empty_state()
        q = agg[agg["balls"] >= 30].nlargest(10, "sr")[["batter", "sr", "runs", "balls"]].copy()
        q.columns = ["Batter", "SR", "Runs", "Balls"]
        return styled_table(q, highlight_cols=["SR"], bold_cols=["Batter"], player_col="Batter", player_teams=player_teams())

    @render.ui
    def boundaries_chart():
        agg = batting_agg()
        if agg.empty:
            return empty_state()
        agg = agg.copy()
        agg["boundaries"] = agg["fours"] + agg["sixes"]
        top = agg.nlargest(10, "boundaries").reset_index(drop=True)
        pt = player_teams()
        labels = [f"{b} ({team_short(pt[b])})" if b in pt else b for b in top["batter"]]
        fig = go.Figure()
        fig.add_trace(go.Bar(
            x=labels, y=top["fours"], name="Fours",
            marker=dict(color="#1a73e8", cornerradius=4),
        ))
        fig.add_trace(go.Bar(
            x=labels, y=top["sixes"], name="Sixes",
            marker=dict(color="#FF6B6B", cornerradius=4),
        ))
        fig.update_layout(barmode="stack", showlegend=True,
                          legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                          margin=dict(l=10, r=10, t=40, b=10),
                          paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font=dict(color="#1f2937"))
        fig.update_xaxes(gridcolor="rgba(0,0,0,0.05)", zeroline=False)
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False)
        return plotly_ui(fig)

    @render.ui
    def batting_phase_chart():
        bbb = _stat_bbb()
        if bbb.empty:
            return empty_state()
        dls = _has_rain_shortened(_stat_matches())
        team_filter = input.batting_phase_team()
        if team_filter and team_filter != "All Teams":
            bbb = bbb[bbb["team"] == team_filter]
        phase_bat = bbb.groupby("phase").agg(
            runs=("batter_runs", "sum"), balls=("batter_runs", "count"),
        ).reset_index()
        phase_bat["sixes"] = bbb.groupby("phase")["batter_runs"].apply(lambda x: (x == 6).sum()).values
        phase_bat["fours"] = bbb.groupby("phase")["batter_runs"].apply(lambda x: (x == 4).sum()).values
        phase_bat["dots"] = bbb.groupby("phase")["batter_runs"].apply(lambda x: (x == 0).sum()).values
        phase_bat["Run Rate"] = phase_bat.apply(lambda r: round(r["runs"] / r["balls"] * 6, 2) if r["balls"] > 0 else 0, axis=1)
        phase_bat["Boundary %"] = phase_bat.apply(lambda r: round((r["sixes"] + r["fours"]) / r["balls"] * 100, 1) if r["balls"] > 0 else 0, axis=1)
        phase_bat["Dot Ball %"] = phase_bat.apply(lambda r: round(r["dots"] / r["balls"] * 100, 1) if r["balls"] > 0 else 0, axis=1)
        labels = {"powerplay": "Powerplay (1-6)", "middle": "Middle (7-15)", "death": "Death (16-20)"}
        phase_bat["phase_label"] = phase_bat["phase"].map(labels)
        ordered = ["Powerplay (1-6)", "Middle (7-15)", "Death (16-20)"]
        phase_bat = phase_bat.set_index("phase_label").reindex(ordered).reset_index()
        # Filter out phases with no data
        phase_bat = phase_bat.dropna(subset=["Run Rate"])
        if phase_bat.empty:
            return empty_state("No data for selected team")
        y_labels = phase_bat["phase_label"].tolist()

        metrics = ["Run Rate", "Boundary %", "Dot Ball %"]
        z = phase_bat[metrics].fillna(0).values
        # Normalize each column independently so colors are comparable within each metric
        z_norm = z.copy().astype(float)
        for col in range(z_norm.shape[1]):
            cmin, cmax = z_norm[:, col].min(), z_norm[:, col].max()
            z_norm[:, col] = (z_norm[:, col] - cmin) / (cmax - cmin) if cmax > cmin else 0.5
        text = [[f"{v}" for v in row] for row in z]

        # Choose text color based on normalized intensity
        text_colors = [["white" if z_norm[r][c] > 0.55 else "#1f2937" for c in range(len(metrics))] for r in range(len(y_labels))]
        fig = go.Figure(go.Heatmap(
            z=z_norm, x=metrics, y=y_labels,
            text=text, texttemplate="%{text}", textfont=dict(size=16),
            colorscale=[[0, "#eff6ff"], [0.5, "#60a5fa"], [1, "#1a56db"]],
            showscale=False, xgap=3, ygap=3,
            hovertemplate="%{y}<br>%{x}: %{text}<extra></extra>",
        ))
        for r in range(len(y_labels)):
            for c in range(len(metrics)):
                fig.add_annotation(
                    x=metrics[c], y=y_labels[r], text=text[r][c],
                    showarrow=False, font=dict(size=16, color=text_colors[r][c], family="Figtree, sans-serif"),
                )
        fig.update_traces(texttemplate="")
        chart_height = max(120, len(y_labels) * 55 + 30)
        fig.update_layout(
            **LAYOUT_TEMPLATE, margin=dict(l=0, r=0, t=30, b=0, autoexpand=True), height=chart_height,
            xaxis=dict(side="top"), yaxis=dict(autorange="reversed"),
        )

        # Donut: Runs by Phase
        phase_colors = ["#1a73e8", "#45B7D1", "#e8f4f8"]
        donut = go.Figure(go.Pie(
            labels=phase_bat["phase_label"], values=phase_bat["runs"],
            hole=0.55, marker=dict(colors=phase_colors, line=dict(color="white", width=2)),
            textinfo="label+percent", textfont=dict(size=11),
            hovertemplate="%{label}<br>%{value} runs (%{percent})<extra></extra>",
        ))
        donut.update_layout(
            **LAYOUT_TEMPLATE, margin=dict(l=0, r=0, t=25, b=0), height=180,
            showlegend=False,
            annotations=[dict(text="Runs", x=0.5, y=0.5, font_size=13, showarrow=False)],
        )
        children = [
            ui.div(plotly_ui(fig), style="max-width:500px;margin:0 auto;"),
            ui.HTML('<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">'),
            ui.div(
                ui.p("Runs by Phase", style="text-align:center;font-weight:600;font-size:13px;margin:0 0 -10px 0;color:#6b7280;"),
                plotly_ui(donut),
                style="max-width:280px;margin:0 auto;",
            ),
        ]
        if dls:
            children.append(ui.HTML(RAIN_PHASE_FOOTNOTE))
        return ui.div(*children)

    # ── Bowling ───────────────────────────────

    @reactive.calc
    def bowling_agg():
        bowl = _stat_bowl()
        if bowl.empty:
            return pd.DataFrame()
        agg = bowl.groupby("bowler").agg(
            wickets=("wickets", "sum"), innings=("wickets", "count"),
            overs=("overs", "sum"), runs=("runs", "sum"), maidens=("maidens", "sum"),
            dots=("dots", "sum"), wides=("wides", "sum"), noballs=("noballs", "sum"),
        ).reset_index()
        agg["economy"] = agg.apply(lambda r: round(r["runs"] / r["overs"], 2) if r["overs"] > 0 else 0, axis=1)
        agg["avg"] = agg.apply(lambda r: round(r["runs"] / r["wickets"], 2) if r["wickets"] > 0 else float("inf"), axis=1)
        # Strike rate: balls per wicket
        agg["sr"] = agg.apply(lambda r: round(_overs_to_balls(r["overs"]) / r["wickets"], 1) if r["wickets"] > 0 else float("inf"), axis=1)
        # Best bowling figures (best innings)
        best = bowl.sort_values(["wickets", "runs"], ascending=[False, True]).drop_duplicates("bowler")[["bowler", "wickets", "runs"]].copy()
        best["bbi"] = best["wickets"].astype(str) + "/" + best["runs"].astype(str)
        agg = agg.merge(best[["bowler", "bbi"]], on="bowler", how="left")
        # 4-wicket and 5-wicket hauls
        agg["4w"] = bowl[bowl["wickets"] >= 4].groupby("bowler").size().reindex(agg["bowler"].values, fill_value=0).values
        agg["5w"] = bowl[bowl["wickets"] >= 5].groupby("bowler").size().reindex(agg["bowler"].values, fill_value=0).values
        return agg.sort_values(["wickets", "economy", "innings"], ascending=[False, True, True])

    @render.ui
    def purple_cap_chart():
        agg = bowling_agg()
        if agg.empty:
            return empty_state()
        return plotly_ui(horizontal_bar(agg.head(10), x="wickets", y="bowler", title="", text="wickets", player_teams=player_teams()))

    @render.ui
    def bowling_leaderboard():
        agg = bowling_agg().head(15).copy()
        if agg.empty:
            return empty_state()
        agg["avg"] = agg["avg"].apply(lambda x: f"{x:.2f}" if x != float("inf") else "-")
        agg["sr"] = agg["sr"].apply(lambda x: f"{x:.1f}" if x != float("inf") else "-")
        display = agg[["bowler", "innings", "overs", "runs", "wickets", "bbi", "avg", "economy", "sr", "4w", "5w"]].copy()
        return styled_table(display.rename(columns={
            "bowler": "Bowler", "wickets": "Wkts", "innings": "Inn",
            "overs": "Overs", "runs": "Runs", "bbi": "BBI",
            "economy": "Econ", "avg": "Avg", "sr": "SR",
            "4w": "4W", "5w": "5W",
        }), highlight_cols=["Wkts"], bold_cols=["Bowler"], player_col="Bowler", player_teams=player_teams())

    @render.ui
    def best_figures():
        bowl = _stat_bowl()
        if bowl.empty:
            return empty_state()
        bowl = bowl.copy()
        bowl["figures"] = bowl["wickets"].astype(str) + "/" + bowl["runs"].astype(str)
        matches = _stat_matches()
        best = bowl.sort_values(["wickets", "runs", "overs"], ascending=[False, True, True]).head(10)[["bowler", "figures", "overs", "economy", "dots", "team", "match_number"]].copy()
        def get_opponent(row):
            m = matches[matches["match_number"] == row["match_number"]]
            if m.empty:
                return ""
            m = m.iloc[0]
            return m["team_2"] if row["team"] == m["team_1"] else m["team_1"]
        best["vs"] = best.apply(get_opponent, axis=1).apply(lambda t: team_short(t))
        best["match"] = "M" + best["match_number"].astype(str)
        best = best[["bowler", "figures", "overs", "economy", "dots", "vs", "match"]]
        best.columns = ["Bowler", "Figures", "Overs", "Econ", "Dots", "vs", "Match"]
        return styled_table(best, highlight_cols=["Figures"], bold_cols=["Bowler"], player_col="Bowler", player_teams=player_teams())

    @render.ui
    def best_economy():
        agg = bowling_agg()
        if agg.empty:
            return empty_state()
        q = agg[agg["overs"] >= 10].nsmallest(10, "economy")[["bowler", "economy", "overs", "wickets"]].copy()
        q.columns = ["Bowler", "Econ", "Overs", "Wkts"]
        return styled_table(q, highlight_cols=["Econ"], bold_cols=["Bowler"], player_col="Bowler", player_teams=player_teams())

    @render.ui
    def dots_chart():
        agg = bowling_agg()
        if agg.empty:
            return empty_state()
        top = agg.sort_values(["dots", "economy"], ascending=[False, True]).head(10)[["bowler", "dots", "overs", "economy", "wickets"]].copy()
        balls_total = top["overs"].apply(_overs_to_balls)
        top["dot_%"] = top.apply(lambda r: round(r["dots"] / _overs_to_balls(r["overs"]) * 100, 1) if _overs_to_balls(r["overs"]) > 0 else 0, axis=1)
        top = top[["bowler", "dots", "dot_%", "overs", "economy", "wickets"]]
        top.columns = ["Bowler", "Dots", "Dot %", "Overs", "Econ", "Wkts"]
        return styled_table(top, highlight_cols=["Dots"], bold_cols=["Bowler"], player_col="Bowler", player_teams=player_teams())

    @render.ui
    def bowling_phase_chart():
        bbb = _stat_bbb()
        if bbb.empty:
            return empty_state()
        dls = _has_rain_shortened(_stat_matches())
        team_filter = input.bowling_phase_team()
        if team_filter and team_filter != "All Teams":
            # Derive bowling team from match data
            matches = _stat_matches()[["match_number", "team_1", "team_2"]]
            bbb = bbb.merge(matches, on="match_number", how="left")
            bbb["bowling_team"] = bbb.apply(
                lambda r: r["team_2"] if r["team"] == r["team_1"] else r["team_1"], axis=1
            )
            bbb = bbb[bbb["bowling_team"] == team_filter]
        phase_bowl = bbb.groupby("phase").agg(
            runs=("total_runs", "sum"),
            balls=("total_runs", "count"),
        ).reset_index()
        phase_bowl["wickets"] = bbb.groupby("phase")["is_wicket"].apply(lambda x: (x == True).sum()).values
        phase_bowl["dots"] = bbb.groupby("phase")["batter_runs"].apply(lambda x: (x == 0).sum()).values
        phase_bowl["Economy"] = phase_bowl.apply(lambda r: round(r["runs"] / r["balls"] * 6, 2) if r["balls"] > 0 else 0, axis=1)
        phase_bowl["Strike Rate"] = phase_bowl.apply(
            lambda r: round(r["balls"] / r["wickets"], 1) if r["wickets"] > 0 else float("inf"), axis=1
        )
        phase_bowl["Dot Ball %"] = phase_bowl.apply(lambda r: round(r["dots"] / r["balls"] * 100, 1) if r["balls"] > 0 else 0, axis=1)
        labels = {"powerplay": "Powerplay (1-6)", "middle": "Middle (7-15)", "death": "Death (16-20)"}
        phase_bowl["phase_label"] = phase_bowl["phase"].map(labels)
        ordered = ["Powerplay (1-6)", "Middle (7-15)", "Death (16-20)"]
        phase_bowl = phase_bowl.set_index("phase_label").reindex(ordered).reset_index()
        phase_bowl = phase_bowl.dropna(subset=["Economy"])
        if phase_bowl.empty:
            return empty_state("No data for selected team")
        y_labels = phase_bowl["phase_label"].tolist()

        # Replace inf strike rate with a display-friendly value
        phase_bowl["Strike Rate"] = phase_bowl["Strike Rate"].replace(float("inf"), None)
        metrics = ["Economy", "Strike Rate", "Dot Ball %"]
        z = phase_bowl[metrics].values
        # For normalization, replace None/NaN with max + 1 (worst strike rate)
        z_filled = pd.DataFrame(z, columns=metrics).copy()
        sr_max = z_filled["Strike Rate"].max()
        z_filled["Strike Rate"] = z_filled["Strike Rate"].fillna(sr_max + 10 if pd.notna(sr_max) else 50)
        z_arr = z_filled.values.astype(float)
        z_norm = z_arr.copy()
        for col in range(z_norm.shape[1]):
            cmin, cmax = z_norm[:, col].min(), z_norm[:, col].max()
            z_norm[:, col] = (z_norm[:, col] - cmin) / (cmax - cmin) if cmax > cmin else 0.5
        text = [[("-" if pd.isna(z[r][c]) else f"{z[r][c]}") for c in range(len(metrics))] for r in range(len(y_labels))]

        text_colors = [["white" if z_norm[r][c] > 0.55 else "#1f2937" for c in range(len(metrics))] for r in range(len(y_labels))]
        fig = go.Figure(go.Heatmap(
            z=z_norm, x=metrics, y=y_labels,
            text=text, texttemplate="", textfont=dict(size=16),
            colorscale=[[0, "#fef2f2"], [0.5, "#f87171"], [1, "#dc2626"]],
            showscale=False, xgap=3, ygap=3,
            hovertemplate="%{y}<br>%{x}: %{text}<extra></extra>",
        ))
        for r in range(len(y_labels)):
            for c in range(len(metrics)):
                fig.add_annotation(
                    x=metrics[c], y=y_labels[r], text=text[r][c],
                    showarrow=False, font=dict(size=16, color=text_colors[r][c], family="Figtree, sans-serif"),
                )
        chart_height = max(120, len(y_labels) * 55 + 30)
        fig.update_layout(
            **LAYOUT_TEMPLATE, margin=dict(l=0, r=0, t=30, b=0, autoexpand=True), height=chart_height,
            xaxis=dict(side="top"), yaxis=dict(autorange="reversed"),
        )

        # Donut: Wickets by Phase
        phase_colors = ["#d63031", "#FF6B6B", "#fde8e8"]
        donut = go.Figure(go.Pie(
            labels=phase_bowl["phase_label"], values=phase_bowl["wickets"],
            hole=0.55, marker=dict(colors=phase_colors, line=dict(color="white", width=2)),
            textinfo="label+percent", textfont=dict(size=11),
            hovertemplate="%{label}<br>%{value} wkts (%{percent})<extra></extra>",
        ))
        donut.update_layout(
            **LAYOUT_TEMPLATE, margin=dict(l=0, r=0, t=25, b=0), height=180,
            showlegend=False,
            annotations=[dict(text="Wickets", x=0.5, y=0.5, font_size=13, showarrow=False)],
        )
        children = [
            ui.div(plotly_ui(fig), style="max-width:500px;margin:0 auto;"),
            ui.HTML('<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">'),
            ui.div(
                ui.p("Wickets by Phase", style="text-align:center;font-weight:600;font-size:13px;margin:0 0 -10px 0;color:#6b7280;"),
                plotly_ui(donut),
                style="max-width:280px;margin:0 auto;",
            ),
        ]
        if dls:
            children.append(ui.HTML(RAIN_PHASE_FOOTNOTE))
        return ui.div(*children)

    # ── Fielding & Partnerships ───────────────

    @reactive.calc
    def fielding_agg():
        fielding = load_all_fielding()
        if fielding.empty:
            return pd.DataFrame()
        fagg = fielding.groupby("player").agg(
            catches=("catches", "sum"), stumpings=("stumpings", "sum"), run_outs=("run_outs", "sum"),
        ).reset_index()
        fagg["total"] = fagg["catches"] + fagg["stumpings"] + fagg["run_outs"]
        return fagg.sort_values("total", ascending=False)

    @render.ui
    def fielding_table():
        fagg = fielding_agg()
        if fagg.empty:
            return empty_state()
        top = fagg.head(15)[["player", "catches", "stumpings", "run_outs", "total"]].copy()
        top.columns = ["Player", "Catches", "Stumpings", "Run Outs", "Total"]
        return styled_table(top, highlight_cols=["Total"], bold_cols=["Player"], player_col="Player", player_teams=player_teams())

    @render.ui
    def partnerships_chart():
        p = load_partnerships()
        nr = nr_match_numbers()
        if nr and not p.empty and "match_number" in p.columns:
            p = p[~p["match_number"].isin(nr)]
        if p.empty:
            return empty_state()
        top = p.nlargest(10, "total_runs").copy()
        matches = _stat_matches()
        def get_opponent(row):
            m = matches[matches["match_number"] == row["match_number"]]
            if m.empty:
                return ""
            m = m.iloc[0]
            return m["team_2"] if row["team"] == m["team_1"] else m["team_1"]
        top["opponent"] = top.apply(get_opponent, axis=1).apply(lambda t: team_short(t))
        top["pair"] = top["batter_1"] + " & " + top["batter_2"] + " (" + top["team"].map(team_short) + " vs " + top["opponent"] + ", M" + top["match_number"].astype(str) + ")"
        top = top.iloc[::-1]  # reverse so highest is at top
        fig = go.Figure()
        # Connecting lines
        for _, row in top.iterrows():
            fig.add_trace(go.Scatter(
                x=[row["batter_1_runs"], row["batter_2_runs"]],
                y=[row["pair"], row["pair"]],
                mode="lines",
                line=dict(color="#d1d5db", width=6),
                showlegend=False, hoverinfo="skip",
            ))
        # Batter 1 dots
        fig.add_trace(go.Scatter(
            x=top["batter_1_runs"], y=top["pair"],
            mode="markers+text", name="Batter 1",
            marker=dict(color="#1a73e8", size=14, line=dict(width=2, color="white")),
            text=top["batter_1_runs"].astype(str),
            textposition="bottom center", textfont=dict(size=10, color="#1a73e8"),
            hovertemplate=top["batter_1"] + ": %{x} runs<extra></extra>",
        ))
        # Batter 2 dots
        fig.add_trace(go.Scatter(
            x=top["batter_2_runs"], y=top["pair"],
            mode="markers+text", name="Batter 2",
            marker=dict(color="#34A853", size=14, line=dict(width=2, color="white")),
            text=top["batter_2_runs"].astype(str),
            textposition="bottom center", textfont=dict(size=10, color="#34A853"),
            hovertemplate=top["batter_2"] + ": %{x} runs<extra></extra>",
        ))
        # Total annotation at the midpoint
        for _, row in top.iterrows():
            mid = (row["batter_1_runs"] + row["batter_2_runs"]) / 2
            fig.add_annotation(
                x=max(row["batter_1_runs"], row["batter_2_runs"]) + 3,
                y=row["pair"],
                text=f"<b>{row['total_runs']}</b> ({row['total_balls']}b)",
                showarrow=False, font=dict(size=11, color="#374151"), xanchor="left",
            )
        fig.update_layout(
            showlegend=False,
            **LAYOUT_TEMPLATE, margin=dict(l=10, r=80, t=20, b=10, autoexpand=True),
            height=max(300, len(top) * 50),
        )
        fig.update_xaxes(gridcolor="rgba(0,0,0,0.05)", zeroline=False, title_text="Runs")
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False)
        return plotly_ui(fig)

    @render.ui
    def best_by_wicket_chart():
        p = load_partnerships()
        nr = nr_match_numbers()
        if nr and not p.empty and "match_number" in p.columns:
            p = p[~p["match_number"].isin(nr)]
        if p.empty:
            return empty_state()
        best = p.loc[p.groupby("wicket_number")["total_runs"].idxmax()].copy()
        best = best.sort_values("wicket_number", ascending=False)
        def ordinal(n):
            return str(n) + ("th" if 4 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))
        matches = _stat_matches()
        def get_opponent(row):
            m = matches[matches["match_number"] == row["match_number"]]
            if m.empty:
                return ""
            m = m.iloc[0]
            return m["team_2"] if row["team"] == m["team_1"] else m["team_1"]
        best["opponent"] = best.apply(get_opponent, axis=1).apply(lambda t: team_short(t))
        best["wicket_label"] = best["wicket_number"].apply(lambda n: ordinal(n) + " wkt") + " (" + best["team"].map(team_short) + " vs " + best["opponent"] + ", M" + best["match_number"].astype(str) + ")"

        colors = [team_color(t) for t in best["team"]]
        fig = go.Figure()
        # Batter 1 extends left (negative)
        fig.add_trace(go.Bar(
            y=best["wicket_label"], x=-best["batter_1_runs"], orientation="h",
            name="Batter 1", marker=dict(color="#1a73e8", cornerradius=4),
            text=best["batter_1"] + ": " + best["batter_1_runs"].astype(str),
            textposition="inside", textfont=dict(color="white", size=11),
            hovertemplate="%{text}<extra></extra>",
        ))
        # Batter 2 extends right (positive)
        fig.add_trace(go.Bar(
            y=best["wicket_label"], x=best["batter_2_runs"], orientation="h",
            name="Batter 2", marker=dict(color="#34A853", cornerradius=4),
            text=best["batter_2"] + ": " + best["batter_2_runs"].astype(str),
            textposition="inside", textfont=dict(color="white", size=11),
            hovertemplate="%{text}<extra></extra>",
        ))
        # Total annotations on the right
        for _, row in best.iterrows():
            fig.add_annotation(
                x=row["batter_2_runs"] + 3, y=row["wicket_label"],
                text=f"<b>{row['total_runs']}</b> ({row['total_balls']}b)",
                showarrow=False, font=dict(size=11, color="#374151"), xanchor="left",
            )
        fig.update_layout(
            barmode="relative", showlegend=True,
            legend=dict(orientation="h", yanchor="bottom", y=-0.15, xanchor="center", x=0.5),
            xaxis=dict(
                title="Runs", zeroline=True, zerolinecolor="rgba(0,0,0,0.2)", zerolinewidth=1,
                tickvals=[], showticklabels=False,
            ),
            **LAYOUT_TEMPLATE, margin=dict(l=10, r=80, t=20, b=40, autoexpand=True),
            height=max(300, len(best) * 50),
        )
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False)
        return plotly_ui(fig)

    # ── Season Analysis ─────────────────────────

    @render.ui
    def season_team_dna():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        return plotly_ui(team_dna_heatmap(bbb))

    @render.ui
    def season_radar():
        bbb = load_ball_by_ball()
        matches = load_matches()
        if bbb.empty or matches.empty:
            return empty_state()
        return plotly_ui(team_radar_chart(bbb, matches))

    @render.ui
    def season_runs_innings():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        return plotly_ui(runs_per_over_innings_compare(bbb))

    @render.ui
    def season_econ_avg():
        bowl = load_bowling_scorecards()
        if bowl.empty:
            return empty_state()
        return plotly_ui(economy_vs_average_scatter(bowl))

    @render.ui
    def bump_chart():
        matches = load_matches()
        if matches.empty:
            return empty_state()

        bbb = load_ball_by_ball()
        team_stats = {}
        team_match_num = {}  # team -> count of matches played
        snapshots = []

        for _, row in matches.sort_values("match_number").iterrows():
            mn = int(row["match_number"])
            result = str(row.get("result", ""))
            winner = row.get("winner", "")
            match_teams = []

            # Update both teams' stats first
            for team_col, score_col, opp_score_col in [
                ("team_1", "team_1_score", "team_2_score"),
                ("team_2", "team_2_score", "team_1_score"),
            ]:
                team = row[team_col]
                if team not in team_stats:
                    team_stats[team] = {"points": 0, "rs": 0, "bf": 0, "rc": 0, "bb": 0}
                    team_match_num[team] = 0
                team_match_num[team] += 1
                match_teams.append(team)

                if result == "no result":
                    team_stats[team]["points"] += 1
                elif team == winner:
                    team_stats[team]["points"] += 2

                if result != "no result" and not bbb.empty:
                    score_str = str(row[score_col])
                    opp_str = str(row[opp_score_col])
                    s_parts = score_str.split("/") if "/" in score_str else []
                    o_parts = opp_str.split("/") if "/" in opp_str else []
                    runs = int(s_parts[0]) if len(s_parts) >= 1 else 0
                    wickets = int(s_parts[1]) if len(s_parts) >= 2 else 0
                    opp_runs = int(o_parts[0]) if len(o_parts) >= 1 else 0
                    opp_wickets = int(o_parts[1]) if len(o_parts) >= 2 else 0

                    match_bbb = bbb[bbb["match_number"] == mn]
                    inn_df = match_bbb[match_bbb["team"] == team]
                    balls = 120 if wickets == 10 else len(inn_df[~inn_df["extra_type"].isin(["wides", "noballs"])])

                    opp_team = row["team_2"] if team == row["team_1"] else row["team_1"]
                    opp_inn_df = match_bbb[match_bbb["team"] == opp_team]
                    opp_balls = 120 if opp_wickets == 10 else len(opp_inn_df[~opp_inn_df["extra_type"].isin(["wides", "noballs"])])

                    team_stats[team]["rs"] += runs
                    team_stats[team]["bf"] += balls
                    team_stats[team]["rc"] += opp_runs
                    team_stats[team]["bb"] += opp_balls

            # Check if a round just completed (all 10 teams have played the same number)
            all_teams_active = len(team_match_num) == 10
            min_played = min(team_match_num.values()) if team_match_num else 0
            recorded_rounds = {s["round"] for s in snapshots}
            if all_teams_active and min_played > 0 and min_played not in recorded_rounds:
                # All teams have now played at least min_played matches — record standings
                ranking = []
                for t, s in team_stats.items():
                    nrr = round((s["rs"] / (s["bf"] / 6) - s["rc"] / (s["bb"] / 6)), 3) if s["bf"] > 0 and s["bb"] > 0 else 0.0
                    ranking.append({"team": t, "points": s["points"], "nrr": nrr})
                ranking.sort(key=lambda x: (-x["points"], -x["nrr"]))

                for i, r in enumerate(ranking):
                    snapshots.append({
                        "round": min_played,
                        "team": r["team"],
                        "points": r["points"],
                        "nrr": r["nrr"],
                        "position": i + 1,
                    })

        # Also add current standings as final point if last round isn't complete
        snap_df = pd.DataFrame(snapshots) if snapshots else pd.DataFrame()
        last_round = int(snap_df["round"].max()) if not snap_df.empty else 0
        current_min = min(team_match_num.values()) if team_match_num else 0
        current_max = max(team_match_num.values()) if team_match_num else 0
        if current_max > last_round:
            ranking = []
            for t, s in team_stats.items():
                nrr = round((s["rs"] / (s["bf"] / 6) - s["rc"] / (s["bb"] / 6)), 3) if s["bf"] > 0 and s["bb"] > 0 else 0.0
                ranking.append({"team": t, "points": s["points"], "nrr": nrr})
            ranking.sort(key=lambda x: (-x["points"], -x["nrr"]))
            next_round = last_round + 1
            for i, r in enumerate(ranking):
                snapshots.append({
                    "round": next_round,
                    "team": r["team"],
                    "points": r["points"],
                    "nrr": r["nrr"],
                    "position": i + 1,
                })
            snap_df = pd.DataFrame(snapshots)

        if snap_df.empty:
            return empty_state()

        y_col = "position"

        max_round = int(snap_df["round"].max())
        num_teams = snap_df["team"].nunique()

        fig = go.Figure()
        for team in snap_df["team"].unique():
            tdf = snap_df[snap_df["team"] == team].sort_values("round")
            color = team_color(team)
            short = team_short(team)

            fig.add_trace(go.Scatter(
                x=tdf["round"], y=tdf[y_col],
                mode="lines",
                name=short,
                line=dict(color=color, width=4, shape="spline", smoothing=0.8),
                hovertemplate=(
                    f"<b>{team}</b><br>"
                    "Round %{x}<br>"
                    "Position: %{customdata[0]}<br>"
                    "Pts: %{customdata[1]}, NRR: %{customdata[2]:+.3f}"
                    "<extra></extra>"
                ),
                customdata=tdf[["position", "points", "nrr"]].values,
            ))

        # Build right-edge labels at a fixed x, offsetting collisions
        label_x = max_round + 0.15
        end_points = []
        for team in snap_df["team"].unique():
            tdf = snap_df[snap_df["team"] == team].sort_values("round")
            last = tdf.iloc[-1]
            end_points.append({"team": team, "y": last[y_col]})
        # Sort by y position and nudge overlapping ones
        end_points.sort(key=lambda p: p["y"])
        min_gap = 0.55
        for i in range(1, len(end_points)):
            if end_points[i]["y"] - end_points[i - 1]["y"] < min_gap:
                end_points[i]["y"] = end_points[i - 1]["y"] + min_gap

        for ep in end_points:
            logo_url = team_logo(ep["team"])
            if logo_url:
                fig.add_layout_image(dict(
                    source=logo_url,
                    xref="x", yref="y",
                    x=label_x, y=ep["y"],
                    sizex=0.5, sizey=0.5,
                    xanchor="left", yanchor="middle",
                    layer="above",
                ))

        fig.update_layout(
            xaxis_title="Round",
            yaxis_title="",
            showlegend=False,
            **LAYOUT_TEMPLATE,
            margin=dict(l=40, r=100, t=20, b=50),
        )
        fig.update_xaxes(
            dtick=1, gridcolor="rgba(0,0,0,0.06)",
            range=[0.5, max_round + 1.8],
        )
        fig.update_yaxes(
            autorange="reversed", dtick=1,
            gridcolor="rgba(0,0,0,0.04)",
            range=[0.5, num_teams + 0.5],
            showticklabels=True,
            tickfont=dict(size=12, color="#9ca3af"),
        )
        for pos in range(1, num_teams + 1):
            fig.add_shape(
                type="line", x0=0.5, x1=max_round + 1.8,
                y0=pos, y1=pos,
                line=dict(color="rgba(0,0,0,0.06)", width=1),
                layer="below",
            )
        if num_teams > 4:
            fig.add_shape(
                type="line", x0=0.5, x1=max_round + 1.8,
                y0=4.5, y1=4.5,
                line=dict(color="#dc2626", width=1.5, dash="dash"),
                layer="below",
            )
            fig.add_annotation(
                x=max_round + 1.8, y=4.5,
                text="Playoff cutoff",
                xanchor="right", yanchor="bottom",
                showarrow=False,
                font=dict(size=10, color="#dc2626"),
            )

        chart = plotly_ui(_apply_style(fig, height=500))
        footnote = ui.HTML('<div style="font-size:11px;color:#6b7280;margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb">Standings are shown per round — a round completes when all teams have played the same number of matches. Some teams may have played additional matches not yet reflected here.</div>')
        return ui.TagList(chart, footnote)

    @render.ui
    def toss_decision_chart():
        m = load_matches()
        m = m[pd.to_numeric(m.get("target_overs", 20), errors="coerce").fillna(20) >= 20]
        td = m["toss_decision"].value_counts().reset_index()
        td.columns = ["Decision", "Count"]
        chart = plotly_ui(vertical_bar(td, x="Decision", y="Count", title="", text="Count"))
        if _has_rain_shortened(load_matches()):
            return ui.TagList(chart, ui.HTML('<div style="font-size:11px;color:#6b7280;margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb">Rain-shortened matches excluded</div>'))
        return chart

    @render.ui
    def toss_match_chart():
        m = load_matches().copy()
        has_rain = _has_rain_shortened(m)
        m = m[pd.to_numeric(m.get("target_overs", 20), errors="coerce").fillna(20) >= 20]
        m["toss_won_match"] = m["toss_winner"] == m["winner"]
        tw = m["toss_won_match"].value_counts().reset_index()
        tw.columns = ["Result", "Count"]
        tw["Result"] = tw["Result"].map({True: "Yes", False: "No"})
        chart = plotly_ui(vertical_bar(tw, x="Result", y="Count", title="", text="Count"))
        if has_rain:
            return ui.TagList(chart, ui.HTML('<div style="font-size:11px;color:#6b7280;margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb">Rain-shortened matches excluded</div>'))
        return chart

    @render.ui
    def team_phase_chart():
        phase = _stat_phase()
        if phase.empty:
            return empty_state()
        metric = input.phase_metric()
        team_phase = phase.groupby(["team", "phase"]).agg(
            runs=("runs", "sum"), wickets=("wickets", "sum"),
            balls=("balls", "sum"), boundaries=("boundaries", "sum"), dots=("dots", "sum"),
        ).reset_index()
        team_phase["run_rate"] = ((team_phase["runs"] / team_phase["balls"]) * 6).round(2)
        chart = plotly_ui(phase_comparison_chart(team_phase, metric=metric))
        if _has_rain_shortened(_stat_matches()):
            return ui.TagList(chart, ui.HTML(RAIN_PHASE_FOOTNOTE))
        return chart

    @render.ui
    def venue_table():
        matches = _stat_matches()
        matches = matches.copy()
        # Split "Stadium, City" into separate columns
        venue_parts = matches["venue"].str.rsplit(", ", n=1, expand=True)
        matches["stadium"] = venue_parts[0]
        matches["city"] = venue_parts[1] if 1 in venue_parts.columns else ""
        matches["venue_has_rain"] = pd.to_numeric(matches.get("target_overs", 20), errors="coerce").fillna(20) < 20
        vs = matches.groupby(["stadium", "city"]).agg(
            matches_count=("match_number", "count"),
            venue_has_rain=("venue_has_rain", "any"),
        ).reset_index()
        has_rain = vs["venue_has_rain"].any()
        # Exclude rain-shortened matches from score averages (they skew unnaturally)
        full_matches = matches[pd.to_numeric(matches.get("target_overs", 20), errors="coerce").fillna(20) >= 20] if has_rain else matches
        venue_scores = []
        for _, row in full_matches.iterrows():
            s1 = int(str(row["team_1_score"]).split("/")[0]) if "/" in str(row["team_1_score"]) else 0
            s2 = int(str(row["team_2_score"]).split("/")[0]) if "/" in str(row["team_2_score"]) else 0
            venue_scores.append({"stadium": row["stadium"], "city": row["city"], "first_inn": s1, "second_inn": s2})
        if venue_scores:
            vdf = pd.DataFrame(venue_scores)
            va = vdf.groupby(["stadium", "city"]).agg(avg_1st=("first_inn", "mean"), avg_2nd=("second_inn", "mean")).round(0).reset_index()
            vs = vs.merge(va, on=["stadium", "city"], how="left")
        else:
            vs["avg_1st"] = 0
            vs["avg_2nd"] = 0
        vs = vs[["stadium", "city", "matches_count", "avg_1st", "avg_2nd", "venue_has_rain"]]
        vs["avg_1st"] = vs["avg_1st"].fillna(0).astype(int).astype(str).replace("0", "-")
        vs["avg_2nd"] = vs["avg_2nd"].fillna(0).astype(int).astype(str).replace("0", "-")
        vs.loc[vs["venue_has_rain"], "avg_1st"] = vs.loc[vs["venue_has_rain"], "avg_1st"] + "*"
        vs.loc[vs["venue_has_rain"], "avg_2nd"] = vs.loc[vs["venue_has_rain"], "avg_2nd"] + "*"
        tbl = styled_table(vs.drop(columns=["venue_has_rain"]).rename(columns={
            "stadium": "Stadium", "city": "City", "matches_count": "Matches",
            "avg_1st": "Avg 1st Inn", "avg_2nd": "Avg 2nd Inn",
        }), bold_cols=["Stadium"])
        if has_rain:
            return ui.TagList(tbl, ui.HTML('<div style="font-size:11px;color:#6b7280;margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb">* Rain-shortened matches excluded from score averages</div>'))
        return tbl

    @render.ui
    def home_away_overall():
        matches = _stat_matches()
        if matches.empty:
            return empty_state()

        home_wins = 0
        away_wins = 0
        for _, row in matches.iterrows():
            if str(row.get("result", "")) == "no result" or not row.get("winner"):
                continue
            winner = row["winner"]
            venue = row["venue"]
            if HOME_VENUES.get(winner, "") == venue:
                home_wins += 1
            else:
                away_wins += 1

        total = home_wins + away_wins
        if total == 0:
            return empty_state()

        fig = go.Figure(go.Pie(
            labels=["Home Wins", "Away Wins"],
            values=[home_wins, away_wins],
            marker=dict(colors=["#16a34a", "#3b82f6"], line=dict(color="#ffffff", width=2)),
            textinfo="label+value+percent",
            textfont=dict(size=13, color="#1f2937"),
            hovertemplate="<b>%{label}</b><br>%{value} wins (%{percent})<extra></extra>",
            hole=0.45,
        ))
        fig.update_layout(
            showlegend=False,
            annotations=[dict(text=f"{total}", x=0.5, y=0.5, font_size=20, font_color="#1f2937", showarrow=False)],
        )
        return plotly_ui(_apply_style(fig, height=350))

    @render.ui
    def home_advantage_chart():
        matches = _stat_matches()
        if matches.empty:
            return empty_state()

        rows = []
        for _, row in matches.iterrows():
            venue = row["venue"]
            winner = row.get("winner", "")
            result = str(row.get("result", ""))
            if result == "no result":
                continue
            for team_col in ["team_1", "team_2"]:
                team = row[team_col]
                is_home = HOME_VENUES.get(team, "") == venue
                loc = "Home" if is_home else "Away"
                won = 1 if team == winner else 0
                rows.append({"team": team, "location": loc, "won": won})

        if not rows:
            return empty_state()

        df = pd.DataFrame(rows)
        agg = df.groupby(["team", "location"]).agg(played=("won", "count"), wins=("won", "sum")).reset_index()
        agg["win_pct"] = (agg["wins"] / agg["played"] * 100).round(1)

        teams_sorted = sorted(agg["team"].unique())
        fig = go.Figure()
        for loc in ["Home", "Away"]:
            ldf = agg[agg["location"] == loc].set_index("team").reindex(teams_sorted).reset_index()
            colors = [team_color(t) for t in ldf["team"]]
            # Away bars get 50% opacity
            if loc == "Away":
                def _fade(hex_c):
                    r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
                    return f"rgba({r},{g},{b},0.45)"
                colors = [_fade(c) for c in colors]
            fig.add_trace(go.Bar(
                x=[team_short(t) for t in ldf["team"]],
                y=ldf["win_pct"].fillna(0),
                name=loc,
                marker=dict(color=colors, cornerradius=4),
                text=[f"{int(w)}/{int(p)}" if pd.notna(w) else "" for w, p in zip(ldf["wins"], ldf["played"])],
                textposition="outside",
                textfont=dict(size=11, color="#1f2937"),
                hovertemplate="<b>%{x}</b> " + loc + "<br>Win%%: %{y:.1f}%%<br>Record: %{text}<extra></extra>",
            ))

        fig.update_layout(
            barmode="group",
            title="Home vs Away Win %",
            xaxis_title="",
            yaxis_title="Win %",
            yaxis=dict(range=[0, 110]),
            legend=dict(orientation="h", yanchor="bottom", y=-0.2, xanchor="center", x=0.5),
        )
        return plotly_ui(_apply_style(fig))

    # ── Match Centre ──────────────────────────

    @reactive.calc
    def selected_match_num():
        return int(input.match_select())

    @reactive.calc
    def match_innings_teams():
        """Return dict mapping innings number to team name for selected match."""
        bbb = load_ball_by_ball()
        mn = selected_match_num()
        mbbb = bbb[bbb["match_number"] == mn]
        teams = {}
        for inn in mbbb["innings"].unique():
            inn_df = mbbb[mbbb["innings"] == inn]
            if not inn_df.empty:
                teams[int(inn)] = inn_df["team"].iloc[0]
        return teams

    @render.ui
    def match_header():
        mn = selected_match_num()
        m = load_matches()
        match_rows = m[m["match_number"] == mn]
        if match_rows.empty:
            return empty_state("Match data not found")
        row = match_rows.iloc[0]
        t1, t2 = row["team_1"], row["team_2"]
        winner = str(row.get("winner", ""))
        result = str(row.get("result", ""))
        is_no_result = result == "no result" or winner == "nan" or winner == ""
        s1 = str(row["team_1_score"]) if str(row["team_1_score"]) != "nan" else "-"
        s2 = str(row["team_2_score"]) if str(row["team_2_score"]) != "nan" else "-"

        if is_no_result:
            summary = f"No Result | {row['venue']}"
        else:
            wbw = pd.to_numeric(row.get("win_by_wickets", 0), errors="coerce") or 0
            wbr = pd.to_numeric(row.get("win_by_runs", 0), errors="coerce") or 0
            if wbw > 0:
                margin = f"by {int(wbw)} wickets"
            elif wbr > 0:
                margin = f"by {int(wbr)} runs"
            else:
                margin = result
            pom = str(row.get("player_of_match", ""))
            pom_text = f" | POM: {pom}" if pom and pom != "nan" else ""
            summary = f"<b>{winner}</b> won {margin} | {row['venue']}{pom_text}"

        return ui.HTML(f"""
        <div style="display:flex; align-items:center; justify-content:center; gap:30px; padding:20px 0;">
            <div style="text-align:center;">
                <div style="height:70px; display:flex; align-items:center; justify-content:center;">
                    <img src="{team_logo(t1)}" style="max-height:70px; max-width:70px; object-fit:contain;">
                </div>
                <div style="font-weight:700; font-size:16px; margin-top:8px; white-space:nowrap;">{t1}</div>
                <div style="font-size:28px; font-weight:800; color:{team_color(t1)};">{s1}</div>
            </div>
            <div style="font-size:20px; font-weight:600; color:#6b7280;">vs</div>
            <div style="text-align:center;">
                <div style="height:70px; display:flex; align-items:center; justify-content:center;">
                    <img src="{team_logo(t2)}" style="max-height:70px; max-width:70px; object-fit:contain;">
                </div>
                <div style="font-weight:700; font-size:16px; margin-top:8px; white-space:nowrap;">{t2}</div>
                <div style="font-size:28px; font-weight:800; color:{team_color(t2)};">{s2}</div>
            </div>
        </div>
        <div style="text-align:center; padding-bottom:10px;">
            {summary}
        </div>
        """)

    @render.ui
    def match_worm():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        return plotly_ui(worm_chart(bbb, selected_match_num()))

    @render.ui
    def match_key_moments():
        mn = selected_match_num()
        bat = load_batting_scorecards()
        bowl = load_bowling_scorecards()
        part = load_partnerships()
        bbb = load_ball_by_ball()

        tiles = []

        # Top batter
        bdf = bat[bat["match_number"] == mn] if not bat.empty else pd.DataFrame()
        if not bdf.empty:
            tb = bdf.sort_values("runs", ascending=False).iloc[0]
            tiles.append((
                "Top Batter",
                tb["batter"],
                f"{int(tb['runs'])} ({int(tb['balls'])}b)",
                f"SR {float(tb['strike_rate']):.1f} · {int(tb['fours'])}×4 · {int(tb['sixes'])}×6",
                team_color(tb["team"]) if "team" in tb else "#1a56db",
            ))

        # Top bowler (by wickets, then economy)
        wdf = bowl[bowl["match_number"] == mn] if not bowl.empty else pd.DataFrame()
        if not wdf.empty:
            wdf_sorted = wdf.sort_values(["wickets", "economy"], ascending=[False, True])
            tw = wdf_sorted.iloc[0]
            tiles.append((
                "Top Bowler",
                tw["bowler"],
                f"{int(tw['wickets'])}/{int(tw['runs'])}",
                f"{float(tw['overs']):.1f} ov · ER {float(tw['economy']):.2f}",
                team_color(tw["team"]) if "team" in tw else "#1a56db",
            ))

        # Highest partnership
        pdf = part[part["match_number"] == mn] if not part.empty else pd.DataFrame()
        if not pdf.empty:
            hp = pdf.sort_values("total_runs", ascending=False).iloc[0]
            tiles.append((
                "Best Partnership",
                f"{hp['batter_1']} & {hp['batter_2']}",
                f"{int(hp['total_runs'])} ({int(hp['total_balls'])}b)",
                f"{team_short(hp['team'])} · wkt #{int(hp['wicket_number'])}",
                team_color(hp["team"]),
            ))

        # Biggest over
        obb = bbb[bbb["match_number"] == mn] if not bbb.empty else pd.DataFrame()
        if not obb.empty:
            ov = obb.groupby(["innings", "team", "over"])["total_runs"].sum().reset_index()
            if not ov.empty:
                big = ov.sort_values("total_runs", ascending=False).iloc[0]
                tiles.append((
                    "Biggest Over",
                    f"Over {int(big['over'])}",
                    f"{int(big['total_runs'])} runs",
                    team_short(big["team"]),
                    team_color(big["team"]),
                ))

        if not tiles:
            return empty_state()

        tile_html = "".join(
            f"""
            <div style="flex:1;min-width:180px;border:1px solid #e5e7eb;border-left:4px solid {accent};
                        border-radius:8px;padding:12px 14px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">{label}</div>
                <div style="font-size:16px;font-weight:700;color:#111827;margin-top:4px;">{name}</div>
                <div style="font-size:20px;font-weight:800;color:{accent};margin-top:2px;">{main}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px;">{sub}</div>
            </div>
            """
            for (label, name, main, sub, accent) in tiles
        )
        return ui.HTML(
            f'<div style="display:flex;flex-wrap:wrap;gap:12px;padding:4px 0;">{tile_html}</div>'
        )

    @render.ui
    def match_manhattan_1_header():
        return _team_header(1, "Manhattan")

    @render.ui
    def match_manhattan_2_header():
        return _team_header(2, "Manhattan")

    def _match_manhattan(innings):
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        mbbb = bbb[(bbb["match_number"] == selected_match_num()) & (bbb["innings"] == innings)]
        if mbbb.empty:
            return empty_state()
        return plotly_ui(manhattan_chart(bbb, selected_match_num(), innings))

    @render.ui
    def match_manhattan_1():
        return _match_manhattan(1)

    @render.ui
    def match_manhattan_2():
        return _match_manhattan(2)

    @render.ui
    def match_run_rate():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        mbbb = bbb[bbb["match_number"] == selected_match_num()]
        if mbbb.empty:
            return empty_state()
        return plotly_ui(run_rate_chart(bbb, selected_match_num()))

    def _team_header(innings, label):
        teams = match_innings_teams()
        team = teams.get(innings, f"{innings} Innings")
        short = team_short(team)
        color = team_color(team)
        return ui.HTML(
            f'<div class="card-header" style="display:flex;align-items:center;gap:8px;">'
            f'<span style="width:10px;height:10px;border-radius:50%;background:{color};display:inline-block;"></span>'
            f'<b>{label} — {short}</b>'
            f'</div>'
        )

    @render.ui
    def scorecard_bat_1_header():
        return _team_header(1, "Batting")

    @render.ui
    def scorecard_bat_2_header():
        return _team_header(2, "Batting")

    @render.ui
    def scorecard_bowl_1_header():
        return _team_header(2, "Bowling")  # team 2 bowls in innings 1

    @render.ui
    def scorecard_bowl_2_header():
        return _team_header(1, "Bowling")  # team 1 bowls in innings 2

    @render.ui
    def match_phase_1_header():
        return _team_header(1, "Phase Summary")

    @render.ui
    def match_phase_2_header():
        return _team_header(2, "Phase Summary")

    @render.ui
    def match_partnership_1_header():
        return _team_header(1, "Partnerships")

    @render.ui
    def match_partnership_2_header():
        return _team_header(2, "Partnerships")

    def _batting_scorecard(innings):
        batting = load_batting_scorecards()
        if batting.empty:
            return empty_state()
        df = batting[(batting["match_number"] == selected_match_num()) & (batting["innings"] == innings)]
        if df.empty:
            return empty_state()
        df = df[["batter", "runs", "balls", "fours", "sixes", "strike_rate", "dismissal"]].copy()
        df.columns = ["Batter", "Runs", "Balls", "4s", "6s", "SR", "Dismissal"]
        return styled_table(df, highlight_cols=["Runs"], bold_cols=["Batter"], player_col="Batter", player_teams=player_teams())

    def _bowling_scorecard(innings):
        bowling = load_bowling_scorecards()
        if bowling.empty:
            return empty_state()
        df = bowling[(bowling["match_number"] == selected_match_num()) & (bowling["innings"] == innings)]
        if df.empty:
            return empty_state()
        df = df[["bowler", "overs", "maidens", "runs", "wickets", "economy", "dots"]].copy()
        df.columns = ["Bowler", "Overs", "Mdns", "Runs", "Wkts", "Econ", "Dots"]
        return styled_table(df, highlight_cols=["Wkts"], bold_cols=["Bowler"], player_col="Bowler", player_teams=player_teams())

    @render.ui
    def scorecard_bat_1():
        return _batting_scorecard(1)

    @render.ui
    def scorecard_bat_2():
        return _batting_scorecard(2)

    @render.ui
    def scorecard_bowl_1():
        return _bowling_scorecard(1)

    @render.ui
    def scorecard_bowl_2():
        return _bowling_scorecard(2)

    @render.ui
    def match_fow_chart():
        fow = load_fall_of_wickets()
        if fow.empty:
            return empty_state()
        return plotly_ui(fow_timeline(fow, selected_match_num()))

    def _phase_table(innings):
        phase = load_phase_summaries()
        if phase.empty:
            return empty_state()
        mp = phase[(phase["match_number"] == selected_match_num()) & (phase["innings"] == innings)].copy()
        if mp.empty:
            return empty_state()
        phase_labels = {"powerplay": "Powerplay", "middle": "Middle", "death": "Death"}
        mp["phase"] = mp["phase"].map(phase_labels).fillna(mp["phase"])
        mp = mp[["phase", "runs", "wickets", "balls", "run_rate", "boundaries", "dots"]]
        mp.columns = ["Phase", "Runs", "Wkts", "Balls", "RR", "Boundaries", "Dots"]
        return styled_table(mp, highlight_cols=["RR"], bold_cols=["Phase"])

    @render.ui
    def match_phase_1():
        return _phase_table(1)

    @render.ui
    def match_phase_2():
        return _phase_table(2)

    def _partnership_chart(innings):
        p = load_partnerships()
        if p.empty:
            return empty_state()
        idf = p[(p["match_number"] == selected_match_num()) & (p["innings"] == innings)].copy()
        if idf.empty:
            return empty_state()
        idf = idf.sort_values("wicket_number")
        team = idf["team"].iloc[0]
        color = team_color(team)

        def ordinal(n):
            return str(n) + ("th" if 4 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))

        labels = [ordinal(int(w)) + " wkt" for w in idf["wicket_number"]]

        fig = go.Figure()
        r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
        lighter = f"rgba({r},{g},{b},0.55)"
        max_runs = idf["total_runs"].max() if not idf.empty else 1

        fig.add_trace(go.Bar(
            y=labels, x=idf["batter_1_runs"], orientation="h",
            name="Batter 1", marker=dict(color=color, cornerradius=3),
            hovertemplate=idf["batter_1"] + ": " + idf["batter_1_runs"].astype(str) + "<extra></extra>",
        ))
        fig.add_trace(go.Bar(
            y=labels, x=idf["batter_2_runs"], orientation="h",
            name="Batter 2", marker=dict(color=lighter, cornerradius=3),
            hovertemplate=idf["batter_2"] + ": " + idf["batter_2_runs"].astype(str) + "<extra></extra>",
        ))
        # Total annotation on the right
        x_pad = max(max_runs * 0.03, 2)
        for _, row in idf.iterrows():
            wkt_label = ordinal(int(row["wicket_number"])) + " wkt"
            fig.add_annotation(
                x=row["total_runs"] + x_pad, y=wkt_label,
                text=f"<b>{int(row['total_runs'])}</b> ({int(row['total_balls'])}b)",
                showarrow=False, font=dict(size=10, color="#6b7280"), xanchor="left",
            )

        fig.update_layout(
            barmode="stack", showlegend=False,
            xaxis=dict(title="Runs", showgrid=False, range=[0, max_runs * 1.25]),
            **LAYOUT_TEMPLATE,
            margin=dict(l=10, r=10, t=10, b=30),
            height=max(200, len(idf) * 40 + 50),
        )
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.05)", zeroline=False, autorange="reversed")
        return plotly_ui(fig)

    @render.ui
    def match_partnership_1():
        return _partnership_chart(1)

    @render.ui
    def match_partnership_2():
        return _partnership_chart(2)

    @render.ui
    def match_reviews():
        r = load_reviews()
        if r.empty:
            return empty_state("No reviews data available")
        mr = r[r["match_number"] == selected_match_num()]
        if mr.empty:
            return empty_state("No DRS reviews in this match")
        cards = []
        for _, row in mr.iterrows():
            color = team_color(row["team"])
            short = team_short(row["team"])
            upheld = row["decision"].strip().lower() == "upheld"
            badge_color = "#d63031" if upheld else "#27ae60"
            badge_text = "Upheld" if upheld else "Struck Down"
            cards.append(f"""
            <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-left:4px solid {color};
                        background:#f9fafb;border-radius:0 8px 8px 0;margin-bottom:8px;">
                <div style="min-width:50px;text-align:center;">
                    <div style="font-size:11px;color:#6b7280;">Over</div>
                    <div style="font-weight:700;font-size:16px;">{row['over']}.{row['ball']}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-weight:600;font-size:13px;">{short} reviewed ({row['type']})</div>
                    <div style="font-size:12px;color:#6b7280;">{row['batter']} vs {row['bowler']} &middot; Umpire: {row['umpire']}</div>
                </div>
                <div style="background:{badge_color};color:white;padding:3px 10px;border-radius:12px;
                            font-size:11px;font-weight:700;white-space:nowrap;">{badge_text}</div>
            </div>""")
        return ui.HTML("".join(cards))

    @render.ui
    def match_subs():
        s = load_substitutions()
        if s.empty:
            return empty_state("No substitutions data available")
        ms = s[s["match_number"] == selected_match_num()]
        if ms.empty:
            return empty_state("No substitutions in this match")
        cards = []
        for _, row in ms.iterrows():
            color = team_color(row["team"])
            short = team_short(row["team"])
            reason = row["reason"].replace("_", " ").title()
            cards.append(f"""
            <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-left:4px solid {color};
                        background:#f9fafb;border-radius:0 8px 8px 0;margin-bottom:8px;">
                <div style="min-width:50px;text-align:center;">
                    <div style="font-size:11px;color:#6b7280;">Over</div>
                    <div style="font-weight:700;font-size:16px;">{row['over']}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:13px;">
                        <span style="color:#27ae60;font-weight:700;">&#9650; {row['player_in']}</span>
                        <span style="color:#6b7280;margin:0 4px;">for</span>
                        <span style="color:#d63031;font-weight:700;">&#9660; {row['player_out']}</span>
                    </div>
                    <div style="font-size:12px;color:#6b7280;">{short} &middot; {reason}</div>
                </div>
            </div>""")
        return ui.HTML("".join(cards))


app = App(app_ui, server)
