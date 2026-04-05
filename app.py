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
    TEAM_COLORS, LAYOUT_TEMPLATE,
    team_color, team_logo, team_short,
)


def plotly_ui(fig):
    """Render a Plotly figure as HTML. Plotly JS is loaded once in <head>."""
    return ui.HTML(fig.to_html(full_html=False, include_plotlyjs=False))


def empty_state(message="No data available"):
    """Styled empty state placeholder."""
    return ui.HTML(
        f'<div class="empty-state">'
        f'<div class="icon">&#128202;</div>'
        f'<div class="message">{message}</div>'
        f'</div>'
    )


def styled_table(df, highlight_cols=None, bold_cols=None, align_right=None):
    """Render a DataFrame as a styled HTML table.

    highlight_cols: list of column names to highlight with accent color
    bold_cols: list of column names to render bold
    align_right: list of column names to right-align (numeric cols)
    """
    highlight_cols = highlight_cols or []
    bold_cols = bold_cols or []
    align_right = align_right or []

    # Auto-detect numeric columns for right-alignment
    if not align_right:
        for col in df.columns:
            if df[col].dtype in ("int64", "float64", "int32", "float32"):
                align_right.append(col)

    header = "".join(
        f'<th style="padding:8px 12px;text-align:{"right" if c in align_right else "left"};'
        f'border-bottom:2px solid #dee2e6;font-weight:700;font-size:13px;color:#555;'
        f'text-transform:uppercase;letter-spacing:0.5px">{c}</th>'
        for c in df.columns
    )
    rows = ""
    for i, (_, row) in enumerate(df.iterrows()):
        bg = "#f8f9fa" if i % 2 == 1 else "white"
        cells = ""
        for c in df.columns:
            val = row[c]
            style = f'padding:8px 12px;text-align:{"right" if c in align_right else "left"};'
            if c in highlight_cols:
                style += "color:#1a73e8;font-weight:700;"
            elif c in bold_cols:
                style += "font-weight:700;"
            cells += f'<td style="{style}">{val}</td>'
        rows += f'<tr style="background:{bg};border-bottom:1px solid #eef0f2">{cells}</tr>'

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
    # Overview
    ui.nav_panel("Overview",
        # Stats tabs — compact on mobile, full grid on desktop
        ui.navset_pill(
            ui.nav_panel("Key Stats",
                ui.layout_columns(
                    ui.value_box("Matches Played", ui.output_text("overview_matches"), theme="primary"),
                    ui.value_box("Highest Total", ui.output_text("overview_highest"), ui.output_text("overview_highest_team"), theme="success"),
                    ui.value_box("Lowest Total", ui.output_text("overview_lowest"), ui.output_text("overview_lowest_team"), theme="warning"),
                    ui.value_box("Closest Match", ui.output_text("closest_match"), ui.output_text("closest_match_detail"), theme="danger"),
                    col_widths={"sm": [6, 6, 6, 6], "lg": [3, 3, 3, 3]},
                ),
            ),
            ui.nav_panel("Leaders",
                ui.layout_columns(
                    ui.value_box("Leading Run Scorer", ui.output_text("top_scorer"), ui.output_text("top_scorer_runs"), theme="light"),
                    ui.value_box("Leading Wicket Taker", ui.output_text("top_bowler"), ui.output_text("top_bowler_wkts"), theme="light"),
                    col_widths={"sm": [6, 6], "md": [6, 6]},
                ),
            ),
            ui.nav_panel("Numbers",
                ui.layout_columns(
                    ui.value_box("Total Sixes", ui.output_text("total_sixes"), theme="light"),
                    ui.value_box("Total Fours", ui.output_text("total_fours"), theme="light"),
                    ui.value_box("Toss Winner Won", ui.output_ui("toss_win_pct"), theme="light"),
                    ui.value_box("Chose to Field", ui.output_ui("field_first_pct"), theme="light"),
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
            ui.card(ui.card_header("Top Fielders (Stacked Breakdown)"), ui.output_ui("fielding_stacked_chart")),
            col_widths=[12],
        ),
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
    ui.nav_panel("Team Analysis",
        ui.layout_columns(
            ui.card(ui.card_header("NRR Progression"), ui.output_ui("nrr_chart")),
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
                ui.input_select("phase_metric", "Metric", choices=["run_rate", "wickets", "boundaries", "dots"]),
                ui.output_ui("team_phase_chart"),
            ),
            col_widths=[12],
        ),
        ui.layout_columns(
            ui.card(ui.card_header("Venue Performance"), ui.output_ui("venue_table"), full_screen=True),
            col_widths=[12],
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
            ui.card(ui.card_header("Worm Chart"), ui.output_ui("match_worm")),
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

    title=ui.tags.span("openIPL", style="font-weight:700;"),
    id="nav",
    theme=ui.Theme("flatly"),
    header=ui.head_content(
        ui.tags.script(src="https://cdn.plot.ly/plotly-2.35.2.min.js", type="text/javascript"),
        ui.tags.link(rel="preconnect", href="https://fonts.googleapis.com"),
        ui.tags.link(rel="preconnect", href="https://fonts.gstatic.com", crossorigin=""),
        ui.tags.link(href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap", rel="stylesheet"),
        ui.tags.style("""
            /* Typography */
            body, .navbar, .nav-link, .card, .card-header,
            h1, h2, h3, h4, h5, h6, th, td, label, select, input {
                font-family: 'Figtree', sans-serif !important;
            }

            /* Value box styling */
            .bslib-value-box .value-box-title {
                text-decoration: underline !important;
                text-underline-offset: 4px !important;
                text-decoration-thickness: 2px !important;
            }
            .bslib-value-box .value-box-value {
                font-weight: 500 !important;
            }

            /* Loading shimmer bar */
            .shiny-busy .recalculating { opacity: 0.4; transition: opacity 0.3s; }
            .shiny-busy .navbar::after {
                content: ''; position: fixed; top: 0; left: 0; width: 100%; height: 3px;
                background: linear-gradient(90deg, #1a73e8, #45B7D1, #1a73e8);
                background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;
                z-index: 9999;
            }
            @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

            /* Empty state */
            .empty-state { text-align: center; padding: 40px 20px; color: #888; }
            .empty-state .icon { font-size: 32px; margin-bottom: 8px; }
            .empty-state .message { font-size: 14px; }

            /* Pill tabs spacing */
            .nav-pills { margin-bottom: 12px !important; }

            /* Force 2-col grid for value-box rows on small screens */
            @media (max-width: 575.98px) {
                .tab-content bslib-layout-columns.bslib-grid {
                    grid-template-columns: 1fr 1fr !important;
                }
                .tab-content .bslib-grid-item:has(> .bslib-value-box) {
                    grid-column: span 1 !important;
                }
            }

            /* Mobile */
            @media (max-width: 768px) {
                .bslib-value-box { min-height: 0 !important; }
                .bslib-value-box .card-body { padding: 10px 12px !important; }
                .bslib-value-box .value-box-area { padding: 0 !important; min-height: 0 !important; }
                .bslib-value-box .value-box-title { font-size: 0.7rem !important; line-height: 1.2 !important; margin: 0 0 2px 0 !important; }
                .bslib-value-box .value-box-value { font-size: 1.1rem !important; line-height: 1.3 !important; margin: 0 !important; }
                .bslib-value-box .value-box-showcase { display: none !important; }
                .card { margin-bottom: 8px !important; }
                .bslib-mb-spacing { margin-bottom: 8px !important; }
                .container-fluid { padding-left: 8px !important; padding-right: 8px !important; }
                .nav-link { font-size: 12px !important; padding: 6px 8px !important; }
                table { font-size: 12px !important; }
                table th, table td { padding: 4px 6px !important; }
            }
            @media (max-width: 576px) {
                .navbar-brand { font-size: 18px !important; font-weight: 800 !important; }
            }
        """),
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
        return str(len(load_matches()))



    @reactive.calc
    def all_scores():
        matches = load_matches()
        scores = []
        for _, row in matches.iterrows():
            for col, tcol in [("team_1_score", "team_1"), ("team_2_score", "team_2")]:
                s = str(row[col])
                if "/" in s:
                    scores.append((int(s.split("/")[0]), s, row[tcol]))
        return scores

    @render.text
    def overview_highest():
        scores = all_scores()
        return max(scores, key=lambda x: x[0])[1] if scores else "-"

    @render.text
    def overview_highest_team():
        scores = all_scores()
        return max(scores, key=lambda x: x[0])[2] if scores else ""

    @render.text
    def overview_lowest():
        scores = all_scores()
        return min(scores, key=lambda x: x[0])[1] if scores else "-"

    @render.text
    def overview_lowest_team():
        scores = all_scores()
        return min(scores, key=lambda x: x[0])[2] if scores else ""

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
            rows_html += f"""<tr style="border-bottom:1px solid #f0f0f0">
                <td style="text-align:center;padding:6px">{int(r['position'])}</td>
                <td style="white-space:nowrap;padding:6px"><img src="{logo}" style="height:22px;width:22px;object-fit:contain;vertical-align:middle;margin-right:8px" onerror="this.style.display='none'"><strong>{short}</strong> <span style="color:#666;font-size:0.85em">{r['team']}</span></td>
                <td style="text-align:center;padding:6px">{int(r['played'])}</td>
                <td style="text-align:center;color:#28a745;font-weight:600;padding:6px">{int(r['won'])}</td>
                <td style="text-align:center;color:#dc3545;padding:6px">{int(r['lost'])}</td>
                <td style="text-align:center;padding:6px">{int(r['no_result'])}</td>
                <td style="text-align:center;font-family:monospace;padding:6px">{nrr}</td>
                <td style="text-align:center;padding:6px"><strong>{int(r['points'])}</strong></td>
            </tr>"""
        return ui.HTML(f"""<table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead><tr style="border-bottom:2px solid #dee2e6;text-align:center">
                <th style="padding:8px">#</th><th style="padding:8px;text-align:left">Team</th>
                <th style="padding:8px">P</th><th style="padding:8px">W</th><th style="padding:8px">L</th>
                <th style="padding:8px">NR</th><th style="padding:8px">NRR</th><th style="padding:8px">Pts</th>
            </tr></thead><tbody style="line-height:2.2">{rows_html}</tbody></table>""")

    @render.ui
    def toss_win_pct():
        m = load_matches()
        if m.empty:
            return ui.HTML("-")
        wins = (m["toss_winner"] == m["winner"]).sum()
        pct = round(wins / len(m) * 100)
        return ui.HTML(f'{wins}/{len(m)} <span style="font-size:0.6em;color:#888;">({pct}%)</span>')

    @render.ui
    def field_first_pct():
        m = load_matches()
        if m.empty:
            return ui.HTML("-")
        ff = (m["toss_decision"] == "field").sum()
        pct = round(ff / len(m) * 100)
        return ui.HTML(f'{ff}/{len(m)} <span style="font-size:0.6em;color:#888;">({pct}%)</span>')

    @render.text
    def top_scorer():
        bat = load_batting_scorecards()
        if bat.empty:
            return "-"
        return bat.groupby("batter")["runs"].sum().idxmax()

    @render.text
    def top_scorer_runs():
        bat = load_batting_scorecards()
        if bat.empty:
            return ""
        return f"{bat.groupby('batter')['runs'].sum().max()} runs"

    @render.text
    def top_bowler():
        bowl = load_bowling_scorecards()
        if bowl.empty:
            return "-"
        return bowl.groupby("bowler")["wickets"].sum().idxmax()

    @render.text
    def top_bowler_wkts():
        bowl = load_bowling_scorecards()
        if bowl.empty:
            return ""
        return f"{bowl.groupby('bowler')['wickets'].sum().max()} wickets"

    @render.text
    def total_sixes():
        bbb = load_ball_by_ball()
        return str((bbb["batter_runs"] == 6).sum()) if not bbb.empty else "0"

    @render.text
    def total_fours():
        bbb = load_ball_by_ball()
        return str((bbb["batter_runs"] == 4).sum()) if not bbb.empty else "0"

    @render.ui
    def overview_pie():
        m = load_matches()
        if m.empty:
            return empty_state()
        bat_wins = len(m[m["win_by_runs"].astype(int) > 0])
        chase_wins = len(m[m["win_by_wickets"].astype(int) > 0])
        fig = go.Figure(go.Pie(
            labels=["Bat First", "Chasing"],
            values=[bat_wins, chase_wins],
            hole=0.45,
            marker=dict(colors=["#FF6B6B", "#4ECDC4"], line=dict(color="white", width=2)),
            textinfo="label+percent",
            textfont=dict(size=13),
        ))
        fig.update_layout(height=300, showlegend=False,
                          margin=dict(l=10, r=10, t=10, b=10),
                          paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
        return plotly_ui(fig)

    @render.ui
    def overview_avg_innings():
        m = load_matches()
        if m.empty:
            return empty_state()
        avg1 = m["team_1_score"].apply(lambda x: int(str(x).split("/")[0]) if "/" in str(x) else 0).mean()
        avg2 = m["team_2_score"].apply(lambda x: int(str(x).split("/")[0]) if "/" in str(x) else 0).mean()
        fig = go.Figure(go.Bar(
            x=["1st Innings", "2nd Innings"], y=[avg1, avg2],
            marker=dict(color=["#1a73e8", "#45B7D1"], cornerradius=4),
            text=[f"{avg1:.0f}", f"{avg2:.0f}"], textposition="outside",
            textfont=dict(size=13, color="#333"), width=0.5,
        ))
        fig.update_layout(height=300, yaxis_title="Avg Score",
                          margin=dict(l=40, r=10, t=10, b=10),
                          paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
        fig.update_xaxes(gridcolor="rgba(0,0,0,0.05)", zeroline=False)
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False)
        return plotly_ui(fig)

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
        return f"{team_short(row['winner'])} vs {team_short(loser)}"

    @render.ui
    def recent_results():
        m = load_matches()
        if m.empty:
            return empty_state("No match results available")
        m = m.sort_values("match_number", ascending=False).head(5)
        cards_html = ""
        for _, row in m.iterrows():
            t1, t2 = row["team_1"], row["team_2"]
            s1, s2 = str(row["team_1_score"]), str(row["team_2_score"])
            winner = row["winner"]
            c1, c2 = team_color(t1), team_color(t2)
            logo1, logo2 = team_logo(t1), team_logo(t2)
            w1 = "font-weight:800" if winner == t1 else "opacity:0.6"
            w2 = "font-weight:800" if winner == t2 else "opacity:0.6"
            if int(row["win_by_wickets"]) > 0:
                margin = f"{winner} won by {int(row['win_by_wickets'])} wickets"
            else:
                margin = f"{winner} won by {int(row['win_by_runs'])} runs"
            cards_html += f"""
            <div style="flex:1;min-width:220px;border:1px solid #e0e0e0;border-radius:10px;padding:14px;background:white">
                <div style="font-size:11px;color:#888;margin-bottom:8px">Match {int(row['match_number'])} &bull; {row['date']}</div>
                <div style="display:flex;align-items:center;margin-bottom:6px;{w1}">
                    <img src="{logo1}" style="height:24px;width:24px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">
                    <span style="margin-left:8px;white-space:nowrap;flex:1">{team_short(t1)}</span>
                    <span style="font-family:monospace;font-size:13px;white-space:nowrap">{s1}</span>
                </div>
                <div style="display:flex;align-items:center;{w2}">
                    <img src="{logo2}" style="height:24px;width:24px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">
                    <span style="margin-left:8px;white-space:nowrap;flex:1">{team_short(t2)}</span>
                    <span style="font-family:monospace;font-size:13px;white-space:nowrap">{s2}</span>
                </div>
                <div style="font-size:11px;color:#555;margin-top:8px;border-top:1px solid #eee;padding-top:4px;white-space:nowrap">{margin}</div>
                <div style="font-size:11px;color:#888;margin-top:4px;white-space:nowrap">POM: <strong style="color:#333">{row['player_of_match']}</strong></div>
            </div>"""
        return ui.HTML(f'<div style="display:flex;gap:12px;flex-wrap:wrap">{cards_html}</div>')

    def _boundary_chart(stat, view_value, color):
        """Shared logic for most sixes/fours charts."""
        bat = load_batting_scorecards()
        if bat.empty:
            return empty_state()
        if view_value == "overall":
            top = bat.groupby("batter").agg(count=(stat, "sum"), innings=(stat, "count")).reset_index()
            top = top.nlargest(10, "count")
            top["label"] = top["batter"] + " (" + top["innings"].astype(str) + " inn)"
        else:
            matches = load_matches()
            top = bat.sort_values([stat, "strike_rate"], ascending=[False, False]).head(10)[["batter", stat, "runs", "balls", "team", "match_number"]].copy()
            top = top.merge(matches[["match_number", "team_1", "team_2"]], on="match_number", how="left")
            top["opponent"] = top.apply(lambda r: team_short(r["team_2"]) if r["team"] == r["team_1"] else team_short(r["team_1"]), axis=1)
            top["label"] = top["batter"] + " (vs " + top["opponent"] + ", M" + top["match_number"].astype(str) + ")"
            top["count"] = top[stat]
        fig = go.Figure(go.Bar(
            x=top["count"], y=top["label"], orientation="h",
            marker=dict(color=color, cornerradius=4),
            text=top["count"], textposition="outside", textfont=dict(size=13, color="#333"),
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
        bat = load_batting_scorecards()
        if bat.empty:
            return pd.DataFrame()
        agg = bat.groupby("batter").agg(
            runs=("runs", "sum"), innings=("runs", "count"),
            balls=("balls", "sum"), fours=("fours", "sum"), sixes=("sixes", "sum"),
        ).reset_index()
        agg["avg"] = (agg["runs"] / agg["innings"]).round(2)
        agg["sr"] = ((agg["runs"] / agg["balls"]) * 100).round(2).fillna(0)
        return agg.sort_values(["runs", "sr", "innings"], ascending=[False, False, True])

    @render.ui
    def orange_cap_chart():
        agg = batting_agg()
        if agg.empty:
            return empty_state()
        return plotly_ui(horizontal_bar(agg.head(10), x="runs", y="batter", title="", text="runs"))

    @render.ui
    def batting_leaderboard():
        agg = batting_agg().head(15)
        if agg.empty:
            return empty_state()
        return styled_table(agg.rename(columns={
            "batter": "Batter", "runs": "Runs", "innings": "Inn",
            "balls": "Balls", "fours": "4s", "sixes": "6s", "avg": "Avg", "sr": "SR",
        }), highlight_cols=["Runs"], bold_cols=["Batter"])

    @render.ui
    def highest_scores():
        bat = load_batting_scorecards()
        if bat.empty:
            return empty_state()
        top = bat.nlargest(10, "runs")[["batter", "runs", "balls", "fours", "sixes", "strike_rate"]].copy()
        top.columns = ["Batter", "Runs", "Balls", "4s", "6s", "SR"]
        return styled_table(top, highlight_cols=["Runs"], bold_cols=["Batter"])

    @render.ui
    def best_sr():
        agg = batting_agg()
        if agg.empty:
            return empty_state()
        q = agg[agg["balls"] >= 30].nlargest(10, "sr")[["batter", "sr", "runs", "balls"]].copy()
        q.columns = ["Batter", "SR", "Runs", "Balls"]
        return styled_table(q, highlight_cols=["SR"], bold_cols=["Batter"])

    @render.ui
    def boundaries_chart():
        agg = batting_agg()
        if agg.empty:
            return empty_state()
        agg = agg.copy()
        agg["boundaries"] = agg["fours"] + agg["sixes"]
        top = agg.nlargest(10, "boundaries").reset_index(drop=True)
        fig = go.Figure()
        fig.add_trace(go.Bar(
            x=top["batter"], y=top["fours"], name="Fours",
            marker=dict(color="#1a73e8", cornerradius=4),
        ))
        fig.add_trace(go.Bar(
            x=top["batter"], y=top["sixes"], name="Sixes",
            marker=dict(color="#FF6B6B", cornerradius=4),
        ))
        fig.update_layout(barmode="stack", showlegend=True,
                          legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                          margin=dict(l=10, r=10, t=40, b=10),
                          paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
        fig.update_xaxes(gridcolor="rgba(0,0,0,0.05)", zeroline=False)
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False)
        return plotly_ui(fig)

    @render.ui
    def batting_phase_chart():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        team_filter = input.batting_phase_team()
        if team_filter and team_filter != "All Teams":
            bbb = bbb[bbb["team"] == team_filter]
        phase_bat = bbb.groupby("phase").agg(
            runs=("batter_runs", "sum"), balls=("batter_runs", "count"),
        ).reset_index()
        phase_bat["sixes"] = bbb.groupby("phase")["batter_runs"].apply(lambda x: (x == 6).sum()).values
        phase_bat["fours"] = bbb.groupby("phase")["batter_runs"].apply(lambda x: (x == 4).sum()).values
        phase_bat["dots"] = bbb.groupby("phase")["batter_runs"].apply(lambda x: (x == 0).sum()).values
        phase_bat["Run Rate"] = ((phase_bat["runs"] / phase_bat["balls"]) * 6).round(2)
        phase_bat["Boundary %"] = (((phase_bat["sixes"] + phase_bat["fours"]) / phase_bat["balls"]) * 100).round(1)
        phase_bat["Dot Ball %"] = ((phase_bat["dots"] / phase_bat["balls"]) * 100).round(1)
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
        text_colors = [["white" if z_norm[r][c] > 0.45 else "#333" for c in range(len(metrics))] for r in range(len(y_labels))]
        fig = go.Figure(go.Heatmap(
            z=z_norm, x=metrics, y=y_labels,
            text=text, texttemplate="%{text}", textfont=dict(size=16),
            colorscale=[[0, "#e8f4f8"], [0.5, "#45B7D1"], [1, "#1a73e8"]],
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
            **LAYOUT_TEMPLATE, margin=dict(l=0, r=0, t=30, b=0), height=chart_height,
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
        return ui.div(
            ui.div(plotly_ui(fig), style="max-width:500px;margin:0 auto;"),
            ui.HTML('<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">'),
            ui.div(
                ui.p("Runs by Phase", style="text-align:center;font-weight:600;font-size:13px;margin:0 0 -10px 0;color:#555;"),
                plotly_ui(donut),
                style="max-width:280px;margin:0 auto;",
            ),
        )

    # ── Bowling ───────────────────────────────

    @reactive.calc
    def bowling_agg():
        bowl = load_bowling_scorecards()
        if bowl.empty:
            return pd.DataFrame()
        agg = bowl.groupby("bowler").agg(
            wickets=("wickets", "sum"), innings=("wickets", "count"),
            overs=("overs", "sum"), runs=("runs", "sum"), maidens=("maidens", "sum"),
            dots=("dots", "sum"), wides=("wides", "sum"), noballs=("noballs", "sum"),
        ).reset_index()
        agg["economy"] = (agg["runs"] / agg["overs"]).round(2)
        agg["avg"] = agg.apply(lambda r: round(r["runs"] / r["wickets"], 2) if r["wickets"] > 0 else float("inf"), axis=1)
        return agg.sort_values(["wickets", "economy", "innings"], ascending=[False, True, True])

    @render.ui
    def purple_cap_chart():
        agg = bowling_agg()
        if agg.empty:
            return empty_state()
        return plotly_ui(horizontal_bar(agg.head(10), x="wickets", y="bowler", title="", text="wickets"))

    @render.ui
    def bowling_leaderboard():
        agg = bowling_agg().head(15).copy()
        if agg.empty:
            return empty_state()
        agg["avg"] = agg["avg"].apply(lambda x: f"{x:.2f}" if x != float("inf") else "-")
        return styled_table(agg.rename(columns={
            "bowler": "Bowler", "wickets": "Wkts", "innings": "Inn",
            "overs": "Overs", "runs": "Runs", "maidens": "Mdns",
            "dots": "Dots", "economy": "Econ", "avg": "Avg",
        }), highlight_cols=["Wkts"], bold_cols=["Bowler"])

    @render.ui
    def best_figures():
        bowl = load_bowling_scorecards()
        if bowl.empty:
            return empty_state()
        bowl = bowl.copy()
        bowl["figures"] = bowl["wickets"].astype(str) + "/" + bowl["runs"].astype(str)
        best = bowl.sort_values(["wickets", "runs", "overs"], ascending=[False, True, True]).head(10)[["bowler", "figures", "overs", "economy", "dots"]].copy()
        best.columns = ["Bowler", "Figures", "Overs", "Econ", "Dots"]
        return styled_table(best, highlight_cols=["Figures"], bold_cols=["Bowler"])

    @render.ui
    def best_economy():
        agg = bowling_agg()
        if agg.empty:
            return empty_state()
        q = agg[agg["overs"] >= 10].nsmallest(10, "economy")[["bowler", "economy", "overs", "wickets"]].copy()
        q.columns = ["Bowler", "Econ", "Overs", "Wkts"]
        return styled_table(q, highlight_cols=["Econ"], bold_cols=["Bowler"])

    @render.ui
    def dots_chart():
        agg = bowling_agg()
        if agg.empty:
            return empty_state()
        top = agg.sort_values(["dots", "economy"], ascending=[False, True]).head(10)[["bowler", "dots", "overs", "economy", "wickets"]].copy()
        balls_total = top["overs"] * 6  # approximate
        top["dot_%"] = ((top["dots"] / balls_total) * 100).round(1)
        top = top[["bowler", "dots", "dot_%", "overs", "economy", "wickets"]]
        top.columns = ["Bowler", "Dots", "Dot %", "Overs", "Econ", "Wkts"]
        return styled_table(top, highlight_cols=["Dots"], bold_cols=["Bowler"])

    @render.ui
    def bowling_phase_chart():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        team_filter = input.bowling_phase_team()
        if team_filter and team_filter != "All Teams":
            # Derive bowling team from match data
            matches = load_matches()[["match_number", "team_1", "team_2"]]
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
        phase_bowl["Economy"] = ((phase_bowl["runs"] / phase_bowl["balls"]) * 6).round(2)
        phase_bowl["Strike Rate"] = phase_bowl.apply(
            lambda r: round(r["balls"] / r["wickets"], 1) if r["wickets"] > 0 else float("inf"), axis=1
        )
        phase_bowl["Dot Ball %"] = ((phase_bowl["dots"] / phase_bowl["balls"]) * 100).round(1)
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

        text_colors = [["white" if z_norm[r][c] > 0.45 else "#333" for c in range(len(metrics))] for r in range(len(y_labels))]
        fig = go.Figure(go.Heatmap(
            z=z_norm, x=metrics, y=y_labels,
            text=text, texttemplate="", textfont=dict(size=16),
            colorscale=[[0, "#fde8e8"], [0.5, "#FF6B6B"], [1, "#d63031"]],
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
            **LAYOUT_TEMPLATE, margin=dict(l=0, r=0, t=30, b=0), height=chart_height,
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
        return ui.div(
            ui.div(plotly_ui(fig), style="max-width:500px;margin:0 auto;"),
            ui.HTML('<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">'),
            ui.div(
                ui.p("Wickets by Phase", style="text-align:center;font-weight:600;font-size:13px;margin:0 0 -10px 0;color:#555;"),
                plotly_ui(donut),
                style="max-width:280px;margin:0 auto;",
            ),
        )

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
    def fielding_stacked_chart():
        fagg = fielding_agg()
        if fagg.empty:
            return empty_state()
        top = fagg.head(10)
        fig = go.Figure()
        fig.add_trace(go.Bar(x=top["catches"], y=top["player"], orientation="h", name="Catches", marker=dict(color="#1a73e8", cornerradius=4)))
        fig.add_trace(go.Bar(x=top["run_outs"], y=top["player"], orientation="h", name="Run Outs", marker=dict(color="#FF6B6B", cornerradius=4)))
        fig.add_trace(go.Bar(x=top["stumpings"], y=top["player"], orientation="h", name="Stumpings", marker=dict(color="#34A853", cornerradius=4)))
        fig.update_layout(
            barmode="stack", yaxis=dict(autorange="reversed"),
            showlegend=True, legend=dict(orientation="h", yanchor="bottom", y=-0.2, xanchor="center", x=0.5),
        )
        # Total labels outside the last segment
        for i, row in top.iterrows():
            fig.add_annotation(x=row["total"], y=row["player"], text=str(row["total"]),
                               xanchor="left", showarrow=False, font=dict(size=13, color="#333"), xshift=5)

        return plotly_ui(_apply_style(fig, height=max(300, len(top) * 40)))

    @render.ui
    def fielding_table():
        fagg = fielding_agg()
        if fagg.empty:
            return empty_state()
        top = fagg.head(15)[["player", "catches", "stumpings", "run_outs", "total"]].copy()
        top.columns = ["Player", "Catches", "Stumpings", "Run Outs", "Total"]
        return styled_table(top, highlight_cols=["Total"], bold_cols=["Player"])

    @render.ui
    def partnerships_chart():
        p = load_partnerships()
        if p.empty:
            return empty_state()
        top = p.nlargest(10, "total_runs").copy()
        top["pair"] = top["batter_1"] + " & " + top["batter_2"]
        top = top.iloc[::-1]  # reverse for horizontal bar
        fig = go.Figure()
        fig.add_trace(go.Bar(
            x=top["batter_1_runs"], y=top["pair"], orientation="h",
            name=None, marker=dict(color="#1a73e8", cornerradius=4),
            text=top["batter_1"] + ": " + top["batter_1_runs"].astype(str),
            textposition="inside", textfont=dict(color="white", size=11),
            hovertemplate="%{text}<extra></extra>",
        ))
        fig.add_trace(go.Bar(
            x=top["batter_2_runs"], y=top["pair"], orientation="h",
            name=None, marker=dict(color="#34A853", cornerradius=4),
            text=top["batter_2"] + ": " + top["batter_2_runs"].astype(str),
            textposition="inside", textfont=dict(color="white", size=11),
            hovertemplate="%{text}<extra></extra>",
        ))
        # Add total label outside
        fig.add_trace(go.Bar(
            x=[0]*len(top), y=top["pair"], orientation="h",
            text=top["total_runs"].astype(str) + " (" + top["total_balls"].astype(str) + "b)",
            textposition="outside", textfont=dict(size=12, color="#333"),
            marker=dict(color="rgba(0,0,0,0)"), showlegend=False,
            hoverinfo="skip",
        ))
        fig.update_layout(
            barmode="stack", showlegend=False,
            **LAYOUT_TEMPLATE, margin=dict(l=10, r=60, t=20, b=10),
            height=max(300, len(top) * 45),
        )
        fig.update_xaxes(gridcolor="rgba(0,0,0,0.05)", zeroline=False, title_text="Runs")
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False)
        return plotly_ui(fig)

    @render.ui
    def best_by_wicket_chart():
        p = load_partnerships()
        if p.empty:
            return empty_state()
        best = p.loc[p.groupby("wicket_number")["total_runs"].idxmax()].copy()
        best = best.sort_values("wicket_number", ascending=False)
        def ordinal(n):
            return str(n) + ("th" if 4 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))
        best["wicket_label"] = best["wicket_number"].apply(lambda n: ordinal(n) + " wkt")

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
                showarrow=False, font=dict(size=11, color="#333"), xanchor="left",
            )
        fig.update_layout(
            barmode="relative", showlegend=True,
            legend=dict(orientation="h", yanchor="bottom", y=-0.15, xanchor="center", x=0.5),
            xaxis=dict(
                title="Runs", zeroline=True, zerolinecolor="rgba(0,0,0,0.2)", zerolinewidth=1,
                tickvals=[], showticklabels=False,
            ),
            **LAYOUT_TEMPLATE, margin=dict(l=10, r=80, t=20, b=40),
            height=max(300, len(best) * 50),
        )
        fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False)
        return plotly_ui(fig)

    # ── Team Analysis ─────────────────────────

    @render.ui
    def nrr_chart():
        matches = load_matches()
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()

        teams_nrr = []
        team_running = {}
        team_match_count = {}

        for _, row in matches.sort_values("match_number").iterrows():
            mn = int(row["match_number"])
            for team_col, score_col, opp_score_col in [
                ("team_1", "team_1_score", "team_2_score"),
                ("team_2", "team_2_score", "team_1_score"),
            ]:
                team = row[team_col]
                if team not in team_running:
                    team_running[team] = {"rs": 0, "bf": 0, "rc": 0, "bb": 0}
                    team_match_count[team] = 0
                team_match_count[team] += 1

                score_str = str(row[score_col])
                opp_str = str(row[opp_score_col])
                runs = int(score_str.split("/")[0]) if "/" in score_str else 0
                wickets = int(score_str.split("/")[1]) if "/" in score_str else 0
                opp_runs = int(opp_str.split("/")[0]) if "/" in opp_str else 0
                opp_wickets = int(opp_str.split("/")[1]) if "/" in opp_str else 0

                match_bbb = bbb[bbb["match_number"] == mn]
                inn_df = match_bbb[match_bbb["team"] == team]
                balls = 120 if wickets == 10 else len(inn_df[~inn_df["extra_type"].isin(["wides", "noballs"])])

                opp_team = row["team_2"] if team == row["team_1"] else row["team_1"]
                opp_inn_df = match_bbb[match_bbb["team"] == opp_team]
                opp_balls = 120 if opp_wickets == 10 else len(opp_inn_df[~opp_inn_df["extra_type"].isin(["wides", "noballs"])])

                team_running[team]["rs"] += runs
                team_running[team]["bf"] += balls
                team_running[team]["rc"] += opp_runs
                team_running[team]["bb"] += opp_balls

                tr = team_running[team]
                nrr = round(tr["rs"] / (tr["bf"] / 6) - tr["rc"] / (tr["bb"] / 6), 3) if tr["bf"] > 0 and tr["bb"] > 0 else 0.0
                teams_nrr.append({"match": team_match_count[team], "team": team, "nrr": nrr})

        nrr_df = pd.DataFrame(teams_nrr)
        fig = line_chart(nrr_df, x="match", y="nrr", color="team", title="")
        fig.update_xaxes(dtick=1)
        return plotly_ui(fig)

    @render.ui
    def toss_decision_chart():
        m = load_matches()
        td = m["toss_decision"].value_counts().reset_index()
        td.columns = ["Decision", "Count"]
        return plotly_ui(vertical_bar(td, x="Decision", y="Count", title="", text="Count"))

    @render.ui
    def toss_match_chart():
        m = load_matches().copy()
        m["toss_won_match"] = m["toss_winner"] == m["winner"]
        tw = m["toss_won_match"].value_counts().reset_index()
        tw.columns = ["Result", "Count"]
        tw["Result"] = tw["Result"].map({True: "Yes", False: "No"})
        return plotly_ui(vertical_bar(tw, x="Result", y="Count", title="", text="Count"))

    @render.ui
    def team_phase_chart():
        phase = load_phase_summaries()
        if phase.empty:
            return empty_state()
        metric = input.phase_metric()
        team_phase = phase.groupby(["team", "phase"]).agg(
            runs=("runs", "sum"), wickets=("wickets", "sum"),
            balls=("balls", "sum"), boundaries=("boundaries", "sum"), dots=("dots", "sum"),
        ).reset_index()
        team_phase["run_rate"] = ((team_phase["runs"] / team_phase["balls"]) * 6).round(2)
        return plotly_ui(phase_comparison_chart(team_phase, metric=metric))

    @render.ui
    def venue_table():
        matches = load_matches()
        matches = matches.copy()
        # Split "Stadium, City" into separate columns
        venue_parts = matches["venue"].str.rsplit(", ", n=1, expand=True)
        matches["stadium"] = venue_parts[0]
        matches["city"] = venue_parts[1] if 1 in venue_parts.columns else ""
        vs = matches.groupby(["stadium", "city"]).agg(matches_count=("match_number", "count")).reset_index()
        venue_scores = []
        for _, row in matches.iterrows():
            s1 = int(str(row["team_1_score"]).split("/")[0]) if "/" in str(row["team_1_score"]) else 0
            s2 = int(str(row["team_2_score"]).split("/")[0]) if "/" in str(row["team_2_score"]) else 0
            venue_scores.append({"stadium": row["stadium"], "city": row["city"], "first_inn": s1, "second_inn": s2})
        vdf = pd.DataFrame(venue_scores)
        va = vdf.groupby(["stadium", "city"]).agg(avg_1st=("first_inn", "mean"), avg_2nd=("second_inn", "mean")).round(0).reset_index()
        vs = vs.merge(va, on=["stadium", "city"])
        vs = vs[["stadium", "city", "matches_count", "avg_1st", "avg_2nd"]]
        return styled_table(vs.rename(columns={
            "stadium": "Stadium", "city": "City", "matches_count": "Matches",
            "avg_1st": "Avg 1st Inn", "avg_2nd": "Avg 2nd Inn",
        }), bold_cols=["Stadium"])

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
            t = mbbb[mbbb["innings"] == inn]["team"].iloc[0]
            teams[int(inn)] = t
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
        winner = row["winner"]
        if int(row["win_by_wickets"]) > 0:
            margin = f"by {int(row['win_by_wickets'])} wickets"
        elif int(row["win_by_runs"]) > 0:
            margin = f"by {int(row['win_by_runs'])} runs"
        else:
            margin = row.get("result", "")

        return ui.HTML(f"""
        <div style="display:flex; align-items:center; justify-content:center; gap:30px; padding:20px 0;">
            <div style="text-align:center;">
                <div style="height:70px; display:flex; align-items:center; justify-content:center;">
                    <img src="{team_logo(t1)}" style="max-height:70px; max-width:70px; object-fit:contain;">
                </div>
                <div style="font-weight:700; font-size:16px; margin-top:8px; white-space:nowrap;">{t1}</div>
                <div style="font-size:28px; font-weight:800; color:{team_color(t1)};">{row['team_1_score']}</div>
            </div>
            <div style="font-size:20px; font-weight:600; color:#888;">vs</div>
            <div style="text-align:center;">
                <div style="height:70px; display:flex; align-items:center; justify-content:center;">
                    <img src="{team_logo(t2)}" style="max-height:70px; max-width:70px; object-fit:contain;">
                </div>
                <div style="font-weight:700; font-size:16px; margin-top:8px; white-space:nowrap;">{t2}</div>
                <div style="font-size:28px; font-weight:800; color:{team_color(t2)};">{row['team_2_score']}</div>
            </div>
        </div>
        <div style="text-align:center; padding-bottom:10px;">
            <b>{winner}</b> won {margin} | {row['venue']} | POM: {row.get('player_of_match', '')}
        </div>
        """)

    @render.ui
    def match_worm():
        bbb = load_ball_by_ball()
        if bbb.empty:
            return empty_state()
        return plotly_ui(worm_chart(bbb, selected_match_num()))

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
        return styled_table(df, highlight_cols=["Runs"], bold_cols=["Batter"])

    def _bowling_scorecard(innings):
        bowling = load_bowling_scorecards()
        if bowling.empty:
            return empty_state()
        df = bowling[(bowling["match_number"] == selected_match_num()) & (bowling["innings"] == innings)]
        if df.empty:
            return empty_state()
        df = df[["bowler", "overs", "maidens", "runs", "wickets", "economy", "dots"]].copy()
        df.columns = ["Bowler", "Overs", "Mdns", "Runs", "Wkts", "Econ", "Dots"]
        return styled_table(df, highlight_cols=["Wkts"], bold_cols=["Bowler"])

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
                showarrow=False, font=dict(size=10, color="#555"), xanchor="left",
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
                        background:#fafafa;border-radius:0 8px 8px 0;margin-bottom:8px;">
                <div style="min-width:50px;text-align:center;">
                    <div style="font-size:11px;color:#888;">Over</div>
                    <div style="font-weight:700;font-size:16px;">{row['over']}.{row['ball']}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-weight:600;font-size:13px;">{short} reviewed ({row['type']})</div>
                    <div style="font-size:12px;color:#666;">{row['batter']} vs {row['bowler']} &middot; Umpire: {row['umpire']}</div>
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
                        background:#fafafa;border-radius:0 8px 8px 0;margin-bottom:8px;">
                <div style="min-width:50px;text-align:center;">
                    <div style="font-size:11px;color:#888;">Over</div>
                    <div style="font-weight:700;font-size:16px;">{row['over']}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:13px;">
                        <span style="color:#27ae60;font-weight:700;">&#9650; {row['player_in']}</span>
                        <span style="color:#888;margin:0 4px;">for</span>
                        <span style="color:#d63031;font-weight:700;">&#9660; {row['player_out']}</span>
                    </div>
                    <div style="font-size:12px;color:#666;">{short} &middot; {reason}</div>
                </div>
            </div>""")
        return ui.HTML("".join(cards))


app = App(app_ui, server)
