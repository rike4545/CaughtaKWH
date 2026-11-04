#!/usr/bin/env python3
"""Polite, resumable Scrapling spider for authorized CaughtaKWH station URLs."""
from __future__ import annotations
import argparse
import json
import logging
import os
from pathlib import Path
from urllib.parse import urlparse
from scrapling.fetchers import FetcherSession, ProxyRotator
from scrapling.spiders import Response, SessionManager, Spider

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_HOST = "www.tesla.com"
ALLOWED_PREFIX = "/findus/location/supercharger/"

def load_stations(path: Path, limit: int) -> list[dict]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("Station input must be a JSON array.")
    result, seen = [], set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "")
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST or not parsed.path.startswith(ALLOWED_PREFIX):
            continue
        if url in seen:
            continue
        seen.add(url)
        result.append({"url": url, "station_id": str(row.get("id") or row.get("stationId") or ""), "name": str(row.get("name") or "")})
        if len(result) >= limit:
            break
    return result

class TeslaStationSpider(Spider):
    name = "caughtakwh-tesla-stations"
    allowed_domains = {ALLOWED_HOST}
    concurrent_requests = max(1, int(os.getenv("SCRAPLING_CONCURRENCY", "2")))
    concurrent_requests_per_domain = 1
    robots_txt_obey = True
    autothrottle_enabled = True
    autothrottle_start_delay = 5.0
    autothrottle_max_delay = 120.0
    autothrottle_block_backoff = True
    max_blocked_retries = 1
    logging_level = logging.INFO

    def __init__(self, stations: list[dict], proxy_urls: list[str], **kwargs):
        super().__init__(**kwargs)
        self.stations_by_url = {item["url"]: item for item in stations}
        self.start_urls = list(self.stations_by_url)
        self.proxy_urls = proxy_urls

    def configure_sessions(self, manager: SessionManager) -> None:
        # Operator-authorized proxy endpoints only; standard HTTP, no stealth/browser bypass.
        rotator = ProxyRotator(self.proxy_urls) if self.proxy_urls else None
        manager.add("default", FetcherSession(proxy_rotator=rotator, timeout=20, retries=0))

    async def is_blocked(self, response: Response) -> bool:
        # Do not rotate/retry around 401/403/407/429 access-control responses.
        return response.status in {500, 502, 503, 504}

    async def parse(self, response: Response):
        station = self.stations_by_url.get(str(response.url), {})
        yield {
            "station_id": station.get("station_id", ""),
            "station_name": station.get("name", ""),
            "url": str(response.url),
            "status": int(response.status),
            "title": response.css("title::text").get(""),
            "html": response.body.decode("utf-8", errors="replace"),
            "proxy": response.meta.get("proxy"),
        }

def export_items(items, output: Path, fmt: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    method = {"json": "to_json", "jsonl": "to_jsonl", "csv": "to_csv", "xml": "to_xml"}[fmt]
    if fmt == "json":
        getattr(items, method)(str(output), indent=True)
    else:
        getattr(items, method)(str(output))

def main() -> int:
    parser = argparse.ArgumentParser(description="Crawl authorized CaughtaKWH station URLs with Scrapling.")
    parser.add_argument("--input", type=Path, default=ROOT / "data/stations.json")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--format", choices=("json", "jsonl", "csv", "xml"), default="jsonl")
    parser.add_argument("--output", type=Path, default=ROOT / "data/scrapling-export/stations.jsonl")
    parser.add_argument("--crawl-dir", type=Path, default=ROOT / ".scrapling-crawls/tesla-stations")
    parser.add_argument("--stream", action="store_true", help="Write JSONL items as they arrive.")
    args = parser.parse_args()
    stations = load_stations(args.input, max(1, args.limit))
    if not stations:
        raise SystemExit("No authorized Tesla Supercharger station URLs found in the input.")
    proxies = [v.strip() for v in os.getenv("SCRAPLING_PROXY_LIST", "").splitlines() if v.strip()]
    spider = TeslaStationSpider(stations, proxies, crawldir=str(args.crawl_dir), interval=120.0)
    if args.stream:
        if args.format != "jsonl":
            parser.error("--stream currently requires --format jsonl.")
        import anyio
        async def stream_items():
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("a", encoding="utf-8") as handle:
                async for item in spider.stream():
                    handle.write(json.dumps(item, ensure_ascii=False) + "\n")
                    handle.flush()
        anyio.run(stream_items)
        print(json.dumps({"output": str(args.output), "streamed": True}))
        return 0
    result = spider.start()
    export_items(result.items, args.output, args.format)
    print(json.dumps({
        "output": str(args.output), "completed": result.completed, "paused": result.paused,
        "requests": result.stats.requests_count, "items": result.stats.items_scraped,
        "blocked": result.stats.blocked_requests_count,
        "autothrottle": result.stats.autothrottle_delays,
    }, default=str))
    return 0 if result.completed or result.paused else 1

if __name__ == "__main__":
    raise SystemExit(main())
