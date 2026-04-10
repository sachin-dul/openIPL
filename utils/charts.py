"""Reusable Plotly chart helpers for the IPL dashboard."""

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go


# Consistent IPL team colors
TEAM_COLORS = {
    "Chennai Super Kings": "#FFDC00",
    "Mumbai Indians": "#004BA0",
    "Royal Challengers Bengaluru": "#D4171E",
    "Kolkata Knight Riders": "#3A225D",
    "Rajasthan Royals": "#EA1A85",
    "Sunrisers Hyderabad": "#FF822A",
    "Delhi Capitals": "#004C93",
    "Punjab Kings": "#ED1B24",
    "Gujarat Titans": "#1C1C1C",
    "Lucknow Super Giants": "#A72056",
}


TEAM_LOGOS = {
    "Chennai Super Kings": "https://upload.wikimedia.org/wikipedia/en/thumb/2/2b/Chennai_Super_Kings_Logo.svg/200px-Chennai_Super_Kings_Logo.svg.png",
    "Mumbai Indians": "https://upload.wikimedia.org/wikipedia/en/thumb/c/cd/Mumbai_Indians_Logo.svg/200px-Mumbai_Indians_Logo.svg.png",
    "Royal Challengers Bengaluru": "https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Royal_Challengers_Bengaluru_Logo.svg/200px-Royal_Challengers_Bengaluru_Logo.svg.png",
    "Kolkata Knight Riders": "https://upload.wikimedia.org/wikipedia/en/thumb/4/4c/Kolkata_Knight_Riders_Logo.svg/200px-Kolkata_Knight_Riders_Logo.svg.png",
    "Rajasthan Royals": "https://upload.wikimedia.org/wikipedia/en/thumb/5/5c/This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg/200px-This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg.png",
    "Sunrisers Hyderabad": "https://upload.wikimedia.org/wikipedia/en/thumb/5/51/Sunrisers_Hyderabad_Logo.svg/200px-Sunrisers_Hyderabad_Logo.svg.png",
    "Delhi Capitals": "https://upload.wikimedia.org/wikipedia/en/thumb/2/2f/Delhi_Capitals.svg/200px-Delhi_Capitals.svg.png",
    "Punjab Kings": "https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Punjab_Kings_Logo.svg/200px-Punjab_Kings_Logo.svg.png",
    "Gujarat Titans": "https://upload.wikimedia.org/wikipedia/en/thumb/0/09/Gujarat_Titans_Logo.svg/200px-Gujarat_Titans_Logo.svg.png",
    "Lucknow Super Giants": "https://upload.wikimedia.org/wikipedia/en/thumb/3/34/Lucknow_Super_Giants_Logo.svg/200px-Lucknow_Super_Giants_Logo.svg.png",
}

# Short names for compact display
TEAM_SHORT = {
    "Chennai Super Kings": "CSK",
    "Mumbai Indians": "MI",
    "Royal Challengers Bengaluru": "RCB",
    "Kolkata Knight Riders": "KKR",
    "Rajasthan Royals": "RR",
    "Sunrisers Hyderabad": "SRH",
    "Delhi Capitals": "DC",
    "Punjab Kings": "PBKS",
    "Gujarat Titans": "GT",
    "Lucknow Super Giants": "LSG",
}


def team_color(team):
    return TEAM_COLORS.get(team, "#888888")


def team_logo(team):
    return TEAM_LOGOS.get(team, "")


def team_short(team):
    return TEAM_SHORT.get(team, team)


# Common layout template — clean light theme
LAYOUT_TEMPLATE = dict(
    font=dict(family="Figtree, sans-serif", color="#1f2937"),
    plot_bgcolor="rgba(0,0,0,0)",
    paper_bgcolor="rgba(0,0,0,0)",
    hoverlabel=dict(bgcolor="#ffffff", font_size=13, font_color="#1f2937", bordercolor="#e5e7eb"),
    title_font=dict(size=16, color="#1a56db"),
)


def _apply_style(fig, height=None):
    """Apply common styling to all charts."""
    fig.update_layout(
        **LAYOUT_TEMPLATE,
        margin=dict(l=40, r=40, t=50, b=40, autoexpand=True),
    )
    if height:
        fig.update_layout(height=height)
    fig.update_xaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False, tickfont=dict(color="#6b7280"))
    fig.update_yaxes(gridcolor="rgba(0,0,0,0.08)", zeroline=False, tickfont=dict(color="#6b7280"))
    return fig


def horizontal_bar(df, x, y, title, color=None, text=None, team_colored=False, player_teams=None):
    """Horizontal bar chart. If player_teams dict is provided, bars are colored by team and labels get team short codes."""
    df = df.copy()
    if player_teams and not color:
        colors = [team_color(player_teams.get(name, "")) for name in df[y]]
        labels = [f"{name} ({team_short(player_teams[name])})" if name in player_teams else name for name in df[y]]
        fig = go.Figure(go.Bar(
            x=df[x], y=labels, orientation="h",
            marker=dict(color=colors, line=dict(width=0), cornerradius=4),
            text=df[text] if text else None,
            textposition="outside",
            textfont=dict(size=13, color="#1f2937"),
        ))
        fig.update_layout(title=title, yaxis=dict(autorange="reversed"))
    elif team_colored and not color:
        colors = [team_color(name) if name in TEAM_COLORS else "#1a73e8" for name in df[y]]
        fig = go.Figure(go.Bar(
            x=df[x], y=df[y], orientation="h",
            marker=dict(color=colors, line=dict(width=0), cornerradius=4),
            text=df[text] if text else None,
            textposition="outside",
            textfont=dict(size=13, color="#1f2937"),
        ))
        fig.update_layout(title=title, yaxis=dict(autorange="reversed"))
    else:
        fig = px.bar(
            df, x=x, y=y, orientation="h", title=title,
            color=color, text=text,
            color_discrete_map=TEAM_COLORS if color else None,
        )
        fig.update_layout(yaxis=dict(autorange="reversed"), showlegend=False)
        if not color:
            fig.update_traces(marker=dict(color="#3b82f6", cornerradius=4))
        if text:
            fig.update_traces(textposition="outside", textfont=dict(size=13))

    return _apply_style(fig, height=max(300, len(df) * 40))


def vertical_bar(df, x, y, title, color=None, text=None):
    fig = px.bar(
        df, x=x, y=y, title=title,
        color=color, text=text,
        color_discrete_map=TEAM_COLORS if color else None,
    )
    fig.update_layout(showlegend=bool(color))
    if not color:
        fig.update_traces(marker=dict(color="#3b82f6", cornerradius=4))
    if text:
        fig.update_traces(textposition="outside", textfont=dict(size=13, color="#1f2937"))
    return _apply_style(fig)


def line_chart(df, x, y, color, title, markers=True):
    fig = px.line(
        df, x=x, y=y, color=color, title=title,
        markers=markers,
        color_discrete_map=TEAM_COLORS,
    )
    fig.update_traces(line=dict(width=3), marker=dict(size=8))
    return _apply_style(fig)


def worm_chart(bbb_df, match_number):
    """Build a cumulative runs worm chart for a specific match."""
    mdf = bbb_df[bbb_df["match_number"] == match_number].copy()
    if mdf.empty:
        return go.Figure()

    fig = go.Figure()
    for inn in sorted(mdf["innings"].unique()):
        idf = mdf[mdf["innings"] == inn].copy()
        team = idf["team"].iloc[0]
        idf["cum_runs"] = idf["total_runs"].cumsum()
        idf["over_float"] = pd.to_numeric(idf["over"], errors="coerce").fillna(0) + pd.to_numeric(idf["ball"], errors="coerce").fillna(0) / 10

        fig.add_trace(go.Scatter(
            x=idf["over_float"], y=idf["cum_runs"],
            mode="lines", name=team,
            line=dict(color=team_color(team), width=3),
            fill="tozeroy",
            fillcolor=f"rgba({int(team_color(team)[1:3], 16)},{int(team_color(team)[3:5], 16)},{int(team_color(team)[5:7], 16)},0.1)",
            hovertemplate=f"<b>{team_short(team)}</b><br>Over: %{{x}}<br>Score: %{{y}}<extra></extra>",
        ))

    fig.update_layout(
        title="Match Worm Chart",
        xaxis_title="Over", yaxis_title="Runs",
        legend=dict(orientation="h", yanchor="bottom", y=-0.25, xanchor="center", x=0.5),
        hovermode="x unified",
    )
    return _apply_style(fig, height=400)


def phase_comparison_chart(phase_df, metric="run_rate"):
    """Grouped bar chart comparing teams across phases."""
    phase_labels = {"powerplay": "Powerplay (1-6)", "middle": "Middle (7-15)", "death": "Death (16-20)"}
    ordered_phases = ["Powerplay (1-6)", "Middle (7-15)", "Death (16-20)"]
    phase_df = phase_df.copy()
    phase_df["phase"] = phase_df["phase"].map(phase_labels)
    phase_df["phase"] = pd.Categorical(phase_df["phase"], categories=ordered_phases, ordered=True)
    phase_df = phase_df.sort_values("phase")
    fig = px.bar(
        phase_df, x="phase", y=metric, color="team",
        barmode="group",
        title=f"{metric.replace('_', ' ').title()} by Phase",
        color_discrete_map=TEAM_COLORS,
        category_orders={"phase": ordered_phases},
    )
    fig.update_traces(marker=dict(cornerradius=3))
    return _apply_style(fig)


def fow_timeline(fow_df, match_number):
    """Fall of wickets scatter/line for a match."""
    mdf = fow_df[fow_df["match_number"] == match_number].copy()
    if mdf.empty:
        return go.Figure()

    fig = go.Figure()
    for team in mdf["team"].unique():
        tdf = mdf[mdf["team"] == team].sort_values("wicket_number")
        color = team_color(team)
        r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)

        fig.add_trace(go.Scatter(
            x=tdf["over"], y=tdf["score"],
            mode="lines",
            line=dict(color=f"rgba({r},{g},{b},0.3)", width=2, dash="dot"),
            showlegend=False,
            hoverinfo="skip",
        ))
        fig.add_trace(go.Scatter(
            x=tdf["over"], y=tdf["score"],
            mode="markers+text", name=team_short(team),
            marker=dict(color=color, size=12, line=dict(width=2, color="white"), symbol="x"),
            text=tdf["player_out"],
            textposition="top center",
            textfont=dict(size=10),
            hovertemplate=f"<b>{team_short(team)}</b><br>%{{text}}<br>Score: %{{y}} (Over %{{x}})<extra></extra>",
        ))

    fig.update_layout(
        title="Fall of Wickets",
        xaxis_title="Over", yaxis_title="Score",
        legend=dict(orientation="h", yanchor="bottom", y=-0.25, xanchor="center", x=0.5),
    )
    return _apply_style(fig, height=400)
