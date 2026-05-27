import { SiteHeader } from "@/components/site-header";

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="max-w-[1320px] mx-auto px-6 py-5 w-full">{children}</main>
    </>
  );
}
