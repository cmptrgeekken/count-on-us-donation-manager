# Pending Questions

This document tracks product or architectural questions that came up during the remaining-issues implementation pass.
It is intentionally lightweight so decisions can be reviewed later without blocking current development.

## Open Questions

### `#45` Shopify charge sync completion scope

- The core Shopify Payments charge sync service, jobs, and reporting integration appear to be implemented already.
- It is not yet clear whether `#45` still needs:
  - a merchant-facing manual sync or troubleshooting control surface
  - additional reporting visibility beyond what already exists
  - or simply issue/status cleanup plus final validation

### Country-aware tax guidance rollout

- `#75` exists for exploring country-aware tax estimation guidance.
- The near-term question is whether the first implementation should be:
  - curated links and presets for a small country set
  - a country-to-guidance mapping driven by shop locale/country
  - or a broader settings architecture that can grow into localized tax help later
