# App Store Listing Draft

This draft is the working source for Issue `#62`. It should stay aligned with the implemented product, not the full aspirational PRD.

## App Name

**Proposed name:** `Count On Us`

This name avoids the prohibited use of `Shopify` while still matching the product identity already used in the app and repo.

## Category

**Primary category:** `Finance / Reporting`

## Key Benefits

1. Track donation impact with real cost-aware reporting instead of simple revenue percentages.
2. Show customers transparent donation estimates on product, cart, post-purchase, and receipts surfaces.
3. Keep audit-ready records for reporting periods, disbursements, receipts, tax reserve estimates, and exports.

## Short Description

Track true product costs, calculate donation pools, and show transparent donation impact from storefront to reporting.

## Detailed Description

Count On Us helps cause-driven merchants connect product sales to transparent, audit-ready donation reporting.

Configure your material, equipment, and template costs, assign causes to products, and let the app estimate donation impact before purchase. After orders arrive, Count On Us creates reporting periods, tracks donation allocations, records disbursements, stores receipt evidence, and helps you review tax reserve effects over time.

The app includes:

- cost templates and per-variant cost configuration
- product-level cause assignments
- a storefront donation widget for Online Store 2.0 themes
- cart, post-purchase, and public receipts donation surfaces
- reporting periods, disbursements, receipts, tax true-ups, and exports
- audit log visibility for financial changes

Count On Us is designed for merchants who want charitable giving workflows that stay grounded in real product costs and clear operational reporting.

Current scope note for internal review:

- storefront donation transparency is implemented today
- Provider Connections exists as a real admin foundation page
- full Printify sync, mapping, and POD-backed cost resolution are still being completed and should not be overstated in listing copy until the provider tranche lands

## Platform Requirements / Disclosures

- Online Store 2.0 is required for the storefront widget and cart donation summary app blocks.
- Checkout Extensibility is required for the Thank You / Order Status donation extension.
- Shopify Payments is required for the current reporting and charge-sync experience.
- Public donation receipts are served through an app proxy surface.

## Screenshot Plan

Minimum listing screenshots to capture:

1. **Cost configuration**
   - Variant detail or template detail showing materials, equipment, and cost setup
2. **Donation reporting**
   - Reporting dashboard with a closed period, disbursements, and tax true-up summary
3. **Storefront widget**
   - Product page with the donation widget expanded and visible

Recommended additional screenshots:

4. **Public receipts**
   - Donation receipts page with a closed period and receipt links
5. **Setup wizard**
   - Dashboard checklist / setup wizard for first-run onboarding

## Support / Operations Fields To Fill

- Support contact email: `TODO`
- Support URL: `TODO`
- Response-time commitment: `TODO`
- Privacy policy URL: `TODO`
- DPA request path: `TODO`

## Review Notes

- Keep wording aligned with what is already implemented. Avoid claiming:
  - automatic historical import before app install
  - legacy-theme widget support
  - app embeds where the product currently ships theme app blocks
  - fully automated POD review readiness unless provider review is explicitly in scope
- Re-check this draft after any remaining Phase 6 hardening work lands.
