"use client";

import { useEffect, useState } from "react";
import { runQuery } from "./db";

export type DuckQueryState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: T[]; error: null }
  | { status: "error"; data: null; error: Error };

/**
 * Run a SQL query against the in-browser DuckDB-WASM instance.
 * Re-runs whenever `sql` changes. Cancellation is handled via a stale flag
 * so a slow query overtaken by a new one can't write a stale result.
 */
export function useDuckQuery<T = Record<string, unknown>>(
  sql: string
): DuckQueryState<T> {
  const [state, setState] = useState<DuckQueryState<T>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, error: null });

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
  }, [sql]);

  return state;
}
