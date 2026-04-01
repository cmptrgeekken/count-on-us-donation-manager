# ADR-004: Storefront widget data delivery

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | March 2026 |
| **Depends on** | ADR-003 |
| **Supersedes** | PRD §10.1 (Reactivity & Performance — 50KB threshold) |

## Context

The storefront widget must display per-variant cost and donation breakdowns that update instantly when the customer changes variant or quantity — with no perceptible delay. It runs inside a Shopify Theme App Extension sandbox with no `localStorage`, no document access, and scoped CSS. It must not degrade product page load performance and must not expose internal margin data beyond what is intentionally displayed.

Two competing concerns must be balanced: **performance** (data available before the customer opens the widget) and **render cost** (resolving costs for a 50-variant product with complex templates is expensive work to do on every page load, most of which is wasted if the customer never opens the widget).

### Why the PRD's 50KB threshold was wrong

The original PRD specified a payload size threshold: if the JSON payload exceeds 50KB, use lazy-load. This logic is circular. To know the compressed payload size, you must first build the payload — which means fully resolving all variant costs. At that point the data is already in memory, so the "decision" to lazy-load gains nothing: you'd discard data you already computed and force the client to fetch it again.

## Decision

The widget uses a **threshold-based dual delivery strategy** determined by a cheap aggregate query run before any cost resolution. The threshold is total line item count across all variants for the product — not payload size, not variant count alone.

### Why line item count, not variant count

Variant count is easy to check but poorly correlated with render cost and payload size. A product with 10 variants each having 20 line items is much larger than one with 30 variants each having 2 lines. Line item count captures both dimensions with a single cheap query.

### Threshold query

```sql
SELECT SUM(line_item_count)
FROM variant_cost_summary
WHERE product_id = ?
```

`line_item_count` per variant = count of material lines + equipment lines + shipping material lines. This requires a `VariantCostSummary` view or denormalised count column maintained on insert/delete of `VariantMaterialLine` and `VariantEquipmentLine` records. See PRD §12.1.

### Delivery strategies

**Pre-load** (total line items < 200):

- All variant cost data resolved at page render time server-side
- Embedded as JSON in a `<script type="application/json">` block in the Theme App Extension output
- Widget JS reads from this block on mount — zero network requests on interaction
- Typical product: up to ~25 variants with typical cost configs

**Lazy-load** (total line items ≥ 200):

- No cost data embedded at page render — threshold query only
- Widget JS fetches from app server on first toggle open, passing product ID and shop context
- `CostEngine` resolves all variants at that point
- Result cached in memory for subsequent variant switches
- Loading indicator shown on first open only (typically < 500ms)
- Typical product: 25+ variants or heavily configured variants

**Why 200 line items?**

At roughly 1–2KB per variant in JSON, 200 line items across ~25 variants produces ~25–50KB — acceptable as an embedded page payload. Above this the render-time cost becomes disproportionate for customers who may never open the widget. The threshold is a server-side constant, not configurable per merchant in v1.

### Payload structure

Both strategies produce an identical payload structure from the same server-side renderer. The payload contains one entry per variant:

- Variant ID, price, currency
- Cost lines: labor, each material (name, line cost, type), each equipment item (name, line cost), mistake buffer amount
- Shipping material lines — per-shipment fixed values, not scaled by quantity
- Shopify fee rates: payment processing rate and flat fee, Managed Markets fee rate and applicability flag
- Cause assignments: name, icon URL, donation percentage, estimated donation at qty=1, donation link
- Tax reserve display flag (`widget_tax_suppressed` from `TaxOffsetCache`) and estimated rate
- POD cost total — not broken down per line for storefront display; detail is admin-only

> **Security boundary:** The payload must never include net contribution amounts, profit margins, purchase prices of materials, or any field that reveals the merchant's cost structure beyond what is intentionally displayed. `CostEngine` in preview mode returns a display-safe projection only. The endpoint is rate-limited per shop to prevent bulk scraping.

### Widget reactivity rules

- **Variant change:** widget updates in place from in-memory data. No network request. Widget stays expanded.
- **Quantity change:** scaled values (labor, materials, equipment, Shopify fees, cause donation amounts) recomputed client-side by multiplying unit costs by quantity. Shipping material costs do not scale — they are per-shipment fixed values.
- **Currency:** cause donation amounts use Shopify Storefront API MoneyV2 in customer's selected currency. All other costs in shop currency.
- **Managed Markets fee:** shown only when Storefront Localization API detects an international customer. Falls back to currency mismatch detection if Localization API unavailable.

### Cache invalidation

There is no explicit cache to invalidate. Because costs are resolved at render time (pre-load) or at first toggle open (lazy-load), any config change takes effect automatically on the next page load or next toggle open.

Two bounded staleness windows exist:

| Data type | Staleness window | Reason |
| --- | --- | --- |
| Material and equipment costs | Zero — live on render | Resolved by `CostEngine` from current library values |
| POD costs | Up to 24 hours | Widget uses `ProviderCostCache` (daily-synced) |
| Tax reserve suppression | Up to 1 hour | `widget_tax_suppressed` from `TaxOffsetCache`, refreshed hourly |
| Cause assignments | Zero — live on render | Read from Shopify metafields at render or fetch time |

Both staleness windows are acceptable for estimated display values and are disclosed in the widget label "Estimated breakdown — actual donation confirmed after purchase."

### Extension network configuration

The Checkout UI Extension (Thank You page) requires explicit network access configuration in `shopify.extension.toml`:

```toml
[extensions.capabilities]
api_access = true
network_access = true

[extensions.network_access]
allowed_urls = ["https://your-app-server.com"]
```

The extension will silently fail to deploy if `allowed_urls` is missing — no error is shown, the old version remains live. The app server must also return correct `Access-Control-Allow-Origin` headers for the Shopify checkout domain, as fetch calls from the extension are made client-side and CORS applies.

### Thank You page one-shot constraint

The Thank You page (`purchase.thank-you.block.render`) is shown exactly once per order. If the customer refreshes or revisits the URL, they are redirected to the Order Status page. The 30-second polling window in the extension is the only opportunity to show confirmed donation amounts on the Thank You page. The Order Status page (`customer-account.order-status.block.render`) serves as the recovery path for customers who revisit after the snapshot is confirmed.

## Consequences

### Benefits

- Threshold query is cheap — a single aggregate before any cost resolution work begins.
- No circular logic: the delivery decision is made before any payload is computed.
- Pre-load path has zero network requests on interaction.
- Lazy-load path avoids wasted render work for large catalogs.
- Identical widget JS handles both modes — no branching in the extension code.
- No explicit cache invalidation needed — page render always produces fresh data.

### Costs

- Requires a `VariantCostSummary` view or denormalised count column — an extra schema consideration.
- Lazy-load shows a loading state on first toggle open.
- POD costs up to 24 hours stale on the widget.
- Tax suppression flag up to 1 hour stale.
- Threshold of 200 is empirical and may need tuning once real-world profiling data is available.

## Alternatives considered

**Payload size threshold (PRD original)** — Rejected. Circular: to know the compressed payload size you must build the payload, which means you've already resolved all costs and are holding the data in memory. At that point lazy-loading gains nothing — you'd discard data you already computed.

**Variant count threshold** — Rejected as sole metric. Variant count is fast to check but poorly correlated with render cost and payload size. A product with 10 variants × 20 lines is much larger than 30 variants × 2 lines. Line item count captures both dimensions.

**Always pre-load** — Rejected. Resolving 50 variants with complex templates on every page load — even for customers who never open the widget — wastes server resources and adds latency unnecessarily.

**Always lazy-load** — Rejected. For the common case (small product, few variants) a network round-trip on toggle open adds unnecessary latency and a loading state that degrades experience.

**Shopify CDN / edge caching** — Rejected for v1. Introduces cache invalidation complexity — stale cost data could persist at the edge after a merchant updates prices. The "fresh on every render or fetch" guarantee is simpler and more correct for a financial display tool.

## Links

- PRD §10.1 (Product Page Widget)
- PRD §12.1 (Core Data Models — VariantCostSummary)
- PRD §13.2 (Services — CostEngine preview mode)
- PRD §14.4 (Widget security)
- PRD §16 (Known Limitations — POD widget staleness)
- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-005](adr-005-direct-giving-mode.md)
