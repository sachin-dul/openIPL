<div align="center">

# openIPL

**Open-source, analysis-ready datasets for the Indian Premier League**

[![License: MIT](https://img.shields.io/badge/Code-MIT-blue.svg)](LICENSE)
[![License: CC BY 4.0](https://img.shields.io/badge/Data-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![Data Source](https://img.shields.io/badge/Source-Cricsheet-orange.svg)](https://cricsheet.org/)

*Inspired by [Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League) — doing the same for IPL cricket.*

</div>

---

A comprehensive dataset for every match of the Indian Premier League, starting from the 2026 season. Updated after every match during the season. Raw ball-by-ball data is sourced from [Cricsheet](https://cricsheet.org/) (CC BY 4.0) and transformed into flat CSV files — scorecards, phase breakdowns, partnerships, player aggregates, and more — so you can `pd.read_csv()` and start analyzing immediately.

## Data at a Glance

| Level | What you get |
|-------|-------------|
| **Season** | `matches.csv` &middot; `points_table.csv` &middot; `players.csv` &middot; `player_registry.csv` |
| **Per Match** | `ball_by_ball.csv` &middot; `batting_scorecard.csv` &middot; `bowling_scorecard.csv` &middot; `partnerships.csv` &middot; `fall_of_wickets.csv` &middot; `phase_summary.csv` &middot; `reviews.csv`* &middot; `super_over.csv`* &middot; `substitutions.csv`* |
| **Per Player** | `batting.csv` &middot; `bowling.csv` &middot; `fielding.csv` |
| **Per Team** | `batting.csv` &middot; `bowling.csv` &middot; `results.csv` |

<sub>* Only generated when the data exists for that match</sub>

<details>
<summary><strong>Full directory structure</strong></summary>

```
data/
  2026/
    matches.csv                    # All matches: date, venue, teams, result, toss, officials
    points_table.csv               # Standings with NRR
    players.csv                    # All players with team and role
    player_registry.csv            # Cricsheet IDs for cross-season player linking
    matches/
      match_01_CSK_vs_MI/
        ball_by_ball.csv           # Every delivery (with granular extras)
        batting_scorecard.csv      # Batting figures
        bowling_scorecard.csv      # Bowling figures
        partnerships.csv           # Partnership data
        fall_of_wickets.csv        # Wicket progression
        phase_summary.csv          # Powerplay / Middle / Death splits
        reviews.csv                # DRS reviews (when present)
        super_over.csv             # Super over deliveries (when present)
        substitutions.csv          # Impact player / concussion subs (when present)
    players/
      Virat_Kohli/
        batting.csv                # Match-by-match batting
        bowling.csv                # Match-by-match bowling
        fielding.csv               # Catches, stumpings, run-outs
    teams/
      Chennai_Super_Kings/
        batting.csv
        bowling.csv
        results.csv
```

</details>

## Dashboard

openIPL includes an interactive analytics dashboard built with [Shiny for Python](https://shiny.posit.co/py/) and Plotly.

**Live:** [openipl.shinyapps.io/openipl](https://openipl.shinyapps.io/openipl/)

```bash
pip install -r requirements.txt
shiny run app.py
```

**Pages:**

| Page | What's on it |
|------|--------------|
| **Overview** | Points table with last-5 form badges, recent results, key season stats |
| **Batting** | Orange Cap, strike rates, boundaries, phase heatmaps |
| **Bowling** | Purple Cap, economy, dot balls, phase heatmaps |
| **Fielding & Partnerships** | Stacked fielding breakdown, best partnerships by wicket |
| **Season Analysis** | Scoring rhythm heatmap, team fingerprint radar, runs-per-over innings compare (team filter with missing-innings notice), economy vs average scatter, standings bump chart, toss analysis, phase comparison, venue stats, DRS reviews (3-way outcome stack with success-rate line, team/umpire toggle), impact player introductions small-multiples |
| **Match Centre** | Scorecards, worm chart, fall of wickets, partnerships, DRS reviews, substitutions |

## Quick Start

### Browse on GitHub

Every CSV renders directly on GitHub — navigate into `data/` and explore.

### Use with Python

```python
import pandas as pd

# Season overview
matches = pd.read_csv("data/2026/matches.csv")
table   = pd.read_csv("data/2026/points_table.csv")

# Ball-by-ball for a specific match
bbb = pd.read_csv("data/2026/matches/match_01_CSK_vs_MI/ball_by_ball.csv")

# A player's batting season
kohli = pd.read_csv("data/2026/players/Virat_Kohli/batting.csv")
```

## Run It Yourself

> **Prerequisites:** Python 3.10+ and pip

```bash
git clone https://github.com/sachin-dul/openIPL.git
cd openIPL
pip install -r requirements.txt
```

```bash
# Fetch from Cricsheet and process all matches for a season
cd scripts
python orchestrator.py --season 2026

# Incremental update (fetches only new matches)
python orchestrator.py --season 2026 --fetch-mode incremental

# Full re-download from Cricsheet
python orchestrator.py --season 2026 --fetch-mode full

# Reprocess all matches (even already processed ones)
python orchestrator.py --season 2026 --reprocess

# Process from a local directory of Cricsheet JSON files
python orchestrator.py --season 2026 --json-dir /path/to/json --no-fetch
```

<details>
<summary><strong>What the orchestrator does</strong></summary>

1. Fetches match data from [Cricsheet](https://cricsheet.org/) (or uses local JSON files)
2. Parses each match into per-match CSVs
3. Builds `matches.csv` and `points_table.csv`
4. Generates per-player and per-team aggregates

Already-processed matches are skipped unless `--reprocess` is passed.

</details>

## Data Dictionary

See [DATA_DICTIONARY.md](DATA_DICTIONARY.md) for detailed column descriptions of every CSV.

## Data Source & Attribution

All ball-by-ball data is sourced from [Cricsheet](https://cricsheet.org/), created and maintained by Stephen Rushe, under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license.

## License

| Component | License |
|-----------|---------|
| Code (scripts, workflows) | [MIT](LICENSE) |
| Data (CSVs derived from Cricsheet) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## Using This Data

You're welcome to use this dataset in your own projects, research, or analysis. All I ask is that you cite this repo and credit [Cricsheet](https://cricsheet.org/) as the original data source.

## Issues

Found a problem? [Open an issue](../../issues).

---

<sub>This dataset contains only men's IPL data. IPL is a trademark of the BCCI. This project is not affiliated with or endorsed by the BCCI or IPL.</sub>
