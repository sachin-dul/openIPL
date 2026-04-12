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

    fig.update_layout(xaxis_title="", yaxis_title="")
    return _apply_style(fig, height=max(300, len(df) * 40))


def vertical_bar(df, x, y, title, color=None, text=None):
    fig = px.bar(
        df, x=x, y=y, title=title,
        color=color, text=text,
        color_discrete_map=TEAM_COLORS if color else None,
    )
    fig.update_layout(showlegend=bool(color), xaxis_title="", yaxis_title="")
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
    fig.update_layout(xaxis_title="", yaxis_title="")
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
        xaxis_title="Over", yaxis_title="Runs",
        legend=dict(orientation="h", yanchor="top", y=-0.25, xanchor="center", x=0.5),
        margin=dict(b=90),
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
        color_discrete_map=TEAM_COLORS,
        category_orders={"phase": ordered_phases},
    )
    metric_label = metric.replace("_", " ").title()
    fig.update_layout(xaxis_title="", yaxis_title=metric_label)
    fig.update_traces(marker=dict(cornerradius=3))
    return _apply_style(fig)


def manhattan_chart(bbb_df, match_number, innings):
    """Stacked runs-per-over bar chart for a specific innings.

    Segments: 6s (red) / 4s (orange) / other runs (blue) / extras (gray).
    Wicket markers shown as X above bars for overs where wickets fell.
    """
    idf = bbb_df[(bbb_df["match_number"] == match_number) & (bbb_df["innings"] == innings)].copy()
    if idf.empty:
        return go.Figure()
    team = idf["team"].iloc[0]

    idf["is_six"] = (idf["batter_runs"] == 6).astype(int) * 6
    idf["is_four"] = (idf["batter_runs"] == 4).astype(int) * 4
    idf["other_bat"] = idf.apply(
        lambda r: r["batter_runs"] if r["batter_runs"] not in (4, 6) else 0, axis=1
    )
    idf["extras"] = idf["extra_runs"]

    agg = idf.groupby("over").agg(
        sixes=("is_six", "sum"),
        fours=("is_four", "sum"),
        other=("other_bat", "sum"),
        extras=("extras", "sum"),
        wickets=("is_wicket", "sum"),
        total=("total_runs", "sum"),
    ).reset_index()

    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=agg["over"], y=agg["other"], name="1s/2s/3s",
        marker=dict(color="#9ca3af", cornerradius=2),
        hovertemplate="Over %{x}<br>Runs (non-boundary): %{y}<extra></extra>",
    ))
    fig.add_trace(go.Bar(
        x=agg["over"], y=agg["fours"], name="Fours",
        marker=dict(color="#fb923c", cornerradius=2),
        hovertemplate="Over %{x}<br>Runs from 4s: %{y}<extra></extra>",
    ))
    fig.add_trace(go.Bar(
        x=agg["over"], y=agg["sixes"], name="Sixes",
        marker=dict(color="#dc2626", cornerradius=2),
        hovertemplate="Over %{x}<br>Runs from 6s: %{y}<extra></extra>",
    ))
    fig.add_trace(go.Bar(
        x=agg["over"], y=agg["extras"], name="Extras",
        marker=dict(color="#60a5fa", cornerradius=2),
        hovertemplate="Over %{x}<br>Extras: %{y}<extra></extra>",
    ))

    # Wicket markers
    wkt_overs = agg[agg["wickets"] > 0]
    if not wkt_overs.empty:
        fig.add_trace(go.Scatter(
            x=wkt_overs["over"], y=wkt_overs["total"] + 1.5,
            mode="markers+text",
            marker=dict(symbol="x", color="#111827", size=12, line=dict(width=2)),
            text=wkt_overs["wickets"].apply(lambda n: "W" if n == 1 else f"{n}W"),
            textposition="top center",
            textfont=dict(size=11, color="#111827"),
            name="Wicket",
            hovertemplate="Over %{x}<br>Wickets: %{text}<extra></extra>",
        ))

    fig.update_layout(
        barmode="stack",
        xaxis=dict(title="Over", tickmode="linear", dtick=1),
        yaxis_title="Runs",
        legend=dict(orientation="h", yanchor="top", y=-0.25, xanchor="center", x=0.5),
        margin=dict(b=90),
        bargap=0.25,
    )
    return _apply_style(fig, height=360)


def run_rate_chart(bbb_df, match_number):
    """Current run rate (both innings) + required run rate (2nd innings) over time."""
    mdf = bbb_df[bbb_df["match_number"] == match_number].copy()
    if mdf.empty:
        return go.Figure()

    mdf["legal"] = ((mdf["wides"] == 0) & (mdf["noballs"] == 0)).astype(int)

    fig = go.Figure()
    target = None

    for inn in sorted(mdf["innings"].unique()):
        idf = mdf[mdf["innings"] == inn].copy().reset_index(drop=True)
        team = idf["team"].iloc[0]
        idf["balls"] = idf["legal"].cumsum()
        idf["score"] = idf["total_runs"].cumsum()
        # Only keep legal-ball rows for a clean curve
        curve = idf[idf["legal"] == 1].copy()
        if curve.empty:
            continue
        curve["current_rr"] = curve["score"] / (curve["balls"] / 6)
        # Cricket notation matching worm chart: over + ball/10 (e.g. 10.3 = over 10, ball 3)
        curve["x"] = (
            pd.to_numeric(curve["over"], errors="coerce").fillna(0)
            + pd.to_numeric(curve["ball"], errors="coerce").fillna(0) / 10
        )

        fig.add_trace(go.Scatter(
            x=curve["x"], y=curve["current_rr"],
            mode="lines", name=f"{team_short(team)} RR",
            line=dict(color=team_color(team), width=3),
            hovertemplate=f"<b>{team_short(team)}</b><br>RR: %{{y:.2f}}<extra></extra>",
        ))

        if inn == 1:
            target = int(idf["total_runs"].sum()) + 1
        elif inn == 2 and target is not None:
            curve["balls_remaining"] = (120 - curve["balls"]).clip(lower=1)
            curve["runs_needed"] = (target - curve["score"]).clip(lower=0)
            curve["required_rr"] = curve["runs_needed"] / (curve["balls_remaining"] / 6)
            fig.add_trace(go.Scatter(
                x=curve["x"], y=curve["required_rr"],
                mode="lines", name=f"{team_short(team)} RRR",
                line=dict(color=team_color(team), width=2, dash="dash"),
                hovertemplate=f"<b>Required RR</b><br>RRR: %{{y:.2f}}<extra></extra>",
            ))

    fig.update_layout(
        xaxis=dict(
            title="Over", range=[1, 21],
            tickmode="array", tickvals=list(range(1, 22, 2)),
            hoverformat=".1f",
        ),
        yaxis=dict(title="Runs / over", rangemode="tozero"),
        legend=dict(orientation="h", yanchor="top", y=-0.25, xanchor="center", x=0.5),
        margin=dict(b=90),
        hovermode="x unified",
    )
    return _apply_style(fig, height=360)


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
        xaxis_title="Over", yaxis_title="Score",
        legend=dict(orientation="h", yanchor="bottom", y=-0.25, xanchor="center", x=0.5),
    )
    return _apply_style(fig, height=400)


def team_dna_heatmap(bbb_df):
    """Average runs scored per over by each team across the season.

    y = team, x = over (1..20), color = mean runs per over when batting.
    Shows each team's scoring rhythm (when they attack vs consolidate).
    """
    if bbb_df.empty:
        return go.Figure()
    df = bbb_df.copy()
    # Runs per (match, innings, team, over)
    grp = (
        df.groupby(["match_number", "innings", "team", "over"])["total_runs"]
        .sum()
        .reset_index()
    )
    agg = grp.groupby(["team", "over"]).agg(
        avg_runs=("total_runs", "mean"),
        n=("total_runs", "size"),
    ).reset_index()
    team_order = (
        agg.groupby("team")["avg_runs"].mean()
        .sort_values(ascending=True)
        .index.tolist()
    )
    mean_pivot = (
        agg.pivot(index="team", columns="over", values="avg_runs")
        .reindex(index=team_order).reindex(columns=list(range(1, 21)))
    )
    n_pivot = (
        agg.pivot(index="team", columns="over", values="n")
        .reindex(index=team_order).reindex(columns=list(range(1, 21))).fillna(0).astype(int)
    )
    y_labels = [team_short(t) for t in mean_pivot.index]
    fig = go.Figure(go.Heatmap(
        z=mean_pivot.values,
        x=list(range(1, 21)),
        y=y_labels,
        customdata=n_pivot.values[..., None],
        colorscale="YlOrRd",
        colorbar=dict(title="Avg runs"),
        hovertemplate="<b>%{y}</b><br>Over %{x}<br>Avg: %{z:.1f} runs<br>Sample: %{customdata[0]} over(s)<extra></extra>",
    ))
    fig.update_layout(
        xaxis=dict(title="Over", tickmode="linear", dtick=1),
        yaxis=dict(title=""),
    )
    return _apply_style(fig, height=max(300, 34 * len(mean_pivot.index) + 80))


def team_radar_chart(bbb_df, matches_df):
    """Six-axis radar per team: batting run-rate (PP/Mid/Death) + bowling econ inverse.

    Bowling axes are inverted (lower economy → higher radar value) so 'further out'
    always means 'better'.
    """
    if bbb_df.empty:
        return go.Figure()
    df = bbb_df.copy()
    df["legal"] = ((df["wides"] == 0) & (df["noballs"] == 0)).astype(int)

    # Batting: group by batting team + phase
    bat = df.groupby(["team", "phase"]).agg(
        runs=("total_runs", "sum"), balls=("legal", "sum")
    ).reset_index()
    bat["run_rate"] = (bat["runs"] / bat["balls"] * 6).round(2)

    # Bowling: derive opposing team per (match, innings) from matches_df
    # Simpler approach: for each match, the OTHER team is bowling when this team bats.
    # Build a (match_number, batting_team) -> bowling_team lookup.
    opp_map = {}
    if not matches_df.empty:
        for _, m in matches_df.iterrows():
            t1, t2 = m.get("team_1"), m.get("team_2")
            mn = m.get("match_number")
            if t1 and t2 and mn is not None:
                opp_map[(mn, t1)] = t2
                opp_map[(mn, t2)] = t1
    df["bowling_team"] = [
        opp_map.get((mn, t)) for mn, t in zip(df["match_number"], df["team"])
    ]
    bowl = df.dropna(subset=["bowling_team"]).groupby(["bowling_team", "phase"]).agg(
        runs=("total_runs", "sum"), balls=("legal", "sum")
    ).reset_index()

    phases = ["powerplay", "middle", "death"]
    phase_labels = {"powerplay": "PP Bat", "middle": "Mid Bat", "death": "Death Bat"}
    bowl_labels = {"powerplay": "PP Bowl", "middle": "Mid Bowl", "death": "Death Bowl"}

    teams = sorted(bat["team"].unique())
    fig = go.Figure()
    axis_order = phases + phases[::-1]  # bat L→R, bowl R→L
    theta_labels = (
        [phase_labels[p] for p in phases]
        + [bowl_labels[p] for p in phases[::-1]]
    )

    # Determine a shared max for radial scale
    max_rr = max(bat["run_rate"].max(), 15.0)

    for team in teams:
        bat_team = bat[bat["team"] == team].set_index("phase")["run_rate"]
        r_bat = [float(bat_team.get(p, 0)) for p in phases]
        bw = bowl[bowl["bowling_team"] == team].copy()
        if not bw.empty and bw["balls"].sum() > 0:
            bw["econ"] = bw["runs"] / bw["balls"] * 6
            bw_series = bw.set_index("phase")["econ"]
            # Invert: "better" = lower economy. Map econ to (max_rr - econ)
            r_bowl = [max_rr - float(bw_series.get(p, max_rr)) for p in phases[::-1]]
        else:
            r_bowl = [0, 0, 0]

        r_values = r_bat + r_bowl
        # Close the loop
        r_values.append(r_values[0])
        theta_loop = theta_labels + [theta_labels[0]]

        color = team_color(team)
        r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
        fig.add_trace(go.Scatterpolar(
            r=r_values,
            theta=theta_loop,
            fill="toself",
            name=team_short(team),
            line=dict(color=color, width=2),
            fillcolor=f"rgba({r},{g},{b},0.15)",
            hovertemplate=f"<b>{team_short(team)}</b><br>%{{theta}}: %{{r:.2f}}<extra></extra>",
        ))

    fig.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, max_rr], showticklabels=True),
        ),
        legend=dict(orientation="h", yanchor="top", y=-0.08, xanchor="center", x=0.5),
        margin=dict(b=70),
    )
    return _apply_style(fig, height=520)


def runs_per_over_innings_compare(bbb_df):
    """Overlay histogram comparing 1st vs 2nd innings runs-per-over."""
    if bbb_df.empty:
        return go.Figure()
    over_runs = (
        bbb_df.groupby(["match_number", "innings", "over"])["total_runs"]
        .sum().reset_index()
    )
    max_x = max(over_runs["total_runs"].max() + 1, 30)
    colors = {1: "#004BA0", 2: "#D4171E"}
    labels = {1: "1st innings", 2: "2nd innings"}

    fig = go.Figure()
    means = {}
    for inn in [1, 2]:
        data = over_runs[over_runs["innings"] == inn]["total_runs"]
        if data.empty:
            continue
        fig.add_trace(go.Histogram(
            x=data, name=labels[inn],
            xbins=dict(start=-0.5, end=max_x + 0.5, size=1),
            marker=dict(color=colors[inn], line=dict(width=0)),
            opacity=0.55,
            hovertemplate=f"{labels[inn]}<br>%{{x}} runs — %{{y}} overs<extra></extra>",
        ))
        means[inn] = float(data.mean())
        fig.add_vline(
            x=means[inn], line_dash="dash", line_color=colors[inn], opacity=0.9,
        )

    # Compact mean legend in top-right corner (paper coords, doesn't collide with bars)
    mean_lines = [
        f"<span style='color:{colors[inn]}'>■</span> {labels[inn]} mean: <b>{means[inn]:.1f}</b>"
        for inn in [1, 2] if inn in means
    ]
    fig.add_annotation(
        x=0.98, y=0.98, xref="paper", yref="paper",
        text="<br>".join(mean_lines),
        showarrow=False, align="left",
        xanchor="right", yanchor="top",
        bgcolor="rgba(255,255,255,0.85)",
        bordercolor="#e5e7eb", borderwidth=1,
        font=dict(size=11, color="#1f2937"),
    )

    fig.update_layout(
        barmode="overlay",
        xaxis=dict(title="Runs in over", dtick=2, range=[-0.5, max_x + 0.5]),
        yaxis=dict(title="Number of overs"),
        bargap=0.05,
        legend=dict(orientation="h", yanchor="top", y=-0.18, xanchor="center", x=0.5),
        margin=dict(l=60, r=40, b=70, t=40),
    )
    return _apply_style(fig, height=380)


def economy_vs_average_scatter(bowling_df, min_overs=4):
    """Scatter of every bowler: x = economy, y = bowling average (runs/wicket).

    Size = total wickets, color = team. Lower-left quadrant = elite (cheap + strikes).
    """
    if bowling_df.empty:
        return go.Figure()
    agg = bowling_df.groupby(["bowler", "team"]).agg(
        overs=("overs", "sum"),
        runs=("runs", "sum"),
        wickets=("wickets", "sum"),
    ).reset_index()
    agg = agg[agg["overs"] >= min_overs]
    if agg.empty:
        return go.Figure()
    agg["economy"] = (agg["runs"] / agg["overs"]).round(2)
    # Bowling average: runs/wicket — use NaN when no wickets
    agg["average"] = agg.apply(
        lambda r: r["runs"] / r["wickets"] if r["wickets"] > 0 else None, axis=1
    )
    # For bowlers with 0 wickets, plot at top of axis with different marker
    wicketed = agg[agg["wickets"] > 0].copy()
    if wicketed.empty:
        return go.Figure()

    fig = go.Figure()
    for team in sorted(wicketed["team"].unique()):
        tdf = wicketed[wicketed["team"] == team]
        color = team_color(team)
        fig.add_trace(go.Scatter(
            x=tdf["economy"],
            y=tdf["average"],
            mode="markers+text",
            name=team_short(team),
            marker=dict(
                color=color,
                size=tdf["wickets"] * 4 + 8,
                line=dict(width=1, color="white"),
                opacity=0.85,
            ),
            text=tdf["bowler"],
            textposition="top center",
            textfont=dict(size=9, color="#1f2937"),
            customdata=tdf[["wickets", "overs", "runs"]].values,
            hovertemplate=(
                "<b>%{text}</b><br>"
                "Econ: %{x:.2f}<br>Avg: %{y:.1f}<br>"
                "%{customdata[0]} wkts in %{customdata[1]:.1f} overs "
                "(%{customdata[2]} runs)<extra></extra>"
            ),
        ))

    med_econ = float(wicketed["economy"].median())
    med_avg = float(wicketed["average"].median())
    fig.add_vline(x=med_econ, line_dash="dot", line_color="#9ca3af", opacity=0.7)
    fig.add_hline(y=med_avg, line_dash="dot", line_color="#9ca3af", opacity=0.7)
    fig.add_annotation(
        x=med_econ, y=wicketed["average"].min(),
        text="← elite (cheap + strikes)", showarrow=False,
        xanchor="right", yanchor="bottom",
        font=dict(size=10, color="#6b7280"),
    )

    fig.update_layout(
        xaxis=dict(title="Economy (runs/over)"),
        yaxis=dict(title="Bowling average (runs/wicket)"),
        legend=dict(orientation="h", yanchor="top", y=-0.12, xanchor="center", x=0.5),
        margin=dict(b=80),
    )
    return _apply_style(fig, height=520)
