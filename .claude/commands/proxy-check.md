---
description: Run Proxy Doctor to check whether egress gets past Tesla's Akamai.
allowed-tools: Bash(npm run scrape:proxy-test:*)
---
Run `npm run scrape:proxy-test` and interpret the result for the user. Verdicts:

- **PASS** — the proxy returns usable Supercharger pages; the scraper will capture through it.
- **BLOCKED** — connected, but Akamai denies the IP (typical for datacenter/free proxies). Recommend a residential proxy.
- **DEAD** — the proxy isn't forwarding at all (wrong endpoint/credentials, or trial not active). This is NOT an Akamai verdict — it's a connection problem.
- **No proxy configured** — only direct egress is tested and shown getting blocked; explain that a residential `SCRAPE_PROXY` is what's needed.

`SCRAPE_PROXY` must be set in the shell (local) or as a repo secret (Actions →
Proxy Doctor). See `docs/scrape-proxy.md` for setup and provider guidance. Never
print or echo proxy credentials.
