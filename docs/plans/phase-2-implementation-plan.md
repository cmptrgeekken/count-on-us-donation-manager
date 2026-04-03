# Phase 2 Implementation Plan — Count On Us

Use this document as the execution plan for Phase 2.

It turns the build plan and ADR decisions into a concrete implementation sequence for the cost-model work. It should stay implementation-oriented and avoid restating product requirements unless they directly affect execution.

## Context

Phase 1 is complete and verified. Phase 2 builds the cost model: schema, CatalogSync, material/equipment/template libraries, variant cost configuration, and CostEngine. POD provider connections (2.9) are deferred to a follow-on. Bulk inline cell editing is replaced with multi-select + template assignment for now.

---

## Scoping decisions

- **POD deferred:** Steps 2.9 (Printful OAuth, Printify, ProviderCostCache, PODSyncService) are out of scope. CostEngine POD step (step 4) is stubbed — returns `{ podCost: 0 }` in both modes.
- **Bulk editor simplified:** No inline cell editing. Multi-select bulk template assignment with overwrite warning. Full inline Tab/Enter/Escape editor is a follow-on.
- **VariantCostSummary:** Implemented as a denormalised `lineItemCount` integer on `VariantCostConfig`, incremented/decremented on every insert/delete of `VariantMaterialLine` and `VariantEquipmentLine`. Not a Postgres view — simpler, same query result.

---

## Version baseline (unchanged from Phase 1)

- Prisma 6.x — uses `$extends` for middleware (not `$use`)
- Polaris 12.x — use `Response.json()` not Remix `json()`
- pg-boss 12.x — explicit `createQueue()` before `work()`
- Remix 2.x

---

## Implementation Steps (ordered by dependency)

### Step 1 — Prisma schema migration

Add to `prisma/schema.prisma`. Also add `mistakeBuffer Decimal? @db.Decimal(5,4)` to the existing `Shop` model.

New models:

**MaterialLibraryItem** — id, shopId, name, type ("production"|"shipping"), costingModel ("yield"|"uses"|null for shipping), purchasePrice, purchaseQty, perUnitCost (derived: purchasePrice÷purchaseQty, stored for query performance), totalUsesPerUnit (nullable, uses-based only), unitDescription, status ("active"|"inactive"), notes, timestamps. Index: [shopId, status].

**EquipmentLibraryItem** — id, shopId, name, hourlyRate (nullable), perUseCost (nullable), status, notes, timestamps. At least one rate required (enforced in service, not DB). Index: [shopId, status].

**CostTemplate** — id, shopId, name, description, status, timestamps. Index: [shopId, status].

**CostTemplateMaterialLine** — id, templateId (FK→CostTemplate, cascade delete), materialId (FK→MaterialLibraryItem), yield (nullable), quantity, usesPerVariant (nullable).

**CostTemplateEquipmentLine** — id, templateId (FK→CostTemplate, cascade delete), equipmentId (FK→EquipmentLibraryItem), minutes (nullable), uses (nullable).

**Product** — id, shopId, shopifyId (full GID), title, handle, status, syncedAt, timestamps. Unique: [shopId, shopifyId]. Index: [shopId].

**Variant** — id, shopId, shopifyId (full GID), productId (FK→Product, cascade delete), title, sku, price Decimal(10,2), syncedAt, timestamps. Unique: [shopId, shopifyId]. Index: [shopId].

**VariantCostConfig** — id, shopId, variantId (FK→Variant, unique, cascade delete), templateId (FK→CostTemplate, nullable), laborMinutes, laborRate, mistakeBuffer (nullable — falls back to Shop.mistakeBuffer), lineItemCount Int default 0 (maintained on insert/delete of material+equipment lines per ADR-004), timestamps. Index: [shopId].

**VariantMaterialLine** — id, shopId, configId (FK→VariantCostConfig, cascade delete), materialId (FK→MaterialLibraryItem), yield (nullable), quantity, usesPerVariant (nullable). Index: [shopId].

**VariantEquipmentLine** — id, shopId, configId (FK→VariantCostConfig, cascade delete), equipmentId (FK→EquipmentLibraryItem), minutes (nullable), uses (nullable). Index: [shopId].

Run: `npx prisma migrate dev --name phase2_cost_model`

**Verify:** `npx prisma migrate status` shows exactly two migrations.

---

### Step 2 — Extend tenant middleware

Add all Phase 2 models to `TENANT_SCOPED_MODELS` in `app/db.server.ts`:

```typescript
const TENANT_SCOPED_MODELS = [
  "Shop", "WizardState", "AuditLog", "DeletionJob",
  "MaterialLibraryItem", "EquipmentLibraryItem", "CostTemplate",
  "CostTemplateMaterialLine", "CostTemplateEquipmentLine",
  "Product", "Variant", "VariantCostConfig",
  "VariantMaterialLine", "VariantEquipmentLine",
];
```

---

### Step 3 — CatalogSync service

**`app/services/catalogSync.server.ts`**

Two exported functions:

`fullSync(shopId, admin)`:
- Cursor-based GraphQL loop — keep fetching until `pageInfo.hasNextPage = false`
- Query: `products(first: 50, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id title handle status variants(first: 100) { nodes { id title sku price } } } }`
- Upsert each product and variant via `prisma.product.upsert` / `prisma.variant.upsert` keyed on `shopifyId`
- Store full Shopify GID strings (e.g. `"gid://shopify/Product/123"`)
- On completion: `prisma.shop.update({ where: { shopId }, data: { catalogSynced: true } })`
- Audit log: `CATALOG_SYNC_COMPLETED` with `{ productCount, variantCount }`

`incrementalSync(shopId, admin, productGid)`:
- Fetch single product + its variants
- Upsert product and all variants
- No `catalogSynced` flag change

Wire into `installService.server.ts`: after `detectAndStorePlan`, enqueue a `catalog.sync` pg-boss job (do not call synchronously).

Add to `app/jobs/processors.server.ts`:
- Register queues: `catalog.sync`, `catalog.sync.incremental`
- `catalog.sync` worker: calls `fullSync` — needs offline session token to build admin context. Use `PrismaSessionStorage` to retrieve the offline session, construct a `@shopify/shopify-api` REST/GraphQL client from it.
- `catalog.sync.incremental` worker: calls `incrementalSync`

---

### Step 4 — CostEngine

**`app/services/costEngine.server.ts`** — pure function, no DB writes.

```typescript
type CostEngineMode = "snapshot" | "preview";

async function resolveCosts(shopId: string, variantId: string, mode: CostEngineMode, prismaClient): Promise<CostResult>
```

Resolution steps (ADR-003):
1. Load `VariantCostConfig` including template + all material/equipment lines + library items (one query with includes)
2. Load `Shop.mistakeBuffer` for fallback
3. Merge lines: template lines are base; variant lines override by materialId/equipmentId
4. **POD step (stubbed):** return `{ podCost: new Decimal(0), podLines: [] }` — full implementation in Phase 2.9
5. Packaging rule: `max(lineCost)` across all shipping material lines (type="shipping"). If no shipping lines: 0.
6. Mistake buffer: `sum(production material line costs) × mistakeBufferPct` where `mistakeBufferPct = config.mistakeBuffer ?? shop.mistakeBuffer ?? 0`
7. Return full structure

Formulas (use `Prisma.Decimal` arithmetic throughout — no JS float):
- Yield-based: `(purchasePrice / purchaseQty / yield) * quantity`
- Uses-based: `(purchasePrice / purchaseQty / totalUsesPerUnit) * usesPerVariant`
- Equipment: `(hourlyRate * minutes / 60) + (perUseCost * uses)` — treat nulls as 0
- NetContribution (snapshot mode only): `salePrice - labor - materials - packaging - equipment - mistakeBuffer - pod`

Preview mode: omit `netContribution`, omit `purchasePrice` and `perUnitCost` from line items.

Edge cases:
- No `VariantCostConfig`: return all-zero result (not an error)
- Deactivated library item: load and compute anyway (soft-delete transparent to CostEngine)
- Zero-cost variant (no lines): valid, returns zeros

---

### Step 5 — Settings: mistake buffer field

Add to `app/routes/app.settings.tsx`:
- Load `Shop.mistakeBuffer` in loader
- New Card section "Cost Defaults" with a percentage TextField for mistake buffer
- New `intent = "update-mistake-buffer"` action: validate 0–100, store as decimal (e.g. 5% → 0.05), audit log `MISTAKE_BUFFER_UPDATED`

---

### Step 6 — Material Library page

**`app/routes/app.materials.tsx`**

Loader: all `MaterialLibraryItem` for shop + usage counts (COUNT of `CostTemplateMaterialLine` + `VariantMaterialLine` per item).

Actions (intent-based):
- `create`: validate, derive `perUnitCost = purchasePrice / purchaseQty`, create, audit log `MATERIAL_CREATED`
- `update`: same derivation, audit log `MATERIAL_UPDATED`
- `deactivate` / `reactivate`: set status, audit log

UI:
- `IndexTable`: Name, Type, Costing Model, Per-unit cost, Used by (template count + variant count), Status badge
- "New material" button → `Modal` with form
- Form adapts: `costingModel` selector appears only when `type = "production"`; `totalUsesPerUnit` field appears only when `costingModel = "uses"`
- Live per-unit cost preview: computed client-side as user types purchasePrice / purchaseQty
- Deactivation: shows usage count in confirmation modal (not hard-blocked)
- Error boundary

---

### Step 7 — Equipment Library page

**`app/routes/app.equipment.tsx`**

Same structure as materials. Simpler form — no costing model branching.

Actions: `create`, `update`, `deactivate`, `reactivate` — each audit logged.

Validation: at least one of `hourlyRate` / `perUseCost` must be non-null and > 0.

UI: `IndexTable` with Name, Hourly rate, Per-use cost, Used by, Status badge.

---

### Step 8 — Cost Templates

**`app/routes/app.templates.tsx`** (list) + **`app/routes/app.templates.$templateId.tsx`** (detail)

List loader: templates + line counts + variant usage count per template.
Actions on list: `create` (name + description), `deactivate`, `reactivate`.

Detail route:
- Loader: single template + all lines (with library item data) + available materials + available equipment
- Actions: `update-meta` (name/description), `add-material-line`, `update-material-line`, `remove-material-line`, `add-equipment-line`, `update-equipment-line`, `remove-equipment-line`
- On `remove-material-line` / `remove-equipment-line`: no `lineItemCount` update here — that's on `VariantCostConfig`, not templates
- Live cost preview on add/update line: compute from library item values + form inputs using same formulas as CostEngine
- All mutations audit logged

---

### Step 9 — Variant Cost Configuration

**`app/routes/app.variants.tsx`** (list + bulk assign) + **`app/routes/app.variants.$variantId.tsx`** (detail)

**List route:**
- Loader: all variants with product title, SKU, price, template assigned (if any), `hasConfig` bool
- Filter by product (select), by configured/unconfigured (toggle)
- `IndexTable` with multi-select
- Bulk action "Assign template": opens modal with template picker → on confirm, upserts `VariantCostConfig` for each selected variant with the chosen templateId. If any selected variants already have a config, show overwrite warning with count before confirming.

**Detail route (`app.variants.$variantId.tsx`):**
- Loader: variant + product info + full `VariantCostConfig` (with all lines + library items) + available templates + available materials + available equipment
- Actions:
  - `assign-template`: sets `templateId` on config (creates config if missing)
  - `remove-template`: sets `templateId = null`
  - `update-labor`: sets `laborMinutes` + `laborRate`
  - `update-mistake-buffer`: sets `config.mistakeBuffer`
  - `add-material-line`: creates `VariantMaterialLine`, increments `config.lineItemCount`
  - `remove-material-line`: deletes line, decrements `config.lineItemCount`
  - `add-equipment-line`: creates `VariantEquipmentLine`, increments `config.lineItemCount`
  - `remove-equipment-line`: deletes line, decrements `config.lineItemCount`
- Live cost preview section: calls a server action `preview-cost` that runs `resolveCosts(shopId, variantId, "preview", prisma)` and returns display-safe totals
- All mutations audit logged

---

### Step 10 — Webhook + job updates

In `app/routes/webhooks.tsx`, `products/update` already returns 200. Add enqueue of `catalog.sync.incremental` job with the product GID from payload.

In `app/jobs/processors.server.ts`, register the two new catalog sync queues and processors (from Step 3).

---

### Step 11 — Dashboard update

Update `app/routes/app.dashboard.tsx` loader to also fetch:
- `productCount`: `prisma.product.count({ where: { shopId } })`
- `variantCount`: `prisma.variant.count({ where: { shopId } })`
- `configuredCount`: `prisma.variantCostConfig.count({ where: { shopId } })`

When `catalogSynced = true`, replace the sync banner with a summary `Card` showing these three counts and a link to Variants page.

---

## Critical files

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add 10 new models + `mistakeBuffer` on `Shop` |
| `app/db.server.ts` | Extend `TENANT_SCOPED_MODELS` |
| `app/services/catalogSync.server.ts` | New — full + incremental sync |
| `app/services/costEngine.server.ts` | New — pure cost resolution |
| `app/services/installService.server.ts` | Add `catalog.sync` job enqueue |
| `app/jobs/processors.server.ts` | Add catalog sync processors |
| `app/routes/webhooks.tsx` | Add `catalog.sync.incremental` enqueue on `products/update` |
| `app/routes/app.settings.tsx` | Add mistake buffer Card |
| `app/routes/app.materials.tsx` | New — Material Library CRUD |
| `app/routes/app.equipment.tsx` | New — Equipment Library CRUD |
| `app/routes/app.templates.tsx` | New — Template list |
| `app/routes/app.templates.$templateId.tsx` | New — Template detail + line management |
| `app/routes/app.variants.tsx` | New — Variant list + bulk assign |
| `app/routes/app.variants.$variantId.tsx` | New — Variant detail + cost config |
| `app/routes/app.dashboard.tsx` | Add catalog stats |

---

## Known risks and gotchas

1. **CatalogSync pagination:** Loop until `pageInfo.hasNextPage = false` — never assume single page.
2. **Prisma Decimal arithmetic:** Use `new Prisma.Decimal(x)` and `.div()`, `.mul()`, `.add()` — never cast to JS `Number` for financial calculations.
3. **`lineItemCount` maintenance (critical):** Must increment on `add-material-line` AND `add-equipment-line`; decrement on `remove-material-line` AND `remove-equipment-line`. Cascade delete from `VariantCostConfig` is fine (whole config gone). Forgetting either operation breaks the ADR-004 widget threshold query.
4. **Shopify GIDs:** Store full GID strings (`gid://shopify/Product/123`), not numeric IDs — GraphQL API requires them.
5. **`perUnitCost` is always derived on the server:** Never trust a client-submitted value — always recompute as `purchasePrice / purchaseQty` in the action.
6. **CostEngine is pure:** Must never write to DB. Snapshot persistence is the caller's responsibility (Phase 3 `SnapshotService`).
7. **Offline token for catalog sync job:** The `catalog.sync` pg-boss processor runs outside a request context. It must retrieve the shop's offline session from `PrismaSessionStorage`, extract the access token, and construct a `shopifyApi.clients.Graphql` client manually.
8. **Bulk assign overwrite warning:** Show count of affected variants that already have a config before proceeding — do not silently overwrite.

---

## Phase 2 exit criteria

- CatalogSync runs on install → `Shop.catalogSynced = true` → dashboard shows product/variant counts
- `products/update` webhook triggers incremental sync
- Material Library: create, edit, deactivate, usage counts all work
- Equipment Library: same
- Cost Templates: create, edit, add/remove lines, deactivate all work
- Variant list: shows all variants, filters by product and configured status
- Bulk template assignment: works with overwrite warning
- Variant detail: assign template, add/remove override lines, set labor, live cost preview
- `lineItemCount` stays accurate through add/remove operations
- `CostEngine` resolves correctly: yield-based, uses-based, labor, equipment, mistake buffer, deactivated items, no-config variant
- All Phase 2 pages: error boundaries, keyboard accessible, no colour-only indicators
- `npm run typecheck` passes with zero errors
