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

### Storefront widget localization and fee detail depth

- The `#53` widget endpoint currently returns donation and tax estimate values in shop currency.
- Managed Markets fee data is currently a placeholder and not yet storefront-aware.
- The follow-up decision is whether:
  - customer-currency donation conversion and Managed Markets applicability should be completed in the endpoint itself
  - or whether those should land with the Theme App Extension work that consumes the endpoint

### Theme App Extension preload strategy

- The current `#54` app block uses a metadata-first storefront strategy:
  - fetch lightweight metadata immediately
  - eager-fetch the full payload on page load for low-line products
  - wait until first open for high-line products
- The follow-up decision is whether this is an acceptable practical interpretation of the preload/lazy ADR, or whether we want to revisit the architecture to pursue a truer page-render-time preload path later.
