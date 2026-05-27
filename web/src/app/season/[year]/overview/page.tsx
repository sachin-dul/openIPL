import { OverviewContent } from "./overview-content";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  return <OverviewContent year={Number(year)} />;
}
