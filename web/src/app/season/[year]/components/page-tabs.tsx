"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { slug: string; label: string };

type Props = {
  year: number;
  tabs: readonly Tab[];
};

export function PageTabs({ year, tabs }: Props) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {tabs.map((t) => {
        const href = `/season/${year}/${t.slug}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={t.slug}
            href={href}
            className={
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors " +
              (active
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
