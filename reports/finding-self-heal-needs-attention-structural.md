# Self-heal needs attention: structural

The self-healing agent could not fully recover the pipeline.

**Classification:** `structural`
**Fresh predictions before/after:** 0 -> 0
**Total observations before/after:** 48 -> 48
**stations.json age (h):** 0.0

Price extraction likely broke due to a page/markup change (e.g. __NEXT_DATA__ shape). Run `npm run agent:drift` for candidate fixes, then update inferPrices/selectors in scrapePrices.mjs.

_Filed automatically by selfHeal.mjs._
