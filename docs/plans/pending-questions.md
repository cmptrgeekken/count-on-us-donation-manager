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

### Cart donation summary surface breadth

- `#64` adds a cart-page app block for the donation summary modal.
- We should decide whether the long-term storefront expectation is:
  - cart template support only
  - a separate cart drawer-compatible integration surface
  - or both
- That decision affects whether we keep the current block as-is or factor the modal trigger/summary logic into a more reusable storefront bundle later.

### Public donation receipts URL shape

- `#57` uses the current app proxy base path, so the public receipts page lives at `/apps/count-on-us/donation-receipts`.
- Older product/docs language still sometimes implies a shorter `/apps/donation-receipts` path.
- We should decide whether the current proxy base is the long-term canonical storefront URL, or whether we want a broader app-proxy path cleanup later and accept the migration/install constraints that come with it.

### Post-purchase estimate parity for discounted orders

- `#55` currently bases pending order estimates on Shopify Admin order line discounted totals before the authoritative snapshot exists.
- We should confirm whether that is the desired customer-facing approximation, or whether we want tighter parity work later around discounts, shipping allocation, and any order-level adjustments that may cause the confirmed snapshot to differ slightly from the early estimate.

### Post-purchase email provider depth and branding

- `#56` selects a pragmatic transport abstraction with `log` and `resend` drivers so the flow is shippable without forcing a provider SDK install in development.
- We should still decide:
  - whether Resend is the long-term production default
  - whether merchants need a configurable `from` address in-app
  - how much store branding (logo/colors/name treatment) must be present before we consider the donation email production-complete
