/**
 * DuckDB-WASM singleton + query runner.
 *
 * Lazy-initializes a single AsyncDuckDB instance on first use, registers each
 * Parquet file under /data/ as a SQL view named after the file (matches.parquet
 * → view `matches`), and exposes `runQuery<T>(sql)` for React components.
 *
 * Two-level cache:
 *   - `inFlight` map dedupes concurrent identical queries (returns the same
 *     pending Promise to both callers).
 *   - `resolved` map keeps the most-recent ~150 query results so re-running
 *     the same SQL is instant. `peekQuery` lets useDuckQuery seed its initial
 *     state synchronously and skip the loading flash on cached navigations.
 *
 * Browser-only: do not import from a Server Component.
 */
import * as duckdb from "@duckdb/duckdb-wasm";

const TABLES = [
  "matches",
  "points_table",
  "players",
  "player_registry",
  "ball_by_ball",
  "batting_scorecard",
  "bowling_scorecard",
  "partnerships",
  "fall_of_wickets",
  "phase_summary",
  "reviews",
  "super_over",
  "substitutions",
  "players_meta",
  // Pre-computed per-player rollups (built by scripts/build_player_aggregates.py).
  // The player page queries these instead of scanning ball_by_ball / scorecards.
  "player_career_bat",
  "player_career_bowl",
  "player_season_bat",
  "player_season_bowl",
  "orange_cap_winners",
  "player_dismissals",
  "player_wicket_types",
  "player_venues",
  "player_bowl_venues",
  "player_bowler_matchups",
  "player_batter_matchups",
  "player_skill_profile",
  "player_bowl_skill_profile",
] as const;

export type TableName = (typeof TABLES)[number];

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function initDb(): Promise<duckdb.AsyncDuckDB> {
  // Pick the right WASM bundle for this browser (MVP / EH / coi).
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  // Create a worker from the bundled main worker URL.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {
      type: "application/javascript",
    })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  // DuckDB-WASM's HTTPFS needs absolute URLs. Resolve relative to the page origin.
  const baseUrl = window.location.origin;
  // Cache-bust the parquet URL per page load so a browser holding a stale
  // entry (e.g. cached when Cache-Control was longer) doesn't poison the
  // schema. The query string varies between page loads but stays stable
  // within one — DuckDB-WASM's range requests stay coalesceable.
  const cacheBust = `?t=${Date.now()}`;
  const parquetUrl = (t: string) => `${baseUrl}/data/${t}.parquet${cacheBust}`;

  await Promise.all(
    TABLES.map((t) =>
      db.registerFileURL(
        `${t}.parquet`,
        parquetUrl(t),
        duckdb.DuckDBDataProtocol.HTTP,
        false
      )
    )
  );

  // Create a persistent view per table so queries can say `FROM matches`.
  // Using the absolute URL (matching what we registered) — alias resolution
  // is unreliable across duckdb-wasm versions when a relative name is passed
  // straight into read_parquet().
  const conn = await db.connect();
  try {
    for (const t of TABLES) {
      await conn.query(
        `CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${parquetUrl(t)}')`
      );
    }
  } finally {
    await conn.close();
  }
  return db;
}

/** Get the shared DuckDB instance, initializing on first call. */
export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (typeof window === "undefined") {
    throw new Error("DuckDB-WASM is browser-only");
  }
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

async function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = getDb().then((db) => db.connect());
  }
  return connPromise;
}

/* ── Query cache ───────────────────────────────────────────────────────── */

const CACHE_MAX = 150;
const inFlight = new Map<string, Promise<unknown[]>>();
const resolved = new Map<string, unknown[]>();

/** Sync peek: returns the cached rows for `sql` if they're already resolved. */
export function peekQuery<T = Record<string, unknown>>(
  sql: string
): T[] | undefined {
  const hit = resolved.get(sql);
  if (hit === undefined) return undefined;
  // LRU touch
  resolved.delete(sql);
  resolved.set(sql, hit);
  return hit as T[];
}

function rememberResult(sql: string, rows: unknown[]) {
  resolved.set(sql, rows);
  if (resolved.size > CACHE_MAX) {
    const oldest = resolved.keys().next().value;
    if (oldest !== undefined && oldest !== sql) resolved.delete(oldest);
  }
}

/** Drop every cached query — useful when underlying parquet files change. */
export function invalidateQueryCache() {
  inFlight.clear();
  resolved.clear();
}

/**
 * Run a SQL query and return rows as plain JS objects. Results are cached in
 * memory; identical SQL strings reuse the previous result (and a concurrent
 * second call piggybacks on the in-flight Promise of the first).
 *
 * BIGINT columns come back as JS `BigInt`, which trips up most charting
 * libraries (Math.max, JSON.stringify, etc.). Counts and IDs we actually
 * traffic in fit comfortably in a Number, so we down-cast bigints unless
 * they exceed Number.MAX_SAFE_INTEGER (in which case we leave them alone
 * and let the caller decide).
 */
export async function runQuery<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const cached = resolved.get(sql);
  if (cached !== undefined) {
    // LRU touch
    resolved.delete(sql);
    resolved.set(sql, cached);
    return cached as T[];
  }
  let pending = inFlight.get(sql);
  if (!pending) {
    pending = (async () => {
      const conn = await getConn();
      const result = await conn.query(sql);
      return result.toArray().map((r) => coerceBigints(r.toJSON()));
    })();
    inFlight.set(sql, pending);
    pending.then(
      (rows) => {
        rememberResult(sql, rows);
        inFlight.delete(sql);
      },
      () => {
        // Don't poison the cache on error — let the next call retry.
        inFlight.delete(sql);
      }
    );
  }
  return pending as Promise<T[]>;
}

function coerceBigints<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") {
      out[k] = v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
