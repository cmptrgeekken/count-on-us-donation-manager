# Demo Store Review Prep

This guide is the practical handoff for Issue `#61` and is meant to make App Store review-store preparation repeatable.

## Seed the review dataset

Use the demo preset to seed a compact but representative shop dataset:

```bash
npm run seed:demo -- --shop=your-dev-store.myshopify.com --reset --end-date=2026-04-01
```

What the preset gives you:

- setup wizard marked complete
- active Causes, including at least one `501(c)(3)` cause
- Materials, Equipment, Production/Shipping Templates
- configured Variants and Product Cause assignments
- multiple Reporting periods with:
  - closed periods
  - Cause allocations
  - logged Disbursements
  - Shopify charge rows
  - Tax true-up history
- post-purchase email enabled

## Manual finish checklist

The seed preset gets the store close to review-ready, but a few items still require manual prep:

1. Confirm the product-page donation widget theme app block is enabled in the Theme Editor.
2. Confirm the cart donation summary theme app block is enabled if you want reviewers to exercise it.
3. Confirm the post-purchase / order-status extension is deployed to the intended review surface.
4. Add or verify at least one representative disbursement receipt upload for the public receipts page.
5. Decide whether POD provider review is in scope:
   - if yes, connect and verify the currently supported provider path
   - if no, note that POD review is intentionally excluded from reviewer instructions

Current recommendation:

- keep POD out of the primary reviewer path until provider completion and storefront hardening work land
- if reviewers will not exercise POD, say so explicitly in the handoff notes rather than implying the flow is fully production-ready

## Recommended reviewer path

1. Open a configured product page and inspect the donation widget.
2. Add the product to cart and inspect the cart donation summary.
3. Place a test order and review the Thank You / Order Status donation summary.
4. Open Reporting and review:
   - closed periods
   - disbursements
   - tax true-ups
   - exports
5. Open the public donation receipts page and verify receipt/disbursement visibility.

## Reviewer instructions to fill in later

- Review store URL:
- Reviewer account email:
- Reviewer password / access flow:
- Theme used for storefront review:
- POD review included:
- Notes for any intentionally unsupported flows:
