# Donation pool calculation audit

**Audited:** 2026-07-17  
**Scope:** authoritative reporting, ordinary order ingestion, historical reporting imports, catalog/seed imports, reporting rebuilds, analytical recalculation, adjustments, fees, artist payouts, tax reserve, and tax true-ups.

## Executive conclusion

The audit resulted in a clarified distinction between available profit capacity
and the amount actually committed to causes. The implemented model is:

```text
available donation capacity
  = adjusted order net contribution
  - Shopify charges
  - confirmed external-settlement fees
  - artist payouts
  - estimated tax reserve
  + prior-period tax true-up surplus
  - prior-period tax true-up shortfall

requested donation = sum of cause-directed allocations
final donation pool = max(0, min(requested donation, available donation capacity))
retained by shop    = max(available donation capacity - final donation pool, 0)
```

The shared calculation and proportional cause cap are implemented in
[`donationPool.server.ts`](../app/services/donationPool.server.ts).

Ordinary webhook orders and the admin's historical order import are aligned at the snapshot-calculation layer because both call the same [`createSnapshot()`](../app/services/snapshotService.server.ts#L618) function. Reporting rebuilds also use those same immutable snapshots; a rebuild does **not** rerun the cost engine.

Three material inconsistencies were found during the audit and addressed:

1. **Analytical recalculation used a narrower pool formula.** It now uses the shared pool calculation and proportionally caps recalculated cause totals.
2. **Rebuild result summaries used a narrower pool formula.** Rebuilds now materialize capped cause obligations, and the rebuild result reports their reconciled total as the committed pool.
3. **The catalog/seed CSV importer had an independent cost engine.** The importer, its command, and its dedicated matching code were removed. Historical imports must use the admin import or financial-backfill paths that call the production snapshot service.

## 1. Authoritative reporting scope

Reporting includes only lines whose snapshot is the current revision of its logical order, whose lifecycle is `active` or `partially_refunded`, and whose snapshot creation date falls in the selected half-open period `[startDate, endDate)`. This prevents superseded, cancelled, fully refunded, review-required, and out-of-period snapshots from contributing. The filter is in [`buildReportingSummary()`](../app/services/reportingSummary.server.ts#L126).

For an all-time rollup, the date range spans the earliest period start through the latest period end. Charges are selected by `processedAt`; period reports accept either an explicit period association or an unassociated charge whose processing date falls in the period. See the charge scope in [`buildReportingSummary()`](../app/services/reportingSummary.server.ts#L99).

All financial arithmetic in the core services uses `Prisma.Decimal`. Currency-facing tax values and outstanding balances deliberately apply explicit two-decimal rounding; snapshot costs remain at the database's four-decimal precision.

## 2. Order revenue and net contribution

### 2.1 Discounted line subtotal

For each order line:

```text
undiscounted subtotal = unit price × quantity
discounted subtotal   = max(undiscounted subtotal - line discounts, 0)
sale price per unit   = discounted subtotal ÷ quantity
```

An explicit Shopify discounted line total wins when supplied. Otherwise line-level discount allocations are summed. The implementation is [`getDiscountedLineSubtotal()`](../app/services/snapshotService.server.ts#L190).

If the order-level discounted subtotal is lower than the sum of eligible lines, the difference is allocated proportionally across discount-eligible lines. The final eligible line receives the residual after cent rounding so the lines reconcile to the order subtotal. Tips and marketplace `not_eligible` lines are excluded from this proportional allocation. See [`allocateOrderLevelDiscounts()`](../app/services/snapshotService.server.ts#L297).

**Reasoning:** costs and donation potential must be based on revenue actually retained for each line, not list price. The residual assignment avoids a cent-level reconciliation drift across multiple lines.

### 2.2 Per-unit production cost

The shared cost engine calculates:

```text
total unit cost
  = labor
  + production materials
  + allocated packaging
  + equipment
  + production-material mistake buffer
  + POD fulfillment cost

unit net contribution = discounted unit sale price - total unit cost
line net contribution = unit net contribution × quantity
```

The total and net formulas are in [`resolveCosts()`](../app/services/costEngine.server.ts#L844). The component rules are:

- **Counted material:** `(purchase price ÷ purchase quantity) × quantity used`.
- **Yield material:** `(purchase price ÷ purchase quantity ÷ yield) × quantity used`.
- **Portioned-use material:** `(purchase price ÷ purchase quantity ÷ total uses per purchased unit) × uses per variant`.

  These are implemented in [`computeMaterialLineCost()`](../app/services/costEngine.server.ts#L105). They normalize purchases to a usable unit cost before applying the variant's consumption.

- **Direct equipment:** `(hourly rate × minutes ÷ 60) + (per-use cost × uses)`.
- **Duration-yield equipment:** `(hourly rate × yield duration ÷ 60) ÷ yield quantity`.
- **Use-yield equipment:** `(per-use cost × yield uses) ÷ yield quantity`.

  These are implemented in [`computeEquipmentLineCost()`](../app/services/costEngine.server.ts#L141). Calculated equipment rates can include electricity, depreciation, consumables, and maintenance; their resolution begins in [`computeEquipmentComponentRates()`](../app/services/costEngine.server.ts#L244).

- **Labor:** `hourly labor rate × labor minutes ÷ 60`, implemented at [`costEngine.server.ts` line 838](../app/services/costEngine.server.ts#L838).
- **Mistake buffer:** `production material cost × configured mistake-buffer rate`, implemented at [line 828](../app/services/costEngine.server.ts#L828). It does not inflate labor, packaging, equipment, or POD cost.
- **POD cost:** live provider data is preferred for snapshots, with the latest cached provider cost as fallback. Resolution is prepared by [`fetchSnapshotPodOverrides()`](../app/services/snapshotService.server.ts#L477).

**Reasoning:** net contribution represents actual order-level economic capacity after the costs directly attributable to making and fulfilling the item. It is the starting capacity, not yet the final donation pool.

### 2.3 Packaging allocation

The order snapshot takes the maximum first-pass packaging cost among eligible product lines as the order package cost, then allocates it proportionally by each eligible line's discounted subtotal:

```text
line packaging = order packaging cost × line subtotal ÷ eligible order subtotal
```

Tips, pending lines, and `not_eligible` marketplace rows receive no packaging allocation. See [`snapshotService.server.ts` lines 874–902](../app/services/snapshotService.server.ts#L874).

**Reasoning:** a shared shipment should be charged once, not once per item. Revenue-weighted allocation preserves the order total while distributing the shared cost across participating products.

### 2.4 Line types and marketplace fees

- `product` lines participate in cost resolution and donation routing.
- `tip` lines have zero net contribution and are excluded from gross contribution.
- `pending` lines are snapshotted but receive no packaging or cause routing until their status is resolved through lifecycle/replacement flows.
- `not_eligible` marketplace commission/processing rows remain financial evidence. Their negative contribution scales otherwise routable cause allocations once, without becoming a donation recipient.

Line classification is in [`getOrderLineKind()`](../app/services/snapshotService.server.ts#L210). Marketplace scaling is in [`snapshotService.server.ts` lines 1047–1069](../app/services/snapshotService.server.ts#L1047).

## 3. Adjusted order contribution

The authoritative adjusted order contribution is:

```text
adjusted line net contribution = immutable snapshot net contribution + Σ netContribAdj
adjusted order contribution     = Σ adjusted line net contribution
```

Reporting performs this accumulation at [`reportingSummary.server.ts` lines 567–589](../app/services/reportingSummary.server.ts#L567).

Manual cost corrections preserve the accounting identity by setting:

```text
netContribAdj = -(laborAdj + materialAdj + packagingAdj + equipmentAdj)
```

See [`createManualAdjustment()`](../app/services/adjustmentService.server.ts#L190). Refund and lifecycle adjustments are proportional reversals of the affected snapshot components; the proportional helper is [`buildProportionalAdjustment()`](../app/services/adjustmentService.server.ts#L169).

**Reasoning:** snapshots remain immutable evidence of the original order-time calculation. Later refunds, cancellations, and corrections are additive audit records rather than destructive rewrites.

## 4. Deductions from the final pool

Starting with total adjusted net contribution, reporting applies the following deductions.

### Shopify charges

```text
Shopify charge deduction = Σ ShopifyChargeTransaction.amount
```

Transactions are scoped as described in section 1 and summed at [`reportingSummary.server.ts` line 645](../app/services/reportingSummary.server.ts#L645).

**Reasoning:** payment/platform charges reduce cash available for donation. This assumes imported charge amounts are stored as positive deductions; a negative stored amount would increase the pool because the final formula subtracts the sum.

### Confirmed external-settlement fees

```text
external fee deduction = Σ confirmed OrderSettlement.feeAmount
```

Only confirmed settlements are aggregated; see [`reportingSummary.server.ts` lines 515–545](../app/services/reportingSummary.server.ts#L515).

**Reasoning:** externally settled marketplace fees reduce proceeds even when they do not appear in Shopify Payments charges. Pending/review items are excluded to avoid deducting unverified estimates.

### Artist payouts

For each eligible collaboration:

```text
payout basis  = discounted line subtotal × collaboration share
artist payout = payout basis × payout rate
```

Self-purchases and disabled/excluded payouts are omitted. The order-time calculation is in [`snapshotService.server.ts` lines 943–980](../app/services/snapshotService.server.ts#L943); period materialization is in [`materializeArtistAllocationsForPeriod()`](../app/services/reportingPeriodService.server.ts#L438).

**Reasoning:** artist compensation is an obligation ahead of charitable capacity. It is calculated from sales revenue, while cause routing uses the nonnegative net contribution left after product costs and, for artist-routed products, after the artist payout.

### Estimated tax reserve

Taxable contribution intentionally uses a different cost track:

```text
taxable contribution
  = gross line contribution
  - production material cost
  - packaging cost
  + taxable adjustments

taxable base   = floor-to-cents(max(taxable contribution - business expenses, 0))
taxable weight = 0, 1, or non-501(c)(3) allocation share, depending on shop mode
tax reserve    = round-half-up(taxable base × effective tax rate × taxable weight, 2)
```

The reporting taxable-contribution formula is at [`reportingSummary.server.ts` lines 731–734](../app/services/reportingSummary.server.ts#L731). The reserve formula and rounding are in [`computeEstimatedTaxReserve()`](../app/services/taxReserve.server.ts#L67).

**Reasoning:** business expenses and eligible charitable routing affect taxable exposure, but they are not per-order production deductions. This keeps the donation-capacity and tax-estimation tracks separate as required by [ADR-002](adrs/adr-002-dual-track-financial-model.md).

The reserve is also allocated proportionally against eligible cause allocations, capped at the eligible allocation total. The last eligible cause receives the residual to reconcile the applied reserve. See [`applyEstimatedTaxReserveToAllocations()`](../app/services/taxReserve.server.ts#L101).

### Tax true-ups

```text
true-up delta = round-half-up(estimated tax reserve - actual tax, 2)
```

A positive delta is a surplus added to the next open period; a negative delta is a shortfall deducted from it. See [`taxTrueUpService.server.ts` line 242](../app/services/taxTrueUpService.server.ts#L242) and carry-forward application in [`reportingSummary.server.ts` lines 771–778](../app/services/reportingSummary.server.ts#L771).

**Reasoning:** the pool reserves an estimate during the period, then corrects that estimate when actual tax is known without rewriting the closed period.

## 5. Cause allocation versus donation pool

Order-time cause allocations use a nonnegative contribution base:

```text
allocation base = max(line net contribution, 0)
cause amount    = allocation base × configured cause percentage
```

For artist-routed products, the routable base is reduced by artist payout before percentages are applied. See [`snapshotService.server.ts` lines 943–1029](../app/services/snapshotService.server.ts#L943).

Adjustments scale stored allocations by `1 + netContribAdj ÷ original net contribution`, with a guard that refuses ratios whose absolute value exceeds 10. See [`adjustAllocationForLineChange()`](../app/services/allocationAdjustment.server.ts#L6). A zero contribution with a nonzero adjustment or a guarded ratio is now surfaced as a reporting review warning instead of remaining silent.

Cause percentages define the requested donation. Percentages below 100% intentionally leave the remainder as retained shop profit. When requested allocations exceed available capacity, every cause is reduced proportionally and the final rounding residual is assigned to the last cause so allocations reconcile exactly to the final donation pool.

## 6. Alignment by ingestion and rebuild path

| Path | Snapshot cost source | Period reporting source | Alignment |
|---|---|---|---|
| Day-to-day order webhook | `createSnapshot()` → `resolveCosts()` | Current immutable snapshot + adjustments | Baseline/authoritative |
| Admin historical order import | Same `createSnapshot()` → same `resolveCosts()` | Same reporting query and formula | Aligned, subject to imported payload completeness and current configuration at import time |
| Snapshot replacement | Same `createSnapshot()` with a new revision | Only new current revision is counted | Aligned; intentionally recalculates with current configuration |
| Reporting period rebuild | Does not recalculate snapshots; reattaches snapshots/fees and rematerializes cause/artist allocations | Same reporting query after rebuild | Core reporting aligned; rebuild result's displayed pool is incomplete |
| Analytical recalculation | Reruns `resolveCosts()` against current configuration | Separate comparison formula | Cost comparison is intentional; pool comparison is incomplete |
| Catalog/seed CSV import | Independent `calculateVariantCosts()` and direct Prisma writes | Reporting consumes resulting rows | Not reliably aligned |

Historical admin import calls the shared snapshot service at [`historicalBackfill.server.ts` lines 1140–1158](../app/services/historicalBackfill.server.ts#L1140). The rebuild operations and what they mutate are visible in [`rebuildPaymentSafeReportingPeriod()`](../app/services/historicalBackfill.server.ts#L1449).

Important semantic distinction: historical imports calculate an order using the configuration that exists **at import time**, while ordinary snapshots calculate using configuration at order receipt time. The algorithm is aligned, but results can legitimately differ when historical configuration is unavailable or has since changed.

## 7. Detailed findings and recommendations

### Resolved: use one authoritative pool calculation

`computeDonationPool()` now names every capacity and commitment component, and
`capCauseAllocations()` applies the proportional cap with residual reconciliation.

### Resolved: remove the seed importer's duplicate cost engine

The standalone importer was removed. The supported historical import path passes
order payloads through [`createSnapshot()`](../app/services/snapshotService.server.ts#L618).

### Medium: define and test the sign convention for charge imports

The final formula assumes charge and external-fee amounts are positive deductions. Validate and normalize this at every import boundary, then document the database convention. Test refunds/credits explicitly so a Shopify fee refund increases the pool only when intended.

### Resolved: make allocation-to-pool reconciliation policy explicit

Percentage-underallocated contribution is retained shop profit and is not part of
the donation pool. Global deductions cap cause commitments proportionally when
requested donations exceed available capacity.

### Resolved: flag extreme adjustment behavior

The ±10 allocation-ratio guard still protects against unstable division. Zero-net
and greater-than-10× cases now create visible reporting review warnings; partial
and full refunds continue to scale normally. Regression tests cover each branch.

## 8. Existing test evidence and gaps

Existing tests verify the authoritative reporting formula with Shopify charges, external fees, artist payout, and tax reserve in [`reportingSummary.server.test.ts`](../app/services/reportingSummary.server.test.ts#L214). Rebuild tests currently assert the narrower `net contribution - Shopify charges` result in [`historicalBackfill.server.test.ts`](../app/services/historicalBackfill.server.test.ts#L944), which confirms the inconsistency rather than protecting parity.

Recommended parity test matrix:

1. Feed one canonical order payload through webhook-origin and historical-import-origin `createSnapshot()` and compare every persisted monetary field.
2. Rebuild a period with nonzero Shopify charges, confirmed external fees, artist payouts, estimated tax reserve, and both true-up directions; assert the displayed rebuild pool equals reporting.
3. Run analytical recalculation on that same fixture and assert its authoritative and recalculated pools use identical non-cost components.
4. If the seed importer remains independent, import the same catalog/order through both paths and compare component costs, net contribution, allocations, and final reporting pool.
5. Cover charge credits/refunds, missing variants, POD live/cache/missing states, order-level discount residuals, pending/not-eligible/tip lines, partial/full refunds, and the adjustment-ratio guard.

## 9. Canonical trace

```text
Shopify webhook or admin historical import
  → createSnapshot()
    → discounted line revenue
    → resolveCosts()
    → shared packaging allocation
    → immutable line net contribution and cause/artist evidence
  → lifecycle adjustments (refunds/corrections)
  → buildReportingSummary()
    → current active/partially-refunded revisions in period
    → adjusted net contribution
    → less Shopify charges
    → less confirmed external settlement fees
    → less artist payouts
    → less estimated tax reserve
    → plus/minus prior-period tax true-up
    → authoritative donation pool
```
