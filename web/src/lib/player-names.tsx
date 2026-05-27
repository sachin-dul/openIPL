"use client";

import { useEffect, useState } from "react";
import { runQuery } from "./db";

type NameMap = Map<string, string>;

let cachePromise: Promise<NameMap> | null = null;
let globalMap: NameMap | null = null;
const subscribers = new Set<() => void>();

function ensureLoaded(): void {
  if (cachePromise) return;
  type Row = {
    registry_name: string;
    unique_name: string | null;
    display_name: string;
  };
  cachePromise = runQuery<Row>(
    "SELECT registry_name, unique_name, display_name FROM players_meta"
  ).then((rows) => {
    const m: NameMap = new Map();
    for (const r of rows) {
      if (r.registry_name) m.set(r.registry_name, r.display_name);
      if (r.unique_name && r.unique_name !== r.registry_name) {
        m.set(r.unique_name, r.display_name);
      }
    }
    globalMap = m;
    for (const cb of subscribers) cb();
    return m;
  });
}

/**
 * Returns a synchronous resolver that maps a raw Cricsheet short name
 * ("MS Dhoni") to its display name ("Mahendra Singh Dhoni"). While the
 * lookup table is still loading the resolver returns the raw name, then
 * re-renders the subscribing component once data is ready.
 */
export function usePlayerNames(): {
  resolve: (raw: string | null | undefined) => string;
  ready: boolean;
} {
  const [, force] = useState(0);

  useEffect(() => {
    ensureLoaded();
    if (globalMap) return;
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  return {
    ready: globalMap != null,
    resolve: (raw) => {
      if (!raw) return "";
      return globalMap?.get(raw) ?? raw;
    },
  };
}
