import { Suspense } from "react";
import { MatchupContent } from "./matchup-content";

export default function MatchupPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-12 text-zinc-500 text-sm text-center">
          Loading…
        </div>
      }
    >
      <MatchupContent />
    </Suspense>
  );
}
