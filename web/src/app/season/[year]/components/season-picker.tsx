"use client";

import { usePathname, useRouter } from "next/navigation";

type Props = {
  current: number;
  seasons: readonly number[];
};

export function SeasonPicker({ current, seasons }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newYear = e.target.value;
    // Swap the year segment (/season/2024/...) keeping the rest of the path.
    const next = pathname.replace(/^\/season\/\d+/, `/season/${newYear}`);
    router.push(next);
  }

  return (
    <label className="flex items-center gap-2 text-sm text-zinc-600">
      <span className="hidden sm:inline">Season</span>
      <select
        value={current}
        onChange={onChange}
        className="border border-zinc-300 rounded-md px-2 py-1 bg-white text-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
      >
        {[...seasons].reverse().map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}
