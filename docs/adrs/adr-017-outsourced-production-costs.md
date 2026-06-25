# ADR-017: Outsourced production costs

- Status: Proposed
- Date: June 2026
- Depends on: ADR-003, ADR-010, ADR-013

## Context

Count On Us currently models variant production economics through manual labor, material, equipment, packaging, templates, and provider-backed POD cost mappings.

That covers most current products, but some products may occasionally require third-party production help that is not a POD integration.

Examples include:

- contracting a local or online 3D printing service for overflow demand
- using a small-batch fabrication vendor when in-house capacity is limited
- outsourcing production for a specific bulk variant while keeping ordinary quantities in-house
- paying a one-off setup, batching, or service fee that belongs to a specific variant's production economics

This is distinct from Printify/Printful-style POD provider support.

POD provider work includes connection lifecycle, catalog mapping, provider cost cache, provider sync status, and provider-specific fallback behavior.
Outsourced production may be a manual vendor cost with no integration, no catalog sync, and no provider mapping.

The first known use case is a new product where low quantities may be produced in-house, while bulk quantities may need a third-party 3D printing service. This product may have no donation attached, or may have a lower donation percentage such as 10-20%. Future products may use outsourced production differently.

## Decision

The app will treat outsourced production as a variant-level cost concept, separate from provider-backed POD mappings.

### Outsourced production belongs to variant cost configuration

Outsourced production costs should attach to a Shopify variant because the need, price, and production method may differ by variant.

For example:

- a standard quantity variant may use in-house material, equipment, and labor costs
- a bulk quantity variant may use a third-party production cost
- a special color, size, or finish may require outsourced work while other variants do not

The product remains the donation-routing owner unless a later ADR introduces variant-level donation routing.

### Outsourced production should be additive and line-based

The cost model should support one or more outsourced production cost lines rather than a single hard-coded outsourced cost field.

Each line should be able to represent at least:

- vendor or service name
- unit cost
- optional setup, batch, or minimum-order cost
- notes
- active/inactive status

The exact schema can be decided during implementation, but the financial model should preserve line-level detail for preview, snapshot, audit, and export.

### Outsourced production is not POD

Outsourced production should not require a Provider Connection or Provider Variant Mapping.

If a future outsourced vendor becomes integration-backed, a later ADR may decide whether that belongs in provider integrations, outsourced production lines, or a bridge between them.

Until then, manual outsourced production cost lines should remain a simpler admin-managed cost input.

### Outsourced production composes with existing variant costs

A variant may combine outsourced production with other cost inputs when that reflects reality.

Examples:

- outsourced 3D printing plus in-house finishing labor
- outsourced fabrication plus merchant packaging materials
- vendor production cost plus equipment/labor overrides for post-processing

The CostEngine should include outsourced production in the variant's cost total before calculating net contribution and donation allocation.

### Separate Shopify variants are an acceptable storefront strategy

When customers explicitly choose a quantity tier or production mode, separate Shopify variants can represent those economics.

For example:

- "Single / in-house"
- "Bulk / outsourced"

This works with the existing app model because costs are already variant-specific.

However, separate variants should only be used when they make sense to the customer and storefront workflow. If outsourcing is an internal fulfillment decision that depends on demand after purchase, the cost model should not force that complexity into customer-visible options.

### Donation differences by variant are future work

The current app primarily models Cause and Artist routing at the product level.

Some outsourced or bulk variants may need a lower donation percentage or no donation at all.

That is a separate routing decision and should not be hidden inside outsourced production cost.

If variant-specific donation behavior becomes necessary, the app should introduce an explicit variant-level donation override or routing model rather than overloading production costs.

## Consequences

### Benefits

- supports occasional third-party production without pretending it is POD
- keeps one-off vendor costs close to the variant economics they affect
- preserves the existing product-level donation routing model for ordinary products
- allows bulk variants to carry different cost structures without changing the product architecture
- keeps future provider integrations and manual vendor costs conceptually separate

### Costs

- introduces another cost category in the variant editor and CostEngine
- requires snapshot, preview, export, and reporting surfaces to include the new cost category
- may require UI restraint so rare outsourced costs do not make every variant editor feel more complex
- does not by itself solve variant-specific donation percentages

## Alternatives considered

**Model outsourced production as POD** - Rejected. POD implies provider connection, catalog mapping, sync status, cached provider cost lines, and provider-specific fallback behavior. Manual third-party production may have none of those properties.

**Model outsourced production as material or equipment** - Rejected. A third-party service fee is not raw material and not owned equipment usage. Folding it into those categories would obscure production economics and make reporting less clear.

**Model outsourced production as a business expense** - Rejected. The cost is directly attributable to a sold variant and should reduce that variant's contribution before donation allocation. General expenses are not variant-specific production costs.

**Require separate Shopify products for outsourced/bulk production** - Rejected as a general rule. Separate products may be useful in some storefront designs, but the cost model should support variant-specific production economics without forcing catalog fragmentation.

**Treat lower donations as an outsourced production cost side effect** - Rejected. Donation routing and production cost are separate concepts. Lower or disabled donation behavior for a variant should be modeled explicitly if needed.

## Follow-up implications

- Add a variant-level outsourced production cost model or generalized custom cost-line model.
- Add an admin UI section on Variant detail for outsourced production lines.
- Update CostEngine preview and snapshot logic to include outsourced production totals.
- Update order snapshot persistence, exports, and reporting to preserve outsourced production cost detail.
- Consider whether variant-level donation overrides are needed for bulk or outsourced variants.
- Consider whether templates should eventually support outsourced production lines if multiple variants share the same vendor economics.

## Links

- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-010](adr-010-provider-rollout-strategy.md)
- [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md)
