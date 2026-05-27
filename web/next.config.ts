import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Parquet files are content-stable between deploys (rebuilt by the
        // ETL pipeline). DuckDB-WASM hits these via HTTP range requests, so
        // every uncached fetch pays a server round-trip. In prod we cache
        // aggressively. In dev we frequently rebuild parquets and adding
        // columns is a silent failure mode — the browser serves the stale
        // schema and any query referencing a new column errors out. Disable
        // the cache here so a normal refresh always re-reads the file.
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isDev
              ? "no-store"
              : "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
