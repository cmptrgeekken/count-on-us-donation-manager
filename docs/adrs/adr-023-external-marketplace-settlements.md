# ADR-023: External marketplace settlement review

- Status: Proposed
- Date: July 2026
- Depends on: ADR-002, ADR-006, ADR-009, ADR-012, ADR-019

## Context

Count On Us currently treats Shopify orders and Shopify payout/charge data as the primary source for donation reporting.

This works for ordinary Shopify checkout orders where Shopify is the payment processor or at least the source of payout and fee data.

Some merchants also receive orders from external marketplaces or wholesale channels that appear in Shopify for fulfillment, inventory, or operational tracking, but where payment is settled outside Shopify.

Faire is an example:

- Shopify may show an order total, such as `$480.00`
- Shopify may show paid amount as `$0.00`
- the merchant may receive a separate Faire payout, such as `$386.18`
- the difference, `$93.82`, represents marketplace fees, withholding, discounts, commission, shipping adjustments, or other external settlement effects

If Count On Us relies only on Shopify paid or Shopify charge data, these orders can produce misleading donation reporting:

- gross order value may be visible
- Shopify payout evidence is missing or zero
- external marketplace fees are not represented as Shopify charges
- the merchant needs a way to enter actual settlement evidence before the period is trusted

This is separate from order production cost snapshotting. The order's material, equipment, labor, packaging, POD, Cause, and Artist data still belong in `OrderSnapshot` and child snapshot tables. External settlement data answers a different question: how much cash did the merchant actually receive for this order after non-Shopify marketplace deductions?

## Decision

Count On Us will add a first-class external settlement review model for orders whose payout is not represented by Shopify payout/charge records.

The app should detect likely external-settlement orders, flag them for merchant review, and allow the merchant to enter actual payout information.

### Preserve gross order economics

Order snapshots should continue to preserve gross sales, production costs, and net contribution using the order line data available at snapshot time.

For externally settled orders, Shopify's `$0 paid` value must not be treated as the product sale price when the Shopify order still contains meaningful order totals and line items.

Example:

```text
Shopify order total:     480.00
External payout received: 386.18
External settlement fee:  93.82
```

The order snapshot should preserve the `$480.00` order economics. The `$93.82` settlement delta should reduce the donation pool as an external marketplace fee or settlement adjustment.

### Add external settlement records

The app should add a model similar to `OrderSettlement`:

- `shopId`
- `snapshotId`
- `shopifyOrderId`
- `source` - `faire`, `manual`, `other_marketplace`, etc.
- `status` - `needs_review`, `confirmed`, `ignored`
- `grossOrderAmount`
- `amountReceived`
- `feeAmount`
- `currency`
- `paidAt`
- `referenceId`
- `notes`
- `createdAt`
- `updatedAt`
- optional `confirmedAt`
- optional `confirmedBy`

`feeAmount` should be derived as:

```text
grossOrderAmount - amountReceived
```

The merchant may override or explain this when a marketplace settlement includes tax, shipping, credits, or order-level adjustments that do not map cleanly to the Shopify order total.

The settlement record is operational evidence. It should be audited and should not be silently deleted during ordinary reporting rebuilds.

### Detection and review

The app should create a review item when an order appears externally settled.

Initial detection can be conservative:

- order total is greater than zero
- Shopify paid amount is zero or missing
- order is paid, fulfilled, or otherwise operationally complete
- source/channel/gateway metadata indicates a marketplace or non-Shopify settlement when available

The first implementation should avoid over-automating source detection. If source metadata is unreliable, it can create a generic review:

> This order appears to have been paid outside Shopify. Enter the actual payout received before closing the reporting period.

Review should live under Reporting because it affects donation pool accuracy.

The review UI should show:

- order number
- order date
- gross order amount
- Shopify paid amount
- detected source/channel when available
- current reporting period
- input for actual amount received
- input for paid date
- input for reference id
- notes

For the motivating example, the merchant should be able to enter:

```text
source: Faire
gross order amount: 480.00
amount received: 386.18
fee amount: 93.82
```

### Reporting treatment

Confirmed external settlement fees should reduce the Track 1 donation pool similarly to Shopify charges, but they should be displayed separately.

Reporting summaries should distinguish:

- Shopify charges
- external marketplace settlement fees
- production costs
- artist payouts
- tax true-ups

This avoids hiding Faire or other marketplace deductions inside Shopify charges when Shopify did not provide the settlement.

The donation pool calculation should conceptually become:

```text
donationPool =
  totalNetContribution
  - Shopify charges
  - external settlement fees
  - artist payout obligations
  +/- tax true-up effects
```

The exact placement in existing summary contracts should follow ADR-002 and ADR-012, but the UI must not imply the fee came from Shopify.

### Period closing safeguards

Reporting periods should warn or block closing when they contain unresolved external settlement reviews.

The strictness may be configurable later, but the first implementation should prefer blocking close for unresolved high-confidence external settlement orders because donation pool accuracy depends on the entered payout.

If a merchant chooses to ignore a review, the app should require a reason and write an audit log.

### Imports and rebuild

External settlements may be entered manually or imported from marketplace payout exports in a future workflow.

Reporting rebuild should preserve settlement records and rematerialize derived summaries from them.

Snapshot replacement from ADR-019 should preserve or remap existing settlement records by `shopifyOrderId` / replacement snapshot id where possible. Replacing cost snapshots should not discard merchant-entered payout evidence.

## Consequences

### Benefits

- supports Faire and similar wholesale/marketplace order flows
- prevents `$0 paid in Shopify` from silently producing misleading reporting
- keeps production cost snapshots separate from actual payout evidence
- gives merchants a clear review workflow before closing periods
- makes external marketplace fees visible instead of burying them under Shopify charges

### Costs

- adds another operational review surface under Reporting
- requires merchants to enter or import external payout evidence
- reporting summary contracts need another fee category
- period close logic needs unresolved-settlement safeguards
- snapshot replacement must preserve settlement evidence

## Alternatives considered

**Treat Shopify paid amount as sale price** - Rejected. For externally settled orders, Shopify paid may be zero even when the order represents real revenue. Using zero would erase product economics and donation basis.

**Record Faire deductions as Shopify charges** - Rejected. The deductions are real fees, but they are not Shopify charges. Mixing them makes reconciliation and explanations less trustworthy.

**Use only manual business expenses** - Rejected. Marketplace settlement fees are order-linked Track 1 deductions, not general Track 2 operating expenses.

**Ignore externally paid orders until marketplace integrations exist** - Rejected. Merchants need a manual path before integrations; the review workflow can later be backed by marketplace imports.

## Follow-up implications

- Add `OrderSettlement` or equivalent schema.
- Add external settlement review detection during snapshot creation or reconciliation.
- Add a Reporting review UI for unresolved settlement orders.
- Add period close safeguards for unresolved high-confidence settlement reviews.
- Update reporting summaries and exports to include external settlement fees separately from Shopify charges.
- Update public disclosure serialization if external settlement fees affect public period summaries.
- Ensure ADR-019 snapshot replacement remaps or preserves settlement records.

## Links

- [ADR-002](adr-002-dual-track-financial-model.md)
- [ADR-006](adr-006-bulk-migration-removal.md)
- [ADR-009](adr-009-cause-payables-and-cross-period-disbursement.md)
- [ADR-012](adr-012-public-financial-disclosure-boundaries.md)
- [ADR-019](adr-019-merchant-triggered-historical-backfill.md)
