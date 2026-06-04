# ADR-011: Marketing attribution and customer-facing transparency

- Status: Accepted
- Date: April 2026
- Depends on: ADR-003, ADR-004, ADR-009, ADR-010

## Context

Count On Us is fundamentally a customer trust and transparency product.

The storefront promise is not only that donations are calculated correctly after purchase, but that customers can understand the major categories that affect the donation amount before they buy.

Shop Campaigns introduce a material transparency concern:

- a customer might purchase after viewing or redeeming a Shop Campaigns offer
- the merchant can be charged a customer acquisition cost for that conversion
- that charge can be meaningful relative to the order value, for example $10-$15 on a small order
- if acquisition cost reduces the merchant's available contribution pool, hiding it would make the pre-purchase donation estimate feel misleading

Shopify's public documentation creates several constraints:

- Shop Campaigns attribution is officially visible after an order is attributed, by applying the `Shop Cash Offer Acquired` tag to the order and customer.
- Shopify says that tag can take up to 8 hours to appear on attributed orders.
- As of January 2026, Shop Campaigns fees are charged to the merchant's Shopify bill and are no longer deducted from Shopify Payments payouts.
- Shopify says each charge group can contain multiple orders acquired through the same campaign.
- Shopify says some attributed orders are charged only part of the configured customer acquisition cost and others are charged the full customer acquisition cost, capped by the merchant's configured maximum CAC.
- Ads on Shopify Product Network can send checkout through another Shopify store, and Shopify notes that configured checkout extensions are not compatible with Product Network.
- Shop app and Shop Store surfaces do not render Online Store theme app blocks. Shopify recommends putting customizations or disclaimers that must be visible in Shop into product descriptions.

Sources:

- [Shop Campaigns](https://help.shopify.com/en/manual/online-sales-channels/shop/shop-campaigns)
- [Understanding Shop Campaigns](https://help.shopify.com/en/manual/online-sales-channels/shop/shop-campaigns/understanding-campaigns)
- [Paying for Shop Campaigns](https://help.shopify.com/en/manual/online-sales-channels/shop/shop-campaigns/payment)
- [Shop Campaigns notification templates](https://help.shopify.com/en/manual/online-sales-channels/shop/shop-campaigns/notification-templates)
- [Managing products, categories, and collections on Shop](https://help.shopify.com/en/manual/online-sales-channels/shop/manage-shop-store/products-and-collections)

## Decision

The app will treat paid acquisition and marketing cost as a first-class transparency category, but it will not treat client-side campaign hints as authoritative financial truth.

### Official Shop Campaign attribution is post-order only

For Shop Campaigns, the app will treat the post-order `Shop Cash Offer Acquired` order/customer tag as the only currently documented attribution signal that is safe to use for authoritative campaign classification.

Because Shopify documents an attribution delay of up to 8 hours, the app must not depend on this tag for real-time add-to-cart, cart, checkout, or immediate snapshot-time certainty.

When the tag appears after snapshot creation, the app may record or update an attribution marker for reporting and reconciliation, but it must not silently rewrite immutable order financial truth unless a future ADR defines a safe adjustment workflow.

### Campaign fee amount is not currently order-authoritative

The app will not assume that a Shop Campaign attributed order has a known per-order marketing fee equal to the merchant's configured maximum CAC.

The maximum CAC is an upper bound, not the guaranteed actual charge. Shopify also presents campaign charges as billing charges that can be grouped across multiple orders.

Until Shopify exposes an order-level campaign charge amount through a stable API, the app will model actual Shop Campaign fees as one of:

- unknown at order time
- estimated from merchant configuration
- reconciled later from billing exports or manual merchant entry
- imported later if Shopify exposes a reliable API

### Pre-purchase disclosure should use estimated or reserved marketing cost

The product/cart/checkout transparency surfaces should be able to show a marketing/acquisition cost category when the merchant has configured one.

This category must be labeled as estimated, conditional, or reserved unless the app has authoritative order-level campaign fee data.

Suggested customer-facing language:

- "Estimated marketing/acquisition reserve"
- "May apply when this order is attributed to a paid Shop Campaign"
- "Final donation amount is confirmed after purchase"

The app should prefer showing a conservative estimate over hiding a potentially material marketing deduction, but the wording must not imply certainty that the current customer came from a paid campaign unless the platform provides a reliable signal.

### URL parameters and cookies are advisory only

The app may explore URL parameters, referrer values, landing-page state, cart attributes, or first-party cookies as customer-experience hints, but these signals must remain advisory.

They are not sufficient for authoritative Shop Campaign attribution because:

- Shop Campaigns attribution can occur from Shop app, Shop on the web, Shopify Product Network, or other Shop-run ad surfaces.
- Some surfaces occur outside the merchant's Online Store domain.
- Some attributions are based on ad views, not only offer redemption or link clicks.
- Shopify controls campaign attribution and can apply it after purchase.
- Cookies, referrers, and URL parameters can be missing, stripped, spoofed, blocked, or unavailable in app-proxy and extension contexts.
- Using undocumented campaign parameters as financial truth would create privacy, accuracy, and maintenance risk.

If implemented, these hints can support UI copy such as "This visit may be campaign-associated," but they cannot be used to calculate a final campaign deduction.

### Marketing cost belongs in the cost model as a distinct category

Marketing/acquisition cost should not be hidden inside Shopify fees, POD costs, tax reserve, or merchant margin.

It should be represented as its own display-safe category in preview/reporting contracts:

- production costs
- packaging/shipping materials
- POD/provider fulfillment costs
- Shopify/payment fees
- tax reserve
- marketing/acquisition reserve
- cause donation amount

This keeps customer-facing explanations honest and lets merchants decide how visibly they want to discuss acquisition cost.

### Shop app disclosure requires a static product-description strategy

Because Shop app and Shop Store purchases cannot rely on Online Store theme blocks, the app should support a static product-description disclosure path.

This should be opt-in and merchant-controlled.

Recommended implementation shape:

- generate a display-safe "donation impact" description block from the app's product/variant cost configuration
- insert or update that block in the Shopify product description only between app-owned HTML markers
- preserve all merchant-authored description content outside those markers
- support preview before publish
- support remove/restore behavior
- clearly label the block as an estimate

The description block can be useful even when it is not variant- or quantity-reactive.
It should show a baseline such as the default variant at quantity 1, a range across variants, or a merchant-selected representative variant.

The description block should not attempt to include dynamic Shop Campaign attribution or an exact campaign fee amount. At most, it may include general policy language such as:

"Some purchases may include an estimated marketing/acquisition reserve when an order is attributed to a paid campaign. Final donation amounts are confirmed after purchase."

### Product Network and off-storefront purchases need graceful degradation

The app must assume some sales channels cannot show the full dynamic breakdown before checkout.

For those channels, the fallback transparency hierarchy is:

1. Product description disclosure when the surface renders product descriptions.
2. Shopify notification templates or transaction records when Shopify supports campaign/Shop Cash display there.
3. Post-purchase email and public receipt/transparency surfaces after the order is confirmed.
4. Admin/reporting reconciliation for merchant-only financial truth.

This is a product limitation to disclose clearly, not a reason to block the broader transparency feature.

## Consequences

### Benefits

- keeps the transparency promise honest when marketing cost materially affects donation amounts
- avoids presenting guessed campaign attribution as financial truth
- creates a clear path for Shop app visibility through product descriptions
- separates acquisition cost from other fee categories in reporting and customer-facing explanations
- remains compatible with future Shopify APIs for order-level campaign charge data

### Costs

- pre-purchase marketing cost display may be approximate or conditional
- product-description injection requires careful merchant consent and content preservation
- Shop app disclosure will be less dynamic than Online Store product/cart widgets
- later billing reconciliation may be needed to connect actual campaign charges to attributed orders
- customer-facing copy will need careful wording to avoid overstating certainty

## Alternatives considered

**Ignore marketing/acquisition cost in customer-facing breakdowns** - Rejected. If paid acquisition cost materially reduces the donation pool, hiding it undermines the trust purpose of the app.

**Treat the Shop Campaigns maximum CAC as the actual per-order deduction** - Rejected. Shopify documents that some orders are charged only part of the customer acquisition cost and charge groups can contain multiple orders.

**Use URL parameters or cookies as authoritative campaign detection** - Rejected. These signals are not documented as authoritative, are unavailable in important sales surfaces, and can be missing or spoofed.

**Only disclose campaign cost after purchase** - Rejected as the sole strategy. Post-purchase disclosure is necessary, but customers should get a good-faith pre-purchase estimate when a merchant has configured marketing reserves that can materially reduce donations.

**Automatically overwrite product descriptions** - Rejected. Product descriptions are merchant-authored sales content and are also visible across channels. Any injection must be opt-in, previewable, marker-delimited, and reversible.

## Follow-up implications

- [#102](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/102) tracks a marketing/acquisition cost configuration surface.
- [#103](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/103) tracks display-safe marketing reserve support in widget and public transparency contracts.
- [#104](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/104) tracks Shop Campaigns post-order attribution polling or tag reconciliation.
- [#105](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/105) tracks opt-in product-description donation breakdown generation.
- [#106](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/106) researches whether Shopify exposes billing charge details or campaign charge exports that can be safely reconciled to attributed orders.
- Revisit this ADR if Shopify exposes a stable real-time campaign attribution or order-level campaign fee API.
