# Changelog

All notable changes to this project will be documented in this file.

---

## 2026-04-13

### Added

- DRS Reviews chart in Season Analysis with toggle between **By Team** and **By Umpire** views; stacked diverging bars split each side by role (batting-side vs fielding-side reviews)
- Impact Player Introductions per-team arrow strip: glyphs encode role swap (▲ strengthen batting, ▼ strengthen bowling, ◆ like-for-like), colored by innings, plotted over a 0–20 over timeline with phase bands
- GitHub Actions cache for `.cricsheet_cache/` so `incremental` mode works correctly in CI (old JSONs persist across runs → `points_table.csv` and `player_registry.csv` rebuild from the full set)

### Changed

- Match Centre header: result, toss (with team color), venue, and POM now laid out as a three-column meta strip instead of a pipe-delimited single line
- Season Analysis histogram height bumped to match the Team Fingerprint radar in the same row
- Workflow default fetch mode switched from `auto` → `incremental` (daily runs only fetch Cricsheet's last-7-days zip)

---

## 2026-04-12

### Added

- Season Analysis page (renamed from Team Analysis) with four new charts:
  - Scoring Rhythm heatmap — avg runs per over by team, with sample size in hover
  - Team Fingerprint radar — batting run-rate and inverted bowling economy across phases
  - Runs per over — 1st vs 2nd innings overlay histogram with mean info box
  - Economy vs Bowling Average scatter (min 4 overs) with median crosshairs

### Changed

- Unified chart titling convention: card headers own titles, figures are untitled
- Legends on Manhattan, Worm, and Run Rate charts moved below plot with bottom margin to prevent collision with x-axis title

### Removed

- Match Centre bowling economy chart (redundant with bowling scorecard table)
- Match Centre ball-outcome share by phase chart (overlapped Manhattan + scorecards)

---

## 2026-04-10

### Added

- `.python-version` file (3.12) to fix ShinyApps Connect deployment version warning

### Changed

- Replaced NRR Progression with single bump chart using actual match numbers on x-axis

### Fixed

- NRR calculation in `orchestrator.py` now uses ball counts internally instead of accumulating cricket-notation overs, avoiding rounding errors
- NRR all-out handling now respects `target_overs` for rain-shortened matches instead of always assuming 20 overs
- `orchestrator.py` now preserves existing matches in `matches.csv` that aren't in cache, preventing data loss on partial reruns
- Fall of wickets over notation in `parser.py`: now 1-indexed with `.6` for last ball of an over; reprocessed all 15 matches
- Unsafe `.iloc[0]` in match innings team lookup — added empty check
- Division-by-zero guards across batting, bowling, and phase calculations
- Safe score and win margin parsing in bump chart (handles missing `/` separators)

---

## 2026-04-08

### Added

- Added `method` and `target_overs` fields to `matches.csv` for better rain-affected match handling
- Added score normalization for rain-shortened matches in dashboard calculations
- Added footnotes in `app.py` for rain-affected matches in charts and tables

### Changed

- Updated NRR calculation in `orchestrator.py` to use decimal overs instead of ball conversions for improved accuracy
- Enhanced phase boundary calculation in `parser.py` for rain-shortened matches, using cumulative legal balls instead of over numbers
- Modified `app.py` to exclude no-result matches from all statistics and charts
- Improved UI in `app.py` by hiding Plotly mode bar for cleaner visualizations

## 2026-04-05

### Added

- Interactive dashboard (`app.py`) with 6 pages: Overview, Batting, Bowling, Fielding & Partnerships, Team Analysis, Match Centre
- Reusable Plotly chart helpers (`utils/charts.py`): horizontal/vertical bar, line chart, worm chart, phase comparison, fall of wickets timeline
- Data loading utilities (`utils/data_loader.py`) with `@lru_cache` for all CSV types
- Consistent IPL team colors, logos, and short names across all visualizations
- Deployed dashboard to [ShinyApps.io](https://openipl.shinyapps.io/openipl/)
- Auto-redeploy step in GitHub Actions workflow after data updates

### Changed

- Fixed NRR calculation in `orchestrator.py`: all-out teams (10 wickets) now deemed to have faced 20 overs per ICC rules
- Fixed duplicate unbroken partnership in `parser.py`: skip final partnership save when team is all out

## 2026-03-30

### Changed

- Renamed `match_id` to `cricsheet_match_id` in `matches.csv` for clarity
- Fall of wickets over format now uses standard cricket notation (e.g., `2.0` instead of `1.6` when wicket falls on last ball of an over)
- Added `opponent` column to per-team `batting.csv` and `bowling.csv`

## 2026-03-29

### Added

- DRS reviews extraction (`reviews.csv` per match, when reviews occurred)
- Super over extraction (`super_over.csv` per match, when super over was played)
- Impact player / concussion substitutions (`substitutions.csv` per match, when subs occurred)
- Player registry (`player_registry.csv` at season level) with Cricsheet IDs for cross-season linking
- Granular extras breakdown in `ball_by_ball.csv` (wides, noballs, byes, legbyes, penalty as separate columns)
- Match stage field in `matches.csv` (league / Qualifier 1 / Eliminator / Final)
- Umpire and match referee fields merged into `matches.csv`

### Removed

- Per-match `info.csv` (redundant — data now lives in `matches.csv`)

## 2026-03-28

### Added

- Data pipeline: `orchestrator.py`, `fetcher.py`, `parser.py`, `collector.py`
- GitHub Actions workflow (`update.yml`) with incremental, full, and auto fetch modes
- `reprocess` input to GitHub Actions workflow
- Dynamic `run-name` for descriptive workflow run titles
- Run log (`logs/run_log.md`) to track every pipeline execution
- `CHANGELOG.md` to track project changes
- `DATA_DICTIONARY.md` with column descriptions for all CSVs
- `README.md` with badges, data summary table, and collapsible sections
- MIT license for code, CC BY 4.0 for data
- Workflow logs on every run (success or failure) with context-aware commit messages
