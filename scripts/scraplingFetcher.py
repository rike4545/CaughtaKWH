#!/usr/bin/env python3
"""Persistent Scrapling HTTP worker for CaughtaKWH.

Uses Scrapling's ordinary HTTP FetcherSession only. It does not launch stealth
browsers, solve challenges, spoof browser fingerprints, or retry access denials.
"""
import json
import os
import sys
import time

from scrapling.fetchers import FetcherSession

HEADERS = {
    "User-Agent": "CaughtaKWH-PriceResearch/1.0 (+https://github.com/rike4545/CaughtaKWH)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.8",
}
TIMEOUT = float(os.environ.get("SCRAPLING_TIMEOUT_SECONDS", "18"))

def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()

def main():
    # No browser impersonation or stealth features: this is a standards-based
    # HTTP fetcher with explicit timeouts and operator-provided proxy routing.
    with FetcherSession(
        impersonate=None,
        stealthy_headers=False,
        timeout=TIMEOUT,
        retries=0,
        headers=HEADERS,
        follow_redirects="safe",
    ) as session:
        for raw in sys.stdin:
            try:
                request = json.loads(raw)
                request_id = request.get("id")
                if request.get("action") == "close":
                    break
                url = str(request.get("url") or "")
                if not url.startswith("https://www.tesla.com/findus/location/supercharger/"):
                    emit({"id": request_id, "status": 0, "html": "", "finalUrl": url, "error": "unsupported_target"})
                    continue
                started = time.monotonic()
                try:
                    proxy = request.get("proxy")
                    kwargs = {"timeout": TIMEOUT}
                    if proxy:
                        kwargs["proxy"] = proxy
                    response = session.get(url, **kwargs)
                    status = int(getattr(response, "status", 0) or 0)
                    html = str(getattr(response, "text", "") or "") if 200 <= status < 300 else ""
                    emit({
                        "id": request_id,
                        "status": status,
                        "html": html,
                        "finalUrl": str(getattr(response, "url", url) or url),
                        "retryAfter": None,
                        "durationMs": round((time.monotonic() - started) * 1000),
                        "error": None,
                    })
                except Exception as exc:
                    emit({
                        "id": request_id,
                        "status": 0,
                        "html": "",
                        "finalUrl": url,
                        "retryAfter": None,
                        "durationMs": round((time.monotonic() - started) * 1000),
                        "error": f"{type(exc).__name__}: {exc}",
                    })
            except Exception as exc:
                emit({"id": None, "status": 0, "html": "", "finalUrl": "", "error": f"worker_error: {exc}"})

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Scrapling worker startup failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
