# ADR-029: Production usage reporting and order lifecycle eligibility

- Status: Accepted
- Date: July 2026
- Depends on: ADR-001, ADR-002, ADR-008, ADR-013, ADR-019, ADR-022

## Context

Merchants need an operational report that summarizes the materials and equipment attributed to orders over a selected order-placement date range or across all recorded history. The report must show material consumption and cost, equipment hours and uses, and the consumable portion of equipment cost. This is distinct from the existing donation-period report: it answers production and purchasing questions rather than disbursement questions.

ADR-001 requires immutable, self-contained order snapshots. The existing snapshot detail already freezes production material quantities and costs, equipment usage and component costs, and individual equipment consumable costs. Those records are the authoritative historical inputs for this report; current library or variant configuration must not be used to recalculate past usage.

Several gaps affect the report's meaning:

- material quantity has different semantics for counted, yield-based, and portioned-use materials
- equipment usage can be direct, duration-yield, or use-yield
- the mistake buffer is frozen at the order-line level, not allocated to individual material lines
- cartonization freezes package quantity and total package material cost, but not the individual shipping-material composition
- immutable snapshots do not currently preserve an independently queryable order cancellation or refund lifecycle
- refund adjustments preserve financial deltas but do not preserve a complete line-level refunded-quantity ledger suitable for production-usage filtering

Cancellation and refund state is also required for correct Cause and Artist payable reconciliation. A canceled or fully refunded order must not continue contributing production usage, donation availability, or Artist payable amounts. A partial merchandise refund must reduce the affected quantities and financial allocations without removing unaffected merchandise.

## Decision

### A dedicated Production Usage report

Count On Us will add a dedicated **Production Usage** interface under the Reporting navigation rather than adding this workflow to the donation-period reporting screen.

The report will support:

- Last 30 days as the default range
- Last 90 days and year-to-date presets
- a custom inclusive start and end date
- an explicit All time option
- optional filtering by snapshot origin
- material, equipment, and consumable name search
- CSV export using the same filter and eligibility rules as the screen

Filters will be represented in URL search parameters so a view can be bookmarked and an export can reproduce it. Loader inputs must be validated before querying.

Date filtering uses `OrderSnapshot.createdAt`, which snapshot creation sets from Shopify's order creation timestamp. Until the Shop model records a merchant IANA timezone, date boundaries are UTC and use a half-open interval: start inclusive and the day after the selected end date exclusive. The interface must identify the timezone rather than implying merchant-local dates.

### Immutable snapshot detail remains authoritative

The report will aggregate the monetary and usage values copied into the order snapshot. It must not run `resolveCosts()` against current configuration and must not reconstruct historical values from current library prices, templates, equipment rates, or package composition.

All arithmetic remains `Prisma.Decimal` through aggregation and serialization. Conversion to JavaScript `number` is permitted only at the final rendering boundary when required by a UI component.

### Material aggregation

Material rows will show:

- material name and production/shipping type
- purchase-unit equivalents consumed
- portion uses when applicable
- frozen base material cost
- distinct order count

For each snapshot material line with a positive `perUnitCost`, purchase-unit equivalents are `lineCost / perUnitCost`. The service sums these per-line results rather than dividing aggregated costs by an average price. This produces a comparable consumption measure across counted, yield-based, and portioned-use models while respecting historical price changes. When `perUnitCost` is zero, consumption is unavailable rather than assumed to be zero, and the row is flagged for incomplete source data.

Raw configured quantities and portion uses may be exposed in drill-down or export data, but the primary quantity must be labeled **Purchase units consumed**. The UI must not present unlike material units as one grand quantity total.

Snapshot material line cost excludes the mistake buffer. The report will therefore show the eligible order-line mistake buffer as a separate summary amount. It will not distribute the buffer among material entries using a newly invented allocation rule.

### Equipment aggregation

Equipment rows will show:

- equipment name
- effective operating hours
- effective discrete uses
- frozen total equipment cost
- consumable cost
- electricity, depreciation, maintenance, and manual-rate cost components
- distinct order count

Effective usage is calculated from the frozen usage mode:

- `direct`: stored scaled `minutes / 60` and stored scaled `uses`
- `duration_yield`: `eligible order-line quantity * yieldDurationMinutes / yieldQuantity / 60`
- `use_yield`: `eligible order-line quantity * yieldUses / yieldQuantity`

Missing or non-positive yield quantities produce unavailable usage and a data-quality flag rather than division by zero.

Each equipment row may expand to list its frozen consumable lines, grouped under that equipment, with consumable name, lifespan basis, and total cost. Consumable quantity or replacement count will not be claimed because the current consumable snapshot stores cost and lifespan basis but not enough frozen rate inputs to reconstruct replacement quantities reliably.

Consumable detail exists only when calculated equipment rates captured component lines. Manual equipment rates can contain embedded consumable cost without a separate breakdown. The interface must disclose this limitation and must not imply that an absent breakdown means no consumable cost was incurred.

### Historical identity and names

Rows group by the frozen source ID when it exists:

- `materialId` for materials
- `equipmentId` for equipment
- `consumableId` within its equipment for consumables

This keeps renamed items together. The most recent frozen name in the selected range is the display name. Rows without a source ID use an exact frozen-name-and-type fallback key and are labeled as historical items. Current library records may supply non-financial display metadata such as a unit description, but they must not change the frozen numeric result, and missing current records must not remove historical rows.

### Shipping material scope

Individual cartonized shipping materials are not required for the first version. The first version will:

- report itemized production material snapshot lines
- report legacy shipping material snapshot lines when they exist
- report cartonized packaging separately by frozen package name, package quantity, and total material cost
- avoid joining current `ShippingPackageMaterialLine` rows to historical package allocations

A future schema may add immutable package-material snapshot children for new orders. Existing package allocations will not be retroactively reconstructed from current configuration because doing so would violate ADR-001 and cause historical reports to drift.

### Order lifecycle is separate from the immutable snapshot

Order cancellation and refund state will not be added as mutable fields inside the immutable snapshot tree. The app will introduce a stable, shop-scoped logical order record keyed by `shopId + shopifyOrderId`. The order record owns the pointer to the current snapshot revision. A one-to-one lifecycle projection belongs to that logical order record, so its identity and lifetime do not depend on a replaceable snapshot database ID. Its normalized state will distinguish at least:

- active
- partially refunded
- fully refunded
- canceled
- unknown or review required

The projection will retain relevant Shopify timestamps and financial/cancellation status, its source, and the last source update time. Lifecycle changes are operational state transitions and must be audited without rewriting frozen cost or allocation facts.

Refund processing will additionally persist append-only, shop-scoped refund events keyed by Shopify refund identity and linked to the logical order record, with child facts containing the stable Shopify line-item identity and refunded merchandise quantity. Refund source facts must not depend on a snapshot-line foreign key. The resolver maps them to the current revision by Shopify line-item identity and reports any unresolved mapping. Duplicate and out-of-order webhooks must be idempotent. Lifecycle/refund facts, corresponding financial adjustments, and audit records must be committed atomically.

The lifecycle projection and refund ledger will be populated through all order ingestion paths:

- `orders/create`
- `orders/updated`
- `refunds/create`
- reconciliation jobs
- merchant-triggered historical imports and rebuilds

Historical import formats must parse cancellation, financial status, refunded totals, and line-level refund information when the source provides them. Missing lifecycle evidence must not be silently treated as confirmed active data for finalized reporting. Such records enter an unknown/review-required state and are counted in a visible data-quality exclusion until reconciled or reviewed.

Existing snapshots require a lifecycle backfill before the report can be treated as complete. Shopify-backed snapshots should be reconciled from Shopify. Imported snapshots should use preserved import evidence where possible and otherwise remain explicitly unknown.

### Reporting rebuild and snapshot replacement

Ordinary reporting rebuild and snapshot replacement have different responsibilities, and both must incorporate lifecycle eligibility.

An ordinary period or full-history reporting rebuild will preserve order lifecycle projections and append-only refund events as source evidence. It will rematerialize Cause allocations, Artist allocations, payable summaries, production-usage rollups if introduced, and other derived reporting state from the combination of:

- immutable snapshot facts
- preserved lifecycle and refund facts
- effective append-only financial adjustments

It must not restore canceled or refunded merchandise merely because it is rebuilding from the original snapshot. Rebuild output must use the same eligibility resolver as the live reporting path.

Snapshot replacement changes the snapshot and its child database IDs. The replacement workflow must therefore treat lifecycle preservation and rebinding as part of the replacement operation, not as an optional later cleanup step. In particular:

- lifecycle identity remains attached to `shopId + shopifyOrderId` and is never reset to active merely because a new snapshot was created
- absent lifecycle fields in an uploaded or refetched replacement payload do not erase newer or more complete lifecycle evidence
- explicit lifecycle fields are merged using source authority and source update time so a stale upload cannot overwrite a newer Shopify reconciliation
- refund event children are mapped to replacement lines by stable Shopify line-item identity without changing the source facts
- unresolved refund lines place the order in review-required state and block finalized reporting for the affected order
- lifecycle/refund-derived adjustments are recalculated against the replacement snapshot and recreated as the delta needed to reach the retained target state
- merchant-entered adjustments, packaging reconciliation, and other adjustment evidence that cannot be derived from lifecycle facts must be deterministically preserved/remapped or cause replacement to stop for explicit destructive review
- affected reporting periods are marked for rebuild, and any requested immediate rebuild uses the rebound lifecycle state

Snapshot replacement must create and activate a new immutable revision rather than delete the prior revision. Revision creation, lifecycle/refund mapping, adjustment reconciliation, replacement audit logging, current-pointer update, and affected-period invalidation must commit as one transaction. A failed mapping or reconciliation rolls back the replacement and leaves the prior current revision active.

Replacement dry run must report, in addition to snapshot cost changes:

- current and proposed lifecycle state
- recorded refund count and refunded merchandise quantities
- refund lines that can and cannot map to proposed replacement lines
- lifecycle-derived and independently preserved adjustments
- old and proposed eligible production quantities
- old and proposed Cause and Artist payable impact
- affected open and closed reporting periods

Reporting rebuild does not repair missing lifecycle evidence by itself. It consumes the best authoritative state already present and continues to exclude unknown/review-required orders. Lifecycle repair belongs to Shopify reconciliation, import correction, or an explicit merchant review workflow.

### Required refactoring

The current snapshot replacement path deletes the existing `OrderSnapshot` and its cascading children inside `createSnapshot()`, then writes the replacement audit record from the caller after that transaction completes. That structure cannot satisfy the lifecycle-preservation and atomicity requirements above. The implementation must be refactored around a stable order aggregate and immutable snapshot revisions.

#### Stable order aggregate and snapshot revisions

Introduce a stable logical order model, referred to here as `OrderRecord`, with at least:

- `id`
- `shopId`
- `shopifyOrderId`
- `currentSnapshotId`, nullable while an event exists before its snapshot
- creation and update timestamps
- a unique constraint on `shopId + shopifyOrderId`

`OrderSnapshot` becomes an immutable revision belonging to `OrderRecord`. It retains copied Shopify identity and order-time data so each revision remains independently auditable, and adds revision metadata such as:

- `orderRecordId`
- monotonically increasing revision number
- snapshot-recorded timestamp distinct from Shopify order-placement time
- replacement source and replacement reason where applicable

The existing uniqueness rule that permits only one snapshot for `shopId + shopifyOrderId` must be replaced by revision identity. `OrderRecord.currentSnapshotId` is the authoritative pointer used by current reports and payable calculations. Creating a replacement adds a new revision and atomically moves the pointer; it does not delete or mutate the prior revision.

Existing snapshots are migrated into one `OrderRecord` each as revision 1 and become that record's current snapshot. The migration must be shop-scoped, deterministic, resumable, and covered by a production-data backfill test.

#### Stable lifecycle, refund, and adjustment evidence

Add source-evidence models independent of snapshot revision IDs:

- `OrderLifecycle` belongs one-to-one to `OrderRecord`
- `OrderRefundEvent` belongs to `OrderRecord` and is uniquely identified by shop and Shopify refund ID
- `OrderRefundLine` belongs to a refund event and stores Shopify line-item identity, refunded merchandise quantity, and source amounts when available
- `OrderAdjustmentEvent` represents durable correction evidence such as a merchant adjustment or other non-snapshot operational fact

Per-revision `Adjustment` rows may remain the materialized financial application used by existing calculations, but each derived row must identify its stable source event. Idempotency must be enforced by a database uniqueness rule at the source-event and target-revision-line boundary, not inferred from reason text. Prior-revision applications remain attached to prior revisions for audit; current calculations follow only the current snapshot revision and its applications.

Every adjustment type must declare an explicit snapshot-replacement policy:

| Adjustment source | Replacement behavior |
| --- | --- |
| Refund or cancellation | Regenerate from lifecycle/refund evidence against the new revision |
| Merchant manual adjustment | Reapply the stable adjustment event to the matching replacement line |
| Packaging reconciliation | Recompute from the replacement snapshot and preserved packaging evidence/configuration permitted by its governing workflow |
| Order update | Determine whether the replacement payload already incorporates the update; apply only the remaining delta |
| Unknown or unsupported type | Block replacement for explicit review |

An adjustment must never be copied blindly. If a stable Shopify line-item identity cannot map a required event to the replacement revision, the order becomes review required and replacement does not commit unless a separate destructive-resolution flow is explicitly invoked.

Existing `Adjustment` rows require a migration to stable adjustment events before revision-based replacement is enabled. Their `type`, actor, audit evidence, and line identity determine the migration policy. Ambiguous adjustments must be reported for merchant review rather than discarded.

#### Split candidate construction from persistence

Refactor the current all-in-one snapshot service into explicit operations:

1. Build and validate a snapshot candidate from the Shopify/import payload and current configuration without deleting existing data.
2. Persist a candidate as a new immutable revision using a caller-provided Prisma transaction client.
3. Reconcile lifecycle eligibility and materialize the revision's required adjustments from stable events.
4. Activate the revision by updating `OrderRecord.currentSnapshotId` only after all validation and reconciliation succeeds.

External provider refreshes may be prepared before opening the database transaction, but authoritative database reads used for cost resolution and every replacement write must use the transaction client. The replacement transaction must lock or compare the expected current revision so concurrent webhook, refund, reconciliation, or replacement jobs cannot activate conflicting revisions.

Initial snapshot creation, historical import, reconciliation-created snapshot creation, and merchant replacement must use the same candidate/persistence primitives. They differ in authorization, provenance, and replacement safeguards, not in how snapshot children are written.

#### Dedicated replacement orchestrator

Move replacement responsibility out of `createSnapshot()` into a dedicated server-only service. Its transaction will:

1. authenticate the logical order by `shopId + shopifyOrderId` and verify the expected current revision
2. create the new immutable snapshot revision and all child detail
3. merge lifecycle evidence without allowing missing or stale payload fields to erase newer state
4. resolve refund and adjustment events to replacement lines
5. materialize the lifecycle target and other permitted adjustment applications
6. verify resulting production, Cause, Artist, and financial eligibility
7. update the current snapshot pointer
8. invalidate or mark affected reporting periods for rebuild
9. write replacement and financial audit records

All nine steps commit or roll back together. Queueing optional follow-up work occurs only after commit. The orchestrator returns an explicit result containing old and new revision IDs, lifecycle state, mapping exceptions, adjustment results, and affected periods.

#### Shared eligibility and financial reconciliation services

Extract a pure, Decimal-based eligibility resolver that accepts immutable line quantities plus normalized lifecycle/refund facts and returns eligible quantity/fraction and data-quality state. Production Usage, Cause allocation materialization, Artist allocation materialization, payable summaries, reporting close, exports, and rebuilds must use this resolver or a regression-tested equivalent shared service.

Extract lifecycle financial reconciliation from webhook-specific refund handling. `orders/updated`, `refunds/create`, imports, daily reconciliation, and snapshot replacement will all record/merge evidence and invoke the same target-state reconciler. The reconciler compares the current revision's effective applied state with the desired retained state and creates only the missing Decimal delta.

Refund or lifecycle events may arrive before a snapshot. `OrderRecord` and its source evidence can exist with no current snapshot; reconciliation is deferred and retried when the first revision is activated. This prevents webhook ordering from losing cancellation or refund truth.

#### Rebuild service changes

Period and full-history rebuild services must query only each `OrderRecord.currentSnapshotId`, join the logical lifecycle/refund evidence, and invoke the shared eligibility resolver. They preserve all order records, snapshot revisions, lifecycle facts, refund events, adjustment events, prior-revision applications, audit logs, and external payment evidence.

Snapshot replacement and reporting rebuild remain separate commands. A replacement may request a post-commit reporting rebuild, but the reporting rebuild consumes the newly activated revision and preserved lifecycle state; it does not create another snapshot revision.

#### Import, webhook, and UI changes

Order payload validation schemas must retain Shopify cancellation, financial status, refund, source update timestamp, and stable line-item identity fields. Historical imports must surface missing lifecycle data during dry run. Webhook processors should delegate to lifecycle ingestion and reconciliation services rather than embed refund-only financial rules.

The Imports & rebuild interface must distinguish **Rebuild reporting** from **Replace snapshot revision**. Replacement dry run and confirmation show the lifecycle/refund/adjustment mapping described above. Closed periods, paid allocations, unresolved stable line identities, ambiguous migrated adjustments, and unknown lifecycle state require explicit blocking or the stronger destructive workflow defined by ADR-019.

#### Safe rollout sequence

This refactor will ship additively before removing the legacy single-snapshot assumptions:

1. Add stable order, lifecycle, refund-event, adjustment-event, and revision fields without changing existing readers.
2. Backfill one order record and revision-1 pointer for every existing snapshot, then verify counts and shop isolation.
3. Dual-write lifecycle/refund evidence from webhooks, imports, and reconciliation while existing financial behavior remains observable for comparison.
4. Migrate existing adjustments to stable events and quarantine ambiguous records for review.
5. Reconcile existing Shopify-backed lifecycle state and classify imported records with missing evidence as review required.
6. Switch reporting, payable, close, export, and rebuild reads to current revisions plus the shared eligibility resolver.
7. Enable immutable revision replacement only after migration verification and replacement regression tests pass.
8. Enable Production Usage reporting after lifecycle coverage and exclusion counts meet the release acceptance threshold.
9. Remove the legacy `shopId + shopifyOrderId` snapshot uniqueness and delete-and-recreate replacement path only after no callers depend on them.

Replacement must remain disabled during any migration state in which lifecycle, refund, or adjustment evidence cannot be preserved deterministically. Each backfill step records resumable progress and produces counts suitable for operator verification before the next read path is enabled.

### Eligibility rules

Production usage eligibility is merchandise-line-aware:

- canceled orders contribute zero
- fully refunded orders contribute zero
- partially refunded merchandise contributes only its unrefunded line quantity
- unaffected lines on a partially refunded order remain eligible
- refunds without merchandise quantity, such as a shipping-only refund or goodwill adjustment, affect financial reconciliation but do not reduce production usage
- unknown/review-required orders are excluded from finalized totals and surfaced as an excluded-order count

For an eligible fraction `remaining merchandise quantity / original snapshot-line quantity`, the report applies that fraction to the line's frozen material quantities and costs, equipment usage and component costs, consumable costs, and separate mistake-buffer amount. Values are clamped between zero and the original quantity so duplicate or malformed source events cannot create negative usage.

This report represents usage attributed to retained merchandise orders. It is not proof that an item physically entered production, was returned to inventory, or was scrapped.

### Donation and Artist payable reconciliation

The same normalized lifecycle and refund facts will drive financial eligibility. Cancellation and refund processors must reconcile toward an effective target state rather than blindly append the full reversal represented by each arriving event. This prevents double reversal when, for example, an order cancellation update and its refund webhook arrive separately or out of order.

Financial corrections remain append-only `Adjustment` records under ADR-001. A lifecycle reconciliation service will compare the effective financial state already represented by snapshot values and adjustments with the target retained state, then append only the required delta. Cause and Artist allocation summaries, reporting-period close, outstanding payable calculations, and public reconciliation must consume that adjusted effective state.

Lifecycle records do not replace adjustments: lifecycle/refund facts explain what happened, while adjustments preserve how the immutable financial snapshot was corrected.

### Query and performance strategy

The reporting service will select only required columns, include parent line/order data in the same bounded queries, and aggregate in batches using cursor pagination. It must not issue queries inside a per-row loop or load an unbounded all-time detail set in one query.

The first implementation will aggregate in the application layer because model-aware yield calculations and lifecycle eligibility do not map cleanly to a single Prisma aggregate. Raw SQL will not be introduced. If measured volume later requires materialized rollups, those rollups must preserve the same snapshot and lifecycle semantics and be rebuildable from authoritative records.

## Consequences

### Benefits

- merchants receive a stable production and purchasing report based on order-time cost facts
- renamed, inactive, and deleted library items remain historically reportable
- equipment consumables and other component costs remain auditable
- material quantities are labeled according to a consistent purchase-unit interpretation
- canceled and refunded merchandise no longer overstates production demand, Cause availability, or Artist payables
- one lifecycle model serves live webhooks, imports, reconciliation, production reporting, and financial reporting
- immutable prior snapshot revisions and their applied adjustments remain available for audit after replacement
- immutable snapshots remain unchanged

### Costs

- order lifecycle requires new schema, webhook processing, import mapping, reconciliation, and backfill work
- the current single-snapshot replacement path must be replaced with a stable order aggregate and revision migration
- existing adjustments need provenance migration before replacement can safely preserve or regenerate them
- partial refund eligibility adds line-level aggregation complexity
- unknown historical lifecycle state can temporarily exclude orders and must be disclosed
- individual cartonized shipping materials remain unavailable until future snapshot detail is introduced
- manual equipment rates cannot provide a reliable consumable breakdown
- all-time reports require batched reads and may eventually justify rebuildable rollups

## Alternatives considered

**Group and filter only from current library configuration** - Rejected. Current names, prices, rates, and package composition can differ from the values used when an order was placed.

**Treat every snapshot as eligible and rely only on aggregate refund adjustments** - Rejected. Adjustments do not currently provide complete merchandise lifecycle and line-quantity facts, and cancellation may not alter line totals.

**Mutate the order snapshot with current lifecycle status** - Rejected. Cancellation and refund status changes after placement and should not blur the boundary around immutable financial facts.

**Continue deleting and recreating the only snapshot, then copy selected children** - Rejected. Cascading deletion can destroy adjustment and operational evidence, copying cannot reliably distinguish durable facts from derived applications, and a failure between replacement and audit/reconciliation can expose inconsistent state.

**Remove an entire order after any partial refund** - Rejected. It would understate retained merchandise and unrelated production lines. Partial merchandise refunds are applied to affected line quantities only.

**Infer historical shipping-material composition from the current package definition** - Rejected. Package contents can change and would make old reports drift.

**Allocate mistake buffer proportionally to each material** - Rejected for the first version. The snapshot does not freeze such an allocation, so presenting one as historical fact would be misleading.

## Testing requirements

Regression coverage must include:

- shop isolation for every lifecycle and report query
- UTC date boundaries, custom ranges, and All time
- counted, yield-based, and portioned-use material aggregation
- direct, duration-yield, and use-yield equipment aggregation
- zero-cost and invalid-yield data-quality behavior
- equipment component and nested consumable totals
- stable-ID grouping across renamed entries and fallback grouping without IDs
- separate mistake-buffer totals
- package-level reporting without current-definition reconstruction
- active, canceled, fully refunded, partially refunded, and unknown eligibility
- merchandise versus non-merchandise refunds
- duplicate and out-of-order order/refund events
- delta-based financial reconciliation without double reversal
- historical import lifecycle parsing and existing-snapshot backfill behavior
- ordinary reporting rebuild preserving lifecycle/refund evidence and applying eligibility
- snapshot replacement preserving logical lifecycle identity across changed snapshot IDs
- refund-line rebinding to replacement lines and rollback on unresolved required mappings
- replacement adjustment regeneration without losing independent/manual adjustments
- stale or incomplete replacement payloads not resetting newer lifecycle state
- migration of existing snapshots to stable order records and revision 1
- migration of existing adjustments to stable source events, including review-required ambiguity
- retention of prior snapshot revisions and their adjustment applications
- concurrent replacement/refund processing activating only one valid current revision
- refund or cancellation evidence arriving before initial snapshot creation
- post-commit job dispatch occurring only after successful replacement activation
- consistency between on-screen results and CSV export
- browser coverage for range selection, All time, tabs, expansion, empty states, exclusions, and export
