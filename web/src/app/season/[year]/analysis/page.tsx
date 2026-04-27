import { AnalysisContent } from "./_analysis-content";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  return <AnalysisContent year={Number(year)} />;
}
