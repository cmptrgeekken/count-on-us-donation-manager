# Phase 3 Kickoff Checklist

Use this document as the practical start-of-work checklist for Phase 3.

It complements `phase-3-implementation-plan.md` by breaking the first tranche into concrete prep, verification, and sequencing steps for the current repo state.

## Current baseline

Before starting Phase 3 implementation, the repo already has:

- completed Phase 2 cost model flows
- staged save/discard on template and variant detail pages
- shared localization wired to shop currency and request locale
- migration off Shopify React dependencies
- Playwright coverage for:
  - template details save/discard
  - variant details save/discard
  - variants bulk assignment

## Remaining preparation tasks

These should happen before the first substantive Phase 3 feature branch is opened.

### 1. Confirm `main` is stable

- Run `npx tsc --noEmit`
- Run `npm run lint`
- Run `npm test`
- Run `npm run test:ui`
- Smoke test in Shopify admin:
  - Materials add/edit/deactivate
  - Equipment add/edit/deactivate
  - Template details save/discard
  - Variant details save/discard
  - Variants bulk assignment

### 2. Update Shopify app configuration

Current scopes already cover:

- `read_orders`
- `read_metaobjects`
- `write_metaobjects`
- `write_products`

Still needed:

- add webhook subscriptions for:
  - `orders/create`
  - `orders/updated`
  - `refunds/create`
- verify whether any additional scope or approval is required for protected customer data handling before production rollout

### 3. Lock the Phase 3 branch strategy

Recommended first tranche:

1. Prisma schema and tenant scoping
2. Cause metaobject definition and Cause CRUD
3. Product cause assignment and product metafield sync
4. Snapshot schema-adjacent service scaffolding
5. Order webhook and job wiring

Do not start with:

- order history UI
- reconciliation job
- business expenses UI

Those depend on the snapshot data model being stable first.

## Recommended implementation order

### Tranche A: Data model foundation

- Add Phase 3 Prisma models:
  - `Cause`
  - `ProductCauseAssignment`
  - `OrderSnapshot`
  - `OrderSnapshotLine`
  - `OrderSnapshotMaterialLine`
  - `OrderSnapshotEquipmentLine`
  - `OrderSnapshotPODLine`
  - `LineCauseAllocation`
  - `Adjustment`
  - `BusinessExpense`
  - `TaxOffsetCache`
- Update `app/db.server.ts` tenant model allowlist
- Run migration and regenerate Prisma client

Exit check:

- schema migrates cleanly
- Prisma client compiles
- tenant guardrails still work as expected

### Tranche B: Cause foundation

- Add Cause metaobject definition bootstrap service
- Hook definition creation into install flow
- Implement `app.causes.tsx` for cause management
- Add audit logging for cause create/update/status changes

Exit check:

- creating a Cause writes both local DB record and Shopify metaobject
- updating a Cause updates both systems
- inactive causes are preserved correctly

### Tranche C: Product donation assignment

- Implement product-level cause assignment route
- Validate percentage totals
- Sync assignment metafield to Shopify product

Exit check:

- a product can be assigned one or more causes
- totals over 100% are rejected
- metafield payload matches stored DB assignments

### Tranche D: Snapshot scaffolding

- Add `SnapshotService` shell
- Add packaging allocation contract into `CostEngine`
- Define snapshot creation inputs and idempotency rules
- Add initial unit tests for:
  - idempotency
  - packaging override path
  - cause allocation math

Exit check:

- service compiles and is test-covered before webhook wiring begins

### Tranche E: Webhook and job wiring

- add order webhook subscriptions
- wire `orders/create`, `orders/updated`, `refunds/create`
- add job queue processors for snapshot and adjustment flows

Exit check:

- webhook handlers enqueue jobs correctly
- duplicate deliveries do not produce duplicate snapshots

## Testing expectations

Phase 3 should raise the testing bar further than Phase 2.

Add or expand:

- Vitest coverage for:
  - snapshot math
  - packaging allocation
  - cause allocation percentages
  - refund proportional adjustments
  - tax offset cache updates
- Playwright coverage when Phase 3 introduces:
  - new staged editors
  - new modal-driven admin workflows
  - new list selection or bulk-action patterns

For embedded Shopify shell integrations, keep a short manual verification checklist even when Playwright is green.

## Suggested first branch

Recommended first implementation branch name:

- `phase-3-tranche-a-schema-foundation`

Suggested scope for that branch only:

- Prisma schema
- Prisma migration
- tenant model registration
- any required generated client updates
- no route/UI work yet

Keeping the first branch data-model-only will reduce merge risk and give the rest of Phase 3 a clean foundation.
