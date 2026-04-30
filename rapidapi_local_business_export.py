#!/usr/bin/env python3
"""
Export Google Maps businesses from RapidAPI "Local Business Data".

Usage:
  python rapidapi_local_business_export.py "roofing contractor" "dallas tx" 500

Required environment variables:
  RAPIDAPI_KEY   - your RapidAPI key

Optional environment variables:
  RAPIDAPI_HOST      (default: local-business-data.p.rapidapi.com)
  RAPIDAPI_ENDPOINT  (default: https://local-business-data.p.rapidapi.com/search)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


CSV_HEADERS = [
    "business_name",
    "full_address",
    "phone",
    "website_url",
    "google_rating",
    "review_count",
    "business_category",
    "latitude",
    "longitude",
    "google_place_id",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch local businesses from RapidAPI and export CSV."
    )
    parser.add_argument("query", help='Business query, e.g. "roofing contractor"')
    parser.add_argument("city", help='City/state, e.g. "dallas tx"')
    parser.add_argument(
        "max_results",
        type=int,
        help="Maximum number of businesses to export",
    )
    args = parser.parse_args()
    if args.max_results <= 0:
        parser.error("max_results must be greater than 0")
    return args


def env_or_exit(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def slugify(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return s or "export"


def safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None


def pick_first_nonempty(*values: Any) -> str:
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def extract_lat_lng(item: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    lat = safe_float(item.get("latitude"))
    lng = safe_float(item.get("longitude"))
    if lat is not None or lng is not None:
        return lat, lng

    location = item.get("location") or {}
    if isinstance(location, dict):
        lat = safe_float(location.get("lat") or location.get("latitude"))
        lng = safe_float(location.get("lng") or location.get("lon") or location.get("longitude"))
    return lat, lng


def extract_category(item: Dict[str, Any]) -> str:
    category = pick_first_nonempty(item.get("type"), item.get("category"))
    if category:
        return category
    subtypes = item.get("subtypes")
    if isinstance(subtypes, list) and subtypes:
        return pick_first_nonempty(subtypes[0])
    categories = item.get("categories")
    if isinstance(categories, list) and categories:
        first = categories[0]
        if isinstance(first, dict):
            return pick_first_nonempty(first.get("name"), first.get("label"))
        return pick_first_nonempty(first)
    return ""


def extract_items_and_next_token(payload: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
    data = payload.get("data", payload)
    items: List[Dict[str, Any]] = []
    next_token = ""

    if isinstance(data, list):
        items = [x for x in data if isinstance(x, dict)]
    elif isinstance(data, dict):
        for key in ("data", "results", "businesses", "places", "items"):
            candidate = data.get(key)
            if isinstance(candidate, list):
                items = [x for x in candidate if isinstance(x, dict)]
                break
        if not items and any(k in data for k in ("place_id", "name", "business_id")):
            items = [data]
        next_token = pick_first_nonempty(
            data.get("next_page_token"),
            data.get("nextPageToken"),
            data.get("cursor"),
            data.get("next_cursor"),
        )

    if not next_token:
        next_token = pick_first_nonempty(
            payload.get("next_page_token"),
            payload.get("nextPageToken"),
            payload.get("cursor"),
            payload.get("next_cursor"),
        )
    return items, next_token


def request_with_backoff(
    base_url: str,
    headers: Dict[str, str],
    params: Dict[str, Any],
    max_attempts: int = 7,
) -> Dict[str, Any]:
    for attempt in range(max_attempts):
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
        url = f"{base_url}?{query}"
        req = urllib.request.Request(url=url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            status = e.code
            if status == 429 or 500 <= status < 600:
                if attempt == max_attempts - 1:
                    raise
                wait_s = (2 ** attempt) + random.uniform(0, 0.8)
                print(f"HTTP {status}; retrying in {wait_s:.1f}s...", file=sys.stderr)
                time.sleep(wait_s)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == max_attempts - 1:
                raise
            wait_s = (2 ** attempt) + random.uniform(0, 0.8)
            print(f"Transient error; retrying in {wait_s:.1f}s...", file=sys.stderr)
            time.sleep(wait_s)
    raise RuntimeError("Exhausted retries")


def normalize_row(item: Dict[str, Any]) -> Dict[str, Any]:
    place_id = pick_first_nonempty(item.get("place_id"), item.get("placeId"))
    name = pick_first_nonempty(item.get("name"), item.get("business_name"))
    full_address = pick_first_nonempty(
        item.get("full_address"),
        item.get("formatted_address"),
        item.get("address"),
    )
    phone = pick_first_nonempty(
        item.get("phone_number"),
        item.get("phone"),
        item.get("phoneNumber"),
    )
    website = pick_first_nonempty(item.get("website"), item.get("website_url"), item.get("site"))
    rating = safe_float(item.get("rating") or item.get("google_rating"))
    reviews = safe_int(item.get("review_count") or item.get("reviews") or item.get("reviews_count"))
    lat, lng = extract_lat_lng(item)
    category = extract_category(item)

    return {
        "business_name": name,
        "full_address": full_address,
        "phone": phone,
        "website_url": website,
        "google_rating": rating if rating is not None else "",
        "review_count": reviews if reviews is not None else "",
        "business_category": category,
        "latitude": lat if lat is not None else "",
        "longitude": lng if lng is not None else "",
        "google_place_id": place_id,
    }


def write_csv(path: str, rows: List[Dict[str, Any]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    args = parse_args()
    rapidapi_key = env_or_exit("RAPIDAPI_KEY")
    rapidapi_host = os.getenv("RAPIDAPI_HOST", "local-business-data.p.rapidapi.com").strip()
    endpoint = os.getenv("RAPIDAPI_ENDPOINT", "https://local-business-data.p.rapidapi.com/search").strip()

    headers = {
        "x-rapidapi-key": rapidapi_key,
        "x-rapidapi-host": rapidapi_host,
        "accept": "application/json",
    }

    search_text = f"{args.query} in {args.city}".strip()
    max_results = args.max_results
    page_size = min(20, max_results)

    seen_place_ids = set()
    out_rows: List[Dict[str, Any]] = []
    next_token = ""
    page_num = 0

    print(f"Searching: {search_text}")
    while len(out_rows) < max_results:
        page_num += 1
        params = {
            "query": search_text,
            "limit": page_size,
            "next_page_token": next_token,
        }
        payload = request_with_backoff(endpoint, headers, params)
        items, fetched_next = extract_items_and_next_token(payload)
        if not items:
            break

        before = len(out_rows)
        for item in items:
            row = normalize_row(item)
            pid = row["google_place_id"]
            if pid:
                if pid in seen_place_ids:
                    continue
                seen_place_ids.add(pid)
            out_rows.append(row)
            if len(out_rows) >= max_results:
                break

        if len(out_rows) // 50 > before // 50:
            print(f"Progress: {len(out_rows)} businesses exported...")

        if not fetched_next or len(out_rows) >= max_results:
            break
        next_token = fetched_next

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"local_businesses_{slugify(args.query)}_{slugify(args.city)}_{timestamp}.csv"
    write_csv(out_name, out_rows[:max_results])

    print(f"Done. Wrote {min(len(out_rows), max_results)} businesses to {out_name}")


if __name__ == "__main__":
    main()

