/**
 * DuckDB-WASM singleton + query runner.
 *
 * Lazy-initializes a single AsyncDuckDB instance on first use, registers each
 * Parquet file under /data/ as a SQL view named after the file (matches.parquet
 * → view `matches`), and exposes `runQuery<T>(sql)` for React components.
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
] as const;

export type TableName = (typeof TABLES)[number];

let _dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

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

  await Promise.all(
    TABLES.map((t) =>
      db.registerFileURL(
        `${t}.parquet`,
        `${baseUrl}/data/${t}.parquet`,
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
        `CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${baseUrl}/data/${t}.parquet')`
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
  if (!_dbPromise) {
    _dbPromise = initDb();
  }
  return _dbPromise;
}

/**
 * Run a SQL query and return rows as plain JS objects.
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
  const db = await getDb();
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    return result.toArray().map((r) => coerceBigints(r.toJSON())) as T[];
  } finally {
    await conn.close();
  }
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
