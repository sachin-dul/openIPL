import { BattingContent } from "./batting-content";

export default async function BattingPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  return <BattingContent year={Number(year)} />;
}
