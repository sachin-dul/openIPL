"use client";

import { useEffect, useRef, useState } from "react";
import { peekQuery, runQuery } from "./db";

export type DuckQueryState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: T[]; error: null }
  | { status: "error"; data: null; error: Error };

function successFromCache<T>(sql: string): DuckQueryState<T> | null {
  const cached = peekQuery<T>(sql);
  return cached ? { status: "success", data: cached, error: null } : null;
}

/**
 * Run a SQL query against the in-browser DuckDB-WASM instance.
 * Re-runs whenever `sql` changes. If the SQL is already in the module-level
 * result cache the state is seeded synchronously to "success" so the consumer
 * never sees a loading flash on cached navigations. Stale results are guarded
 * by a cancellation flag.
 */
export function useDuckQuery<T = Record<string, unknown>>(
  sql: string
): DuckQueryState<T> {
  const [state, setState] = useState<DuckQueryState<T>>(
    () =>
      successFromCache<T>(sql) ?? {
        status: "loading",
        data: null,
        error: null,
      }
  );

  // Track which SQL the current state was produced for so SQL changes that
  // happen to also hit the cache update the state in place without flashing
  // through "loading".
  const lastSqlRef = useRef(sql);

  useEffect(() => {
    let cancelled = false;

    const cached = successFromCache<T>(sql);
    if (cached) {
      if (lastSqlRef.current !== sql || state.status !== "success") {
        setState(cached);
        lastSqlRef.current = sql;
      }
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading", data: null, error: null });
    lastSqlRef.current = sql;

    runQuery<T>(sql)
      .then((data) => {
        if (!cancelled) setState({ status: "success", data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
      });

    return () => {
      cancelled = true;
    };
    // We intentionally don't include `state.status` — re-running on every
    // status transition would loop. The ref + initial check handle cache hits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql]);

  return state;
}
