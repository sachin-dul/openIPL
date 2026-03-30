# Data Dictionary

Detailed column descriptions for every CSV in this dataset.

---

## Season-Level CSVs

### `matches.csv`

Season-level match index.

| Column | Type | Description |
|--------|------|-------------|
| cricsheet_match_id | string | Cricsheet match ID |
| match_number | int | Match number in the season (1-70 league, 71+ playoffs) |
| date | date | Match date (YYYY-MM-DD) |
| venue | string | Stadium and city |
| team_1 | string | Team batting first |
| team_2 | string | Team batting second |
| toss_winner | string | Team that won the toss |
| toss_decision | string | bat / field |
| winner | string | Winning team (empty if no result) |
| result | string | Special result type: "no result", "tie" (empty for normal wins) |
| win_by_runs | int | Margin in runs (0 if chasing team won) |
| win_by_wickets | int | Margin in wickets (0 if batting first team won) |
| player_of_match | string | Player of the match |
| team_1_score | string | Total score (e.g., "185/4") |
| team_2_score | string | Total score (e.g., "170/10") |
| match_stage | string | league / Qualifier 1 / Qualifier 2 / Eliminator / Final |
| umpire_1 | string | On-field umpire |
| umpire_2 | string | On-field umpire |
| tv_umpire | string | TV umpire |
| match_referee | string | Match referee |

### `points_table.csv`

Final standings with Net Run Rate.

| Column | Type | Description |
|--------|------|-------------|
| position | int | Current ranking |
| team | string | Team name |
| played | int | Matches played |
| won | int | Matches won |
| lost | int | Matches lost |
| no_result | int | No result matches |
| net_run_rate | float | Net Run Rate |
| points | int | Total points (2 per win, 1 per NR) |

### `players.csv`

All players who appeared in the season.

| Column | Type | Description |
|--------|------|-------------|
| player | string | Player name |
| team | string | Team name |
| role | string | batter / bowler / allrounder |
| matches | int | Matches played |

### `player_registry.csv`

Unique Cricsheet IDs for all players and officials in the season. Useful for linking players across seasons even if names change.

| Column | Type | Description |
|--------|------|-------------|
| player | string | Person name (players and officials) |
| cricsheet_id | string | Unique Cricsheet identifier |

---

## Per-Match CSVs

Located in `matches/match_XX_Team1_vs_Team2/`.

### `ball_by_ball.csv`

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| team | string | Batting team |
| over | int | Over number (1-indexed) |
| ball | int | Ball number within the over (1-6+) |
| batter | string | Striker name |
| bowler | string | Bowler name |
| non_striker | string | Non-striker name |
| batter_runs | int | Runs scored by batter |
| extra_runs | int | Total extra runs |
| total_runs | int | Total runs off the delivery |
| extra_type | string | wide / noball / legbye / bye / penalty (empty if none) |
| wides | int | Wide runs (0 if not a wide) |
| noballs | int | No ball runs (0 if not a no ball) |
| byes | int | Bye runs (0 if none) |
| legbyes | int | Leg bye runs (0 if none) |
| penalty | int | Penalty runs (0 if none) |
| is_wicket | bool | Whether a wicket fell |
| wicket_kind | string | caught / bowled / lbw / run out / stumped / etc. |
| player_out | string | Dismissed batter |
| fielder | string | Fielder involved in dismissal |
| phase | string | powerplay / middle / death |

### `batting_scorecard.csv`

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| team | string | Batter's team |
| batter | string | Batter name |
| runs | int | Runs scored |
| balls | int | Balls faced |
| fours | int | Number of 4s |
| sixes | int | Number of 6s |
| strike_rate | float | (runs / balls) * 100 |
| dismissal | string | How out (e.g., "c Fielder b Bowler") or "not out" |
| batting_position | int | Batting order position |

### `bowling_scorecard.csv`

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| team | string | Bowler's team |
| bowler | string | Bowler name |
| overs | float | Overs bowled (e.g., 3.4) |
| maidens | int | Maiden overs |
| runs | int | Runs conceded |
| wickets | int | Wickets taken |
| economy | float | Runs per over |
| dots | int | Dot balls bowled |
| wides | int | Wides bowled |
| noballs | int | No balls bowled |

### `partnerships.csv`

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| team | string | Batting team |
| wicket_number | int | Partnership for Nth wicket |
| batter_1 | string | First batter |
| batter_1_runs | int | Runs by batter 1 |
| batter_1_balls | int | Balls faced by batter 1 |
| batter_2 | string | Second batter |
| batter_2_runs | int | Runs by batter 2 |
| batter_2_balls | int | Balls faced by batter 2 |
| total_runs | int | Partnership runs (including extras) |
| total_balls | int | Partnership balls |

### `fall_of_wickets.csv`

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| team | string | Batting team |
| wicket_number | int | Nth wicket to fall |
| player_out | string | Dismissed batter |
| score | int | Team score when wicket fell |
| over | string | Over at which wicket fell in cricket notation (e.g., "5.3" = 5 overs 3 balls, "6.0" = 6 overs complete) |

### `phase_summary.csv`

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| team | string | Batting team |
| phase | string | powerplay (1-6) / middle (7-15) / death (16-20) |
| runs | int | Runs scored in phase |
| wickets | int | Wickets lost in phase |
| balls | int | Legal deliveries in phase |
| run_rate | float | Runs per over in phase |
| boundaries | int | 4s + 6s in phase |
| dots | int | Dot balls in phase |

### `reviews.csv` *(only present when DRS reviews occurred)*

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| over | int | Over number (1-indexed) |
| ball | int | Ball number |
| team | string | Team that requested the review |
| batter | string | Batter facing the delivery |
| bowler | string | Bowler |
| umpire | string | Umpire whose decision was reviewed |
| type | string | Review type (e.g., "wicket") |
| decision | string | upheld / overturned |

### `super_over.csv` *(only present when a super over was played)*

| Column | Type | Description |
|--------|------|-------------|
| team | string | Batting team |
| ball | int | Ball number |
| batter | string | Striker name |
| bowler | string | Bowler name |
| non_striker | string | Non-striker name |
| batter_runs | int | Runs scored by batter |
| extra_runs | int | Extra runs |
| total_runs | int | Total runs off the delivery |
| extra_type | string | Extra type (empty if none) |
| is_wicket | bool | Whether a wicket fell |
| wicket_kind | string | Dismissal type |
| player_out | string | Dismissed batter |

### `substitutions.csv` *(only present when substitutions occurred)*

| Column | Type | Description |
|--------|------|-------------|
| innings | int | 1 or 2 |
| over | int | Over number (1-indexed) |
| ball | int | Ball number |
| team | string | Team making the substitution |
| player_in | string | Replacement player |
| player_out | string | Player being replaced |
| reason | string | impact_player / concussion_substitute / etc. |

---

## Per-Player CSVs

Located in `players/<Player_Name>/`.

### `batting.csv`

| Column | Type | Description |
|--------|------|-------------|
| match_number | int | Season match number |
| date | date | Match date |
| opponent | string | Opposition team |
| venue | string | Stadium |
| runs | int | Runs scored |
| balls | int | Balls faced |
| fours | int | 4s hit |
| sixes | int | 6s hit |
| strike_rate | float | Strike rate |
| dismissal | string | How out or "not out" |
| batting_position | int | Batting position |
| phase_pp_runs | int | Runs in powerplay |
| phase_mid_runs | int | Runs in middle overs |
| phase_death_runs | int | Runs in death overs |

### `bowling.csv`

| Column | Type | Description |
|--------|------|-------------|
| match_number | int | Season match number |
| date | date | Match date |
| opponent | string | Opposition team |
| venue | string | Stadium |
| overs | float | Overs bowled |
| maidens | int | Maidens |
| runs | int | Runs conceded |
| wickets | int | Wickets taken |
| economy | float | Economy rate |
| dots | int | Dot balls |
| wides | int | Wides |
| noballs | int | No balls |

### `fielding.csv`

| Column | Type | Description |
|--------|------|-------------|
| match_number | int | Season match number |
| date | date | Match date |
| opponent | string | Opposition team |
| catches | int | Catches taken |
| stumpings | int | Stumpings |
| run_outs | int | Run out involvements |

---

## Per-Team CSVs

Located in `teams/<Team_Name>/`.

### `results.csv`

| Column | Type | Description |
|--------|------|-------------|
| match_number | int | Season match number |
| date | date | Match date |
| opponent | string | Opposition team |
| venue | string | Stadium |
| result | string | won / lost / no result |
| margin | string | e.g., "by 20 runs", "by 5 wickets" |

### `batting.csv`

| Column | Type | Description |
|--------|------|-------------|
| match_number | int | Season match number |
| opponent | string | Opposition team |
| batter | string | Batter name |
| runs | int | Runs scored |
| balls | int | Balls faced |
| fours | int | 4s hit |
| sixes | int | 6s hit |
| strike_rate | float | Strike rate |
| dismissal | string | How out or "not out" |

### `bowling.csv`

| Column | Type | Description |
|--------|------|-------------|
| match_number | int | Season match number |
| opponent | string | Opposition team |
| bowler | string | Bowler name |
| overs | float | Overs bowled |
| maidens | int | Maidens |
| runs | int | Runs conceded |
| wickets | int | Wickets taken |
| economy | float | Economy rate |
| dots | int | Dot balls |
