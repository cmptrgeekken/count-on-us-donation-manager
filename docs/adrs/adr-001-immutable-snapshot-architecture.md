# ADR-001: Immutable order snapshot architecture

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | March 2026 |
| **Deciders** | Product, Engineering |
| **Supersedes** | PRD §7 (partial) |

## Context

At order creation, the app must record a financially accurate, auditable record of costs, donations, and cause allocations as they existed at that moment. Product costs, cause assignments, and tax settings all change over time — a merchant may update material prices, reassign causes, or change their tax rate between when an order is placed and when a reporting period is closed.

A mutable record would cause historical donation figures to drift as configuration changes, making accurate reporting, disbursement, and audit impossible.

The PRD originally specified four rolled-up cost totals per snapshot line (labor, materials, equipment, packaging). This ADR supersedes that decision and records the rationale for storing full line-item detail instead.

## Decision

At the moment an order webhook fires, the app creates an immutable snapshot record tree. No record in this tree is ever mutated after creation. Refunds and corrections are handled via append-only `Adjustment` records only.

The snapshot is fully self-contained — it does not depend on any library, template, or config record to be meaningful or auditable. Material and equipment names, prices, and all cost fields are copied into the snapshot at order time.

### Rules

- Material and equipment names, prices, and all cost fields are copied at order time. If a merchant later renames or reprices a material, the snapshot is unaffected.
- Four category totals (labor, materials, equipment, packaging) are stored as denormalised sums on `OrderSnapshotLine` for fast reporting queries.
- Full line-item detail is stored in three child tables for audit and drill-down purposes.
- POD cost lines are stored individually per provider line item, not as a single total.
- Cause assignments, percentages, and 501(c)3 status are stored as they are at order time.
- Tax settings (rate, mode, taxable_weight, taxable_exposure, surplus_absorbed) are stored at snapshot time.
- Reconciliation-created snapshots are flagged via the `origin` enum and use current config — a known and disclosed limitation.

### Schema — new tables added by this ADR

**OrderSnapshotMaterialLine**

| Field | Type | Notes |
| --- | --- | --- |
| snapshot_line_id | FK | |
| material_id | VARCHAR | Reference only — not a hard FK |
| material_name | VARCHAR | Copied at order time |
| material_type | ENUM | production / shipping |
| costing_model | ENUM | yield / uses |
| purchase_price | NUMERIC(10,2) | Copied at order time |
| purchase_quantity | NUMERIC(10,4) | Copied at order time |
| per_unit_cost | NUMERIC(10,4) | Copied at order time |
| yield | NUMERIC(10,4) | Nullable — set if yield-based |
| uses_per_variant | NUMERIC(10,4) | Nullable — set if uses-based |
| quantity | NUMERIC(10,4) | |
| line_cost | NUMERIC(10,2) | |

**OrderSnapshotEquipmentLine**

| Field | Type | Notes |
| --- | --- | --- |
| snapshot_line_id | FK | |
| equipment_id | VARCHAR | Reference only |
| equipment_name | VARCHAR | Copied at order time |
| hourly_rate | NUMERIC(10,2) | Nullable |
| per_use_cost | NUMERIC(10,2) | Nullable |
| minutes | NUMERIC(10,2) | Nullable |
| uses | NUMERIC(10,2) | Nullable |
| line_cost | NUMERIC(10,2) | |

**OrderSnapshotPODLine**

| Field | Type | Notes |
| --- | --- | --- |
| snapshot_line_id | FK | |
| provider | ENUM | printful / printify |
| cost_line_type | VARCHAR | base / shipping / fee |
| description | VARCHAR | Copied from provider |
| amount | NUMERIC(10,2) | |

### Updated fields on OrderSnapshotLine

The following fields are added to `OrderSnapshotLine` alongside the existing four category totals:

- `pod_cost NUMERIC(10,2)` — denormalised sum of POD line items
- `labor_minutes NUMERIC(10,2)` — stored for labor audit
- `labor_rate NUMERIC(10,2)` — stored for labor audit
- `mistake_buffer_amount NUMERIC(10,2)` — derived, stored for audit
- Removed duplicate `taxable_exposure_at_order_time` column (was listed twice in original PRD)

### Atomicity requirement

`CostEngine` resolution and snapshot persistence must be wrapped in a single database transaction by `SnapshotService`. If any part of the snapshot write fails — including child tables — the entire transaction rolls back. The webhook handler returns 2xx to Shopify immediately (async processing) but the snapshot is only considered created once the transaction commits.

## Consequences

### Benefits

- Historical reports are stable regardless of config changes.
- Audit trail is complete and tamper-evident — a snapshot from three years ago is fully readable without looking up any other record.
- Charity partners and auditors can see exactly how every cost figure was derived.
- Production Usage Report (v2) can be built directly from snapshot detail without `RecalculationService`.
- Removes the "re-derive analytically" gap where cost changes would produce inaccurate historical breakdowns.
- Disbursements can be made with confidence in the underlying figures.
- No fan-out jobs needed when costs change.

### Costs

- Snapshot creation is more complex — `SnapshotService` must write to four tables, all within a single transaction.
- More storage per order.
- Reconciliation snapshots use current costs, not order-time costs — a known accuracy gap, disclosed in UI and Section 16 of the PRD.
- No ability to "correct" a snapshot — corrections require adjustment records.

## Alternatives considered

**Live calculation from current config** — Rejected. Figures change whenever the merchant edits costs or causes. Impossible to produce stable historical reports or audit-ready records.

**Four rolled-up totals only (PRD original)** — Rejected. `RecalculationService` re-derives from current config, not order-time config. If costs change after an order is placed, the "re-derived" breakdown would be wrong. For an audit-ready financial ledger this is not acceptable.

**Store detail in v2 only** — Rejected. Schema migrations that add detail to existing snapshot records are not possible — past snapshots cannot be retroactively enriched. Starting without detail means the audit gap exists permanently for all v1 orders.

**Store material ID only, look up name from library** — Rejected. If a material is renamed, deactivated, or deleted, the snapshot becomes incomplete or misleading. Self-contained snapshots are simpler to reason about and audit.

**Mutable snapshot with change log** — Rejected. A mutable record with a log is harder to reason about and audit than an immutable record with append-only adjustments. The append-only model is simpler and safer.

## Links

- PRD §7 (Order Snapshot System)
- PRD §12.1 (Core Data Models)
- [ADR-002](adr-002-dual-track-financial-model.md)
- [ADR-003](adr-003-cost-resolution-strategy.md)
