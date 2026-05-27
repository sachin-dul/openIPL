"""
Normalize player names using Cricsheet's public register + Wikidata + a small
manual override CSV.

Pipeline (each step independent / cached / re-runnable):

  1. Fetch https://cricsheet.org/register/people.csv (~1 MB) and join on
     cricsheet_id to get Cricsheet's disambiguated `unique_name` and the
     external IDs (ESPNcricinfo, BCCI, Cricbuzz).
  2. For every cricinfo ID, batch-query Wikidata SPARQL (P2697 — ESPNcricinfo.com
     player ID) for the English Wikipedia label and `P1477` birth name. Prefer
     label, else Latin birth name, else None. Cached to data/wikidata_cache.json.
  3. Apply manual overrides from data/player_aliases.csv (cricsheet_id, full_name)
     — last write wins.

Outputs:

  data/people.csv               # raw cache of the Cricsheet register
  data/wikidata_cache.json      # raw cache of Wikidata results
  data/players_meta.csv         # joined output
  data/aggregated/players_meta.parquet  # parquet copy for the web app

`display_name` resolution order (in code):
  manual override > wikidata full_name > cricsheet unique_name > registry name

Usage:
    python scripts/normalize_players.py
    python scripts/normalize_players.py --refresh         # re-download people.csv
    python scripts/normalize_players.py --skip-wikidata   # join Cricsheet only
    python scripts/normalize_players.py --refresh-wikidata  # ignore SPARQL cache
"""

import argparse
import csv
import json
import re
import shutil
import sys
import time
from pathlib import Path

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PEOPLE_URL = "https://cricsheet.org/register/people.csv"
PEOPLE_CACHE = DATA_DIR / "people.csv"
WIKIDATA_CACHE = DATA_DIR / "wikidata_cache.json"
WIKIDATA_NATIONALITY_CACHE = DATA_DIR / "wikidata_nationality_cache.json"
WIKIDATA_BIRTH_CACHE = DATA_DIR / "wikidata_birth_country_cache.json"
WIKIPEDIA_CACHE = DATA_DIR / "wikipedia_cache.json"
ALIASES_CSV = DATA_DIR / "player_aliases.csv"
COUNTRY_OVERRIDES_CSV = DATA_DIR / "player_country_overrides.csv"
INDIA_QID = "Q668"

# Cricket-context country grouping: collapse historical Indian states into
# "India", every Caribbean cricket nation into "West Indies", and relabel
# the UK as "England" (cricket convention). Sovereign cricket nations pass
# through. Outliers (e.g. Q45 Portugal — one ancestry edge case) keep their
# own row so they're still surfacable rather than silently miscategorised.
QID_TO_COUNTRY = {
    # India proper + pre-independence states
    "Q668":     "India",
    "Q129286":  "India",  # British Raj
    "Q1775277": "India",  # Dominion of India
    # England (UK in Wikidata; cricketers play for England)
    "Q145":     "England",
    # West Indies (every Caribbean cricket member)
    "Q244":     "West Indies",  # Barbados
    "Q734":     "West Indies",  # Guyana
    "Q766":     "West Indies",  # Jamaica
    "Q754":     "West Indies",  # Trinidad and Tobago
    "Q760":     "West Indies",  # Saint Lucia
    "Q781":     "West Indies",  # Antigua and Barbuda
    "Q784":     "West Indies",  # Dominica
    # Sovereign cricket nations — pass through
    "Q408":     "Australia",
    "Q258":     "South Africa",
    "Q664":     "New Zealand",
    "Q854":     "Sri Lanka",
    "Q843":     "Pakistan",
    "Q889":     "Afghanistan",
    "Q902":     "Bangladesh",
    "Q954":     "Zimbabwe",
    "Q1030":    "Namibia",
    "Q114":     "Kenya",
    "Q837":     "Nepal",
    "Q833":     "Malaysia",
    # Ireland (Wikipedia-only path — Wikidata P27 didn't surface any IPL
    # Irish player, but Joshua Little's enwiki infobox declares Ireland)
    "Q27":      "Ireland",
    "Q22890":   "Ireland",  # Republic of Ireland (alternative QID some pages use)
    # Outliers (single-player edge cases)
    "Q45":      "Portugal",
}
SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
SPARQL_USER_AGENT = "openIPL-name-normalizer/1.0 (https://github.com/sachinmb/openIPL; mbsachin97@gmail.com)"
SPARQL_BATCH_SIZE = 400
WBGETENTITIES_BATCH_SIZE = 50
WIKIPEDIA_SLEEP = 0.25


def fetch_people(refresh: bool) -> Path:
    if PEOPLE_CACHE.exists() and not refresh:
        print(f"Using cached {PEOPLE_CACHE} ({PEOPLE_CACHE.stat().st_size/1024:.0f} KB)")
        return PEOPLE_CACHE
    print(f"Downloading {PEOPLE_URL} ...")
    resp = requests.get(PEOPLE_URL, timeout=60)
    resp.raise_for_status()
    PEOPLE_CACHE.write_bytes(resp.content)
    print(f"  Wrote {PEOPLE_CACHE} ({len(resp.content)/1024:.0f} KB)")
    return PEOPLE_CACHE


def load_all_registries() -> pd.DataFrame:
    """Union every data/<season>/player_registry.csv and tag with seasons seen."""
    rows = {}  # cricsheet_id -> {"player": str, "seasons": set[int]}
    for season_dir in sorted(DATA_DIR.iterdir()):
        if not season_dir.is_dir() or not season_dir.name.isdigit():
            continue
        path = season_dir / "player_registry.csv"
        if not path.exists():
            continue
        season = int(season_dir.name)
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                cid = r.get("cricsheet_id") or ""
                if not cid:
                    continue
                if cid not in rows:
                    rows[cid] = {"player": r["player"], "seasons": set()}
                rows[cid]["seasons"].add(season)
    return pd.DataFrame(
        [
            {
                "cricsheet_id": cid,
                "registry_name": v["player"],
                "first_season": min(v["seasons"]),
                "last_season": max(v["seasons"]),
                "season_count": len(v["seasons"]),
            }
            for cid, v in rows.items()
        ]
    )


def join_cricsheet(registry: pd.DataFrame, people_path: Path) -> pd.DataFrame:
    people = pd.read_csv(
        people_path,
        usecols=[
            "identifier", "name", "unique_name",
            "key_cricinfo", "key_cricbuzz", "key_bcci",
        ],
        dtype=str,
    )
    people = people.rename(columns={"identifier": "cricsheet_id", "name": "cricsheet_name"})
    return registry.merge(people, on="cricsheet_id", how="left")


def load_wikidata_cache() -> dict:
    if WIKIDATA_CACHE.exists():
        return json.loads(WIKIDATA_CACHE.read_text())
    return {}


def save_wikidata_cache(cache: dict):
    WIKIDATA_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True))


def sparql_query(cricinfo_ids: list[str]) -> dict[str, dict]:
    """Query Wikidata for a batch of ESPNcricinfo IDs (P2697)."""
    values = " ".join(f'"{cid}"' for cid in cricinfo_ids)
    query = f"""
      SELECT ?cricinfoId ?person ?personLabel ?birthName WHERE {{
        VALUES ?cricinfoId {{ {values} }}
        ?person wdt:P2697 ?cricinfoId .
        OPTIONAL {{ ?person wdt:P1477 ?birthName . }}
        SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
      }}
    """
    resp = requests.post(
        SPARQL_ENDPOINT,
        data={"query": query, "format": "json"},
        headers={"User-Agent": SPARQL_USER_AGENT, "Accept": "application/sparql-results+json"},
        timeout=90,
    )
    resp.raise_for_status()
    results = {}
    for binding in resp.json()["results"]["bindings"]:
        cid = binding["cricinfoId"]["value"]
        # Prefer English birth name if it looks Latin; else fall back to label.
        birth = binding.get("birthName", {}).get("value")
        label = binding.get("personLabel", {}).get("value")
        results[cid] = {
            "wikidata_id": binding["person"]["value"].rsplit("/", 1)[-1],
            "label": label,
            "birth_name": birth,
        }
    return results


def enrich_wikidata(merged: pd.DataFrame, refresh_cache: bool) -> pd.DataFrame:
    cache = {} if refresh_cache else load_wikidata_cache()
    # Identify cricinfo IDs we haven't queried yet (or refresh-all).
    have_cricinfo = merged[merged["key_cricinfo"].notna()]["key_cricinfo"].unique().tolist()
    to_query = [cid for cid in have_cricinfo if cid not in cache]
    print(f"Wikidata: {len(have_cricinfo)} players have cricinfo IDs, "
          f"{len(cache)} cached, {len(to_query)} to query")

    for i in range(0, len(to_query), SPARQL_BATCH_SIZE):
        batch = to_query[i : i + SPARQL_BATCH_SIZE]
        print(f"  batch {i // SPARQL_BATCH_SIZE + 1}/"
              f"{(len(to_query) + SPARQL_BATCH_SIZE - 1) // SPARQL_BATCH_SIZE} "
              f"({len(batch)} ids) ...", end=" ", flush=True)
        try:
            results = sparql_query(batch)
        except Exception as e:
            print(f"FAILED ({e}) — keeping prior cache, stopping batch loop")
            break
        # Record hits AND misses (so we don't re-query missing entities).
        hits = 0
        for cid in batch:
            if cid in results:
                cache[cid] = results[cid]
                hits += 1
            else:
                cache[cid] = {"wikidata_id": None, "label": None, "birth_name": None}
        print(f"hits {hits}/{len(batch)}")
        save_wikidata_cache(cache)
        time.sleep(1.0)

    # Pick the best name for each cricinfo ID from the cache.
    # Wikidata's English label tends to be the Wikipedia article title
    # (e.g. "Mahendra Singh Dhoni", "Virat Kohli") — prefer it.
    def best(cricinfo_id):
        if not isinstance(cricinfo_id, str):
            return None, None, None
        entry = cache.get(cricinfo_id)
        if not entry:
            return None, None, None
        label = entry.get("label")
        birth = entry.get("birth_name")
        # Reject the label if it's the QID fallback (e.g. "Q470774") which means
        # the entity has no English label.
        is_qid_fallback = (
            isinstance(label, str)
            and label.startswith("Q")
            and label[1:].isdigit()
        )
        if label and not is_qid_fallback and any("a" <= c.lower() <= "z" for c in label):
            return label, "wikidata:label", entry.get("wikidata_id")
        if birth and any("a" <= c.lower() <= "z" for c in birth):
            return birth, "wikidata:birth_name", entry.get("wikidata_id")
        return None, None, entry.get("wikidata_id")

    triples = merged["key_cricinfo"].map(best)
    merged["full_name"] = [t[0] for t in triples]
    merged["full_name_source"] = [t[1] for t in triples]
    merged["wikidata_id"] = [t[2] for t in triples]
    return merged


def load_wikipedia_cache() -> dict:
    if WIKIPEDIA_CACHE.exists():
        return json.loads(WIKIPEDIA_CACHE.read_text())
    return {}


def save_wikipedia_cache(cache: dict):
    WIKIPEDIA_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True))


def fetch_enwiki_titles(qids: list[str]) -> dict[str, str | None]:
    """Map wikidata QID -> English Wikipedia article title (or None)."""
    out: dict[str, str | None] = {}
    for i in range(0, len(qids), WBGETENTITIES_BATCH_SIZE):
        batch = qids[i : i + WBGETENTITIES_BATCH_SIZE]
        resp = requests.get(
            WIKIDATA_API,
            params={
                "action": "wbgetentities",
                "ids": "|".join(batch),
                "props": "sitelinks",
                "sitefilter": "enwiki",
                "format": "json",
            },
            headers={"User-Agent": SPARQL_USER_AGENT},
            timeout=60,
        )
        resp.raise_for_status()
        ents = resp.json().get("entities", {})
        for qid in batch:
            sl = ents.get(qid, {}).get("sitelinks", {}).get("enwiki", {})
            out[qid] = sl.get("title")
        time.sleep(0.3)
    return out


def fetch_wikitext(title: str) -> str | None:
    resp = requests.get(
        WIKIPEDIA_API,
        params={
            "action": "parse",
            "page": title,
            "prop": "wikitext",
            "format": "json",
            "redirects": 1,
        },
        headers={"User-Agent": SPARQL_USER_AGENT},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if "parse" not in data:
        return None
    return data["parse"].get("wikitext", {}).get("*")


def _find_infobox_cricketer(wikitext: str) -> str | None:
    m = re.search(r"\{\{\s*Infobox cricketer", wikitext, re.IGNORECASE)
    if not m:
        return None
    start = m.start()
    i = start + 2
    depth = 1
    while i < len(wikitext) and depth > 0:
        two = wikitext[i : i + 2]
        if two == "{{":
            depth += 1
            i += 2
        elif two == "}}":
            depth -= 1
            i += 2
        else:
            i += 1
    return wikitext[start:i] if depth == 0 else wikitext[start:]


def _extract_infobox_field(infobox: str, field: str) -> str | None:
    """Extract a wikitext infobox field value, respecting nested templates and links."""
    pattern = re.compile(rf"\n\s*\|\s*{re.escape(field)}\s*=", re.IGNORECASE)
    m = pattern.search(infobox)
    if not m:
        return None
    pos = m.end()
    depth_curly = 0
    depth_sq = 0
    j = pos
    end = len(infobox)
    while j < end:
        two = infobox[j : j + 2]
        if two == "{{":
            depth_curly += 1
            j += 2
        elif two == "}}":
            if depth_curly > 0:
                depth_curly -= 1
                j += 2
            else:
                break
        elif two == "[[":
            depth_sq += 1
            j += 2
        elif two == "]]":
            depth_sq = max(0, depth_sq - 1)
            j += 2
        elif infobox[j] == "\n" and depth_curly == 0 and depth_sq == 0:
            k = j + 1
            while k < end and infobox[k] in " \t":
                k += 1
            if k < end and infobox[k] == "|":
                break
            j += 1
        else:
            j += 1
    return infobox[pos:j].strip() or None


def clean_wikitext_value(s: str) -> str:
    """Strip templates ({{efn|...}}, {{cite|...}}), wiki links, HTML tags, refs."""
    s = re.sub(r"<ref[^>]*?/>", "", s, flags=re.IGNORECASE)
    s = re.sub(r"<ref[^>]*?>.*?</ref>", "", s, flags=re.IGNORECASE | re.DOTALL)
    # Iteratively strip non-nested {{...}} until stable
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    # [[Target|Display]] -> Display ; [[Target]] -> Target
    s = re.sub(r"\[\[([^\[\]|]*)\|([^\[\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\[\]]+)\]\]", r"\1", s)
    # Strip remaining HTML tags
    s = re.sub(r"<[^>]+>", "", s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip(" -–—,.;")
    return s


_SPIN_KEYS = (
    "spin",
    "off break",
    "off-break",
    "offbreak",
    "leg break",
    "leg-break",
    "legbreak",
    "orthodox",
    "chinaman",
    "wrist",
    "googly",
    "mystery",
    "slow left arm",
    "slow left-arm",
)
_PACE_KEYS = ("fast", "medium", "pace", "seam", "swing")


def classify_bowling(style: str | None) -> str | None:
    if not style:
        return None
    s = style.lower()
    if any(k in s for k in _SPIN_KEYS):
        return "spin"
    if any(k in s for k in _PACE_KEYS):
        return "pace"
    return None


def classify_batting_hand(style: str | None) -> str | None:
    """Map Wikipedia infobox `batting` text → "LHB" / "RHB" / None.
       Cricketer infoboxes typically read "Right-handed" or "Left-handed";
       prioritise the explicit "left" hit so "right-arm bowls left-handed"
       cases (rare, but real) still resolve sensibly when the batting field
       itself starts with "Left"."""
    if not style:
        return None
    s = style.lower()
    if "left" in s and "hand" in s:
        return "LHB"
    if "right" in s and "hand" in s:
        return "RHB"
    if s.startswith("left"):
        return "LHB"
    if s.startswith("right"):
        return "RHB"
    return None


def classify_role(raw: str | None) -> str | None:
    """Map Wikipedia infobox `role` text to one of:
       Batsman, Bowler, All-rounder, Wicket-keeper.
       Priority: wicket-keeper > all-rounder > bowler > batsman."""
    if not raw:
        return None
    s = raw.lower()
    if "wicket" in s or "keeper" in s or re.search(r"\bwk\b", s):
        return "Wicket-keeper"
    if "all-rounder" in s or "all rounder" in s or "allrounder" in s:
        return "All-rounder"
    if "bowl" in s:
        return "Bowler"
    if "bat" in s:
        return "Batsman"
    return None


def enrich_bowling_style(merged: pd.DataFrame, refresh_cache: bool) -> pd.DataFrame:
    cache = {} if refresh_cache else load_wikipedia_cache()
    qids = (
        merged.loc[merged["wikidata_id"].notna(), "wikidata_id"].astype(str).unique().tolist()
    )
    print(
        f"Wikipedia: {len(qids)} players have a wikidata_id, "
        f"{len(cache)} cached"
    )

    # Step 1: resolve enwiki titles for any QID without a `title` entry in cache.
    needs_title = [q for q in qids if q not in cache or "title" not in cache[q]]
    if needs_title:
        print(f"  resolving enwiki titles for {len(needs_title)} QIDs ...")
        try:
            titles = fetch_enwiki_titles(needs_title)
        except Exception as e:
            print(f"  FAILED title batch: {e}")
            titles = {}
        for q in needs_title:
            cache.setdefault(q, {})["title"] = titles.get(q)
        save_wikipedia_cache(cache)

    # Step 2: fetch wikitext + extract bowling/role/batting for QIDs with a
    # title and missing any of the parsed keys.
    need_fetch = [
        q
        for q in qids
        if cache.get(q, {}).get("title")
        and (
            "bowling_kind" not in cache.get(q, {})
            or "role_raw" not in cache.get(q, {})
            or "batting_hand" not in cache.get(q, {})
        )
    ]
    print(f"  fetching infoboxes for {len(need_fetch)} players ...")
    save_every = 25
    for idx, q in enumerate(need_fetch, 1):
        title = cache[q]["title"]
        try:
            wt = fetch_wikitext(title)
        except Exception as e:
            print(f"    FAILED {q} ({title}): {e}")
            time.sleep(2.0)
            continue
        infobox = _find_infobox_cricketer(wt) if wt else None
        raw_bowl = _extract_infobox_field(infobox, "bowling") if infobox else None
        cleaned_bowl = clean_wikitext_value(raw_bowl) if raw_bowl else None
        cache[q]["bowling_raw"] = raw_bowl
        cache[q]["bowling_style"] = cleaned_bowl or None
        cache[q]["bowling_kind"] = classify_bowling(cleaned_bowl)
        raw_role = _extract_infobox_field(infobox, "role") if infobox else None
        cleaned_role = clean_wikitext_value(raw_role) if raw_role else None
        cache[q]["role_raw"] = raw_role
        cache[q]["role"] = classify_role(cleaned_role)
        raw_bat = _extract_infobox_field(infobox, "batting") if infobox else None
        cleaned_bat = clean_wikitext_value(raw_bat) if raw_bat else None
        cache[q]["batting_raw"] = raw_bat
        cache[q]["batting_style"] = cleaned_bat or None
        cache[q]["batting_hand"] = classify_batting_hand(cleaned_bat)
        if idx % save_every == 0 or idx == len(need_fetch):
            save_wikipedia_cache(cache)
            print(
                f"    {idx}/{len(need_fetch)}  "
                f"(spin={sum(1 for v in cache.values() if v.get('bowling_kind') == 'spin')} "
                f"pace={sum(1 for v in cache.values() if v.get('bowling_kind') == 'pace')} "
                f"RHB={sum(1 for v in cache.values() if v.get('batting_hand') == 'RHB')} "
                f"LHB={sum(1 for v in cache.values() if v.get('batting_hand') == 'LHB')})"
            )
        time.sleep(WIKIPEDIA_SLEEP)

    def lookup(qid):
        if not isinstance(qid, str):
            return None, None, None, None, None
        e = cache.get(qid) or {}
        return (
            e.get("bowling_style"),
            e.get("bowling_kind"),
            e.get("role"),
            e.get("batting_style"),
            e.get("batting_hand"),
        )

    rows = merged["wikidata_id"].map(lookup)
    merged["bowling_style"] = [t[0] for t in rows]
    merged["bowling_kind"] = [t[1] for t in rows]
    merged["role_wiki"] = [t[2] for t in rows]
    merged["batting_style"] = [t[3] for t in rows]
    merged["batting_hand"] = [t[4] for t in rows]
    return merged


def load_nationality_cache() -> dict:
    if WIKIDATA_NATIONALITY_CACHE.exists():
        return json.loads(WIKIDATA_NATIONALITY_CACHE.read_text())
    return {}


def save_nationality_cache(cache: dict):
    WIKIDATA_NATIONALITY_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True))


def sparql_nationality(qids: list[str]) -> dict[str, list[str]]:
    """Query Wikidata for P27 (country of citizenship) per QID. Returns a
    map qid -> list of country QIDs (multiple if dual citizenship)."""
    values = " ".join(f"wd:{q}" for q in qids)
    query = f"""
      SELECT ?person ?country WHERE {{
        VALUES ?person {{ {values} }}
        OPTIONAL {{ ?person wdt:P27 ?country }}
      }}
    """
    resp = requests.post(
        SPARQL_ENDPOINT,
        data={"query": query, "format": "json"},
        headers={"User-Agent": SPARQL_USER_AGENT, "Accept": "application/sparql-results+json"},
        timeout=90,
    )
    resp.raise_for_status()
    out: dict[str, list[str]] = {}
    for b in resp.json()["results"]["bindings"]:
        q = b["person"]["value"].rsplit("/", 1)[-1]
        out.setdefault(q, [])
        c = b.get("country", {}).get("value")
        if c:
            qid = c.rsplit("/", 1)[-1]
            if qid not in out[q]:
                out[q].append(qid)
    return out


def enrich_nationality(merged: pd.DataFrame, refresh_cache: bool) -> pd.DataFrame:
    """Add a `nationality` column: "Indian" / "Overseas".

    A player is "Indian" if any P27 value is Q668 (India). Players without
    a wikidata_id or without P27 fall back to "Indian" — that bucket is
    dominated by uncapped IPL domestic talent without a Wikidata page.
    """
    cache = {} if refresh_cache else load_nationality_cache()
    qids = (
        merged.loc[merged["wikidata_id"].notna(), "wikidata_id"].astype(str).unique().tolist()
    )
    to_query = [q for q in qids if q not in cache]
    print(f"Wikidata P27: {len(qids)} qids, {len(cache)} cached, {len(to_query)} to query")

    # P27-OPTIONAL queries are heavier than P2697 lookups, so use a smaller
    # batch + per-batch retries with backoff. Wikidata's public SPARQL
    # endpoint frequently 502s on first try when warm caches are cold.
    nat_batch = 100
    max_retries = 3
    for i in range(0, len(to_query), nat_batch):
        batch = to_query[i : i + nat_batch]
        print(
            f"  batch {i // nat_batch + 1}/"
            f"{(len(to_query) + nat_batch - 1) // nat_batch} "
            f"({len(batch)} qids) ...",
            end=" ",
            flush=True,
        )
        results = None
        for attempt in range(1, max_retries + 1):
            try:
                results = sparql_nationality(batch)
                break
            except Exception as e:
                print(f"try {attempt} failed ({e})", end=" ", flush=True)
                if attempt == max_retries:
                    break
                time.sleep(2.0 * attempt)
        if results is None:
            print("— giving up on this batch, continuing")
            continue
        hits = 0
        for q in batch:
            cache[q] = results.get(q, [])
            if cache[q]:
                hits += 1
        print(f"hits {hits}/{len(batch)}")
        save_nationality_cache(cache)
        time.sleep(1.0)

    def country_for(qid):
        """Pick the cricket-context country for a player. Heuristics:
        - any India-equivalent QID wins (handles dual citizenship like
          India + Australia by preferring India, matching the BCCI rule
          that Indian citizens count as domestic).
        - otherwise the first known QID we recognise; the first by
          insertion order if multiple Wikidata QIDs are returned.
        - unknown QIDs (Wikidata exists but we haven't mapped the country)
          fall back to None so the user can spot gaps; nationality will
          still flag them as Overseas.
        """
        if not isinstance(qid, str):
            return None
        countries = cache.get(qid, [])
        if not countries:
            return None
        mapped = [QID_TO_COUNTRY[c] for c in countries if c in QID_TO_COUNTRY]
        if "India" in mapped:
            return "India"
        if mapped:
            return mapped[0]
        return None

    countries = merged["wikidata_id"].map(country_for)
    # `country` is None for players we don't have a Wikidata mapping for
    # (the ~63 uncapped tail) or whose P27 list contains only unknown
    # QIDs. They keep showing in "All" / "Indian" buckets via heuristic
    # below but don't get a misleading country attached.
    merged["country"] = countries
    # `nationality` derives from country with the same heuristic as before:
    # unknown → Indian, India → Indian, anything else → Overseas. Keeping
    # this column means the existing Indian/Overseas filter doesn't need
    # to re-derive at query time.
    def nationality_for(c):
        # `c` is NaN (pandas-coerced None) for unmapped players — treat
        # the unmapped tail as Indian, matching the heuristic. `isinstance`
        # check avoids `pd.isna(c) == True` on a string column raising.
        if not isinstance(c, str) or c == "India":
            return "Indian"
        return "Overseas"
    merged["nationality"] = merged["country"].map(nationality_for)
    return merged


def default_unknown_to_india(merged: pd.DataFrame) -> pd.DataFrame:
    """Final-pass heuristic: any player who survived P27 + Wikipedia infobox
    + P19→P17 with a null country is, in practice, an uncapped Indian
    domestic player whose data sources just don't carry country info. This
    closes the Country=India / Nationality=Indian inconsistency — without
    it, ~80 players show up under 'Indian' but not under 'India'.
    """
    mask = merged["country"].isna()
    merged.loc[mask, "country"] = "India"
    merged["nationality"] = merged["country"].map(
        lambda c: "Indian" if not isinstance(c, str) or c == "India" else "Overseas"
    )
    return merged


def load_birth_country_cache() -> dict:
    if WIKIDATA_BIRTH_CACHE.exists():
        return json.loads(WIKIDATA_BIRTH_CACHE.read_text())
    return {}


def save_birth_country_cache(cache: dict):
    WIKIDATA_BIRTH_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True))


def sparql_birth_country(qids: list[str]) -> dict[str, list[str]]:
    """Wikidata P19 (place of birth) → P17 (country) per QID. Returns a
    map qid -> list of country QIDs (usually 0 or 1). Used as a fallback
    for players whose P27 statement is empty on Wikidata."""
    values = " ".join(f"wd:{q}" for q in qids)
    query = f"""
      SELECT ?person ?country WHERE {{
        VALUES ?person {{ {values} }}
        OPTIONAL {{
          ?person wdt:P19 ?place .
          ?place wdt:P17 ?country .
        }}
      }}
    """
    resp = requests.post(
        SPARQL_ENDPOINT,
        data={"query": query, "format": "json"},
        headers={"User-Agent": SPARQL_USER_AGENT, "Accept": "application/sparql-results+json"},
        timeout=90,
    )
    resp.raise_for_status()
    out: dict[str, list[str]] = {}
    for b in resp.json()["results"]["bindings"]:
        q = b["person"]["value"].rsplit("/", 1)[-1]
        out.setdefault(q, [])
        c = b.get("country", {}).get("value")
        if c:
            qid = c.rsplit("/", 1)[-1]
            if qid not in out[q]:
                out[q].append(qid)
    return out


def enrich_birth_country(merged: pd.DataFrame, refresh_cache: bool) -> pd.DataFrame:
    """Wikidata P19→P17 fallback. Runs after P27 + Wikipedia infobox have
    both whiffed; uses the player's place-of-birth's country as a proxy
    for nationality. Accurate for uncapped Indian domestics whose
    Wikipedia articles are too thin to have a `country`/`nationality`
    field but who do have a birthplace populated.
    """
    cache = {} if refresh_cache else load_birth_country_cache()
    qids = (
        merged.loc[
            merged["country"].isna() & merged["wikidata_id"].notna(),
            "wikidata_id",
        ]
        .astype(str)
        .unique()
        .tolist()
    )
    to_query = [q for q in qids if q not in cache]
    print(
        f"Wikidata P19→P17 fallback: {len(qids)} unknown-country qids, "
        f"{len(cache)} cached, {len(to_query)} to fetch"
    )

    nat_batch = 100
    max_retries = 3
    for i in range(0, len(to_query), nat_batch):
        batch = to_query[i : i + nat_batch]
        print(
            f"  batch {i // nat_batch + 1}/"
            f"{(len(to_query) + nat_batch - 1) // nat_batch} "
            f"({len(batch)} qids) ...",
            end=" ",
            flush=True,
        )
        results = None
        for attempt in range(1, max_retries + 1):
            try:
                results = sparql_birth_country(batch)
                break
            except Exception as e:
                print(f"try {attempt} failed ({e})", end=" ", flush=True)
                if attempt == max_retries:
                    break
                time.sleep(2.0 * attempt)
        if results is None:
            print("— giving up on this batch, continuing")
            continue
        hits = 0
        for q in batch:
            cache[q] = results.get(q, [])
            if cache[q]:
                hits += 1
        print(f"hits {hits}/{len(batch)}")
        save_birth_country_cache(cache)
        time.sleep(1.0)

    def fallback(row):
        c = row.get("country")
        if isinstance(c, str):
            return c
        qid = row.get("wikidata_id")
        if not isinstance(qid, str):
            return None
        countries = cache.get(qid, [])
        # Same India-prefer rule as country_for() in enrich_nationality —
        # if birthplace is Indian, treat as Indian even if a secondary
        # nationality shows up.
        mapped = [QID_TO_COUNTRY[c] for c in countries if c in QID_TO_COUNTRY]
        if "India" in mapped:
            return "India"
        if mapped:
            return mapped[0]
        return None

    merged["country"] = merged.apply(fallback, axis=1)
    def nationality_for(c):
        if not isinstance(c, str) or c == "India":
            return "Indian"
        return "Overseas"
    merged["nationality"] = merged["country"].map(nationality_for)
    return merged


# Cricket-context label mapping for infobox-derived `country` / `nationality`
# values. Keys are lowercased; the function below tries exact match on the
# cleaned value, then a small set of safe substring rules. Keep this in
# sync conceptually with QID_TO_COUNTRY — same set of cricket countries.
_WIKI_LABEL_MAP = {
    "india": "India",
    "indian": "India",
    "australia": "Australia",
    "australian": "Australia",
    "south africa": "South Africa",
    "south african": "South Africa",
    "new zealand": "New Zealand",
    "new zealander": "New Zealand",
    "england": "England",
    "english": "England",
    "united kingdom": "England",
    "british": "England",
    "sri lanka": "Sri Lanka",
    "sri lankan": "Sri Lanka",
    "west indies": "West Indies",
    "west indian": "West Indies",
    "jamaica": "West Indies",
    "jamaican": "West Indies",
    "barbados": "West Indies",
    "barbadian": "West Indies",
    "guyana": "West Indies",
    "guyanese": "West Indies",
    "trinidad": "West Indies",
    "trinidad and tobago": "West Indies",
    "trinidadian": "West Indies",
    "saint lucia": "West Indies",
    "st lucia": "West Indies",
    "saint lucian": "West Indies",
    "antigua": "West Indies",
    "antigua and barbuda": "West Indies",
    "antiguan": "West Indies",
    "dominica": "West Indies",
    "dominican": "West Indies",
    "pakistan": "Pakistan",
    "pakistani": "Pakistan",
    "afghanistan": "Afghanistan",
    "afghan": "Afghanistan",
    "bangladesh": "Bangladesh",
    "bangladeshi": "Bangladesh",
    "zimbabwe": "Zimbabwe",
    "zimbabwean": "Zimbabwe",
    "namibia": "Namibia",
    "namibian": "Namibia",
    "kenya": "Kenya",
    "kenyan": "Kenya",
    "nepal": "Nepal",
    "nepali": "Nepal",
    "malaysia": "Malaysia",
    "malaysian": "Malaysia",
    "ireland": "Ireland",
    "irish": "Ireland",
}


def map_wiki_country(
    country: str | None,
    nationality: str | None,
    title: str | None = None,
) -> str | None:
    """Translate a cleaned infobox `country` / `nationality` value (and as
    a last resort the article title's disambiguator) into our cricket-context
    label set. Prefers `country` (the international team field) over
    `nationality` over the title disambiguator.

    Exact match → substring scan → title disambiguator. The title fallback
    catches the dozens of uncapped Indian domestics whose infoboxes have
    no nationality field but whose article titles are 'Foo Bar (Indian
    cricketer)'-style.
    """
    candidates = [v for v in (country, nationality) if v]
    for raw in candidates:
        key = raw.strip().lower()
        if key in _WIKI_LABEL_MAP:
            return _WIKI_LABEL_MAP[key]
    # Substring fallback. Iterate longest-key first so 'south africa' wins
    # before 'africa' could match (it can't here but be defensive).
    keys_by_length = sorted(_WIKI_LABEL_MAP.keys(), key=len, reverse=True)
    for raw in candidates:
        key = raw.strip().lower()
        for k in keys_by_length:
            if k in key:
                return _WIKI_LABEL_MAP[k]
    # Title disambiguator — match the demonym inside "(<demonym> cricketer…)".
    # Lazy match before "cricketer" so trailing qualifiers like ", born 1995"
    # don't capture them.
    if title:
        m = re.search(r"\(([A-Za-z ]+?) cricketer", title)
        if m:
            demonym = m.group(1).strip().lower()
            if demonym in _WIKI_LABEL_MAP:
                return _WIKI_LABEL_MAP[demonym]
    return None


def enrich_wiki_country(merged: pd.DataFrame, refresh_cache: bool) -> pd.DataFrame:
    """Wikipedia infobox fallback for players whose Wikidata P27 is empty.

    Looks at every player where `country` is still null but `wikidata_id`
    is present, fetches their `{{Infobox cricketer}}` wikitext (reusing
    the title resolved during the bowling-style pass), and pulls `country`
    or `nationality` out of it. Results land in `wikipedia_cache.json`
    under the `country_from_wiki` key so subsequent runs are no-op.
    """
    cache = load_wikipedia_cache()

    # Candidates: players still missing country who have a wikidata_id
    # and a cached enwiki title to query.
    still_unknown_qids = (
        merged.loc[
            merged["country"].isna() & merged["wikidata_id"].notna(),
            "wikidata_id",
        ]
        .astype(str)
        .unique()
        .tolist()
    )
    have_title = [q for q in still_unknown_qids if cache.get(q, {}).get("title")]
    print(
        f"Wiki country fallback: {len(still_unknown_qids)} unknown-country qids, "
        f"{len(have_title)} have an enwiki title"
    )

    # `country_raw` is the raw wikitext value (before cleaning); we cache
    # it rather than the cleaned form so re-deriving `country_from_wiki`
    # later (after tweaks to map_wiki_country) doesn't lose information.
    need_fetch = [
        q
        for q in have_title
        if refresh_cache or "country_raw" not in cache.get(q, {})
    ]
    print(f"  fetching infoboxes for {len(need_fetch)} players ...")
    save_every = 25
    for idx, q in enumerate(need_fetch, 1):
        title = cache[q]["title"]
        try:
            wt = fetch_wikitext(title)
        except Exception as e:
            print(f"    FAILED {q} ({title}): {e}")
            time.sleep(2.0)
            continue
        infobox = _find_infobox_cricketer(wt) if wt else None
        raw_country = _extract_infobox_field(infobox, "country") if infobox else None
        raw_nat = _extract_infobox_field(infobox, "nationality") if infobox else None
        cache[q]["country_raw"] = raw_country
        cache[q]["nationality_raw"] = raw_nat
        if idx % save_every == 0 or idx == len(need_fetch):
            save_wikipedia_cache(cache)
            print(f"    {idx}/{len(need_fetch)}")
        time.sleep(WIKIPEDIA_SLEEP)

    # Re-derive `country_from_wiki` for every cached entry (cheap; no
    # network). Means tweaks to map_wiki_country / _WIKI_LABEL_MAP apply
    # immediately on next run without re-fetching wikitext.
    for q, e in cache.items():
        clean_country = clean_wikitext_value(e["country_raw"]) if e.get("country_raw") else None
        clean_nat = clean_wikitext_value(e["nationality_raw"]) if e.get("nationality_raw") else None
        e["country_from_wiki"] = map_wiki_country(clean_country, clean_nat, title=e.get("title"))
    save_wikipedia_cache(cache)
    hits = sum(1 for v in cache.values() if v.get("country_from_wiki"))
    print(f"  mapped from cache: {hits} qids have country_from_wiki")

    # Merge the cache fallback into `merged.country` for rows still null.
    def fallback(row):
        c = row.get("country")
        if isinstance(c, str):
            return c
        qid = row.get("wikidata_id")
        if not isinstance(qid, str):
            return None
        return cache.get(qid, {}).get("country_from_wiki")

    merged["country"] = merged.apply(fallback, axis=1)
    # Re-derive nationality from the (possibly back-filled) country.
    def nationality_for(c):
        if not isinstance(c, str) or c == "India":
            return "Indian"
        return "Overseas"
    merged["nationality"] = merged["country"].map(nationality_for)
    return merged


def apply_aliases(merged: pd.DataFrame) -> pd.DataFrame:
    if not ALIASES_CSV.exists():
        return merged
    aliases = pd.read_csv(ALIASES_CSV, dtype=str)
    if "cricsheet_id" not in aliases or "full_name" not in aliases:
        print(f"  WARN: {ALIASES_CSV} missing cricsheet_id or full_name columns — skipping")
        return merged
    overrides = dict(zip(aliases["cricsheet_id"], aliases["full_name"]))
    mask = merged["cricsheet_id"].isin(overrides)
    merged.loc[mask, "full_name"] = merged.loc[mask, "cricsheet_id"].map(overrides)
    merged.loc[mask, "full_name_source"] = "alias"
    print(f"Applied {mask.sum()} manual overrides from {ALIASES_CSV.name}")
    return merged


def apply_country_overrides(merged: pd.DataFrame) -> pd.DataFrame:
    """Manual country/nationality corrections for the small tail of players
    where the Wikidata pipeline picks the wrong P19→P17 birthplace. CSV
    schema: cricsheet_id,country,nationality,note. Applied as a final step
    so it overrides every prior enrichment heuristic."""
    if not COUNTRY_OVERRIDES_CSV.exists():
        return merged
    overrides = pd.read_csv(COUNTRY_OVERRIDES_CSV, dtype=str)
    if "cricsheet_id" not in overrides or "country" not in overrides:
        print(f"  WARN: {COUNTRY_OVERRIDES_CSV} missing cricsheet_id or country — skipping")
        return merged
    by_id = overrides.set_index("cricsheet_id")
    mask = merged["cricsheet_id"].isin(by_id.index)
    if mask.any():
        merged.loc[mask, "country"] = merged.loc[mask, "cricsheet_id"].map(by_id["country"])
        if "nationality" in by_id.columns:
            nat_map = by_id["nationality"].dropna()
            nat_mask = merged["cricsheet_id"].isin(nat_map.index)
            merged.loc[nat_mask, "nationality"] = merged.loc[nat_mask, "cricsheet_id"].map(nat_map)
        print(f"Applied {mask.sum()} manual country overrides from {COUNTRY_OVERRIDES_CSV.name}")
    return merged


_STATS_ROLE_MAP = {
    "batter": "Batsman",
    "bowler": "Bowler",
    "all-rounder": "All-rounder",
}


def enrich_role(merged: pd.DataFrame) -> pd.DataFrame:
    """Resolve a single normalized `role` per player.
    Preference: Wikipedia infobox `role` (classify_role) > per-season players.parquet
    role (collector heuristic, capitalized). Wicket-keeper is only detectable
    from Wikipedia."""
    wiki = merged.get("role_wiki")
    if wiki is None:
        merged["role_wiki"] = None
        wiki = merged["role_wiki"]

    stats_path = DATA_DIR / "aggregated" / "players.parquet"
    stats_role: dict[str, str] = {}
    if stats_path.exists():
        pl = pd.read_parquet(stats_path, columns=["player", "role", "matches"])
        pl = pl[pl["player"].notna() & pl["role"].notna()]
        # Pick the dominant role per player (most matches). Falls back to mode.
        agg = (
            pl.groupby(["player", "role"])["matches"].sum().reset_index()
            .sort_values(["player", "matches"], ascending=[True, False])
            .drop_duplicates(subset="player", keep="first")
        )
        for _, r in agg.iterrows():
            mapped = _STATS_ROLE_MAP.get(str(r["role"]).lower())
            if mapped:
                stats_role[r["player"]] = mapped

    def resolve(row):
        w = row.get("role_wiki")
        if isinstance(w, str) and w:
            return w
        name = row.get("cricsheet_name")
        if isinstance(name, str) and name in stats_role:
            return stats_role[name]
        return None

    merged["role"] = merged.apply(resolve, axis=1)
    return merged


def finalize(merged: pd.DataFrame) -> pd.DataFrame:
    # display_name preference: full_name > unique_name > registry_name
    merged["display_name"] = (
        merged["full_name"]
        .fillna(merged["unique_name"])
        .fillna(merged["registry_name"])
    )
    cols = [
        "cricsheet_id", "registry_name", "cricsheet_name", "unique_name",
        "full_name", "full_name_source", "display_name",
        "key_cricinfo", "key_cricbuzz", "key_bcci", "wikidata_id",
        "batting_style", "batting_hand",
        "bowling_style", "bowling_kind", "role", "nationality", "country",
        "first_season", "last_season", "season_count",
    ]
    for c in cols:
        if c not in merged.columns:
            merged[c] = None
    return merged[cols]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--refresh", action="store_true", help="Force re-download of people.csv")
    ap.add_argument("--skip-wikidata", action="store_true", help="Cricsheet join only, no SPARQL")
    ap.add_argument("--refresh-wikidata", action="store_true", help="Ignore Wikidata cache, re-query all")
    ap.add_argument("--skip-wiki", action="store_true", help="Skip Wikipedia infobox enrichment (bowling_style)")
    ap.add_argument("--refresh-wiki", action="store_true", help="Ignore Wikipedia cache, re-fetch all")
    ap.add_argument("--skip-nationality", action="store_true", help="Skip Wikidata P27 nationality enrichment")
    ap.add_argument("--refresh-nationality", action="store_true", help="Ignore nationality cache, re-fetch all P27")
    ap.add_argument("--skip-wiki-country", action="store_true", help="Skip Wikipedia infobox country fallback")
    ap.add_argument("--refresh-wiki-country", action="store_true", help="Re-parse Wikipedia infoboxes for country/nationality")
    ap.add_argument("--skip-birth-country", action="store_true", help="Skip Wikidata P19→P17 birth-country fallback")
    ap.add_argument("--refresh-birth-country", action="store_true", help="Ignore birth-country cache, re-fetch P19→P17")
    ap.add_argument("--no-default-india", action="store_true", help="Don't default the remaining unknown-country tail to India")
    args = ap.parse_args()

    people_path = fetch_people(args.refresh)
    registry = load_all_registries()
    print(f"Loaded {len(registry)} unique players from per-season registries")

    merged = join_cricsheet(registry, people_path)
    matched = merged["cricsheet_name"].notna().sum()
    print(f"Cricsheet join: {matched}/{len(merged)} matched")

    if args.skip_wikidata:
        merged["full_name"] = None
        merged["full_name_source"] = None
        merged["wikidata_id"] = None
    else:
        merged = enrich_wikidata(merged, refresh_cache=args.refresh_wikidata)
        wd_hits = merged["full_name"].notna().sum()
        print(f"Wikidata: {wd_hits}/{len(merged)} have a full name")

    merged = apply_aliases(merged)

    if args.skip_wiki:
        merged["bowling_style"] = None
        merged["bowling_kind"] = None
        merged["batting_style"] = None
        merged["batting_hand"] = None
    else:
        merged = enrich_bowling_style(merged, refresh_cache=args.refresh_wiki)
        wk_hits = merged["bowling_kind"].notna().sum()
        print(f"Wikipedia infobox: {wk_hits}/{len(merged)} have a bowling_kind")

    if args.skip_nationality:
        merged["nationality"] = "Indian"  # safe default — preserves column schema
        merged["country"] = None
    else:
        merged = enrich_nationality(merged, refresh_cache=args.refresh_nationality)
        nt_counts = merged["nationality"].value_counts().to_dict()
        country_counts = merged["country"].value_counts(dropna=False).to_dict()
        print(f"Nationality (after P27): {nt_counts}")
        print(f"Country (after P27): {country_counts}")

        if not args.skip_wiki_country:
            merged = enrich_wiki_country(merged, refresh_cache=args.refresh_wiki_country)
            nt_counts = merged["nationality"].value_counts().to_dict()
            country_counts = merged["country"].value_counts(dropna=False).to_dict()
            print(f"Nationality (after Wikipedia fallback): {nt_counts}")
            print(f"Country (after Wikipedia fallback): {country_counts}")

        if not args.skip_birth_country:
            merged = enrich_birth_country(merged, refresh_cache=args.refresh_birth_country)
            nt_counts = merged["nationality"].value_counts().to_dict()
            country_counts = merged["country"].value_counts(dropna=False).to_dict()
            print(f"Nationality (after birth-country fallback): {nt_counts}")
            print(f"Country (after birth-country fallback): {country_counts}")

        merged = apply_country_overrides(merged)

        if not args.no_default_india:
            before = merged["country"].isna().sum()
            merged = default_unknown_to_india(merged)
            if before:
                print(f"Default-to-India: filled {before} remaining unknown-country rows")
                country_counts = merged["country"].value_counts(dropna=False).to_dict()
                print(f"Country (after India default): {country_counts}")

    merged = enrich_role(merged)
    role_counts = merged["role"].value_counts(dropna=False).to_dict()
    print(f"Role: {role_counts}")

    merged = finalize(merged)

    out_csv = DATA_DIR / "players_meta.csv"
    out_parquet = DATA_DIR / "aggregated" / "players_meta.parquet"
    out_parquet.parent.mkdir(parents=True, exist_ok=True)

    merged.sort_values("display_name", inplace=True, kind="stable",
                      key=lambda s: s.fillna("").str.lower())
    merged.to_csv(out_csv, index=False)
    merged.to_parquet(out_parquet, engine="pyarrow", compression="zstd", index=False)

    total = len(merged)
    have_full = merged["full_name"].notna().sum()
    by_src = merged.groupby("full_name_source").size().to_dict()
    print()
    print(f"  total players       : {total}")
    print(f"  with full_name      : {have_full}  ({have_full/total:.0%})")
    for src, n in sorted(by_src.items(), key=lambda x: -x[1]):
        if src is None or pd.isna(src):
            continue
        print(f"    {src:<22}: {n}")
    if "bowling_kind" in merged.columns:
        kinds = merged["bowling_kind"].value_counts(dropna=False).to_dict()
        print(f"  bowling_kind        :")
        for k, n in sorted(kinds.items(), key=lambda x: -x[1]):
            label = "(none)" if (k is None or (isinstance(k, float) and pd.isna(k))) else k
            print(f"    {label:<22}: {n}")
    if "batting_hand" in merged.columns:
        hands = merged["batting_hand"].value_counts(dropna=False).to_dict()
        print(f"  batting_hand        :")
        for k, n in sorted(hands.items(), key=lambda x: -x[1]):
            label = "(none)" if (k is None or (isinstance(k, float) and pd.isna(k))) else k
            print(f"    {label:<22}: {n}")
    print(f"  -> {out_csv}")
    print(f"  -> {out_parquet}")

    # Mirror parquet into web/public/data so the Next.js app picks it up.
    # Skip if the two paths already point to the same file (hardlink).
    web_parquet = ROOT / "web" / "public" / "data" / "players_meta.parquet"
    if web_parquet.parent.exists():
        same = (
            web_parquet.exists()
            and web_parquet.stat().st_ino == out_parquet.stat().st_ino
            and web_parquet.stat().st_dev == out_parquet.stat().st_dev
        )
        if not same:
            shutil.copy2(out_parquet, web_parquet)
        print(f"  -> {web_parquet}{' (already linked)' if same else ''}")

    # Show a sample of the most-played recent players for sanity.
    recent = merged[
        (merged["last_season"] >= 2025) & merged["full_name"].notna()
    ].sort_values("season_count", ascending=False).head(12)
    if len(recent):
        print("\nRecent player sample (full names found):")
        for _, r in recent.iterrows():
            print(f"    {r['registry_name']:<25} -> {r['full_name']}")

    # And the most-played recent without a full name (manual-override candidates).
    misses = merged[
        (merged["last_season"] >= 2025) & merged["full_name"].isna()
    ].sort_values("season_count", ascending=False).head(15)
    if len(misses):
        print("\nNo full name found (candidates for data/player_aliases.csv):")
        for _, r in misses.iterrows():
            print(f"    {r['cricsheet_id']}  {r['registry_name']:<25} "
                  f"cricinfo={r['key_cricinfo']}")


if __name__ == "__main__":
    main()
