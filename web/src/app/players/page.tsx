import { Suspense } from "react";
import { PlayersContent } from "./players-content";

export default function PlayersPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-ipl-sub text-sm">Loading…</div>}>
      <PlayersContent />
    </Suspense>
  );
}
