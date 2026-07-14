# ADR-028: Shopify product search metadata synchronization

- Status: Accepted
- Date: July 2026
- Depends on: ADR-006, ADR-015

## Context

The Product and Variant admin pages search the app's local PostgreSQL catalog. Product search currently covers title and handle, while Variant product search covers only product title. Merchants also organize products with Shopify tags and collections, and need those values to find products and variants for configuration and bulk actions.

Tags belong to a product, but collections are shared resources whose titles and membership can change independently. Shopify sends `products/update` when product attributes change and `collections/update` when products are manually added or removed or collection rules change. It does not send `collections/update` when a product attribute change affects automated collection membership. Webhook delivery and automated collection evaluation can also be delayed.

## Decision

Count On Us will synchronize product tags and Shopify collections into normalized, shop-scoped tables and include them in the existing Product search controls on the Product and Variant pages.

`ProductTag` stores one value per product. `ShopifyCollection` stores Shopify collection identity, title, and handle. `ProductCollection` stores product membership. Foreign keys cascade when a product or collection is deleted.

Product title/handle search will remain a text filter. Tags and collections will be separate, explicit multi-select autocomplete pickers built on the shared assignment-picker interaction. This avoids ambiguous matches and lets merchants select values already synchronized from Shopify. Multiple values within one picker use match-any semantics; when both tag and collection filters are present, a product must match at least one selected tag and at least one selected collection. The Variant page applies the same predicates through its Product relation. Selected values use repeated URL parameters so filters remain bookmarkable and exports can preserve them.

Full and incremental product synchronization will fetch tags and collections and replace the corresponding local sets atomically. Collection synchronization will paginate the collection's products and reconcile membership from the collection side, which is necessary to detect removals. All reads and writes remain shop-scoped.

The app will subscribe to product create, update, and delete webhooks and collection create, update, and delete webhooks. Create and update deliveries enqueue idempotent background synchronization; delete deliveries remove the corresponding shop-scoped local record. Product and collection updates also enqueue a delayed reconciliation pass so asynchronously evaluated automated collections can settle.

The existing merchant-triggered full catalog sync remains a reconciliation mechanism. Webhook processing must not be the only way to repair local search metadata.

No additional Shopify scope is required because the app already requests `read_products`.

## Consequences

### Benefits

- merchants can locate products and variants by the organizational vocabulary already maintained in Shopify
- collection renames update one shared record rather than rewriting every product
- membership removals are represented explicitly instead of leaving stale search text
- product and collection webhook paths together cover manual and automated collection changes
- explicit pickers prevent a product-title query from matching hidden metadata unexpectedly
- multi-selection supports bulk workflows spanning several Shopify tags or collections

### Costs

- catalog synchronization performs additional transactional writes
- collection webhooks require a new paginated background job
- automated collection evaluation requires delayed and full reconciliation rather than relying on one webhook read
- substring searches across related rows may eventually need PostgreSQL trigram indexes for very large catalogs

## Testing requirements

Regression coverage must verify tag replacement, product-side collection replacement, collection-side membership removal, shop isolation, webhook topic routing, and Product and Variant browser searches that match only a tag or collection value.
