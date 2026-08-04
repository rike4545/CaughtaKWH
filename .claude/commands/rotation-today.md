---
description: Show which US states the scheduled scraper covers today and upcoming days.
allowed-tools: Bash(node scripts/rotationSchedule.mjs:*), Bash(npm run rotation:today:*)
---
Run `node scripts/rotationSchedule.mjs $ARGUMENTS` (default 7 days if no number is
given) and show the output to the user.

It prints which US states the scheduled Supercharger scrape rotates through today
and over the coming days. The helper reads the live `SCRAPE_ROTATION_COUNT` from
`.github/workflows/price-refresh.yml` and mirrors the rotation logic in
`scripts/scrapePrices.mjs`, so it reflects what will actually be scraped. Remember
the 52-region sweep period is fixed by the state count — widening the window
changes dwell/states-per-day, not the sweep length.
