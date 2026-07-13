# ADR-027: Product Cause routing overrides for Artist collaborations

- Status: Proposed
- Date: July 2026
- Depends on: ADR-001, ADR-013, ADR-017, ADR-024, ADR-026
- Supersedes in part: ADR-013 product-specific Cause override deferral and collaboration-routing precedence

## Context

ADR-013 introduced Artist collaboration assignments as the authoritative donation-routing source whenever a product has one or more active Artists. Under that model, the app derives a product-level Cause rollup from:

1. each product-Artist collaboration share
2. each Artist's effective payout election and rate
3. each Artist's Cause preferences

Direct product Cause assignments remain authoritative only when a product has no active Artist assignments. ADR-013 intentionally deferred product-specific Cause overrides until a later ADR.

Real collaboration agreements require that deferred behavior. An Artist may create or be credited on a product whose donation percentage or selected Causes differ from the Artist's usual preferences. The Artist must remain credited, and any Artist payout obligation must remain intact, while the product routes its post-payout Cause-eligible amount according to a merchant-defined product override.

The existing Product List bulk Cause action does not meet this requirement. It replaces each selected product's routing with one Cause at 100% and removes its Artist assignments. Cause routing, Artist attribution, and Artist payout are distinct business concepts; editing one must not silently delete another.

ADR-024 also refined ADR-013's validation rule for Artist Cause preferences. Artist Cause preferences are optional and may total from 0% through 100%, while product Cause assignments may total no more than 100%. Product override behavior must use the later validation vocabulary.

## Decision

Count On Us will support explicit product-level Cause routing overrides while preserving Artist attribution and payout configuration.

### Artist configuration and Cause routing are independent dimensions

Product-Artist assignments control:

- public Artist attribution and credit order
- collaboration shares
- Artist payout elections and rates
- Artist payable creation

Product Cause routing controls:

- which Causes receive the post-payout Cause-routable amount
- what percentage of that amount is allocated to each Cause
- the effective Cause rollup exposed to estimates, widgets, Shopify metafields, and other public merchandising surfaces

Assigning or changing Causes must not remove ProductArtistAssignment records. Assigning or changing Artists must not discard merchant-authored product Cause routing.

Artist assignments may be removed only through an explicit Artist removal or clear flow. Destructive bulk behavior that removes Artists as a side effect of assigning Causes will be removed.

### Donation routing precedence is explicit

The effective product Cause routing precedence is:

1. **Product override** - when an explicit product Cause override is enabled, its Cause assignments are authoritative even when the product has active Artists.
2. **Artist-derived routing** - when no product override is enabled and the product has active Artists, the app derives Cause routing from collaboration shares and Artist Cause preferences.
3. **Direct product routing** - when the product has no active Artists, its direct product Cause assignments are authoritative.
4. **Unallocated** - when none of the preceding sources produces a Cause assignment, no Cause obligation is created for the unallocated amount.

The product will store an explicit routing mode rather than infer override intent from the presence of ProductCauseAssignment rows. Existing Artist-routed products already materialize derived ProductCauseAssignment rows for storefront use, so row presence alone cannot distinguish a merchant-authored override from an Artist-derived rollup.

The initial routing modes should be:

- `automatic` - resolve Artist-derived routing when Artists are present; otherwise use direct product routing
- `product_override` - use merchant-authored product Cause assignments regardless of whether Artists are present

The schema may use a constrained string or enum consistent with the repository's Prisma migration practices, but unknown values must fail closed rather than silently select an unintended financial route.

### Product override allocation occurs after Artist payout

Artist payout remains governed by ADR-013 and is calculated independently of Cause routing.

For a product with active Artists and a product override:

1. calculate the line's product economics and allocation base
2. calculate each Artist's collaboration share, payout basis, effective payout election, and payout amount
3. subtract Artist payout amounts from the corresponding Cause-routable Artist shares, flooring each remaining amount at zero
4. pool the remaining Cause-routable amounts
5. apply the product override Cause percentages to that pooled amount

This preserves Artist payables while allowing the product agreement to control the final Cause destinations. Product override percentages may total from 0% through 100%. Any remainder is unallocated and does not create a Cause payable.

For products without active Artists, product Cause percentages continue to apply to the ordinary product allocation base under the existing direct-routing calculation.

### Product detail exposes routing source and override controls

The Product detail page will show the effective routing source and allow the merchant to choose between:

- use Artist Cause preferences
- override Cause routing for this product

Enabling an override on an Artist-routed product should initialize the editable assignments from the current effective Artist-derived rollup. This provides a non-destructive starting point, but the copied assignments become merchant-authored override values after the merchant saves them.

While override mode is active:

- Artist assignment, credit, collaboration-share, and payout fields remain editable
- product Cause assignments are editable
- saving Artist assignments preserves the product override
- later edits to an Artist's Cause preferences do not overwrite the product override

Clearing an override on a product with active Artists restores Artist-derived routing and replaces the materialized public Cause rollup with newly resolved Artist-derived assignments. The UI must require confirmation because the merchant-authored override values will no longer be authoritative.

If the last Artist is removed from a product with an active override, the product Cause assignments remain authoritative as direct product routing and the routing mode returns to `automatic`. Removing an Artist must not silently remove the product's donation configuration.

The Artist collaboration field layout should keep labels and controls aligned at the top, use consistent control heights, and place effective payout/Cause summaries on a separate full-width row. This is a presentation correction and does not change routing semantics.

### Product List supports non-destructive bulk routing changes

The Product List bulk editor will replace its destructive bulk Cause assignment behavior with explicit routing actions.

**Set product Cause routing**:

- accepts one or more Causes and a percentage for each, or an explicit no-Cause allocation choice
- applies the same assignment set to every selected product
- replaces an existing product override on Artist-routed products
- creates or replaces direct Cause assignments on products without Artists
- preserves all Artist assignments and payout configuration

An explicit product override with no Cause assignments means that the product creates no Cause obligation. This is different from clearing the override, which returns an Artist-routed product to its Artists' Cause preferences. The UI must label and confirm the no-Cause choice so an empty selection cannot accidentally suppress donations.

**Clear product Cause override**:

- returns Artist-routed products to Artist-derived routing
- leaves products without an override unchanged
- leaves direct Cause assignments on products without Artists unchanged because those assignments are not overrides
- reports changed, unchanged, skipped, and storefront-sync-failed counts

Bulk operations must show a confirmation summary when they replace existing overrides or change routing source. Products should expose a scannable routing status such as:

- Artist preferences
- Product override
- Direct product
- Not configured

Assigning an Artist in bulk to a product that already has direct product Cause assignments will preserve those assignments as a product override. Artist assignment must not silently change an existing donation destination or percentage.

Bulk local writes and their audit log must be atomic. Shopify synchronization may occur after the local transaction or through the existing background synchronization workflow; a remote sync failure must not roll back the authoritative local routing decision.

### Customer-facing widgets render only effective routing

Every customer-facing product surface must show the same effective Cause routing used by estimates and order snapshots. No frontend widget, app-proxy route, or presentation service may independently combine product Cause assignments with Artist Cause preferences or infer precedence from the presence of both sources.

The server-side routing resolver must provide one effective Cause assignment list to:

- the product donation widget API and theme app block
- the cart donation summary and cart-line Cause annotations
- public product transparency payloads
- product-description donation summaries when description injection is enabled
- Shopify product Cause reference/name metafields used by storefront filtering and external consumers
- donation estimate ranges and other product-level merchandising summaries

The product and cart widget JavaScript should continue rendering the resolved Cause names, percentages, links, and estimated amounts from their payload contracts. The payload may include a routing-source value for diagnostics or deliberate disclosure copy, but frontend code must not use that value to reimplement financial precedence.

An explicit no-Cause override must make product donation widgets and cart annotations ineligible or empty according to their existing fail-closed behavior. It must not fall back to the assigned Artists' Cause preferences. Clearing that override must restore Artist-derived widget content after the effective routing rollup is refreshed.

Artist directory cards continue to describe each Artist's own Cause preferences and are not rewritten to reflect individual product overrides. Artist overlays continue to represent product attribution. Cause directories remain Cause profile surfaces. Product-specific override behavior applies when those surfaces show or filter products by their effective Causes.

Post-purchase, thank-you, order-status, receipt, and reporting surfaces must render the immutable resolved allocations stored on the order snapshot rather than current product configuration. A later override change must therefore update live product/cart presentation without changing historical customer-facing records.

Regression coverage must prove that product and cart widgets:

- show override Causes instead of Artist preferences when override mode is active
- return to Artist-derived Causes after an override is cleared
- show no Artist Cause fallback for an explicit no-Cause override
- preserve Artist credit and payout presentation where those fields are displayed
- never show both override and superseded Artist-derived Causes in the same effective routing list

### Effective rollups remain materialized for consumers

ProductCauseAssignment may continue to store the effective product-level Cause rollup consumed by estimates, widgets, public transparency services, Shopify metafields, product-description summaries, and analytical services.

The explicit product routing mode distinguishes whether those rows are:

- merchant-authored direct or override assignments
- a materialized Artist-derived rollup

All services that consume Cause routing for financial behavior must resolve the routing mode consistently. Shopify metafields and metaobjects remain presentation copies; under ADR-026, the app database remains authoritative.

Changes to effective Cause routing must trigger the same recoverable Shopify synchronization behavior as existing Cause and Artist assignment saves. Storefront sync failures must be audit logged without exposing financial amounts or sensitive Artist data in logs.

### Snapshots freeze the resolved source and math

ADR-001 immutability remains unchanged. At order time, the snapshot must freeze:

- the effective routing mode
- the resolved Cause ids, names, percentages, and 501(c)(3) status
- the resulting Cause allocation amounts
- Artist attribution, collaboration shares, payout elections, payout rates, payout bases, and payout amounts
- routing source metadata distinguishing `product`, `artist`, and `product_override`

Later changes to product overrides, Artist preferences, Artist assignments, or payout configuration must not mutate existing snapshots. Rebuild and historical-import workflows continue to use the configuration explicitly defined by their governing ADRs.

Analytical recalculation, estimates, widgets, exports, and reporting must use the same resolver as snapshot creation or regression-tested equivalent logic. They must not infer routing independently from assignment-row presence.

### Validation, transactions, and audit behavior

All product override inputs must be validated before database writes:

- zero or more selected Causes, with an explicit confirmed no-Cause choice required for an empty override
- unique Cause ids within the assignment set
- active, shop-scoped Cause records
- percentages greater than zero and no greater than 100% per assignment
- total percentage no greater than 100%

Financial percentage parsing and arithmetic must use Prisma Decimal rather than JavaScript floating-point math.

Mode changes, assignment replacement, derived-rollup refresh, and audit logging must occur in one database transaction. Audit payloads should contain only Cause ids, product ids, and counts. They must not contain percentages, raw form input, Artist contact information, order totals, or other sensitive or financial data. The audit action identifies the routing transition without duplicating configuration values in the payload.

Suggested audit actions include:

- `PRODUCT_CAUSE_OVERRIDE_SET`
- `PRODUCT_CAUSE_OVERRIDE_CLEARED`
- `PRODUCT_CAUSE_ROUTING_BULK_SET`
- `PRODUCT_CAUSE_OVERRIDES_BULK_CLEARED`

### Existing products retain their effective behavior

The routing mode defaults to `automatic`.

Migration and compatibility behavior is:

- products with active Artists continue using Artist-derived routing
- products without active Artists continue using their direct ProductCauseAssignment rows
- existing materialized Artist-derived rollups are not treated as merchant overrides
- no existing Artist assignment is deleted
- no existing direct Cause assignment is converted to an override unless an Artist is later assigned while preserving that routing

The migration must not rewrite historical snapshots.

## Consequences

### Benefits

- supports product-specific collaboration agreements without losing Artist credit or payout tracking
- makes routing precedence explicit and testable
- prevents Cause assignment workflows from deleting unrelated Artist configuration
- supports efficient bulk setup and override cleanup
- preserves existing storefront contracts through an effective product rollup
- keeps historical Cause and Artist obligations immutable and auditable

### Costs

- introduces a product routing-mode field and additional resolver branches
- requires product detail and Product List bulk UI changes
- requires snapshot, estimate, analytical recalculation, widget, and Shopify sync paths to agree on override precedence
- requires compatibility handling when Artists are added to products that already have direct Cause assignments
- requires additional regression and browser coverage for mixed routing modes and bulk operations

## Alternatives considered

**Continue removing Artists when Causes are assigned** - Rejected. Artist attribution, payout, and Cause routing are separate configuration dimensions. Removing Artists as a side effect can erase public credit and payable terms without the merchant explicitly choosing to do so.

**Unlock the existing derived Cause fields without storing a routing mode** - Rejected. Artist-routed products already materialize derived ProductCauseAssignment rows, so the system could not reliably distinguish editable overrides from generated rollups. Snapshot and recalculation behavior would remain ambiguous.

**Copy product overrides onto every ProductArtistAssignment** - Rejected. The requested override belongs to the product agreement and applies to the pooled post-payout Cause-routable amount. Duplicating it per Artist creates conflicting sources of truth and unnecessary multi-Artist complexity.

**Replace Artist Cause preferences when a product override is saved** - Rejected. Artist preferences are reusable defaults for other collaboration products and must not be mutated by a product-specific agreement.

**Configure different override sets for every product inside the bulk editor** - Rejected for the initial implementation. Applying one reviewed assignment set to selected products is predictable and auditable. Per-product differences remain available on Product detail.

**Infer override mode whenever a product has both Artist and Cause assignments** - Rejected. Artist-derived routing already creates that same combination, making inference unsafe for existing data.

## Follow-up implications

- Add the product routing-mode field with an `automatic` default.
- Centralize effective Cause routing resolution for snapshots, estimates, recalculation, widgets, and sync services.
- Update Product detail with routing-source selection, aligned Artist fields, override editing, and clear confirmation.
- Replace the Product List destructive bulk Cause action with set-routing and clear-override actions.
- Add a Product List routing-status indicator and mixed-selection summaries.
- Preserve direct Cause assignments as overrides when Artists are assigned.
- Extend snapshot source metadata for product overrides.
- Add unit coverage for precedence, partial percentages, payout-before-routing math, and mode transitions.
- Add regression coverage distinguishing an explicit no-Cause override from clearing an override.
- Add service coverage for atomic bulk set/clear behavior and shop isolation.
- Add widget service and payload coverage for override, clear, explicit no-Cause, and no-source-union behavior.
- Add Playwright coverage for Product detail override workflows, field alignment, bulk set, bulk clear, mixed selections, confirmations, and product/cart widget rendering.

## Links

- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md)
- [ADR-017](adr-017-outsourced-production-costs.md)
- [ADR-024](adr-024-standardized-assignment-pickers-and-selected-lists.md)
- [ADR-026](adr-026-customer-facing-artist-cause-merchandising.md)
