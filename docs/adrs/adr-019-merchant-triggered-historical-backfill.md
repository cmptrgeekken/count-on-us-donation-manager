# ADR-019: Merchant-triggered historical backfill

- Status: Proposed
- Date: June 2026
- Depends on: ADR-001, ADR-002, ADR-003, ADR-006, ADR-009, ADR-012

## Context

ADR-006 removed automatic historical order migration on install.

That decision remains correct for the public app install flow:

- automatic import would require broader historical order access
- historical orders may predate Count On Us configuration
- silently applying current configuration to old orders could produce misleading donation history
- new merchants should not see an opaque migration with historical figures they did not intentionally create

However, there is a separate owner-controlled rollout use case.

A merchant may already have a main Shopify store and a prepared Count On Us configuration, then want to import historical Shopify orders, payouts, and charge data so the app can generate reporting history for that store.

For this use case, the merchant understands that imported historical snapshots are generated from the current Count On Us configuration, not from historical storefront-specific cost or cause records.

The app previously had store-specific historical cost/cause import ideas. Those are too bespoke for the general product and should not be the basis for the import feature.

## Decision

Count On Us will support an explicit merchant-triggered historical backfill workflow.

ADR-006 continues to apply to automatic install migration. This ADR creates a separate opt-in workflow for admins who intentionally import historical data.

### Historical imports use current Count On Us configuration

Imported historical orders will be snapshotted using the product, variant, material, equipment, labor, packaging, POD/provider, Cause, Artist, tax, and settings configuration that exists at import time.

The app will not attempt to import historical cost configuration, historical Cause routing, historical artist attribution, or other prior-store bespoke donation data.

Every imported order snapshot should make this explicit through metadata:

- `origin = "historical_import"` or equivalent
- import batch id
- source filename/source type when available
- imported timestamp
- validation warnings when relevant

The imported timestamp must be stored separately from `OrderSnapshot.createdAt`.
For order snapshots, `createdAt` continues to represent the Shopify order date used for period assignment and reporting windows.

This is intentionally less historically precise than true order-time configuration replay, but it is understandable, repeatable, and appropriate for owner-controlled rollout.

Provider-backed POD costs follow the same rule: historical imports use the provider mappings, cached costs, and live/provider fallback behavior available at import time.
The app should not imply that imported historical orders use provider costs that were accurate at the original order date.

### Import scope

The first backfill workflow should support:

- payout/reporting period import
- Shopify charge transaction import
- Shopify order import
- duplicate detection and skip/upsert behavior
- dry-run validation before writing
- full reporting-history regeneration
- single-period reporting regeneration
- explicit order snapshot replacement dry runs and controlled replacement

The workflow should be UI-accessible, likely under Reporting as an "Imports and rebuild" or similar operational page.

### Payout/reporting period import

Payout imports create or update `ReportingPeriod` records.

The natural dedupe key is:

- `shopId + shopifyPayoutId` when a payout id is present

When a payout id is unavailable, the import may use a strict composite fallback such as:

- shop id
- start date
- end date
- source/import batch

The fallback key should be treated carefully to avoid accidentally merging unrelated manually-defined periods.

For the first implementation, a stable payout id should be required unless a dedicated fallback identity model is designed.
This avoids relying on a composite period identity that the current schema does not enforce.

Imported periods should use a source such as `historical_import`.

### Shopify charge import

Shopify charge imports create or update `ShopifyChargeTransaction` rows.

The preferred dedupe key is:

- `shopId + shopifyTransactionId`

If the source data lacks a stable transaction id, import should either require the merchant to provide one or use a conservative synthetic id derived from immutable row fields such as payout id, processed date, amount, currency, transaction type, and description.

Charges should attach to reporting periods by payout id when available, otherwise by processed date within the period window.

Rows that cannot be matched to a period should be imported with warnings or held for review rather than silently discarded.

### Order import

Order imports create `OrderSnapshot` records.

The dedupe key remains:

- `shopId + shopifyOrderId`

Duplicate orders should be skipped by default.

An explicit replacement mode should be available for merchant-controlled correction workflows, but it must not be the default import behavior.

Replacement is useful when:

- a merchant imported historical orders before finishing Count On Us configuration
- a beta or early production shop created webhook snapshots before newer cost-model fields existed
- equipment, consumable, material, package, Cause, or Artist configuration was intentionally corrected and the merchant wants selected snapshots recomputed
- a merchant uploads or refetches original order payloads to backfill richer snapshot line detail

Replacement may apply to both `historical_import` and `webhook` snapshots. Webhook-created snapshots should require stronger confirmation because they represent live operational records, not merely imported bootstrap history.

Replacement should be implemented as a separate operation from ordinary reporting rebuild. Reporting rebuild refreshes period membership and derived allocations. Snapshot replacement recomputes order financial truth and child detail records.

Replacement of an existing snapshot in an open reporting period may be allowed after dry-run review and confirmation.

Replacement of an existing snapshot in a closed reporting period should be blocked by default, but it must be overridable through an explicit force-replace workflow for owner-controlled cleanup. This supports cases where a merchant intentionally wants to recompute a whole site after beta rollout, configuration repair, or newly-added cost model support.

The force-replace workflow should require stronger confirmation than ordinary replacement:

- a dry-run summary for the selected scope
- a clear statement that closed-period donation obligations may change
- typed confirmation or an equivalent deliberate acknowledgement
- a required replacement reason
- an option to rebuild affected reporting periods after replacement
- audit logging for the run and each replaced snapshot

Snapshots associated with payment applications, tax true-ups, public disclosure exports, receipt evidence, or other records that have already been treated as external operational evidence should require an additional destructive reset checklist. These cases are still overridable by the shop owner, but the workflow must make the affected evidence explicit and must not silently discard or orphan payment, receipt, tax, or public disclosure records.

Replacement should require order payload availability. Because `OrderSnapshot` does not currently store the complete Shopify order payload, replacement must either:

- refetch the order from Shopify Admin API
- use a merchant-uploaded order payload
- use a retained import payload if the implementation later stores one

The dry run should compare old and proposed replacement data before writing:

- line count and line mapping status
- old and new material, labor, packaging, equipment, consumable, POD, and mistake-buffer costs
- old and new net contribution
- old and new Cause and Artist allocation basis
- whether the order belongs to an open or closed reporting period
- whether force replacement would be required
- whether payment, receipt, tax, or public disclosure evidence exists
- whether replacement would change reporting totals

The write path should be transactional. It may either:

- create a replacement snapshot and mark the old snapshot as replaced, if the schema supports historical replacement links
- delete and recreate the snapshot under the same `shopId + shopifyOrderId`, if replacement history is captured through audit logs and the current unique constraint makes parallel snapshots impractical

In either case, the operation must write an audit log containing at least:

- old snapshot id
- new snapshot id, when different
- Shopify order id
- replacement reason
- replacement source: Shopify refetch, uploaded payload, or retained import payload
- old and new total cost and net contribution
- old and new line counts
- actor

Replacement should not silently rematerialize period allocations. After replacement, the relevant reporting period should be marked for rebuild or rebuilt explicitly through the reporting rebuild workflow so the merchant can review changed donation and payout obligations.

When a historical order references an unknown product or variant, import should not invent hidden cost or donation configuration.

The dry run should report:

- unknown products
- unknown variants
- variants without cost configuration
- products without Cause or Artist routing
- orders with zero eligible donation allocation
- unsupported row formats
- duplicate orders

The implementation may choose strict failure or warning-based import for incomplete orders, but the preflight summary must make the outcome visible before the merchant confirms.

After import, snapshots should be associated with reporting periods deterministically.
The rebuild service should define whether it updates `OrderSnapshot.periodId`, relies on date-window queries, or does both.
If both are used, `periodId` should be treated as a denormalized assignment derived from the snapshot order date and the imported payout period windows.

### Reporting regeneration

Backfill needs a rebuild operation because payout periods, charges, and imported snapshots may arrive in separate steps.

The app should support:

- rebuild all reporting history
- rebuild one reporting period

Rebuild should delete and recreate derived reporting data, not raw imported source records.

Reporting rebuild must not replace order snapshots or recompute order line cost metadata. Snapshot replacement is a separate workflow because it changes the source records that reporting derives from.

For a normal rebuild, preserve:

- `OrderSnapshot` and child line/detail records
- `ShopifyChargeTransaction`
- `ReportingPeriod` shell records
- actual cause disbursements
- actual artist payments
- payment/disbursement application records
- tax true-up records
- receipt/file references
- audit records

For a period rebuild, derived data may include:

- `CauseAllocation`
- `ArtistAllocation`
- cause payable rows, if present in the schema/implementation
- artist payable rows, if present in the schema/implementation
- analytical recalculation runs or cached recalculation summaries
- computed tax reserve/cache data when it is safe to recreate

The rebuild process must be careful with payment application records. If a `CauseAllocation` or `ArtistAllocation` has disbursement/payment applications, a normal rebuild should either:

- refuse and ask the merchant to reverse payments first
- preserve payment applications through a deterministic remap, if such a remap is explicitly designed and tested
- provide a separate explicit destructive reset mode

Silent deletion of real payment evidence is not allowed.

Because `DisbursementApplication` and `ArtistPaymentApplication` are currently linked to allocations with cascading deletes, the first safe rebuild implementation should refuse to rebuild any period whose allocations have payment applications.
The existing allocation materialization helpers must not be reused blindly for paid periods.

Tax true-ups should also be preserved by default.
They represent merchant-entered filing or payment facts, not disposable reporting cache.

### Configuration import/export is separate

Count On Us configuration import/export is a useful future feature for moving from a dev store to a main store or backing up configuration.

It is not part of the first historical backfill workflow.

Historical backfill assumes the destination shop's Count On Us configuration has already been created by ordinary admin setup or another future configuration migration feature.

## Consequences

### Benefits

- supports owner-controlled rollout to an existing main Shopify store
- keeps ADR-006's low-risk public install behavior intact
- avoids bespoke prior-store historical cost/cause import logic
- gives merchants an explicit dry-run and confirmation flow
- lets reporting history be rebuilt after payouts, charges, or orders are imported
- lets merchants deliberately replace incomplete or stale order snapshots after configuration improves
- preserves immutable snapshots as the source of reporting history
- preserves real payment evidence during ordinary rebuilds

### Costs

- imported historical snapshots may not reflect true order-time configuration
- backfill requires careful warnings so merchants understand the import-time configuration assumption
- rebuild workflows can become dangerous if they interact with logged disbursements, artist payments, receipts, or audit history
- snapshot replacement can change donation obligations and must be presented as a controlled correction, not a routine refresh
- import parsing, dedupe, dry-run previews, and batch tracking add significant operational surface area
- historical order import may still require Shopify data access that depends on how the merchant exports the data
- first-version period import may require stable payout IDs even when some merchant exports omit them

## Alternatives considered

**Keep ADR-006 as an absolute ban on historical imports** - Rejected. The automatic install migration remains rejected, but an explicit merchant-triggered backfill is a different workflow with different expectations and controls.

**Import historical storefront-specific cost and Cause data** - Rejected for the general product. That data is too bespoke to one storefront and should not define the core import model.

**Require configuration import/export before historical import** - Rejected for the first version. Configuration import/export is valuable, but historical backfill can operate against the current destination-shop configuration.

**Replay historical configuration by date** - Rejected for initial scope. This would be more accurate but requires versioned cost, Cause, Artist, tax, and packaging configuration history that the app does not currently have.

**Delete raw data during reporting rebuild** - Rejected. Rebuild should operate on derived reporting records. Raw imported orders, charges, and reporting period definitions are source data and should only be deleted through explicit import-batch rollback or destructive reset workflows.

**Treat snapshot replacement as ordinary reporting rebuild** - Rejected. Reporting rebuild operates on derived records. Snapshot replacement changes order-level financial truth and needs stricter dry-run, confirmation, and audit semantics.

**Forbid replacing webhook-created snapshots forever** - Rejected. Webhook snapshots should be more protected than imported snapshots, but beta deployments, configuration repairs, and newly-added cost components can produce legitimate merchant-controlled correction needs.

**Allow rebuild to cascade-delete allocation applications** - Rejected. Application records connect real payments to payable obligations. Losing them during a rebuild would destroy operational evidence and could make already-recorded payments appear unpaid.

**Treat tax true-ups as rebuildable derived data** - Rejected for normal rebuilds. True-ups are merchant-entered filing facts and should survive ordinary report regeneration.

**Allow payout imports without stable IDs in v1** - Rejected for the first implementation. A fallback identity may be added later, but requiring stable payout IDs avoids ambiguous period upserts.

## Follow-up implications

- Add import batch metadata models or equivalent audit fields before order, payout, or charge import is implemented.
- Add a Reporting "Imports and rebuild" admin workflow.
- Define accepted file formats for payouts, Shopify charges, and orders.
- Build dry-run validators with duplicate and missing-configuration summaries.
- Add historical order snapshot creation using current configuration and `origin = "historical_import"`.
- Add explicit snapshot replacement dry-run and replacement services with safeguards and override paths for webhook snapshots, closed periods, and externally evidenced records.
- Add period and full-history reporting rebuild services with safeguards around payments, payment applications, tax true-ups, and receipts.
- Decide and document how rebuild assigns `OrderSnapshot.periodId`.
- Decide whether import-batch rollback is needed and how it interacts with payment records.
- Consider configuration export/import separately after the core backfill workflow is stable.

## Links

- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-002](adr-002-dual-track-financial-model.md)
- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-006](adr-006-bulk-migration-removal.md)
- [ADR-009](adr-009-cause-payables-and-cross-period-disbursement.md)
- [ADR-012](adr-012-public-financial-disclosure-boundaries.md)
