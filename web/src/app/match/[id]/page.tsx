import { MatchContent } from "./match-content";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MatchContent rawId={id} />;
}
