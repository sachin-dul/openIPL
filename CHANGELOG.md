# Changelog

All notable changes to this project will be documented in this file.

---

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
