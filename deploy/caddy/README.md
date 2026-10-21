# Self-hosted scrape egress (Caddy forward proxy)

Tesla's Akamai blocks most datacenter and public-proxy IPs. This runs a small, locked-down
Caddy forward proxy on a machine you control so the scraper can egress from that IP.

Caddy does not change TLS or browser fingerprints, so it only helps if the egress IP itself
is acceptable to Tesla. A home connection is the best candidate; a cloud VPS likely is not.
Verify before relying on it.

## Setup

1. Point a DNS name (e.g. `proxy.example.com`) at the box and forward ports 80/443 to it.
   Port 80 is needed for the ACME certificate challenge.
2. `cd deploy/caddy && cp .env.example .env` and set `PROXY_DOMAIN`, `ACME_EMAIL`,
   `PROXY_USER`, `PROXY_PASS`.
3. `docker compose up -d --build`
4. Sanity check from another machine:
   `curl -x https://USER:PASS@proxy.example.com https://api.ipify.org` should print the
   box's public IP. Requests to hosts outside the allowlist must fail.
5. Add the repo secret `SCRAPE_PROXY=https://USER:PASS@proxy.example.com`.
6. Run the `proxy-check` skill (or `node scripts/proxyDoctor.mjs`) to confirm the egress gets
   past Akamai on a Tesla station page.

The `https://` scheme matters: it keeps the proxy credentials encrypted on the way to the
proxy. `scripts/proxyPool.mjs` already accepts `https://user:pass@host` entries.

## What is locked down

- Basic auth required; unauthenticated probes get a plain 404 (`probe_resistance`).
- CONNECT allowed only to port 443 and only to `tesla.com`, `*.tesla.com` and
  `api.ipify.org` (the liveness check in `checkProxy`).
- `hide_ip` / `hide_via` so no forwarding headers are added.

If you add other scrape targets, extend the `allow` line in the `Caddyfile`.

## Notes

- Keep the scraper's existing guards (station cooldowns, circuit breaker after three
  consecutive blocks). A new IP does not remove the need for them.
- The Caddyfile and compose files have not been run against a live Caddy instance in this
  repo's CI; do the sanity check in step 4 first.
