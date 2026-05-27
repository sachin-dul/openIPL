/**
 * Shared SQL fragments for queries against the ball-by-ball table.
 *
 * `WICKET_EXCLUDE` filters out dismissals that don't credit the bowler — run
 * outs, retired hurts, obstructing-the-field, timed-out. Use it in any query
 * computing bowler wickets / strike rate / average from `ball_by_ball.is_wicket`.
 */

export const WICKET_EXCLUDE = `LOWER(COALESCE(wicket_kind, '')) NOT IN ('run out','retired hurt','retired out','obstructing the field','timed out')`;
