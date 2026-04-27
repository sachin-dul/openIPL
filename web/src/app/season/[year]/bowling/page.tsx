import { BowlingContent } from "./_bowling-content";

export default async function BowlingPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  return <BowlingContent year={Number(year)} />;
}
