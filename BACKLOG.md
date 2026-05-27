# openIPL Backlog

Open items deferred from prior sessions. Each entry: what + why it's deferred + where to start.

---

## Tie matches: super-over winner not captured

**What.** When a regulation match is tied and decided by a super over, our
`matches.csv` rows have `result='tie'` and `winner=''`. The standings builder
and the head-to-head matrix both treat these as "no winner attributed", which
under-counts a W and an L per tied match.

**Why it matters.** 2025 standings drift from official:
- GT: ours 9W/5L/0NR — official 9W/4L/1NR (we're missing the m32 DC-RR tie
  super-over credit elsewhere if it cascades, plus the tie itself)
- DC: ours 6W/6L/1NR — official 6W/7L/1NR
- RR: ours 4W/9L/0NR — official 4W/9L/1NR

15+ tied matches affected across seasons (2009, 2010, 2013, 2014, 2015, 2017,
2019, 2020 — 4 ties — 2021, 2025, 2026).

**Where to fix.**
- `scripts/parser.py:71-77` — read `outcome.winner` first, but if it's empty
  and `super_over` data exists, walk the deliveries and credit the team that
  scored more (continue across multiple super overs for 2020+ rules).
- After patching the parser, re-parse 2008–2026 (or just affected seasons) and
  re-run `scripts/aggregator.py`.
- Re-run `scripts/regen_points_table.py` so standings pick up the new W/L.

User decision (2026-05-17): keep as-is for now; revisit later.

---

## Form column still includes playoffs

**What.** The "Form" column on the season-overview points table reads the
last-5 from `matches` with no `match_stage` filter, so playoff games count.
Standings W/L/Pts are now league-only, but Form isn't.

**Where to fix.** `web/src/app/season/[year]/overview/overview-content.tsx`
around line 165-179 — add `AND LOWER(COALESCE(match_stage,'league'))='league'`
to the `played` CTE.

---

## 2025 W/L breakdown vs official (cascade of tie issue)

Knock-on from the tie issue above — fixing tie handling closes most of it.
Verify against Wikipedia IPL 2025 standings after the parser fix lands.

---

## Notes / decisions made (don't redo)

- **Points table is league-only by design.** Playoffs excluded from P/W/L/Pts.
  Changed 2026-05-16 in `scripts/orchestrator.py:build_points_table` and a
  one-shot retrofit via `scripts/regen_points_table.py`.
- **Aggregator default range** is now 2008–2026 (`scripts/aggregator.py:62`).
  Earlier it stopped at 2025 because 2026 was on the Shiny/CSV path.
- **Washout rows** for matches Cricsheet has no JSON for (no ball bowled) live
  in `matches.csv` directly with empty `cricsheet_match_id`, league stage, and
  `result='no result'`. Orchestrator's playoff renumbering reads existing
  matches.csv so it won't collide on re-runs.
- **2025 m58 PBKS-DC** marked `match_stage='league_replayed'` because BCCI
  treated the m24 May 24 fixture as the replay (not a separate fixture).
- **Tied matches in the matrix** currently show "Tied" cell label without a
  winner shortcode — accurate to the data we have, will become "Super Over"
  with a winner once the tie-handling fix lands.
