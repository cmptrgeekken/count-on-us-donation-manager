# ADR-026: Customer-facing artist and cause merchandising

| | |
| --- | --- |
| **Status** | Proposed |
| **Date** | July 2026 |
| **Depends on** | ADR-004, ADR-012, ADR-013, ADR-014, ADR-021 |

## Context

The app already supports product donation routing, public transparency, artist collaboration records, artist-submitted collaboration intake, product-page donation widgets, cart summaries, and Shopify Cause metaobject sync. Sparkly Rocketship also maintains customer-facing Shopify pages for artists and supported causes, uses artist labels on collection product images, and wants artist/cause information available for storefront search and collection filtering.

The current storefront donation widget is intentionally richer than what Shopify's Shop app, external sales channels, marketplaces, or other product data consumers can render. Those surfaces often receive only Shopify-native product data such as title, images, vendor, tags, metafields, and product description HTML. If Count On Us data only appears in app-owned storefront widgets, customers on these external surfaces miss important artist, cause, and donation-estimate context.

The app needs a customer-facing merchandising layer that:

- renders public Artists and Causes directories without merchants hand-maintaining Shopify pages
- exposes artist and cause assignments in Shopify-native custom data for filtering and external consumers
- can display artist credit overlays on product images in collection/search grids when enabled
- can optionally inject a lightweight donation summary into Shopify product descriptions
- preserves the existing widget as the authoritative interactive disclosure surface
- avoids mutating merchant-authored product descriptions unless explicitly opted in

## Decision

The app will add a customer-facing artist and cause merchandising layer built around Shopify metaobjects, typed product metafields, theme app extension blocks/embeds, and app-proxy-backed public endpoints.

### Artists and Causes use public metaobjects

Causes will continue to sync to Shopify metaobjects. Artists will also sync to Shopify metaobjects.

Cause metaobjects should expose public display fields such as:

- name
- legal name, when appropriate
- description
- icon URL or image reference
- donation link
- website URL
- Instagram URL
- 501(c)(3) flag
- status

Artist metaobjects should expose public display fields such as:

- display name
- credit name
- public bio
- icon/avatar URL or image reference
- website URL
- Instagram URL
- status

The app database remains authoritative for financial calculations, product assignment rules, payouts, snapshots, and reporting. Shopify metaobjects are public presentation and filtering records, not the source of truth for financial behavior.

### Product assignments sync to typed Shopify metafields

The existing JSON product metafield for donation widget support may remain, but it is not sufficient for Shopify-native filtering.

The app will write dedicated product metafields for public merchandising and filtering:

- `donation_manager.artist_refs` with type `list.metaobject_reference`
- `donation_manager.cause_refs` with type `list.metaobject_reference`

The app may also write text fallback metafields when needed for theme compatibility or merchant filtering preferences:

- `donation_manager.artist_names` with type `list.single_line_text_field`
- `donation_manager.cause_names` with type `list.single_line_text_field`

Reference metafields are the preferred default because they keep names, icons, links, and other display metadata attached to durable public records. Text metafields are optional compatibility helpers, not the canonical public model.

Metafield definition creation must be idempotent during install, re-auth, and settings repair flows. Sync failures should not roll back local product assignment changes, but they must be audit logged and exposed to the merchant as recoverable sync failures.

### Public Artists and Causes directories use theme app blocks

The app will provide Shopify Theme App Extension page blocks for:

- Artists directory
- Causes directory

These blocks render on Shopify page templates and hydrate from app proxy endpoints. They are the default path for replacing hand-maintained public pages.

The initial directory modes should include:

- simple list, closest to the current manually-authored pages
- card directory, with icons/images, bios/descriptions, and public links

A later richer mode may include product previews, such as the first few active products assigned to an artist or cause. Product previews are optional because they increase payload size, require more theme compatibility testing, and can blur the directory's primary purpose.

Each directory block should support merchant-configurable display settings such as:

- heading and intro text
- list or card layout
- whether to show icons/images
- whether to show website, Instagram, or donation links
- whether to show assigned causes on artist cards
- whether to show product filter links
- maximum records or product previews when applicable

These directories are public presentation surfaces. They must not expose internal notes, contact details, payout settings, payment notes, tax status, order history, or private submission data.

### Product image overlays use an opt-in app embed

The app will provide an opt-in theme app embed for product-card artist overlays.

The embed should annotate collection/search/product-grid cards when it can reliably identify a Shopify product and read or fetch its public artist assignment metadata. The default badge text is:

- first assigned artist credit name
- `+ N more` when more artists are assigned

For example, a product assigned to three artists displays the first artist plus `+ 2 more`.

The overlay must be configurable:

- enabled/disabled
- badge position
- visual style
- max label length
- whether to hide on small screens

Because product-card markup differs across themes, the overlay is best-effort and opt-in. It should fail closed: if the product cannot be identified, metadata cannot be fetched, or the card cannot be safely annotated, no badge is rendered.

### Product description injection is opt-in and bounded

The app may optionally inject a lightweight donation summary into Shopify product descriptions for external surfaces that consume description HTML but cannot render app widgets.

This feature is disabled by default and must be explicitly enabled at the shop level before any product description is modified. Product-level overrides may be added later.

Injected content must be wrapped in stable markers controlled by Count On Us, for example:

```html
<!-- count-on-us:start -->
<section data-count-on-us-description-summary>
  ...
</section>
<!-- count-on-us:end -->
```

The app may only replace content between its own markers. It must not rewrite merchant-authored description content outside the marked block.

The summary should include:

- artist credit names
- assigned causes
- estimated donation range across configured variants
- a short estimate disclosure
- a link to the richer storefront transparency or product widget surface when available

The donation amount should be a range across configured variants rather than a single variant estimate. Product descriptions are product-level data and are often consumed outside the variant-selection context, so a range is more accurate than using a selected/default variant.

If no configured variant can produce a display-safe estimate, the injected block should omit the dollar amount and show artist/cause context only.

### The product widget remains authoritative

The product-page donation widget remains the primary interactive disclosure for detailed estimated breakdowns. Directory pages, overlays, metafields, and description injection are merchandising and portability layers.

These surfaces must avoid implying final donation amounts. They should use estimate language and route customers to the richer widget/transparency surface for details when possible.

## Consequences

### Benefits

- Public artist and cause pages can be generated from app data instead of maintained by hand.
- Shopify-native metafields allow merchants to use artist and cause assignments in search and collection filtering.
- Metaobject references keep icons, links, and public profile metadata attached to durable records.
- Product-card overlays make artist collaborations visible earlier in the browsing journey.
- Description injection gives Shop and external product-data consumers a lightweight fallback when app widgets are unavailable.
- The existing app database remains authoritative for financial and payout behavior.

### Costs

- Artist metaobject definition and sync logic must be added and kept idempotent.
- Product assignment save flows need broader Shopify sync behavior and retry/audit handling.
- Storefront filters still require merchant/theme support and may need configuration in Shopify Search & Discovery or theme filter settings.
- Product-card overlays require careful theme compatibility testing and cannot be guaranteed across all themes.
- Product description injection introduces risk around merchant-authored copy, API rate limits, and stale generated HTML.
- Donation estimate ranges can become stale until the next sync after cost, price, assignment, or setting changes.

### Security and privacy considerations

- All public endpoints must be shop-scoped and expose only display-safe fields.
- Artist contact names, emails, payment settings, tax status, internal notes, submissions, and files must never be exposed through public directory, overlay, metafield, or description summary payloads.
- Description injection must validate and escape all app-generated text.
- Public app proxy endpoints should use the same storefront hardening posture as existing widget endpoints, including rate limiting and bounded payloads.

### Operational considerations

- Product metafield sync should run after direct Cause assignment saves, Artist assignment saves, Artist profile updates that affect public fields, Cause updates, and install/re-auth repair flows.
- Description summary sync should be asynchronous for bulk updates and should record per-product sync failures.
- Merchants need explicit setup affordances for adding the directory blocks and enabling the overlay embed.
- Product description injection needs a clear preview, enable/disable control, and repair action to remove Count On Us blocks from descriptions if the feature is disabled.

## Alternatives considered

**Continue with manual Shopify pages only** - Rejected. Manual pages drift from app data and do not scale as artists, causes, and product assignments change.

**Use only JSON product metafields** - Rejected as the public filtering model. JSON is useful for app-owned widgets but does not map cleanly to Shopify-native storefront filters.

**Use text metafields instead of metaobject references** - Rejected as the default. Text fields are simpler but lose durable public profile records, icons, and links. Text fields remain acceptable as optional compatibility fallbacks.

**Create Shopify-native theme templates rather than app blocks** - Rejected for the default path. Theme templates are more merchant/theme-specific, while app blocks can be shipped and updated through the app's theme extension and added through the theme editor.

**Overlay badges by rewriting theme code** - Rejected. Theme code mutation is brittle and harder to uninstall safely. An opt-in app embed has a cleaner merchant experience and lower long-term maintenance risk.

**Always inject donation summaries into product descriptions** - Rejected. Product descriptions are merchant-authored content and are widely consumed by sales channels. Injection must be opt-in, marked, reversible, and conservative.

**Use a single selected variant for description donation estimates** - Rejected. Product descriptions are product-level and external platforms may not preserve variant context. A configured-variant range is more honest.

## Links

- [ADR-004](adr-004-storefront-widget-data-delivery.md)
- [ADR-012](adr-012-public-financial-disclosure-boundaries.md)
- [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md)
- [ADR-014](adr-014-artist-submission-storefront-widget.md)
- [ADR-021](adr-021-shop-capability-feature-flags.md)
