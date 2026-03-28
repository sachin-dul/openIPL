# Changelog

All notable changes to this project will be documented in this file.

---

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
