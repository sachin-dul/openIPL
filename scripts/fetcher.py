"""
Cricsheet data fetcher for IPL matches.

Two modes:
  - Full:        Downloads ipl_json.zip, extracts all matches for the target season.
  - Incremental: Downloads recently_added_2_json.zip (last 2 days, tiny),
                 extracts only new IPL matches not yet in the local cache.

Usage:
    # First run — full download
    python fetcher.py --season 2026 --mode full

    # Daily updates — incremental
    python fetcher.py --season 2026 --mode incremental

    # Auto — full if no local cache, incremental otherwise
    python fetcher.py --season 2026
"""

import argparse
import io
import json
import os
import sys
import zipfile

import requests

CRICSHEET_BASE = "https://cricsheet.org/downloads"
IPL_ZIP_URL = f"{CRICSHEET_BASE}/ipl_json.zip"
RECENT_ZIP_URL = f"{CRICSHEET_BASE}/recently_added_7_json.zip"


def download_zip(url):
    """Download a zip file and return it as a ZipFile object."""
    print(f"Downloading {url} ...")
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    size_mb = len(resp.content) / (1024 * 1024)
    print(f"  Downloaded {size_mb:.1f} MB")
    return zipfile.ZipFile(io.BytesIO(resp.content))


def extract_ipl_season_matches(zf, season, output_dir):
    """Extract IPL matches for a specific season from a zip file.

    Returns list of (match_id, filepath) for newly extracted files.
    """
    season_str = str(season)
    extracted = []

    for name in zf.namelist():
        if not name.endswith(".json"):
            continue

        # Read and check if it's our season
        try:
            data = json.loads(zf.read(name))
        except (json.JSONDecodeError, KeyError):
            continue

        info = data.get("info", {})
        event = info.get("event", {})
        event_name = event.get("name", "")

        # Must be IPL and correct season
        if "Indian Premier League" not in event_name:
            continue
        if str(info.get("season", "")) != season_str:
            continue

        # Extract match ID from filename
        match_id = os.path.splitext(os.path.basename(name))[0]
        out_path = os.path.join(output_dir, f"{match_id}.json")

        # Skip if already exists
        if os.path.exists(out_path):
            continue

        # Atomic write: tmp file + rename, so a kill mid-write doesn't leave a
        # truncated cache file that future runs would silently treat as valid.
        tmp_path = out_path + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, out_path)

        extracted.append((match_id, out_path))

    return extracted


def fetch(season, mode="auto", cache_dir=None):
    """Fetch IPL match data from Cricsheet.

    Args:
        season: IPL season year (e.g., 2026)
        mode: 'full', 'incremental', or 'auto'
        cache_dir: Directory to store raw JSON files

    Returns:
        cache_dir path
    """
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if cache_dir is None:
        cache_dir = os.path.join(repo_root, ".cricsheet_cache", str(season))
    os.makedirs(cache_dir, exist_ok=True)

    # Decide mode
    existing = [f for f in os.listdir(cache_dir) if f.endswith(".json")]
    if mode == "auto":
        mode = "incremental" if existing else "full"
        print(f"Auto mode: {'incremental' if existing else 'full'} ({len(existing)} cached files)")

    if mode == "full":
        print(f"Full download — fetching all IPL matches...")
        zf = download_zip(IPL_ZIP_URL)
        extracted = extract_ipl_season_matches(zf, season, cache_dir)
        print(f"  Extracted {len(extracted)} new matches for IPL {season}")
    else:
        print(f"Incremental — fetching recently added matches (last 7 days)...")
        zf = download_zip(RECENT_ZIP_URL)
        extracted = extract_ipl_season_matches(zf, season, cache_dir)
        if extracted:
            print(f"  Found {len(extracted)} new IPL {season} matches:")
            for mid, path in extracted:
                print(f"    {mid}")
        else:
            print(f"  No new IPL {season} matches in recent additions")

    total = len([f for f in os.listdir(cache_dir) if f.endswith(".json")])
    print(f"\nTotal cached: {total} matches for IPL {season}")
    return cache_dir


def main():
    p = argparse.ArgumentParser(description="Fetch IPL data from Cricsheet")
    p.add_argument("--season", required=True, help="IPL season (e.g., 2026)")
    p.add_argument("--mode", choices=["full", "incremental", "auto"], default="auto",
                   help="Download mode (default: auto)")
    p.add_argument("--cache-dir", default=None, help="Override cache directory")
    args = p.parse_args()

    fetch(args.season, args.mode, args.cache_dir)


if __name__ == "__main__":
    main()
