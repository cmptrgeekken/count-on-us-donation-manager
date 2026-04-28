# ADR-012: Public financial disclosure boundaries

- Status: Accepted
- Date: April 2026
- Depends on: ADR-001, ADR-002, ADR-003, ADR-008, ADR-009, ADR-011

## Context

Count On Us needs to support a public transparency page that is more complete than a receipt list.

The product promise is strongest when customers, cause partners, and reviewers can see how sales become donations without needing access to merchant-only admin reporting.

The merchant's historical spreadsheet model includes the right level of public intent:

- sales summary
- gross sales
- payment processing fees
- deposited funds
- sales tax
- net sales
- production and operational expense categories
- amounts set aside for future costs
- tax buffer
- merchant/artist payout categories where applicable
- remaining funds to donate
- cause-level totals
- cause-level donation percentages or sales counts
- donated amount
- fees covered
- remaining amount to donate

However, the public storefront should not become a raw accounting export.

Public customers need trustworthy, understandable summaries. Merchants need guardrails so they do not accidentally expose raw purchase costs, payout identifiers, customer/order data, internal notes, or hidden margin details.

ADR-011 already establishes that marketing/acquisition cost is a first-class transparency category, but it is focused on campaign attribution and marketing reserve treatment. This ADR defines the broader public financial disclosure boundary for the transparency page and its widget contracts.

## Decision

The public transparency page will expose display-safe financial reconciliation summaries, not raw ledger/admin reporting payloads.

### Public disclosures are aggregate reconciliations

The detailed public transparency tier may show a reconciliation from sales activity to donation outcome.

The public contract should support summary categories such as:

- gross sales
- refunds and order adjustments
- sales tax collected
- deposited funds or payout-backed funds, when available
- Shopify/payment processing fees
- platform, app, or Shopify subscription fees when included in the merchant's donation formula
- production materials
- labor, assembly, or production work
- equipment usage or maintenance
- packaging and shipping materials
- Shopify shipping or merchant-paid shipping costs when modeled
- POD/provider fulfillment costs
- tax buffer or tax reserve
- marketing/acquisition reserve
- merchant-retained amount, artist payout, or other non-donation payout categories when the merchant's public policy includes them
- net donation pool
- donations made
- donations pending disbursement
- remaining funds to donate

The public contract must label estimates, reserves, and pending values clearly.

Suggested public language:

- "Tax buffer" or "Estimated tax reserve"
- "Marketing/acquisition reserve"
- "Pending disbursement"
- "Remaining funds to donate"
- "Donation pool after costs and reserves"

The page should avoid internal accounting terms when customer-facing wording can be clearer.

### Payout-backed summaries are allowed, raw payout detail is not

The public transparency page may use Shopify payout and balance-transaction data as authoritative source material for public summaries.

It may show high-level payout-backed concepts such as:

- covered payout period
- deposited funds
- payment fees
- adjustments and refunds in aggregate
- net payout-backed amount available for reconciliation

It must not expose:

- raw Shopify payout IDs
- raw balance transaction IDs
- raw order IDs
- customer identifiers
- individual transaction rows
- failure/debug metadata
- reconciliation notes intended for the merchant or support team

If payout data is incomplete, unavailable, or not connected to a reporting period, the public page must either omit payout-backed fields or label the summary as estimated / not payout-final.

### Rollups should support month and year views

The public transparency page should support useful time rollups.

Required near-term rollups:

- month
- year
- reporting period

Useful later rollups:

- year to date
- all time
- custom date range

Detailed cost and payout reconciliation should prefer bounded periods where the app can confidently describe coverage.

All-time summaries are acceptable for donation totals and cause totals, but all-time detailed reconciliation should only be shown when the data completeness boundary is clear.

### Cause summaries are the primary receipt browsing entry point

The public widget should avoid an endlessly long flat receipt table as the primary view.

Instead, the default receipt presentation should roll up by cause:

- cause name
- total allocated or earned for the cause
- donations made
- fees covered
- pending / remaining amount to donate
- receipt count
- receipt drill-down action

The drill-down action should open a modal, drawer, or equivalent focused view for that cause.

The cause receipt drill-down should be paginated and may include:

- paid date
- amount
- fees covered, if applicable
- reporting period
- receipt link when a public receipt exists

The receipt drill-down must not expose raw storage keys, customer data, order IDs, payout IDs, or internal disbursement application IDs.

### Disclosure tiers control public detail

The public transparency page will keep the two-layer disclosure model from issue `#99`:

- shop-level policy defines the maximum public disclosure allowed
- widget-level settings choose what a specific placement shows, constrained by the shop-level policy

Recommended public tier behavior:

#### `minimal`

- overview totals
- donations made
- donations pending disbursement
- cause receipt rollup or receipt history only when public receipts are enabled

#### `standard`

- minimal plus cause-by-cause summaries
- high-level reconciliation groups:
  - gross sales
  - fees
  - costs
  - tax buffer
  - donation pool
  - donated / pending

#### `detailed`

- standard plus more specific display-safe categories:
  - materials
  - labor / assembly
  - equipment / maintenance
  - packaging / shipping materials
  - Shopify shipping or merchant-paid shipping costs when modeled
  - POD/provider fulfillment
  - Shopify/payment fees
  - app/platform fees when included in the donation formula
  - tax buffer
  - marketing/acquisition reserve
  - merchant or artist payout categories when enabled by public policy
- monthly and yearly rollup controls
- cause-level receipt drill-downs with pagination

Detailed does not mean raw. It means more granular aggregate categories.

### Public contracts must remain separate from admin reporting

The public page must not reuse admin reporting payloads directly.

Instead, public transparency data should be serialized through a dedicated public contract that:

- includes only display-safe aggregate fields
- includes disclosure metadata describing hidden or unavailable sections
- labels estimates/reserves/final values
- supports period/rollup metadata
- avoids raw internal identifiers
- is shaped for customer comprehension rather than admin operations

The admin reporting model remains the source of truth, but public serialization is a separate boundary.

## Consequences

### Benefits

- aligns the public transparency page with the real trust promise of the product
- gives customers and cause partners a clear view of how sales become donations
- supports richer disclosure without turning the storefront into an accounting export
- keeps receipt browsing useful as the receipt count grows
- preserves a clear boundary between public summaries and merchant-only finance data
- creates a path for month/year public reports and future transparency screenshots

### Costs

- requires a more careful public aggregation layer than the first receipt-list implementation
- requires public wording for reserves, pending amounts, and payout-backed values
- requires pagination or modal state for receipt drill-downs
- requires data-completeness handling for all-time and payout-backed views
- requires explicit test coverage that restricted fields do not leak

## Alternatives considered

**Keep the public page as a receipt list only** - Rejected. Receipt history is useful, but it does not explain how the donation pool was calculated.

**Expose the admin Reporting page publicly** - Rejected. Admin reporting contains merchant-operational detail and is not shaped for public comprehension or privacy boundaries.

**Expose raw payout and balance transaction rows** - Rejected. Raw payout data can include internal identifiers and operational noise that does not belong on a public storefront page.

**Expose exact purchase-price and material-cost inputs** - Rejected. Customers need cost categories and donation math, not supplier-level purchase details or hidden margin data.

**Use only all-time totals** - Rejected as the only model. All-time donation totals are useful, but month/year/reporting-period rollups make the disclosures easier to validate and compare.

**Keep receipts as one flat table** - Rejected as the primary long-term model. A flat table becomes unwieldy as receipts grow. Cause rollups with paginated drill-downs preserve auditability without overwhelming the page.

## Follow-up implications

- Issue `#99` should treat detailed public transparency as a payout/reconciliation summary, not only receipt browsing.
- The current public transparency payload should grow toward period/rollup-aware reconciliation sections.
- The receipt list should be refactored toward cause rollups with paginated cause-level receipt drill-downs.
- Tests should assert that public transparency payloads exclude raw payout IDs, transaction IDs, order IDs, customer data, raw storage keys, internal notes, and audit-only identifiers.
- ADR-011 remains authoritative for marketing/acquisition attribution and reserve labeling. This ADR is authoritative for the broader public financial disclosure boundary.
