"use client";

import { useDuckQuery } from "@/lib/use-duck-query";
import { Card, DonutWithLegend, type Slice } from "./chart-shell";

type Row = { decision: string; n: number };

export function TossDecisions({ year }: { year: number }) {
  const state = useDuckQuery<Row>(
    `SELECT toss_decision AS decision, CAST(COUNT(*) AS BIGINT) AS n
     FROM matches
     WHERE season = ${year}
       AND COALESCE(result, '') != 'no result'
       AND toss_decision IS NOT NULL
     GROUP BY toss_decision`
  );

  const rows = state.status === "success" ? state.data : [];
  const totalN = rows.reduce((a, r) => a + r.n, 0);
  const bat = rows.find((r) => r.decision === "bat")?.n ?? 0;
  const field = rows.find((r) => r.decision === "field")?.n ?? 0;
  const C_BAT = "#f59e0b";
  const C_FIELD = "#0ea5e9";

  const slices: Slice[] = [
    { label: "Chose to bat", value: bat, color: C_BAT },
    { label: "Chose to field", value: field, color: C_FIELD },
  ];
  const batPct = totalN > 0 ? Math.round((bat / totalN) * 100) : 0;
  const fieldPct = totalN > 0 ? 100 - batPct : 0;

  return (
    <Card title="Toss Decisions">
      <DonutWithLegend
        slices={slices}
        total={totalN}
        totalLabel="tosses"
        legend={[
          { color: C_BAT, label: "Chose to bat", value: bat, pct: batPct },
          { color: C_FIELD, label: "Chose to field", value: field, pct: fieldPct },
        ]}
        loading={state.status === "loading"}
        error={state.status === "error" ? state.error.message : null}
        empty={state.status === "success" && totalN === 0}
      />
    </Card>
  );
}
