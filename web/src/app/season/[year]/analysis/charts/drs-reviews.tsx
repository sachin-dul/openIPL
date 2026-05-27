"use client";

import { useMemo, useState } from "react";
import { useDuckQuery } from "@/lib/use-duck-query";
import { teamShort } from "@/lib/teams";
import {
  Card,
  Loading,
  Empty,
  ErrorBox,
  DRS_COLORS,
  DRS_OUTCOMES,
  type DrsOutcome,
} from "./chart-shell";

type Row = {
  subject: string;
  outcome: DrsOutcome;
  n: number;
};

type Mode = "team" | "umpire";

const MIN_UMPIRE_REVIEWS = 2;
const UMPIRES_PER_PAGE = 8;

export function DrsReviews({ year }: { year: number }) {
  const teamState = useDuckQuery<Row>(
    `SELECT team AS subject, outcome, CAST(COUNT(*) AS BIGINT) AS n
     FROM (
       SELECT team,
              CASE WHEN LOWER(decision) = 'upheld' THEN 'Overturned'
                   WHEN umpires_call = TRUE THEN 'Umpire''s Call'
                   ELSE 'On-field Stood' END AS outcome
       FROM reviews WHERE season = ${year} AND team IS NOT NULL
     )
     GROUP BY team, outcome`
  );

  const umpireState = useDuckQuery<Row>(
    `WITH eligible AS (
       SELECT umpire FROM reviews
       WHERE season = ${year} AND umpire IS NOT NULL
       GROUP BY umpire HAVING COUNT(*) >= ${MIN_UMPIRE_REVIEWS}
     )
     SELECT umpire AS subject, outcome, CAST(COUNT(*) AS BIGINT) AS n
     FROM (
       SELECT umpire,
              CASE WHEN LOWER(decision) = 'upheld' THEN 'Overturned'
                   WHEN umpires_call = TRUE THEN 'Umpire''s Call'
                   ELSE 'On-field Stood' END AS outcome
       FROM reviews
       WHERE season = ${year} AND umpire IN (SELECT umpire FROM eligible)
     )
     GROUP BY umpire, outcome`
  );

  const teams = useMemo(
    () => (teamState.status === "success" ? aggregate(teamState.data, "team") : []),
    [teamState]
  );
  const umpires = useMemo(
    () =>
      umpireState.status === "success" ? aggregate(umpireState.data, "umpire") : [],
    [umpireState]
  );

  const loading = teamState.status === "loading" || umpireState.status === "loading";
  const error =
    teamState.status === "error"
      ? teamState.error.message
      : umpireState.status === "error"
        ? umpireState.error.message
        : null;

  return (
    <Card title="DRS Reviews">
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && teams.length === 0 && umpires.length === 0 && (
        <Empty message="No DRS reviews recorded this season." />
      )}
      {!loading && !error && (teams.length > 0 || umpires.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-x-6 gap-y-6">
          <Panel
            heading="By team"
            count={teams.length}
            footnote="Sorted by Overturned % (higher = challenges paid off)."
            subjects={teams}
            mode="team"
            empty="No team reviews recorded this season."
          />
          <div
            className="hidden lg:block bg-ipl-line2"
            aria-hidden="true"
          />
          <PagedPanel
            heading="By umpire"
            footnote={`Sorted by Upheld % — Stood + Umpire's Call (higher = on-field calls held up); min ${MIN_UMPIRE_REVIEWS} reviews per umpire.`}
            subjects={umpires}
            mode="umpire"
            empty={`No umpires with ≥ ${MIN_UMPIRE_REVIEWS} reviews this season.`}
            pageSize={UMPIRES_PER_PAGE}
          />
        </div>
      )}
    </Card>
  );
}

function colorFor(outcome: DrsOutcome, mode: Mode): string {
  if (mode === "umpire") {
    if (outcome === "Overturned") return DRS_COLORS["On-field Stood"];
    if (outcome === "On-field Stood") return DRS_COLORS["Overturned"];
  }
  return DRS_COLORS[outcome];
}

function PanelLegend({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mb-3">
      {DRS_OUTCOMES.map((o) => (
        <span key={o} className="inline-flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-sm"
            style={{ background: colorFor(o, mode) }}
          />
          <span className="text-ipl-ink">{o}</span>
        </span>
      ))}
    </div>
  );
}

function Panel({
  heading,
  count,
  footnote,
  subjects,
  mode,
  empty,
}: {
  heading: string;
  count: number;
  footnote: string;
  subjects: Aggregated[];
  mode: Mode;
  empty: string;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 h-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ipl-sub">
          {heading}
          {count > 0 && (
            <span className="text-ipl-soft font-normal normal-case tracking-normal ml-2">
              ({count})
            </span>
          )}
        </h3>
      </div>
      <PanelLegend mode={mode} />
      {subjects.length === 0 ? (
        <p className="text-sm text-ipl-sub flex-1">{empty}</p>
      ) : (
        <div className="space-y-1.5 flex-1">
          {subjects.map((s) => (
            <DrsRow key={s.subject} mode={mode} subject={s} />
          ))}
        </div>
      )}
      <p className="text-xs text-ipl-sub mt-4">{footnote}</p>
    </div>
  );
}

function PagedPanel({
  heading,
  footnote,
  subjects,
  mode,
  empty,
  pageSize,
}: {
  heading: string;
  footnote: string;
  subjects: Aggregated[];
  mode: Mode;
  empty: string;
  pageSize: number;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(subjects.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * pageSize;
  const slice = subjects.slice(start, start + pageSize);
  const showPager = subjects.length > pageSize;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 h-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ipl-sub">
          {heading}
          {subjects.length > 0 && (
            <span className="text-ipl-soft font-normal normal-case tracking-normal ml-2">
              ({subjects.length})
            </span>
          )}
        </h3>
        {showPager && (
          <Pager
            page={clampedPage}
            totalPages={totalPages}
            onPrev={() => setPage(Math.max(0, clampedPage - 1))}
            onNext={() => setPage(Math.min(totalPages - 1, clampedPage + 1))}
          />
        )}
      </div>
      <PanelLegend mode={mode} />
      {subjects.length === 0 ? (
        <p className="text-sm text-ipl-sub flex-1">{empty}</p>
      ) : (
        <div className="space-y-1.5 flex-1">
          {slice.map((s) => (
            <DrsRow key={s.subject} mode={mode} subject={s} />
          ))}
        </div>
      )}
      <p className="text-xs text-ipl-sub mt-4">{footnote}</p>
    </div>
  );
}

function Pager({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 0}
        className="w-6 h-6 inline-flex items-center justify-center rounded border border-ipl-line text-ipl-sub hover:bg-ipl-line2/30 disabled:opacity-40 disabled:cursor-default"
        aria-label="Previous page"
      >
        ‹
      </button>
      <span className="text-ipl-sub tabular-nums px-1.5">
        {page + 1}/{totalPages}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages - 1}
        className="w-6 h-6 inline-flex items-center justify-center rounded border border-ipl-line text-ipl-sub hover:bg-ipl-line2/30 disabled:opacity-40 disabled:cursor-default"
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}

type Aggregated = {
  subject: string;
  counts: Record<DrsOutcome, number>;
  total: number;
  rate: number; // overturned% (team) or upheld% (umpire)
};

function aggregate(rows: Row[], mode: Mode): Aggregated[] {
  const map = new Map<string, Aggregated>();
  for (const r of rows) {
    if (!map.has(r.subject)) {
      map.set(r.subject, {
        subject: r.subject,
        counts: { Overturned: 0, "Umpire's Call": 0, "On-field Stood": 0 },
        total: 0,
        rate: 0,
      });
    }
    const a = map.get(r.subject)!;
    a.counts[r.outcome] = (a.counts[r.outcome] ?? 0) + r.n;
    a.total += r.n;
  }
  for (const a of map.values()) {
    if (mode === "team") {
      a.rate = a.total > 0 ? (a.counts.Overturned / a.total) * 100 : 0;
    } else {
      a.rate =
        a.total > 0
          ? ((a.counts["On-field Stood"] + a.counts["Umpire's Call"]) / a.total) * 100
          : 0;
    }
  }
  return [...map.values()]
    .filter((a) => a.total > 0)
    .sort((a, b) => {
      if (a.rate !== b.rate) return b.rate - a.rate;
      return b.total - a.total;
    });
}

function DrsRow({ mode, subject }: { mode: Mode; subject: Aggregated }) {
  const cells: { color: string; outcome: DrsOutcome }[] = [];
  for (const o of DRS_OUTCOMES) {
    for (let i = 0; i < subject.counts[o]; i += 1) {
      cells.push({ color: colorFor(o, mode), outcome: o });
    }
  }
  return (
    <div className="grid grid-cols-[90px_1fr_auto] items-center gap-2 h-7">
      <span
        className="text-xs text-ipl-ink truncate"
        title={mode === "team" ? subject.subject : undefined}
      >
        {mode === "team" ? teamShort(subject.subject) : subject.subject}
      </span>
      <div className="flex flex-wrap gap-[2px]">
        {cells.map((c, i) => (
          <span
            key={i}
            className="block w-3 h-3 rounded-sm"
            style={{ background: c.color }}
            title={c.outcome}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums whitespace-nowrap">
        <span className="font-semibold text-ipl-ink">
          {Math.round(subject.rate)}%
        </span>
      </span>
    </div>
  );
}
