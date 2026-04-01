# ADR-003: Cost resolution strategy

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | March 2026 |
| **Depends on** | ADR-001, ADR-002 |

## Context

`CostEngine` must calculate net contribution for two distinct purposes with different requirements:

- **Snapshot creation** — costs must reflect reality at the exact moment of order placement and be written atomically to the snapshot. Accuracy is paramount.
- **Live preview** — the storefront widget and admin cost editor need fast cost estimates for display. Staleness of up to one hour is acceptable.

The PRD states that `CostEngine` resolves costs from templates and library items at calculation time via live references — no fan-out jobs when costs change. This ADR pins down exactly what "live references" means, what happens in edge cases (deactivated items, mid-order config changes, POD provider unavailability), and how the resolution result is handed to `SnapshotService`.

## Decision

`CostEngine` always resolves costs from the database at call time. It holds no internal cache and performs no pre-computation. The resolution result is a fully materialised cost structure passed directly to the caller.

For snapshot creation, this structure is written atomically inside a single database transaction. For preview, the result is returned directly to the requesting service.

### Resolution steps

1. **Resolve variant config** — load `VariantCostConfig` for the variant. If none exists, net contribution = sale price (zero-cost variant). No error.

2. **Resolve template and library items** — if a template is assigned, load template line items. For each line item, load the referenced `MaterialLibraryItem` or `EquipmentLibraryItem` — including inactive ones. Status is checked only to warn, not to block resolution.

3. **Apply per-variant overrides** — yield, quantity, and `uses_per_variant` from `VariantMaterialLine` override template defaults. Equipment minutes and uses from `VariantEquipmentLine` override template defaults.

4. **Resolve POD costs** *(snapshot mode only)* — for snapshot creation, fetch live from provider API. For preview, use `ProviderCostCache` (daily-synced). If live fetch fails at snapshot time, fall back to cache, flag snapshot as `pod_cost_estimated`, notify merchant.

5. **Apply packaging cost rule** — packaging cost = max total shipping material cost across all shippable variants in the order. Allocated to line items by revenue share.

6. **Apply mistake buffer** — load global mistake buffer % from `Shop`. Apply to production material total only (excludes shipping materials, equipment, labor, POD).

7. **Return materialised cost structure** — a fully computed object with per-line costs, four category totals, and all fields required by `OrderSnapshotLine` and its three child tables. `CostEngine` never writes to the database — it only returns data.

### Critical ordering — POD fetch before transaction

The gap between `CostEngine` resolving costs and `SnapshotService` committing the transaction must be minimised. POD fetch must complete before the database transaction opens — never hold a DB connection open during an external HTTP call. This is a common source of connection pool exhaustion under load.

Correct ordering:
1. Fetch POD costs from provider API (outside transaction)
2. Open database transaction
3. Call `CostEngine` with POD costs as input
4. Write all snapshot tables atomically
5. Commit transaction

### Snapshot vs preview modes

`CostEngine` is called in two modes. The resolution logic is identical except for POD cost sourcing and the output projection applied:

| | Snapshot mode | Preview mode |
| --- | --- | --- |
| **POD costs** | Fetched live from provider API | Sourced from `ProviderCostCache` |
| **Output** | Full cost structure for persistence | Display-safe projection — never includes net contribution, margins, or purchase prices |
| **Caller** | `SnapshotService` | Storefront widget endpoint, admin cost editor |
| **Persisted** | Yes, atomically in DB transaction | No |

### What CostEngine does not do

- Does not write to the database — returns data only
- Does not hold internal state between calls
- Does not cache resolved costs — caching is the caller's responsibility
- Does not validate whether costs are "reasonable" — validation is the merchant's responsibility via the admin UI
- Does not fan out updates to variants when a library item changes — variants resolve live on next call

## Edge case behaviour

| Scenario | Behaviour | Snapshot flag |
| --- | --- | --- |
| Variant has no cost config | net_contribution = sale price. Widget shows $0 cost rows. Valid — not an error. | None |
| Material library item deactivated | `CostEngine` loads the item regardless of status (soft-delete only, data preserved). Costs resolved from stored values. Merchant notified via admin banner. | None |
| Template deactivated | Same as above — soft-delete only. Variant continues resolving from template. Merchant notified. | None |
| POD provider unavailable at snapshot time | Fall back to most recent `ProviderCostCache` value. Snapshot proceeds. Merchant notified in-app. | `pod_cost_estimated` |
| POD provider unavailable, no cache exists | POD cost recorded as $0. Snapshot proceeds with warning. Merchant must manually review. | `pod_cost_missing` |
| Material price updated mid-order batch | Each snapshot in the batch resolves independently at its own transaction time. Two orders in the same batch may use different prices if a change occurs between them. This is correct behaviour — each order reflects the price at its own moment. | None |
| Variant has both template and manual overrides | Template provides base line items. Per-variant overrides replace template defaults on matching line items. Additional manual line items appended. | None |

## Consequences

### Benefits

- No fan-out jobs when costs change — no background workers, no stale denormalised values to manage.
- Every snapshot reflects the most accurate available cost at order time.
- Simple mental model: `CostEngine` is a pure function from variant + order context to cost structure.
- Deactivated items never cause errors — soft-delete ensures data is always available.

### Costs

- Snapshot creation requires multiple sequential DB reads (variant config, template, library items) on the webhook critical path — must be fast.
- POD live fetch must complete before the DB transaction opens, adding latency to snapshot creation.
- Mid-order price changes within a batch produce slightly inconsistent snapshots between orders — acceptable but worth disclosing (see PRD §16).

## Alternatives considered

**Pre-compute and cache costs on library item save** — Rejected. Fan-out jobs add complexity and introduce a window where cached values are stale. The live resolution model is simpler and guarantees accuracy at snapshot time without background workers.

**Denormalise costs onto VariantCostConfig at save time** — Rejected. This would require updating all variant records whenever a library item changes — expensive for large catalogs and prone to partial-update failures.

**Block snapshot creation on deactivated items** — Rejected. Blocking an order from snapshotting because a merchant deactivated a material item is worse than using the last known value. Soft-delete ensures data is always available.

**Fetch POD costs inside the DB transaction** — Rejected. Holding a DB transaction open during an external HTTP call is a deadlock and timeout risk. POD fetch must complete before the transaction opens, with the result passed in as a parameter.

## Links

- PRD §5.5 (Cost Templates)
- PRD §5.8 (POD Providers)
- PRD §13.2 (Services — CostEngine, SnapshotService)
- PRD §16 (Known Limitations — mid-batch price change)
- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-002](adr-002-dual-track-financial-model.md)
- [ADR-004](adr-004-storefront-widget-data-delivery.md)
