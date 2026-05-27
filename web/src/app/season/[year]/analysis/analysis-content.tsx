"use client";

import { PageHead } from "@/components/page-head";
import { StandingsProgression } from "./charts/standings-progression";
import { TeamRadar } from "./charts/team-radar";
import { TeamDnaHeatmap } from "./charts/team-dna-heatmap";
import { TeamPhaseComparison } from "./charts/team-phase-comparison";
import { RunsPerOverInnings } from "./charts/runs-per-over-innings";
import { EconVsAvg } from "./charts/econ-vs-avg";
import { VenuePerformance } from "./charts/venue-performance";
import { TossDecisions } from "./charts/toss-decisions";
import { TossEqualsMatchWin } from "./charts/toss-equals-match-win";
import { HomeVsAwayOverall } from "./charts/home-vs-away-overall";
import { HomeAdvantageByTeam } from "./charts/home-advantage-by-team";
import { DrsReviews } from "./charts/drs-reviews";
import { ImpactPlayerSubs } from "./charts/impact-player-subs";

export function AnalysisContent({ year }: { year: number }) {
  return (
    <div>
      <PageHead title={`IPL ${year}`} sub="Season analysis" />

      <StandingsProgression year={year} />

      <div className="mt-3.5 grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <TeamRadar year={year} />
        <RunsPerOverInnings year={year} />
      </div>

      <div className="mt-3.5">
        <TeamDnaHeatmap year={year} />
      </div>

      <div className="mt-3.5">
        <TeamPhaseComparison year={year} />
      </div>

      <div className="mt-3.5">
        <EconVsAvg year={year} />
      </div>

      <div className="mt-3.5">
        <VenuePerformance year={year} />
      </div>

      <div className="mt-3.5 grid grid-cols-1 lg:grid-cols-3 gap-3.5 items-start">
        <TossDecisions year={year} />
        <TossEqualsMatchWin year={year} />
        <HomeVsAwayOverall year={year} />
      </div>

      <div className="mt-3.5">
        <HomeAdvantageByTeam year={year} />
      </div>

      <div className="mt-3.5">
        <DrsReviews year={year} />
      </div>

      <div className="mt-3.5">
        <ImpactPlayerSubs year={year} />
      </div>
    </div>
  );
}
