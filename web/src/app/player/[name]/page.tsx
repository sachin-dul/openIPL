import { PlayerContent } from "./player-content";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return <PlayerContent name={decodeURIComponent(name)} />;
}
