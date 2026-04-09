# Seed Data

This project includes a deterministic seed script for generating realistic dev data across multiple months. It is intended for testing reporting, order history, and UI flows without relying on real Shopify payouts.

## Run the seed script

```bash
npm run seed:dev -- --shop=your-dev-store.myshopify.com --reset
```

For a compact App Store review-ready dataset, use the demo preset:

```bash
npm run seed:demo -- --shop=your-dev-store.myshopify.com --reset
```

## Defaults

- `--months`: 6
- `--orders-min`: 20
- `--orders-max`: 30
- `--end-date`: start of the current UTC month
- `--preset`: omitted by default

## Override examples

```bash
npm run seed:dev -- --shop=your-dev-store.myshopify.com --months=9 --orders-min=15 --orders-max=40 --end-date=2026-04-01 --reset
```

```bash
npm run seed:dev -- --shop=your-dev-store.myshopify.com --preset=demo-store --reset --end-date=2026-04-01
```

## Determinism

The data generator uses a deterministic seed derived from:

- `shopId`
- `endDate`
- `months`
- `ordersMin`
- `ordersMax`

To keep the dataset stable across runs, pass a fixed `--end-date` value.

## Seed identification

Seeded Shopify GIDs use a custom scheme so they can be identified and cleaned up safely:

- `gid+seed://shopify/...`

Other seeded rows use a `Seed:` prefix in their name/description fields.

## Notes

- The catalog sync does not delete local products/variants, so seeded data will persist until removed.
- Use `--reset` to clear all data for a shop before reseeding.
- The `demo-store` preset also marks setup wizard steps complete so the review store lands in a more finished state.
- See [demo-store-review-prep.md](./demo-store-review-prep.md) for the manual finish checklist after seeding a reviewer store.

## Reporting cache smoke test

After seeding, refresh the Phase 4 tax offset cache through the local dev helper route:

```text
/ui-fixtures/reporting-tax-offset-refresh
```

Usage options:

- In a normal authenticated local app session, open the route directly while logged into the app.
- For local bypass-based testing, append `?__playwrightShop=your-dev-store.myshopify.com`.

The route returns the computed:

- `taxableExposure`
- `deductionPool`
- `cumulativeNetContrib`
- `widgetTaxSuppressed`

Recommended E2E flow:

1. Seed deterministic data.
2. Hit the refresh route.
3. Confirm the JSON values look reasonable for the seeded scenario.
4. Open Reporting and verify Track 2 reflects the expected deduction / suppression behavior.
