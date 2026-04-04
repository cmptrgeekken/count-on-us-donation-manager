# Phase 3 Implementation Plan — Count On Us

Use this document as the execution plan for Phase 3.

It turns the build plan and ADR decisions into a concrete implementation sequence for causes, snapshots, adjustments, and related financial workflows. It should stay implementation-oriented and avoid duplicating PRD language unless the detail is needed to build safely.

## Context

Phase 2 is complete and verified. Phase 3 introduces causes, the immutable snapshot system, business expenses, order webhook handlers, and the order history page. This is the most financially critical phase — the correctness of every subsequent report, disbursement, and tax estimate depends on snapshots being created accurately and atomically.

POD provider connections remain deferred (Phase 2.9). The snapshot system is designed to handle this gracefully — POD cost is stored as `Decimal(0)` with no error flag (absence of POD configuration is not a failure condition).

---

## Pre-Phase 3 amendments (complete before starting Phase 3 steps)

The following items from `docs/implementation-backlog.md` must be completed first. They affect the cost model that SnapshotService will consume:

- **PU-1** — Uses-based costing for shipping materials  
- **PU-2** — Searchable pickers + editable lines in template editor  
- **PU-3** — Template line yield/uses overrides per variant (schema migration required)  
- **PU-4** — Default labor hourly rate (schema migration required)  
- **PU-5** — Currency-agnostic display (`Shop.currency` field + shared formatter)

PU-3 in particular affects what `CostEngine` and `SnapshotService` read from the DB — the `CostTemplateLineOverride` table must exist and be consumed by CostEngine before any snapshot is created.

---

## Scoping decisions

- **POD deferred:** CostEngine POD step remains stubbed at `Decimal(0)`. `OrderSnapshotPODLine` schema is added in this phase but no rows will be written. `pod_cost_estimated` and `pod_cost_missing` flags are for when POD is configured but unavailable — they are not set when POD is simply not configured.

- **Packaging cost rule (multi-variant orders):** The Phase 2 CostEngine computes packaging cost for a single variant preview. For snapshot mode, SnapshotService must handle multi-line-item orders: resolve material costs for each line item first, find the max shipping line cost across all variants in the order, allocate that amount by revenue share. CostEngine accepts `packagingCostOverride` as a parameter in snapshot mode; SnapshotService computes the allocation before calling it.

- **TaxOffsetCache in Phase 3:** Schema added now. SnapshotService writes a TaxOffsetCache record after each order commit (computing taxable_exposure inline from the full order history). The Phase 4 hourly ReportingService will replace this per-order write. This design means the storefront widget (Phase 5) always reads from TaxOffsetCache regardless of which service wrote it.

- **No reporting periods in Phase 3:** `taxable_exposure` is computed as a rolling all-time total (`SUM(net_contribution) - deduction_pool`). Reporting periods and period-scoped calculations are Phase 4.

- **Causes in two places:** Causes are stored in both the local DB (`Cause` table) and as Shopify metaobjects. The DB is authoritative for all financial calculations and reporting. Metaobject storage is required for the storefront widget (Phase 5) to read cause data without an app server call. Both are kept in sync by the Cause management service.

- **Shopify scopes required:** `read_orders` must be added to `shopify.app.toml` before order webhooks can be registered. `read_metaobjects` and `write_metaobjects` are required for Cause management. `write_products` is required for product metafields. Update `shopify.app.toml` and redeploy at the start of Phase 3. Note: `orders/create`, `orders/updated`, and `refunds/create` may require Shopify Protected Customer Data approval — apply for this access before beginning Phase 3 webhook work.

---

## Version baseline (unchanged)

- Prisma 6.x — `$extends` middleware, `$transaction` for atomicity
- Polaris 12.x — `Response.json()`, `useNavigate`/`useSearchParams` for in-app navigation
- pg-boss 12.x — explicit `createQueue()` before `work()`
- Remix 2.x

---

## Implementation steps (ordered by dependency)

### Step 1 — Update Shopify scopes and deploy

Before any code changes:

1. Add to `shopify.app.toml` scopes: `read_orders,read_metaobjects,write_metaobjects,write_products`
2. Add webhook subscriptions to `shopify.app.toml`:
   ```toml
   [[webhooks.subscriptions]]
   topics = ["orders/create", "orders/updated", "refunds/create"]
   uri = "https://shopify.mnbecks.com/webhooks"
   ```
3. Run `shopify app deploy` to push scope changes to the Partner Dashboard.
4. Reinstall the app on the dev store to grant the new scopes.

**Verify:** Check `shopify.app.toml` and Partner Dashboard both reflect new scopes. Reinstall completes without errors.

---

### Step 2 — Prisma schema migration

Add to `prisma/schema.prisma`. Run: `npx prisma migrate dev --name phase3_causes_snapshots`

**New models:**

**Cause**
```
id              String    @id @default(cuid())
shopId          String
shopifyMetaobjectId String?         // GID after metaobject is created
name            String
legalName       String?             // legal nonprofit name
is501c3         Boolean  @default(false)
description     String?
iconUrl         String?
donationLink    String?
websiteUrl      String?
instagramUrl    String?
status          String   @default("active")  // "active" | "inactive"
createdAt       DateTime @default(now())
updatedAt       DateTime @updatedAt

@@index([shopId, status])
```

**ProductCauseAssignment** — maps a product to causes with percentages
```
id          String   @id @default(cuid())
shopId      String
shopifyProductId String               // full GID
causeId     String
cause       Cause    @relation(...)
percentage  Decimal  @db.Decimal(5,2) // 0.00–100.00
createdAt   DateTime @default(now())
updatedAt   DateTime @updatedAt

@@unique([shopId, shopifyProductId, causeId])
@@index([shopId])
```

**OrderSnapshot** — one per order
```
id              String   @id @default(cuid())
shopId          String
shopifyOrderId  String                // full GID
orderNumber     String?
createdAt       DateTime @default(now())
origin          String   @default("webhook")  // "webhook" | "reconciliation"

@@unique([shopId, shopifyOrderId])
@@index([shopId])
```

**OrderSnapshotLine** — one per line item in the order
```
id                  String   @id @default(cuid())
shopId              String
snapshotId          String
snapshot            OrderSnapshot @relation(...)
shopifyLineItemId   String
shopifyVariantId    String               // full GID
variantTitle        String
productTitle        String
quantity            Int
salePrice           Decimal  @db.Decimal(10,2)  // unit price
subtotal            Decimal  @db.Decimal(10,2)  // salePrice × quantity

// Four category totals (denormalised for fast reporting) — per unit
laborCost           Decimal  @db.Decimal(10,4)
materialCost        Decimal  @db.Decimal(10,4)
packagingCost       Decimal  @db.Decimal(10,4)
equipmentCost       Decimal  @db.Decimal(10,4)
podCost             Decimal  @db.Decimal(10,4)  @default(0)
mistakeBufferAmount Decimal  @db.Decimal(10,4)
totalCost           Decimal  @db.Decimal(10,4)
netContribution     Decimal  @db.Decimal(10,4)

// Labor audit fields
laborMinutes        Decimal? @db.Decimal(10,2)
laborRate           Decimal? @db.Decimal(10,2)

// Snapshot flags
podCostEstimated    Boolean  @default(false)
podCostMissing      Boolean  @default(false)

@@index([shopId])
@@index([snapshotId])
```

**OrderSnapshotMaterialLine** — full line-item detail per material (ADR-001)
```
id              String   @id @default(cuid())
snapshotLineId  String
snapshotLine    OrderSnapshotLine @relation(...)
materialId      String?              // reference only, not FK
materialName    String               // copied at order time
materialType    String               // "production" | "shipping"
costingModel    String?              // "yield" | "uses" | null
purchasePrice   Decimal  @db.Decimal(10,2)
purchaseQty     Decimal  @db.Decimal(10,4)
perUnitCost     Decimal  @db.Decimal(10,4)
yield_          Decimal? @db.Decimal(10,4)
usesPerVariant  Decimal? @db.Decimal(10,4)
quantity        Decimal  @db.Decimal(10,4)
lineCost        Decimal  @db.Decimal(10,4)
```

**OrderSnapshotEquipmentLine**
```
id              String   @id @default(cuid())
snapshotLineId  String
snapshotLine    OrderSnapshotLine @relation(...)
equipmentId     String?
equipmentName   String
hourlyRate      Decimal? @db.Decimal(10,2)
perUseCost      Decimal? @db.Decimal(10,2)
minutes         Decimal? @db.Decimal(10,2)
uses            Decimal? @db.Decimal(10,2)
lineCost        Decimal  @db.Decimal(10,4)
```

**OrderSnapshotPODLine** — schema only; no rows written until Phase 2.9
```
id              String   @id @default(cuid())
snapshotLineId  String
snapshotLine    OrderSnapshotLine @relation(...)
provider        String   // "printful" | "printify"
costLineType    String   // "base" | "shipping" | "fee"
description     String
amount          Decimal  @db.Decimal(10,2)
```

**LineCauseAllocation** — cause allocations per snapshot line
```
id              String   @id @default(cuid())
shopId          String
snapshotLineId  String
snapshotLine    OrderSnapshotLine @relation(...)
causeId         String
causeName       String   // copied at order time
is501c3         Boolean  // copied at order time
percentage      Decimal  @db.Decimal(5,2)
amount          Decimal  @db.Decimal(10,4)

@@index([shopId])
```

**Adjustment** — append-only corrections (refunds, manual)
```
id              String   @id @default(cuid())
shopId          String
snapshotLineId  String
snapshotLine    OrderSnapshotLine @relation(...)
type            String   // "refund" | "manual"
reason          String?
laborAdj        Decimal  @db.Decimal(10,4)  @default(0)
materialAdj     Decimal  @db.Decimal(10,4)  @default(0)
packagingAdj    Decimal  @db.Decimal(10,4)  @default(0)
equipmentAdj    Decimal  @db.Decimal(10,4)  @default(0)
netContribAdj   Decimal  @db.Decimal(10,4)  @default(0)
createdAt       DateTime @default(now())
actor           String   @default("system")

@@index([shopId])
```

**BusinessExpense**
```
id          String   @id @default(cuid())
shopId      String
category    String   // "inventory_materials" | "operations" | "other"
subType     String?  // "material_purchase" | "cogs_adjustment"
name        String
amount      Decimal  @db.Decimal(10,2)
expenseDate DateTime
notes       String?
createdAt   DateTime @default(now())

@@index([shopId])
```

**TaxOffsetCache** — written per-order in Phase 3, hourly in Phase 4
```
id                  String   @id @default(cuid())
shopId              String   @unique
taxableExposure     Decimal  @db.Decimal(10,2)
deductionPool       Decimal  @db.Decimal(10,2)
cumulativeNetContrib Decimal @db.Decimal(10,2)
widgetTaxSuppressed Boolean  @default(false)
updatedAt           DateTime @updatedAt
```

Also add to `TENANT_SCOPED_MODELS` in `app/db.server.ts`:
```
"Cause", "ProductCauseAssignment",
"OrderSnapshot", "OrderSnapshotLine",
"OrderSnapshotMaterialLine", "OrderSnapshotEquipmentLine", "OrderSnapshotPODLine",
"LineCauseAllocation", "Adjustment",
"BusinessExpense", "TaxOffsetCache",
```

Note: `OrderSnapshotMaterialLine`, `OrderSnapshotEquipmentLine`, `OrderSnapshotPODLine` have no `shopId` field (protected through parent cascade) — do NOT add them to `TENANT_SCOPED_MODELS`. Same pattern as `CostTemplateMaterialLine`.

**Verify:** `npx prisma migrate status` shows three migrations. `npx tsc --noEmit` passes.

---

### Step 3 — Install flow: create Cause metaobject definition

On install, the app must create a Shopify metaobject definition so that Cause records can later be stored as metaobjects for storefront access.

In `app/services/installService.server.ts`, after the existing install steps, add:

```typescript
await ensureCauseMetaobjectDefinition(admin);
```

**`app/services/causeMetaobjectService.server.ts`** (new):

```typescript
export async function ensureCauseMetaobjectDefinition(admin): Promise<void>
```

- GraphQL mutation: `metaobjectDefinitionCreate` with type `"$app:cause"`, fields: `name`, `legal_name`, `is_501c3` (boolean), `description`, `icon_url`, `donation_link`, `website_url`, `instagram_url`, `status`.
- Idempotent — if the definition already exists (Shopify returns a `TAKEN` error), silently continue.
- Audit log: `CAUSE_METAOBJECT_DEFINITION_CREATED`.

---

### Step 4 — Cause management

**`app/routes/app.causes.tsx`** — list page

Loader: `prisma.cause.findMany({ where: { shopId }, orderBy: { name: "asc" } })` with `_count: { select: { productAssignments: true } }`.

Actions: `create`, `update`, `deactivate`, `reactivate`.

- `create`: validate required fields, create DB record, create Shopify metaobject via `metaobjectCreate` mutation, store `shopifyMetaobjectId` on the Cause.
- `update`: update DB record, update Shopify metaobject via `metaobjectUpdate`.
- `deactivate`: blocked if `productAssignments._count > 0` — return error with count. If zero, set `status = "inactive"`, update metaobject status field.
- `reactivate`: always allowed.

UI: `IndexTable` with name, 501(c)3 badge, status badge, used-by count, Edit/Deactivate/Reactivate actions.

Create/edit: `Modal` with fields for all Cause properties. Apply `stopPropagation` on all row interactive elements.

**Verify:** Create a cause → metaobject appears in Shopify admin → deactivation blocked when assigned to a product.

---

### Step 5 — Product cause assignment

**`app/routes/app.products.tsx`** — list (read-only, shows sync status)

**`app/routes/app.products.$productId.tsx`** — cause assignment per product

Loader: fetch `Product` from DB (synced via CatalogSync). Load existing `ProductCauseAssignment` records. Load active Causes.

Actions:
- `save-assignments`: accepts array of `{ causeId, percentage }`. Validate: percentages must sum ≤ 100, each individual percentage > 0. Upsert all assignments within a transaction. Write metafields to Shopify product:
  - Metafield namespace: `donation_manager`
  - Key: `cause_assignments` — JSON array of `{ causeId, metaobjectId, percentage }`
- `remove-assignment`: delete one assignment, update Shopify metafield.

UI: List of active causes with percentage inputs. Live running total showing sum. Hard error if sum > 100. Save and Remove buttons per row. Add cause button.

**Verify:** Assign two causes to a product with total 80% → save → verify metafield written on Shopify product → set to 110% → error shown.

---

### Step 6 — CostEngine: snapshot mode packaging fix

The existing `resolveCosts` function computes packaging as `max(shippingLineCosts)` for the current variant. For multi-line-item orders, the packaging rule is cross-variant (ADR-003 step 5). Update the function signature:

```typescript
async function resolveCosts(
  shopId: string,
  variantId: string,
  salePrice: Prisma.Decimal,
  mode: "snapshot" | "preview",
  db,
  packagingCostOverride?: Prisma.Decimal,  // provided by SnapshotService in snapshot mode
): Promise<CostResult>
```

In snapshot mode, if `packagingCostOverride` is provided, use it directly instead of computing `max(shippingLineCosts)`. In preview mode (no override), compute as before.

SnapshotService will:
1. Call `resolveCosts` once per variant *without* override to get each variant's max shipping cost.
2. Find the max across all variants = the packaging cost for the order.
3. Compute revenue-share allocation: each variant's packaging share = `packagingCost × (variantSubtotal / orderSubtotal)`.
4. Call `resolveCosts` again for each variant *with* `packagingCostOverride` = allocated share.

This is intentionally two passes — the first is lightweight (only shipping lines needed), the second is the full resolution.

---

### Step 7 — SnapshotService

**`app/services/snapshotService.server.ts`** (new)

```typescript
export async function createSnapshot(
  shopId: string,
  shopifyOrderId: string,
  lineItems: ShopifyLineItem[],
  admin: AdminContext,
  db,
): Promise<void>
```

Resolution algorithm (follows ADR-001 + ADR-003 critical ordering):

```
1. Idempotency check: if snapshot already exists for shopifyOrderId → return (no error)
2. POD fetch (outside transaction): currently stubbed → podCosts = {} (all zeros)
3. First-pass cost resolution (outside transaction):
   For each line item:
     - Find variant in DB by shopifyId
     - Call resolveCosts(shopId, variant.id, price, "snapshot", db) — no packaging override
     - Extract max shipping line cost for this variant
4. Compute packaging allocation (outside transaction):
   - packagingCost = max(allVariantMaxShippingCosts)
   - For each variant: variantPackaging = packagingCost × (variantSubtotal / orderSubtotal)
5. Second-pass cost resolution (outside transaction):
   For each line item:
     - Call resolveCosts(shopId, variant.id, price, "snapshot", db, variantPackaging)
     - This gives the final per-unit cost structure
6. Resolve cause allocations (outside transaction):
   For each line item:
     - Load ProductCauseAssignment for this product (by shopifyProductId)
     - Compute LineCauseAllocation amounts: netContribution × percentage / 100
7. Open database transaction:
   a. Create OrderSnapshot
   b. For each line item:
      - Create OrderSnapshotLine (copy all cost fields × quantity where needed)
      - Create OrderSnapshotMaterialLines (copy all fields from resolveCosts materialLines)
      - Create OrderSnapshotEquipmentLines
      - Create OrderSnapshotPODLines (empty for now)
      - Create LineCauseAllocations
   c. Compute TaxOffsetCache update:
      - cumulativeNetContrib = previous value + sum(this order netContributions)
      - deductionPool = SUM(BusinessExpense.amount) + SUM(LineCauseAllocation.amount WHERE is501c3=true)
      - taxableExposure = max(0, cumulativeNetContrib - deductionPool)
      - widgetTaxSuppressed = (taxableExposure <= 0)
      - Upsert TaxOffsetCache
   d. Audit log: ORDER_SNAPSHOT_CREATED
   e. Commit transaction
```

**Error handling:**
- If a variant is not found in DB (not yet synced): enqueue `catalog.sync.incremental` for that product GID, then use `salePrice` as `netContribution` with zero costs and flag the snapshot line with a note.
- If `resolveCosts` throws: log error, do not create snapshot, allow pg-boss to retry (up to 3×).
- DB transaction failures: roll back entirely, allow retry.

**`app/services/adjustmentService.server.ts`** (new — see Step 9)

---

### Step 8 — Order webhook handlers

Update `app/routes/webhooks.tsx` to handle three new topics. Update `app/jobs/processors.server.ts` to add three new queues and processors.

**`orders/create`:**
```typescript
case "orders/create": {
  const order = payload as ShopifyOrderPayload;
  await jobQueue.send("orders.snapshot", {
    shopId: shop,
    shopifyOrderId: order.admin_graphql_api_id,
    lineItems: order.line_items,
  });
  break;
}
```

**`orders/updated`:**
```typescript
case "orders/updated": {
  // Only process if line items or subtotal changed — ignore tag/note/fulfillment changes
  await jobQueue.send("orders.updated", {
    shopId: shop,
    shopifyOrderId: (payload as { admin_graphql_api_id?: string })?.admin_graphql_api_id,
    payload,
  });
  break;
}
```

**`refunds/create`:**
```typescript
case "refunds/create": {
  await jobQueue.send("orders.refund", {
    shopId: shop,
    refundPayload: payload,
  });
  break;
}
```

**Job processors** — add to `QUEUES` array and register workers:

`orders.snapshot`:
- Call `SnapshotService.createSnapshot(shopId, shopifyOrderId, lineItems, admin, prisma)`
- pg-boss `retryLimit: 3`, `retryDelay: 30` (seconds)

`orders.updated`:
- Load existing snapshot. Compare `subtotal_price` and `line_items` against snapshot.
- If no material changes: log and return.
- If subtotal changed: create `Adjustment` records via `AdjustmentService`.

`orders.refund`:
- Extract refunded line items from payload.
- Call `AdjustmentService.processRefund(shopId, refundPayload, admin, prisma)`.

---

### Step 9 — AdjustmentService

**`app/services/adjustmentService.server.ts`** (new)

```typescript
export async function processRefund(
  shopId: string,
  refundPayload: ShopifyRefundPayload,
  admin: AdminContext,
  db,
): Promise<void>
```

For each refunded line item:
1. Find the corresponding `OrderSnapshotLine` by `shopifyLineItemId`.
2. If no snapshot line: log warning and return (order was placed before Phase 3 install).
3. Compute adjustment amounts proportional to refunded quantity:
   - `refundRatio = refundedQuantity / originalQuantity`
   - Each cost category: `adj = -1 × original × refundRatio`
4. Create `Adjustment` record within a transaction.
5. Recompute `TaxOffsetCache` (subtract the refunded `netContribAdj` from cumulative).
6. Audit log: `REFUND_ADJUSTMENT_CREATED`.

---

### Step 10 — Business Expenses page

**`app/routes/app.expenses.tsx`**

Loader: `prisma.businessExpense.findMany({ where: { shopId }, orderBy: { expenseDate: "desc" } })` + current `TaxOffsetCache` record.

Actions: `create`, `delete`.

UI:
- `IndexTable`: date, category, sub-type, name, amount.
- "Add expense" button → `Modal` with fields: category (select), sub-type (select, conditional on category), name, amount, date, notes.
- Running total: total expenses, current deduction pool, current taxable exposure — displayed in a summary card at the top. Updated live after each add/delete.
- Cash-basis assumption note and tax disclaimer shown as informational banner.
- On create/delete: recompute and upsert `TaxOffsetCache`.

**Verify:** Add a business expense. TaxOffsetCache `deductionPool` increases. If deductionPool exceeds cumulativeNetContrib, `widgetTaxSuppressed` becomes true.

---

### Step 11 — Daily reconciliation job

**`app/services/reconciliationService.server.ts`** (new)

```typescript
export async function runReconciliation(shopId: string, admin: AdminContext, db): Promise<void>
```

- Query Shopify Orders API for orders created in the last 7 days: `orders(first: 250, query: "created_at:>DATE")`.
- For each order: check if `OrderSnapshot` exists by `shopifyOrderId`.
- If missing: call `SnapshotService.createSnapshot(...)` with `origin = "reconciliation"`.
- Skip orders where snapshot already exists (idempotent).
- Advisory lock: use pg-boss job scheduling to prevent concurrent runs (one job per shop per day).

Register in `processors.server.ts`: `reconciliation.daily` queue. Schedule via pg-boss `schedule()` method — once per day at 03:00 UTC.

**Verify:** Temporarily disable `orders.snapshot` processor, place a test order, re-enable, run reconciliation manually → snapshot appears with `origin = "reconciliation"`.

---

### Step 12 — Order History page

**`app/routes/app.orders.tsx`** — list

Loader: `prisma.orderSnapshot.findMany` with include of snapshot lines and aggregated cause allocations. Paginate (50 per page, cursor-based). Filter: `origin` (all / webhook / reconciliation), date range.

UI: `IndexTable` with order number, date, line count, total net contribution, origin badge, POD flags. Clicking a row navigates to detail.

**`app/routes/app.orders.$snapshotId.tsx`** — detail

Loader: full snapshot tree — `OrderSnapshot` → `OrderSnapshotLine[]` → all three child tables → `LineCauseAllocation[]` → `Adjustment[]`.

UI: Order metadata card. Per-line cards showing four category totals with expandable detail sections (material lines, equipment lines, cause allocations). Adjustment history at the bottom. POD flag banners where applicable.

---

### Step 13 — Navigation and settings updates

- Add Causes, Products (donations), Orders, and Business Expenses to the sidebar navigation.
- Add `app/routes/app.tsx` nav items in the appropriate groups.
- Add Cause metaobject definition creation to `handlePostInstall` (Step 3 — registered in installService).

---

## Critical files

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add 10 new models |
| `app/db.server.ts` | Extend `TENANT_SCOPED_MODELS` |
| `shopify.app.toml` | New scopes, new webhook subscriptions |
| `app/services/installService.server.ts` | Add metaobject definition creation |
| `app/services/causeMetaobjectService.server.ts` | New — idempotent definition + CRUD |
| `app/services/costEngine.server.ts` | Add `packagingCostOverride` param for snapshot mode |
| `app/services/snapshotService.server.ts` | New — full multi-pass resolution + atomic write |
| `app/services/adjustmentService.server.ts` | New — refund + manual adjustments |
| `app/services/reconciliationService.server.ts` | New — 7-day backfill job |
| `app/jobs/processors.server.ts` | Add orders.snapshot, orders.updated, orders.refund, reconciliation.daily |
| `app/routes/webhooks.tsx` | Handle orders/create, orders/updated, refunds/create |
| `app/routes/app.causes.tsx` | New — Cause CRUD |
| `app/routes/app.products.tsx` | New — product list |
| `app/routes/app.products.$productId.tsx` | New — cause assignment |
| `app/routes/app.expenses.tsx` | New — Business Expenses |
| `app/routes/app.orders.tsx` | New — Order History list |
| `app/routes/app.orders.$snapshotId.tsx` | New — Order History detail |
| `app/routes/app.tsx` | Navigation: add Causes, Products, Orders, Expenses |

---

## Known risks and gotchas

1. **Protected Customer Data scope approval:** `orders/create`, `orders/updated`, and `refunds/create` webhook topics require Shopify's explicit approval for Protected Customer Data access. Apply before starting webhook work. Without approval, these webhooks will not be deliverable from production stores.

2. **Two-pass CostEngine in snapshot mode:** The packaging cost allocation requires resolving all variants in an order before the packaging cost is known. This doubles DB reads for snapshot creation. For large orders this is acceptable — a 20-line-item order does 40 resolveCosts calls instead of 20. Optimise only if profiling shows it's a bottleneck.

3. **Cause assignment at snapshot time:** If a product has no cause assignments, `netContribution` is computed but zero `LineCauseAllocation` rows are written. This is correct — not every product needs a cause. The snapshot is still valid.

4. **TaxOffsetCache race condition:** Two simultaneous orders could both read the same `cumulativeNetContrib` before either commits. Use `prisma.$transaction` with `upsert` for TaxOffsetCache and add an increment-based approach: `cumulativeNetContrib: { increment: thisOrderNetContrib }` rather than reading and writing. Prisma's `increment` is atomic at the DB level.

5. **Variant not found in DB during snapshot:** Can happen for newly-created products that haven't been synced yet. The `products/update` webhook triggers incremental sync, but there's a race window on install. Handle gracefully: enqueue incremental sync, write a partial snapshot with zero costs and a warning flag.

6. **Metaobject definition idempotency:** Shopify returns a `TAKEN` error code if the metaobject definition already exists (e.g., reinstall). The `ensureCauseMetaobjectDefinition` function must check for this error code and continue rather than throw.

7. **`yield_` field name in Prisma:** Prisma doesn't allow `yield` as a field name (reserved keyword in JS). The field is stored as `yield_` in Prisma models and mapped to `yield` in the DB with `@map("yield")`. This is already handled in the existing Phase 2 schema — maintain consistency in snapshot models.

8. **Adjustment amounts are negative:** Refund adjustments reduce net contribution. Store them as negative `Decimal` values. When summing for reporting, `netContribution = snapshotLine.netContribution + SUM(adjustment.netContribAdj)` where `netContribAdj` is negative for refunds. Do not use absolute values.

---

## Phase 3 exit criteria

- Place a test order on dev store → `OrderSnapshot` and all child tables created atomically
- All cost figures match manual calculation (spot-check 2–3 variants)
- Multi-line-item order: packaging cost allocated proportionally by revenue share
- Cause allocations written correctly: `amount = netContribution × percentage / 100`
- Idempotency: duplicate `orders/create` webhook does not create duplicate snapshot
- Partial refund: `Adjustment` records created with correct negative amounts proportional to refunded quantity
- `TaxOffsetCache` updates correctly after each order and each refund
- Surplus absorption (three scenarios):
  - Seed BusinessExpense entries so deductionPool > cumulativeNetContrib → `widgetTaxSuppressed = true`
  - Clear expenses → `widgetTaxSuppressed = false`
  - Partial surplus: only the exposed portion generates tax reserve
- Reconciliation job: places an order with `orders.snapshot` processor disabled → snapshot missing → run reconciliation → snapshot created with `origin = "reconciliation"`, skipped on second run
- Missing TaxOffsetCache (fresh install): SnapshotService handles gracefully, creates one on first order
- Cause deactivation blocked when assigned to a product; allowed after assignments removed
- Product metafields written to Shopify after cause assignment saved
- All Phase 3 pages: error boundaries, keyboard accessible, no colour-only indicators
- `npm run typecheck` passes with zero errors
