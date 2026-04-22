"""Reusable Plotly chart helpers for the IPL dashboard."""

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots


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
    "Chennai Super Kings": "/logos/CSK.png",
    "Mumbai Indians": "/logos/MI.png",
    "Royal Challengers Bengaluru": "/logos/RCB.png",
    "Kolkata Knight Riders": "/logos/KKR.png",
    "Rajasthan Royals": "/logos/RR.png",
    "Sunrisers Hyderabad": "/logos/SRH.png",
    "Delhi Capitals": "/logos/DC.png",
    "Punjab Kings": "/logos/PBKS.png",
    "Gujarat Titans": "/logos/GT.png",
    "Lucknow Super Giants": "/logos/LSG.png",
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
        xaxis=dict(title="Over", tickmode="linear", dtick=1, range=[0.5, 20.5]),
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
        # Cricket notation: 0.1 = 1st legal ball, 1.0 = end of over 1, 20.0 = last ball.
        complete = curve["balls"] // 6
        ball_in_over = curve["balls"] % 6
        curve["x"] = complete + ball_in_over / 10
        fig.add_trace(go.Scatter(
            x=curve["x"], y=curve["current_rr"],
            mode="lines", name=f"{team_short(team)} RR",
            line=dict(color=team_color(team), width=3),
            hovertemplate=f"<b>{team_short(team)}</b><br>RR: %{{y:.2f}}<extra></extra>",
        ))

        if inn == 1:
            target = int(idf["total_runs"].sum()) + 1
        elif inn == 2 and target is not None:
            curve["balls_remaining"] = 120 - curve["balls"]
            curve["runs_needed"] = (target - curve["score"]).clip(lower=0)
            # RRR is only meaningful while balls remain AND chase isn't already decided.
            rrr_curve = curve[(curve["balls_remaining"] > 0) & (curve["runs_needed"] > 0)].copy()
            rrr_curve["required_rr"] = rrr_curve["runs_needed"] / (rrr_curve["balls_remaining"] / 6)
            fig.add_trace(go.Scatter(
                x=rrr_curve["x"], y=rrr_curve["required_rr"],
                mode="lines", name=f"{team_short(team)} RRR",
                line=dict(color=team_color(team), width=2, dash="dash"),
                hovertemplate=f"<b>Required RR</b><br>RRR: %{{y:.2f}}<extra></extra>",
            ))

    fig.update_layout(
        xaxis=dict(
            title="Over", range=[0, 20],
            tickmode="array", tickvals=list(range(0, 21, 2)),
            hoverformat=".1f",
        ),
        yaxis=dict(title="Runs / over", rangemode="tozero", range=[0, 36]),
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

    fig.add_annotation(
        x=0.5, y=1.08, xref="paper", yref="paper",
        text=(
            "Further from centre = better · batting axes show run rate · "
            "bowling axes are inverted (lower economy → further out)"
        ),
        showarrow=False, xanchor="center", yanchor="bottom",
        font=dict(size=10, color="#6b7280"),
    )
    fig.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, max_rr], showticklabels=True),
        ),
        legend=dict(orientation="h", yanchor="top", y=-0.08, xanchor="center", x=0.5),
        margin=dict(t=60, b=70),
    )
    return _apply_style(fig, height=560)


def runs_per_over_innings_compare(bbb_df, team_label=None):
    """Overlay histogram comparing 1st vs 2nd innings runs-per-over.

    If a `team_label` is supplied and the team has only batted in one innings, a small
    note is shown in place of the missing innings.
    """
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
    match_counts = {}
    for inn in [1, 2]:
        data = over_runs[over_runs["innings"] == inn]["total_runs"]
        match_counts[inn] = over_runs[over_runs["innings"] == inn]["match_number"].nunique()
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

    # Compact mean legend in top-right corner
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

    # If filtered to a single team with no data in one innings, explain why
    if team_label and len(means) == 1:
        missing = 2 if 1 in means else 1
        present = 1 if missing == 2 else 2
        present_n = match_counts.get(present, 0)
        posture = "batted first" if present == 1 else "chased"
        fig.add_annotation(
            x=0.98, y=0.86, xref="paper", yref="paper",
            text=(
                f"<b>{team_label}</b> has no {labels[missing]} data<br>"
                f"<span style='color:#6b7280'>{posture} in all {present_n} match"
                f"{'es' if present_n != 1 else ''}</span>"
            ),
            showarrow=False, align="right",
            xanchor="right", yanchor="top",
            bgcolor="rgba(255,255,255,0.85)",
            bordercolor="#e5e7eb", borderwidth=1,
            font=dict(size=11, color="#374151"),
        )

    fig.update_layout(
        barmode="overlay",
        xaxis=dict(title="Runs in over", dtick=2, range=[-0.5, max_x + 0.5]),
        yaxis=dict(title="Number of overs"),
        bargap=0.05,
        legend=dict(orientation="h", yanchor="top", y=-0.18, xanchor="center", x=0.5),
        margin=dict(l=60, r=40, b=70, t=40),
    )
    return _apply_style(fig, height=560)


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
    wicketed = agg[agg["wickets"] > 0].copy()
    wicketless = agg[agg["wickets"] == 0].copy()
    if wicketed.empty:
        return go.Figure()

    # Wicketless bowlers get mixed into the plot with a diamond marker at the top of the avg range.
    max_avg = float(wicketed["average"].max())
    wicketless_y = max_avg

    # Merge wicketed + wicketless per team — one trace per team so legend filters both.
    agg["plot_y"] = agg["average"].fillna(wicketless_y)
    agg["symbol"] = agg["wickets"].apply(lambda w: "circle" if w > 0 else "diamond")
    agg["size"] = agg.apply(
        lambda r: r["wickets"] * 4 + 8 if r["wickets"] > 0 else r["overs"] * 1.5 + 8, axis=1
    )
    agg["hover_line"] = agg.apply(
        lambda r: (
            f"Avg: {r['average']:.1f}<br>{int(r['wickets'])} wkts in {r['overs']:.1f} overs ({int(r['runs'])} runs)"
            if r["wickets"] > 0
            else f"No wickets yet<br>0 wkts in {r['overs']:.1f} overs ({int(r['runs'])} runs)"
        ),
        axis=1,
    )

    fig = go.Figure()
    for team in sorted(agg["team"].unique()):
        # Put wicketed bowlers first so the legend marker for each team is a circle
        # (Plotly takes the first row's symbol for the legend entry).
        tdf = agg[agg["team"] == team].sort_values("wickets", ascending=False)
        color = team_color(team)
        fig.add_trace(go.Scatter(
            x=tdf["economy"],
            y=tdf["plot_y"],
            mode="markers+text",
            name=team_short(team),
            marker=dict(
                color=color,
                symbol=tdf["symbol"],
                size=tdf["size"],
                line=dict(width=1, color="white"),
                opacity=0.85,
            ),
            text=tdf["bowler"],
            textposition="top center",
            textfont=dict(size=9, color="#1f2937"),
            customdata=tdf["hover_line"].values,
            hovertemplate="<b>%{text}</b><br>Econ: %{x:.2f}<br>%{customdata}<extra></extra>",
        ))

    med_econ = float(wicketed["economy"].median())
    med_avg = float(wicketed["average"].median())
    fig.add_vline(x=med_econ, line_dash="dot", line_color="#9ca3af", opacity=0.7)
    fig.add_hline(y=med_avg, line_dash="dot", line_color="#9ca3af", opacity=0.7)
    # Quadrant labels (lower is better on both axes, so bottom-left is elite).
    quadrants = [
        (0.01, 0.02, "left",  "bottom", "#16a34a", "Elite<br><span style='font-size:9px'>cheap · strikes</span>"),
        (0.99, 0.02, "right", "bottom", "#0284c7", "Strike bowler<br><span style='font-size:9px'>wickets but leaks runs</span>"),
        (0.01, 0.98, "left",  "top",    "#ca8a04", "Stingy<br><span style='font-size:9px'>economical · few wickets</span>"),
        (0.99, 0.98, "right", "top",    "#dc2626", "Struggles<br><span style='font-size:9px'>expensive · few wickets</span>"),
    ]
    for x, y, xa, ya, color, text in quadrants:
        fig.add_annotation(
            x=x, y=y, xref="paper", yref="paper",
            text=text, showarrow=False,
            xanchor=xa, yanchor=ya,
            font=dict(size=11, color=color),
            bgcolor="rgba(255,255,255,0.75)",
            borderpad=3,
        )

    fig.add_annotation(
        x=0.5, y=-0.22, xref="paper", yref="paper",
        text="● circle = has wickets (size ∝ wickets) &nbsp;·&nbsp; ◆ diamond = no wickets yet (size ∝ overs bowled)",
        showarrow=False, xanchor="center", yanchor="top",
        font=dict(size=10, color="#6b7280"),
    )
    fig.update_layout(
        xaxis=dict(title="Economy (runs/over)"),
        yaxis=dict(title="Bowling average (runs/wicket)"),
        legend=dict(orientation="h", yanchor="top", y=-0.28, xanchor="center", x=0.5),
        margin=dict(b=110),
    )
    return _apply_style(fig, height=520)


def drs_combined(reviews_df, bbb_df=None, min_umpire_reviews=2):
    """Stacked bar + success-rate line, toggle between Team and Umpire views.

    Each review falls into one of three outcomes:
      - Overturned      — review upheld, on-field call reversed (reviewer wins)
      - Umpire's Call   — review struck down on a marginal call
      - On-field Stood  — review struck down, on-field call clearly correct

    Team view:   bars colored by reviewer outcome; line = success % (Overturned / total).
    Umpire view: bars colored by umpire correctness (Stood/UC = right, Overturned = wrong);
                 line = accuracy % (on-field decision survived the review).
    """
    if reviews_df.empty:
        return go.Figure()
    df = reviews_df.copy()
    df["decision_norm"] = df["decision"].astype(str).str.lower().str.strip()
    if "umpires_call" not in df.columns:
        df["umpires_call"] = False
    df["umpires_call"] = df["umpires_call"].fillna(False).astype(bool)

    def _classify(row):
        if row["decision_norm"] == "upheld":
            return "Overturned"
        if row["umpires_call"]:
            return "Umpire's Call"
        return "On-field Stood"

    df["outcome"] = df.apply(_classify, axis=1)
    OUTCOMES = ["Overturned", "Umpire's Call", "On-field Stood"]
    C_OVERTURN = "#16a34a"  # green
    C_UMP_CALL = "#eab308"  # yellow
    C_STOOD = "#dc2626"     # red
    LINE_COLOR = "#0891b2"  # cyan

    # --- Team aggregation ---
    team_pivot = df.pivot_table(index="team", columns="outcome", aggfunc="size", fill_value=0)
    for col in OUTCOMES:
        if col not in team_pivot.columns:
            team_pivot[col] = 0
    team_pivot["total"] = team_pivot[OUTCOMES].sum(axis=1)
    team_pivot["success"] = (team_pivot["Overturned"] / team_pivot["total"] * 100).round(0)
    # Sort by success % ascending (worst → best), ties broken by total reviews desc
    team_pivot = team_pivot.sort_values(["success", "total"], ascending=[True, False])
    teams = team_pivot.index.tolist()
    team_labels = [team_short(t) for t in teams]

    # --- Umpire aggregation ---
    ump_pivot = df.pivot_table(index="umpire", columns="outcome", aggfunc="size", fill_value=0)
    for col in OUTCOMES:
        if col not in ump_pivot.columns:
            ump_pivot[col] = 0
    ump_pivot["total"] = ump_pivot[OUTCOMES].sum(axis=1)
    ump_pivot = ump_pivot[ump_pivot["total"] >= min_umpire_reviews]
    # Umpire accuracy: on-field call survived the review (stood clearly OR umpire's call)
    ump_pivot["accuracy"] = (
        (ump_pivot["On-field Stood"] + ump_pivot["Umpire's Call"]) / ump_pivot["total"] * 100
    ).round(0)
    # Sort by accuracy ascending (worst → best), ties broken by total reviews desc
    ump_pivot = ump_pivot.sort_values(["accuracy", "total"], ascending=[True, False])
    umpires = ump_pivot.index.tolist()

    fig = go.Figure()

    # Team traces (visible initially): stack bottom→top as Overturned → UC → Stood
    fig.add_trace(go.Bar(
        x=team_labels, y=team_pivot["Overturned"], name="Overturned",
        marker_color=C_OVERTURN,
        hovertemplate="<b>%{x}</b><br>Overturned: %{y}<extra></extra>",
        visible=True,
    ))
    fig.add_trace(go.Bar(
        x=team_labels, y=team_pivot["Umpire's Call"], name="Umpire's Call",
        marker_color=C_UMP_CALL,
        hovertemplate="<b>%{x}</b><br>Umpire's Call: %{y}<extra></extra>",
        visible=True,
    ))
    fig.add_trace(go.Bar(
        x=team_labels, y=team_pivot["On-field Stood"], name="On-field Stood",
        marker_color=C_STOOD,
        hovertemplate="<b>%{x}</b><br>On-field Stood: %{y}<extra></extra>",
        visible=True,
    ))
    fig.add_trace(go.Scatter(
        x=team_labels, y=team_pivot["success"], name="Success %",
        mode="lines+markers", yaxis="y2",
        line=dict(color=LINE_COLOR, width=2),
        marker=dict(size=8, color=LINE_COLOR),
        hovertemplate="<b>%{x}</b><br>Success: %{y:.0f}%<extra></extra>",
        visible=True,
    ))

    # Umpire traces (hidden initially). Color semantics inverted:
    # Overturned = umpire was wrong (red); On-field Stood = umpire was right (green).
    fig.add_trace(go.Bar(
        x=umpires, y=ump_pivot["On-field Stood"], name="On-field Stood",
        marker_color=C_OVERTURN,
        hovertemplate="<b>%{x}</b><br>On-field Stood: %{y}<extra></extra>",
        visible=False,
    ))
    fig.add_trace(go.Bar(
        x=umpires, y=ump_pivot["Umpire's Call"], name="Umpire's Call",
        marker_color=C_UMP_CALL,
        hovertemplate="<b>%{x}</b><br>Umpire's Call: %{y}<extra></extra>",
        visible=False,
    ))
    fig.add_trace(go.Bar(
        x=umpires, y=ump_pivot["Overturned"], name="Overturned",
        marker_color=C_STOOD,
        hovertemplate="<b>%{x}</b><br>Overturned: %{y}<extra></extra>",
        visible=False,
    ))
    fig.add_trace(go.Scatter(
        x=umpires, y=ump_pivot["accuracy"], name="Accuracy %",
        mode="lines+markers", yaxis="y2",
        line=dict(color=LINE_COLOR, width=2),
        marker=dict(size=8, color=LINE_COLOR),
        hovertemplate="<b>%{x}</b><br>Accuracy: %{y:.0f}%<extra></extra>",
        visible=False,
    ))

    team_max = int(max(team_pivot["total"].max(), 1))
    ump_max = int(max(ump_pivot["total"].max(), 1)) if not ump_pivot.empty else 1

    # % labels as annotations floating above each bar, so they don't get buried inside tall stacks
    team_annotations = [
        dict(x=team_labels[i], y=team_pivot["total"].iloc[i], xref="x", yref="y",
             yshift=14, showarrow=False,
             text=f"{int(team_pivot['success'].iloc[i])}%",
             font=dict(color=LINE_COLOR, size=12, family="Inter, sans-serif"))
        for i in range(len(team_labels))
    ]
    ump_annotations = [
        dict(x=umpires[i], y=ump_pivot["total"].iloc[i], xref="x", yref="y",
             yshift=14, showarrow=False,
             text=f"{int(ump_pivot['accuracy'].iloc[i])}%",
             font=dict(color=LINE_COLOR, size=12, family="Inter, sans-serif"))
        for i in range(len(umpires))
    ]

    fig.update_layout(
        barmode="stack",
        xaxis=dict(title=""),
        yaxis=dict(title="Reviews", range=[0, team_max + 2]),
        yaxis2=dict(title="Success %", overlaying="y", side="right",
                    range=[0, 110], ticksuffix="%", showgrid=False),
        legend=dict(orientation="h", yanchor="top", y=-0.28, xanchor="center", x=0.5),
        margin=dict(l=60, r=70, t=60, b=120),
        annotations=team_annotations,
        updatemenus=[dict(
            type="buttons", direction="right",
            x=0.5, xanchor="center", y=1.14, yanchor="top",
            showactive=True,
            buttons=[
                dict(label="By Team", method="update", args=[
                    {"visible": [True, True, True, True, False, False, False, False]},
                    {"yaxis.range": [0, team_max + 2], "yaxis2.title.text": "Success %",
                     "annotations": team_annotations},
                ]),
                dict(label="By Umpire", method="update", args=[
                    {"visible": [False, False, False, False, True, True, True, True]},
                    {"yaxis.range": [0, ump_max + 2], "yaxis2.title.text": "Accuracy %",
                     "annotations": ump_annotations},
                ]),
            ],
        )],
    )
    return _apply_style(fig, height=460)


def drs_reviews_by_team(reviews_df):
    """Stacked horizontal bar: reviews taken per team, split by outcome.

    'upheld' = review upheld (on-field decision reversed) → reviewer won.
    'struck down' = review struck down (on-field decision stood) → reviewer lost.
    """
    if reviews_df.empty:
        return go.Figure()
    df = reviews_df.copy()
    df["outcome"] = df["decision"].map(
        lambda d: "Successful" if str(d).lower() == "upheld" else "Unsuccessful"
    )
    grp = df.groupby(["team", "outcome"]).size().unstack(fill_value=0)
    for col in ["Successful", "Unsuccessful"]:
        if col not in grp.columns:
            grp[col] = 0
    grp["total"] = grp["Successful"] + grp["Unsuccessful"]
    grp["success_rate"] = (grp["Successful"] / grp["total"] * 100).round(0)
    grp = grp.sort_values("total", ascending=True)
    teams = grp.index.tolist()
    short = [team_short(t) for t in teams]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        y=short, x=grp["Successful"], name="Successful",
        orientation="h", marker=dict(color="#16a34a"),
        text=grp["Successful"], textposition="inside",
        hovertemplate="<b>%{y}</b><br>Successful: %{x}<extra></extra>",
    ))
    fig.add_trace(go.Bar(
        y=short, x=grp["Unsuccessful"], name="Unsuccessful",
        orientation="h", marker=dict(color="#dc2626"),
        text=grp["Unsuccessful"], textposition="inside",
        hovertemplate="<b>%{y}</b><br>Unsuccessful: %{x}<extra></extra>",
    ))
    # Annotate success rate on the right of each bar
    for i, t in enumerate(teams):
        total = int(grp.loc[t, "total"])
        rate = int(grp.loc[t, "success_rate"]) if total > 0 else 0
        fig.add_annotation(
            x=total, y=short[i], xanchor="left", yanchor="middle",
            text=f"  {rate}% success",
            showarrow=False, font=dict(size=11, color="#6b7280"),
        )
    fig.update_layout(
        barmode="stack",
        xaxis=dict(title="Reviews taken"),
        yaxis=dict(title=""),
        legend=dict(orientation="h", yanchor="top", y=-0.15, xanchor="center", x=0.5),
        margin=dict(l=60, r=90, t=30, b=60),
    )
    return _apply_style(fig, height=max(320, len(teams) * 38 + 120))


def impact_player_subs_by_team(subs_df, players_df, bbb_df=None, matches_df=None):
    """Small-multiples strip plot: one mini-timeline per team.

    Each panel is a team, with a logo badge and team-colored border. Within a panel:
      - two lanes: "Bat" (top) = sub made while team was batting,
                   "Bowl" (bottom) = sub made while team was bowling
      - dots colored by intent (green/orange/grey)
      - phase bands shade Powerplay / Middle / Death
      - header: sub count and median over
    Hover shows opponent match, over, innings context, players in/out.
    """
    if subs_df.empty or players_df.empty:
        return go.Figure()
    df = subs_df[subs_df["reason"] == "impact_player"].copy()
    if df.empty:
        return go.Figure()

    role_map = dict(zip(players_df["player"], players_df["role"].str.lower()))
    bat_roles = {"batter", "wicketkeeper", "wicket-keeper"}
    bowl_roles = {"bowler"}

    def _classify(row):
        ro = role_map.get(row["player_out"], "")
        ri = role_map.get(row["player_in"], "")
        if ro in bowl_roles and ri not in bowl_roles:
            return "bat"
        if ri in bat_roles and ro not in bat_roles:
            return "bat"
        if ri in bowl_roles and ro not in bowl_roles:
            return "bowl"
        if ro in bat_roles and ri not in bat_roles:
            return "bowl"
        return "same"

    df["intent"] = df.apply(_classify, axis=1)
    df["x_raw"] = df["over"] + df["ball"] / 10
    df["team_s"] = df["team"].map(team_short)

    # Batting/bowling context per sub
    if bbb_df is not None and not bbb_df.empty and "match_number" in df.columns:
        bat_map = (
            bbb_df.drop_duplicates(["match_number", "innings"])[
                ["match_number", "innings", "team"]
            ].rename(columns={"team": "batting_team"})
        )
        df = df.merge(bat_map, on=["match_number", "innings"], how="left")
        df["context"] = df.apply(
            lambda r: "batting" if r["team"] == r.get("batting_team") else "bowling",
            axis=1,
        )
    else:
        df["context"] = "batting"
    df["y"] = df["context"].map({"batting": 1.0, "bowling": 0.0})

    # Opponent per match for hover
    if matches_df is not None and not matches_df.empty and "match_number" in df.columns:
        m = matches_df[["match_number", "team_1", "team_2"]].copy()
        df = df.merge(m, on="match_number", how="left")
        df["opponent"] = df.apply(
            lambda r: r["team_2"] if r["team"] == r["team_1"] else r["team_1"],
            axis=1,
        )
        df["opponent_s"] = df["opponent"].map(team_short)
    else:
        df["opponent_s"] = ""

    # Spread same-(team, context, over) clusters across a small x-band so stacks are visible
    df = df.sort_values(["team_s", "context", "x_raw", "match_number"]).reset_index(drop=True)
    df["x"] = df["x_raw"]
    for _, grp in df.groupby(["team_s", "context", "x_raw"]):
        n = len(grp)
        if n <= 1:
            continue
        span = 0.9
        for i, idx in enumerate(grp.index):
            off = (-span / 2) + (span * i / (n - 1))
            df.at[idx, "x"] = grp.iloc[0]["x_raw"] + off

    C_BAT = "#16a34a"
    C_BOWL = "#f59e0b"
    C_SAME = "#9ca3af"
    intent_color = {"bat": C_BAT, "bowl": C_BOWL, "same": C_SAME}
    intent_label = {
        "bat": "Strengthen batting",
        "bowl": "Strengthen bowling",
        "same": "Like-for-like",
    }

    # 5 rows × 2 cols of mini-panels, ordered by total subs descending
    counts = df.groupby(["team", "team_s"]).size().reset_index(name="n")
    counts = counts.sort_values("n", ascending=False).reset_index(drop=True)
    team_order = counts["team_s"].tolist()
    team_full_map = dict(zip(counts["team_s"], counts["team"]))

    rows, cols = 5, 2
    fig = make_subplots(
        rows=rows, cols=cols,
        horizontal_spacing=0.08,
        vertical_spacing=0.14,
        shared_xaxes=False,
    )

    legend_done = {"bat": False, "bowl": False, "same": False}
    for idx, team in enumerate(team_order):
        r = idx // cols + 1
        c = idx % cols + 1
        tdf = df[df["team_s"] == team]

        # Phase bands
        fig.add_vrect(x0=0, x1=6, fillcolor="#bfdbfe", opacity=0.30, line_width=0,
                      layer="below", row=r, col=c)
        fig.add_vrect(x0=6, x1=15, fillcolor="#fde68a", opacity=0.30, line_width=0,
                      layer="below", row=r, col=c)
        fig.add_vrect(x0=15, x1=20, fillcolor="#fca5a5", opacity=0.30, line_width=0,
                      layer="below", row=r, col=c)
        # Lane divider
        fig.add_shape(type="line", x0=0, x1=20, y0=0.5, y1=0.5,
                      line=dict(color="#e5e7eb", width=1, dash="dot"),
                      layer="below", row=r, col=c)

        for intent in ["bat", "bowl", "same"]:
            sub = tdf[tdf["intent"] == intent]
            if sub.empty:
                continue
            show = not legend_done[intent]
            legend_done[intent] = True
            fig.add_trace(go.Scatter(
                x=sub["x"], y=sub["y"],
                mode="markers",
                name=intent_label[intent],
                legendgroup=intent,
                showlegend=show,
                marker=dict(symbol="circle", size=13, color=intent_color[intent],
                            line=dict(color="#ffffff", width=1.5)),
                customdata=list(zip(
                    sub["player_in"], sub["player_out"], sub["innings"],
                    sub["context"], sub["x_raw"], sub["match_number"], sub["opponent_s"],
                )),
                hovertemplate=(
                    "<b>Match %{customdata[5]} · vs %{customdata[6]}</b><br>"
                    "Over %{customdata[4]:.1f} · innings %{customdata[2]} (%{customdata[3]})<br>"
                    "In: %{customdata[0]}<br>Out: %{customdata[1]}<extra></extra>"
                ),
            ), row=r, col=c)

        fig.update_xaxes(range=[-0.5, 20.5], dtick=5, row=r, col=c,
                         gridcolor="#f3f4f6", zeroline=False,
                         title_text="Over" if r == rows else "",
                         showline=False)
        fig.update_yaxes(range=[-0.6, 1.6], row=r, col=c,
                         tickmode="array", tickvals=[0, 1],
                         ticktext=["Bowl", "Bat"],
                         gridcolor="#f3f4f6", zeroline=False,
                         showline=False, tickfont=dict(size=10, color="#6b7280"))

    # Per-panel: external header (logo + team name, metadata) + team-colored border
    for idx, team in enumerate(team_order):
        r, c = idx // cols + 1, idx % cols + 1
        axis_idx = (r - 1) * cols + c
        suffix = "" if axis_idx == 1 else str(axis_idx)
        xref_dom = f"x{suffix} domain"
        yref_dom = f"y{suffix} domain"
        full_name = team_full_map[team]
        color = team_color(full_name)
        logo = TEAM_LOGOS.get(full_name)
        td = df[df["team_s"] == team]
        median_x = td["x_raw"].median()

        # Panel border
        fig.add_shape(
            type="rect", xref=xref_dom, yref=yref_dom,
            x0=0, x1=1, y0=0, y1=1,
            line=dict(color=color, width=2.5),
            fillcolor="rgba(0,0,0,0)",
            layer="above",
        )
        # Logo above the panel (outside the border, top-left)
        if logo:
            fig.add_layout_image(
                source=logo, xref=xref_dom, yref=yref_dom,
                x=0.0, y=1.32, sizex=0.09, sizey=0.28,
                xanchor="left", yanchor="top",
                layer="above", opacity=1.0,
            )
        # Team name next to the logo (outside, above the panel)
        fig.add_annotation(
            xref=xref_dom, yref=yref_dom,
            x=0.10, y=1.20, xanchor="left", yanchor="middle",
            text=f"<b>{team}</b>",
            showarrow=False,
            font=dict(size=14, color=color),
        )
        # Metadata on the right of the header (count · median)
        fig.add_annotation(
            xref=xref_dom, yref=yref_dom,
            x=1.0, y=1.20, xanchor="right", yanchor="middle",
            text=f"{len(td)} subs &nbsp;·&nbsp; median O{median_x:.1f}",
            showarrow=False,
            font=dict(size=11, color="#6b7280"),
        )

    fig.update_layout(
        height=860,
        plot_bgcolor="white", paper_bgcolor="white",
        font=dict(family="Inter, sans-serif", size=11, color="#1f2937"),
        legend=dict(orientation="h", yanchor="top", y=-0.10, xanchor="center", x=0.5),
        margin=dict(l=60, r=30, t=60, b=110),
    )
    return fig


def drs_umpire_performance(reviews_df, min_reviews=2):
    """Diverging bar: per umpire, green = umpire's call upheld (review struck down = correct),
    red = umpire's call overturned (review upheld = incorrect).

    An umpire whose on-field calls survive review is more accurate under DRS.
    """
    if reviews_df.empty:
        return go.Figure()
    df = reviews_df.copy()
    df["decision_norm"] = df["decision"].astype(str).str.lower()
    grp = df.groupby("umpire")["decision_norm"].value_counts().unstack(fill_value=0)
    for col in ["struck down", "upheld"]:
        if col not in grp.columns:
            grp[col] = 0
    grp["total"] = grp["struck down"] + grp["upheld"]
    grp = grp[grp["total"] >= min_reviews]
    if grp.empty:
        return go.Figure()
    # accuracy = reviews struck down / total (umpire's call survived)
    grp["accuracy"] = (grp["struck down"] / grp["total"] * 100).round(0)
    grp = grp.sort_values("accuracy", ascending=True)
    umpires = grp.index.tolist()

    fig = go.Figure()
    fig.add_trace(go.Bar(
        y=umpires, x=-grp["upheld"], name="Overturned",
        orientation="h", marker=dict(color="#dc2626"),
        text=grp["upheld"], textposition="inside",
        hovertemplate="<b>%{y}</b><br>Overturned: %{text}<extra></extra>",
    ))
    fig.add_trace(go.Bar(
        y=umpires, x=grp["struck down"], name="Upheld",
        orientation="h", marker=dict(color="#16a34a"),
        text=grp["struck down"], textposition="inside",
        hovertemplate="<b>%{y}</b><br>Upheld: %{text}<extra></extra>",
    ))
    # Accuracy annotation on the right
    max_right = max(grp["struck down"].max(), 1)
    for u in umpires:
        fig.add_annotation(
            x=max_right, y=u, xanchor="left", yanchor="middle",
            text=f"  {int(grp.loc[u, 'accuracy'])}% upheld",
            showarrow=False, font=dict(size=11, color="#6b7280"),
        )
    fig.update_layout(
        barmode="relative",
        xaxis=dict(title="← Overturned    Upheld →", zeroline=True, zerolinecolor="#374151", zerolinewidth=1),
        yaxis=dict(title=""),
        legend=dict(orientation="h", yanchor="top", y=-0.15, xanchor="center", x=0.5),
        margin=dict(l=140, r=130, t=30, b=60),
    )
    return _apply_style(fig, height=max(320, len(umpires) * 34 + 120))
