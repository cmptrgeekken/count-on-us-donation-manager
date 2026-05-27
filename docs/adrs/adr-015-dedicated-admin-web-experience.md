# ADR-015: Dedicated admin web experience

- Status: Proposed
- Date: May 2026
- Depends on: ADR-001, ADR-003, ADR-004, ADR-010, ADR-012, ADR-013, ADR-014

## Context

Count On Us began as a standard embedded Shopify app, but its product surface has grown beyond a simple Shopify-admin companion. The app now includes cost libraries, shipping package modeling, production templates, variant configuration, product/Cause assignment, artists, artist submissions, provider connections, reporting periods, disbursements, receipts, audit logs, storefront widgets, checkout/order-status surfaces, public receipt pages, and provider/POD workflows.

The current embedded shell uses Shopify's `AppProvider` and `ui-nav-menu`, which places navigation into Shopify admin chrome. That keeps the app familiar to Shopify merchants, but it also compresses a large product into a menu model that is increasingly hard to organize. Several workflows are closer to a dedicated operational product than to a lightweight embedded settings panel.

Printify and similar apps demonstrate a hybrid pattern: the app can still be launched from Shopify and may still run in the Shopify iframe, but the product experience uses its own application navigation, hierarchy, and workflow design instead of relying entirely on Shopify-native admin navigation.

Count On Us also needs a clearer way to manage product complexity across shops. Not every merchant needs every component. A single shop may need only donation transparency, only POD cost attribution, only artist collaborations, or the full financial/reporting workflow. Without explicit capability toggles, the admin experience risks becoming overwhelming and the codebase risks accumulating conditional complexity in route-level copy and placeholder states.

## Decision

Count On Us will plan toward a dedicated app-owned admin web experience while preserving Shopify authentication, shop scoping, webhook ingestion, extension deployment, and App Store compatibility.

The dedicated experience may still run embedded inside the Shopify iframe, but the primary information architecture, navigation, page grouping, onboarding, and feature availability will be controlled by Count On Us rather than by Shopify's `ui-nav-menu`.

This ADR does not require leaving Shopify's embedded app model. The initial target is an embedded-first hybrid shell:

- Shopify remains the installation, OAuth, billing/listing, webhook, and extension platform.
- The app continues to support embedded launch from Shopify Admin.
- Count On Us renders its own persistent navigation, section grouping, onboarding state, and contextual workflow menus.
- The existing Shopify admin nav menu is reduced to a small compatibility surface or removed after the custom shell is validated.
- Routes remain shop-scoped and authenticated by the existing admin auth layer.
- Storefront widgets, app proxy pages, checkout/order-status extensions, and public endpoints remain app-owned surfaces governed by their existing ADRs.
- Direct app-domain access is deferred unless a clear operational or App Store review benefit appears during the shell spike.

## Experience model

The dedicated admin should be organized around merchant jobs rather than implementation modules.

Initial top-level areas:

- **Home** - operational dashboard, setup state, alerts, and next actions
- **Products** - products, variants, templates, shipping packages, provider mappings, and assignment workflows
- **Giving** - Causes, product/Cause assignment, public transparency, receipts, and donation communication
- **Artists** - artists, submissions, product attribution, Cause preferences, and artist payables
- **Reporting** - periods, disbursements, exports, analytical recalculation, and audit history
- **Settings** - shop settings, feature configuration, provider credentials, email, disclosure controls, and data lifecycle settings

This grouping may change after design discovery, but the core principle is stable: the shell should expose coherent workflows, not a long flat list of routes.

The first shell target is grouped navigation plus a dashboard. This is intentionally larger than a sidebar-only skin, because capability-aware onboarding and workflow grouping need to be validated together. It is intentionally smaller than a full route redesign, because the first spike should prove the shell model before rewriting every workflow.

The dedicated experience should be visually distinct from Shopify where useful. It should still behave like a serious operational tool, but it does not need to look like a default Shopify Admin surface.

## Feature toggles and capability configuration

The app will introduce a merchant-facing, shop-scoped feature capability layer before or alongside the dedicated shell migration.

Capabilities should be explicit, auditable, and server-enforced. They should not be only client-side navigation filters.

Initial mandatory capability groups:

- `cost_modeling`
- `variant_management`
- `product_management`
- `cause_management`
- `reporting`

Initial optional capability groups:

- `shipping_cost_modeling`
- `pod_provider_connections`
- `storefront_product_widget`
- `cart_donation_summary`
- `public_transparency`
- `post_purchase_donation_surfaces`
- `post_purchase_email`
- `donation_receipts`
- `disbursements`
- `artist_collaborations`
- `artist_submissions`
- `artist_payouts`
- `audit_log`

Materials, Variants, Products, Causes, and Reporting are mandatory because they form the minimum useful operational model for Count On Us. Materials feed cost resolution, Variants and Products anchor Shopify catalog behavior, Causes anchor giving attribution, and Reporting keeps the financial transparency promise visible.

Each capability should define:

- whether the feature is available to the shop
- whether the feature is enabled
- whether it is required by another enabled capability
- what setup state or configuration is missing
- which routes, nav items, background jobs, storefront widgets, and settings it controls
- whether disabling it hides UI only, pauses behavior, or is blocked because historical data exists

The capability layer should be loaded in the admin shell and also checked in route loaders/actions where feature access affects data mutation or sensitive data exposure.

Feature configuration must not rewrite historical financial records. Disabling a capability should hide the related route group and preserve its data unless the merchant explicitly performs a separate data deletion workflow. Historical snapshots, disbursements, artist payable history, and audit log entries remain intact.

Hidden capabilities may still affect reporting, storefront widget displays, and public surfaces. The policy layer must distinguish between:

- hiding admin navigation
- suppressing public/customer-facing display
- pausing background jobs or notifications
- preserving historical data for internal reporting
- blocking mutations while still allowing read-only internal access where needed

Dependencies should be lenient by default. Capabilities should allow partial setup and guide the merchant toward missing configuration instead of blocking broadly. Hard blocking is reserved for cases where enabling the feature would create misleading public disclosures, financial inconsistency, privacy exposure, or broken customer-facing behavior.

Capability settings should support both individual toggles and recommended bundles. Bundles make onboarding easier, while individual toggles let shops tailor the app to their actual operations.

Recommended bundles:

- donation transparency
- product cost transparency
- POD cost attribution
- artist collaboration program
- full donation reporting and disbursement management

### Audit logging for capability changes

Capability changes should be audit logged when they affect customer-facing behavior, public disclosures, financial workflows, private artist data, provider connectivity, or retention/access boundaries.

Initial audit-log recommendation:

- enable or disable storefront product widget
- enable or disable cart donation summary
- enable or disable public transparency surfaces
- enable or disable post-purchase donation surfaces
- enable or disable post-purchase donation email
- enable or disable donation receipts
- enable or disable artist collaborations
- enable or disable artist submissions
- enable or disable artist payouts
- enable or disable provider/POD connections
- change capability bundles
- change disclosure settings that suppress or expose financial, Cause, receipt, artist, or pending-disbursement data

Low-risk UI-only changes, such as hiding a purely internal shortcut without changing route access or public behavior, do not need audit logging.

## Migration plan

### Phase 1: Product architecture and capability inventory

- Inventory every route, extension, job, service, and public endpoint.
- Map each surface to one or more capability groups.
- Mark capabilities as core, optional, or dependent.
- Identify routes that are currently placeholders or low-value for a shop without related capabilities.
- Decide whether capability configuration is merchant-facing, internal/admin-only, plan-based, or a mix.

### Phase 2: Capability schema and server policy

- Add shop-scoped capability configuration storage.
- Add a small server policy helper that answers whether a feature is available, enabled, blocked, or missing setup.
- Add audit logging for capability changes that affect public/customer-facing behavior or financial workflows.
- Update route loaders/actions to enforce capability policy where needed.
- Keep existing routes reachable for development and migration until the new shell is ready.

### Phase 3: Dedicated shell spike

- Build a new app-owned shell around existing routes.
- Keep Shopify embedded auth and session behavior intact.
- Render Count On Us navigation in-app.
- Validate behavior inside the Shopify iframe.
- Defer direct app-domain validation unless the spike finds a concrete need.
- Verify browser history, deep links, save bars, dialogs, focus management, responsive layout, and Shopify navigation events.
- Focus the spike on a highest-pain workflow area rather than a low-risk route group, so the result proves the shell under real product complexity.

### Phase 4: Route grouping and workflow redesign

- Move from the current flat route list toward the dedicated information architecture.
- Reuse existing loaders/actions/services wherever possible.
- Add redirects or compatibility links for old route paths.
- Convert setup wizard and dashboard into capability-aware onboarding.
- Collapse low-value placeholder states into clear setup prompts or hidden navigation.

### Phase 5: Merchant-facing feature selection

- Add a configuration experience where merchants can select the components they need.
- Show dependencies clearly before enabling or disabling capabilities.
- Require confirmation before disabling customer-facing or financial workflow features.
- Provide both recommended bundles and individual feature toggles.
- Hide disabled route groups from primary navigation while preserving their data.

### Phase 6: App Store and operational hardening

- Confirm the dedicated shell still satisfies Shopify App Store embedded app expectations.
- Update listing copy, onboarding, screenshots, privacy disclosures, and support docs.
- Verify accessibility and keyboard navigation for the custom shell.
- Add Playwright coverage for shell navigation, capability gating, setup flows, and deep links.
- Monitor usage, disabled-feature errors, and abandoned setup states.

## Consequences

### Benefits

- gives the app an information architecture that can scale with its actual product scope
- reduces dependence on Shopify's flat embedded navigation model
- allows shops to configure the app around the components they truly need
- improves onboarding by showing only relevant setup steps and routes
- creates a clearer foundation for Printify/POD, artist collaboration, and public transparency workflows
- makes future pricing, plan tiers, and merchant bundles easier to reason about

### Costs

- substantial design, implementation, QA, and documentation work
- introduces a new capability policy layer that must be consistently enforced
- increases risk of route access bugs if UI hiding and server enforcement diverge
- requires careful embedded iframe testing because App Bridge, save bars, modals, focus, and navigation can behave differently inside Shopify Admin
- may require App Store review clarification if the app no longer looks like a conventional embedded Shopify admin app
- adds migration overhead for existing route links, docs, screenshots, tests, and merchant expectations

## Alternatives considered

**Keep the current Shopify `ui-nav-menu` shell** - Rejected as the long-term target. It is simple and Shopify-native, but the route list is already too large for a flat embedded app navigation model.

**Leave the Shopify iframe entirely** - Deferred. A fully standalone admin experience may eventually be useful, but it increases authentication, launch, App Store review, and merchant expectation risk. The safer first move is an app-owned shell that still works embedded.

**Build a second separate non-Shopify app** - Rejected for now. The app's value depends on Shopify products, orders, webhooks, extensions, and shop-scoped configuration. Splitting the admin into a separate product would add operational overhead without removing the need for Shopify integration.

**Add feature toggles only** - Rejected as sufficient. Toggles can reduce visible complexity, but they do not solve the underlying navigation and workflow architecture problem.

**Redesign route by route without a shell change** - Rejected as the primary strategy. Individual page improvements are useful, but they will not address cross-feature orientation, onboarding, or merchant-specific capability bundles.

## Open questions

1. Is the mandatory capability set complete, or should Settings, audit history, donation receipts, or disbursement basics also be mandatory?
2. Which highest-pain workflow should the shell spike target first?
3. Should the current setup wizard become the primary capability-driven onboarding surface, or should onboarding move into the dashboard?
4. Are there any Shopify App Store review constraints that require retaining Shopify-native navigation for core pages?
5. Should Settings remain exposed through Shopify's native nav as a shortcut after the custom shell ships?
6. How should hidden capability data be represented in Reporting and storefront widget outputs?
7. Which existing tests should be rewritten around capability-aware navigation, and which route tests can remain unchanged?

## Follow-up implications

- Create a route/capability inventory document before implementation.
- Add a schema proposal for shop-scoped capability configuration.
- Add a dedicated shell spike plan with embedded Shopify validation steps.
- Update `docs/current-implementation-status.md` once the direction is accepted.
- Update App Store listing and screenshot planning if the custom shell becomes the target admin experience.
- Revisit route naming and redirects after the route grouping decision is made.

## Links

- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-004](adr-004-storefront-widget-data-delivery.md)
- [ADR-010](adr-010-provider-rollout-strategy.md)
- [ADR-012](adr-012-public-financial-disclosure-boundaries.md)
- [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md)
- [ADR-014](adr-014-artist-submission-storefront-widget.md)
