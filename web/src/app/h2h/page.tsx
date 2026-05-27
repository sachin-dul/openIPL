import { Suspense } from "react";
import { H2HContent } from "./h2h-content";

export default function H2HPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-12 text-zinc-500 text-sm text-center">
          Loading…
        </div>
      }
    >
      <H2HContent />
    </Suspense>
  );
}
