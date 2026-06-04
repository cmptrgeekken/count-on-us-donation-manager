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

## Import catalog and live-store financial exports

For higher-fidelity dev testing, use the dev-only catalog importer. It imports the
Shopify catalog/cost JSON export plus optional orders, Shopify charges, and payment
transaction CSV exports.

You can create a matching catalog/cost JSON export from an existing Count On Us
tenant with:

```bash
npm run export:catalog -- \
  --shop=source-store.myshopify.com \
  --out=seed-imports/catalog.json
```

This export includes material and equipment libraries, Causes, synced products
and variants, cost templates and template lines, direct variant material/equipment
assignments, variant cost config basics, and product-Cause assignments. Template
rows are exported as source-keyed records and recreated directly by the importer.

For production Docker usage, including `docker compose exec` file streaming for
the read-only app container, see
[Proxmox Docker deployment](./deployment/proxmox-docker.md#production-catalog-exportimport).

Recommended local file names:

```text
seed-imports/catalog.json
seed-imports/orders.csv
seed-imports/charges.csv
seed-imports/payment-transactions.csv
```

The `seed-imports/` folder is gitignored because these exports can contain
live-store financial data.

Preview the import first:

```bash
npm run seed:import:catalog -- \
  --file=seed-imports/catalog.json \
  --orders-csv=seed-imports/orders.csv \
  --charges-csv=seed-imports/charges.csv \
  --payment-transactions-csv=seed-imports/payment-transactions.csv \
  --order-line-map=seed-imports/order-line-map.json \
  --template-candidates-report=seed-imports/template-candidates.json \
  --shop=your-dev-store.myshopify.com \
  --shop-domain=your-dev-store.myshopify.com \
  --reset-shop \
  --normalize-product-status \
  --dry-run
```

Run the import:

```bash
npm run seed:import:catalog -- \
  --file=seed-imports/catalog.json \
  --orders-csv=seed-imports/orders.csv \
  --charges-csv=seed-imports/charges.csv \
  --payment-transactions-csv=seed-imports/payment-transactions.csv \
  --order-line-map=seed-imports/order-line-map.json \
  --shop=your-dev-store.myshopify.com \
  --shop-domain=your-dev-store.myshopify.com \
  --reset-shop \
  --normalize-product-status
```

### Import options

- `--shop`: target tenant/shop ID to seed. Pass this explicitly for dev-store imports.
- `--shop-domain`: Shopify domain to store on the `Shop` row. Defaults to the same value as `--shop`.
- `--reset-shop`: clears imported catalog, reporting, order snapshot, allocation, charge, business expense, and disclosure cache rows for the shop before importing. It keeps the `Shop` row itself.
- `--reset-only`: runs the `--reset-shop` cleanup and exits without importing. Use this to clean up an accidental import under the wrong shop ID.
- `--normalize-product-status`: maps non-standard product statuses from the export into Prisma-supported values.
- `--order-line-map`: local JSON file for matching renamed historical order line names to current catalog variants. Defaults to `order-line-map.json` beside `--orders-csv`.
- `--interactive-order-line-map`: prompts to confirm ambiguous order-line matches when running in an interactive terminal.
- `--fuzzy-order-line-matching` / `--no-fuzzy-order-line-matching`: enables or disables high-confidence fuzzy matching for renamed order line names. Fuzzy matching is enabled by default for order CSV imports.
- `--template-candidates-report`: optional JSON file path for detailed production/shipping template candidates discovered from repeated variant material/equipment patterns.
- `--template-candidate-min-variants`: minimum number of variants that must share a pattern before it is reported as a template candidate. Defaults to `3`.
- `--dry-run`: validates and summarizes the import without writing to the database.

If `--shop` is omitted, the importer derives the shop ID from the JSON export in
this order: `meta.shopId`, the first product `shopId`, then the first cause
`shopId`.

Order CSV rows do not need material or equipment metadata. The importer resolves
order line names back to the imported variants, then derives material, equipment,
labor, mistake buffer, and cause allocations from the seeded variant catalog.
Customer names, emails, addresses, and phone numbers are not persisted.

When historical order line names no longer exactly match current product names,
the importer first checks `order-line-map.json`, then attempts a conservative
fuzzy match against current product/variant display names. High-confidence
matches are saved back to the local mapping file on non-dry runs. Ambiguous or
unresolved lines are imported without catalog-derived costs or cause allocations
and are listed in the import summary for follow-up.

Database primary keys are generated by Prisma during import, so imported rows use
the same CUID format as rows created through the app. The importer assumes
`--reset-shop` is used before reimporting the same shop.

The dry run also reports repeated material/equipment patterns as possible
production and shipping template candidates. Candidate output includes a
suggested template name, the full material/equipment line details, and example
products/variants using that pattern. Pass `--template-candidates-report` to
write the same analysis to JSON for review. This candidate report is
analysis-only; exported `costTemplates` and template line arrays are imported
directly when they are present in the JSON.

If you accidentally imported under the placeholder shop ID, clean it up with:

```bash
npm run seed:import:catalog -- \
  --file=seed-imports/catalog.json \
  --shop=your-dev-store.myshopify.com \
  --reset-only
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
