# Pricing Confidence Bot

Purpose: improve the 95 percent confidence interval used by CaughtaKWH pricing recommendations.

The bot should prioritize stations with no price observations, then stations with low sample counts, then stations with wide confidence ranges, then stale stations that have not been refreshed recently.

Guardrails:
- Do not silently change production logic.
- Generate reports and pull requests for review.
- Keep recommendations conservative.
- Always tell users that Tesla app pricing is the final source before charging.

Planned outputs:
- data/pricing-priorities.json
- reports/confidence-priorities.md
- GitHub issues for low coverage regions
- Pull requests for model improvements
