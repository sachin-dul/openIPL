"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePlayerNames } from "@/lib/player-names";

type Props = {
  /** Canonical player key — the value used in URLs and parquet joins. */
  name: string | null | undefined;
  /** Override label. Defaults to the resolved display name. */
  children?: ReactNode;
  className?: string;
  title?: string;
  /** Inline span used to keep the link inside a parent that controls layout. */
  inline?: boolean;
};

/**
 * Wraps a player name in a Next link to its profile page. Resolves the
 * canonical key to its display name through usePlayerNames so callers can
 * pass the raw cricsheet key without worrying about the rendered label.
 */
export function PlayerLink({
  name,
  children,
  className,
  title,
  inline,
}: Props) {
  const { resolve } = usePlayerNames();
  if (!name) {
    return <span className={className}>{children ?? "—"}</span>;
  }
  const label = children ?? resolve(name);
  const cls = className ?? "hover:text-ipl-accent";
  return (
    <Link
      href={`/player/${encodeURIComponent(name)}`}
      className={cls}
      title={title}
      style={inline ? { display: "inline" } : undefined}
    >
      {label}
    </Link>
  );
}
