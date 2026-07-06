# ADR-021: Shop capability feature flags

- Status: Proposed
- Date: July 2026
- Depends on: ADR-003, ADR-010, ADR-015, ADR-018, ADR-020

## Context

Count On Us has accumulated several advanced surfaces that are valuable but not part of the merchant's common daily workflow:

- Shipping Packages and Package Profile configuration
- Provider Connections and provider-backed POD mapping/cost surfaces
- variant-level provider mapping details
- future experimental cost-model extensions from ADR-018

These features are not equally mature and not equally relevant to every merchant. When shown unconditionally, they add weight to high-frequency screens such as variant cost editing. They also introduce concepts that can distract from the core setup path: templates, material lines, equipment lines, labor minutes, cost preview, and payout/reporting confidence.

The app currently has no explicit feature-flag or capability model. Some features can be suppressed locally in one route, but local suppression does not address navigation, route access, setup prompts, exports, reports, background jobs, or cost-resolution behavior.

ADR-015 anticipated a dedicated admin experience with shop-scoped capability configuration. This ADR expands that idea into a concrete capability-flag model.

## Decision

Count On Us will add persistent shop-scoped capability flags for optional or advanced feature families.

These are merchant-facing product capabilities, not short-lived A/B experiments. They answer: "Is this shop using this feature family?" rather than "Which experiment bucket is this request in?"

Initial capability flags:

- `packageProfilesEnabled`
- `providerIntegrationsEnabled`

Future capability flags may be added for other advanced cost-model or reporting features when they create meaningful UI, data, or workflow complexity.

### Storage

Capability flags should be stored in the database as part of shop configuration.

The first implementation may use one of these approaches:

- explicit nullable/non-null boolean columns on `Shop`
- a typed JSON settings column if a broader settings object already exists by the time this ADR is implemented

Given the current schema, explicit boolean columns on `Shop` are the simplest first choice.

Recommended defaults:

- `packageProfilesEnabled = false`
- `providerIntegrationsEnabled = false`

Default-off keeps immature or rarely used surfaces out of the main workflow for new shops. Existing shops with package/profile/provider data should be considered during migration; if a shop already has meaningful related records, the migration or post-migration backfill should enable the corresponding capability for that shop.

### Settings UI

Settings should expose an "Advanced features" or "Capabilities" section.

The section should include concise toggles:

- Package profiles
- Provider integrations

Each toggle should describe the main surfaces it controls and warn when disabling hides UI without deleting data.

Disabling a capability must not delete records. It only suppresses creation/editing/navigation and removes the feature from high-frequency workflows.

If existing data is present, the UI should make that visible before disabling. For example:

- "3 shipping packages are configured. Disabling Package profiles hides package setup but keeps the records."
- "1 provider connection and 24 mappings exist. Disabling Provider integrations hides provider-backed setup but keeps historical records."

### Package profiles capability

When `packageProfilesEnabled` is false, the app should suppress:

- Shipping Packages navigation
- Shipping Packages route primary UI
- variant Package Profile section
- package profile setup prompts
- package-specific creation/editing entry points

Historical package allocation records should remain readable where needed for snapshots or reports. Reports may still display package allocation evidence if historical snapshots contain it, but they should not prompt the merchant to configure package profiles.

Cost resolution and snapshot creation should treat missing or disabled package configuration gracefully. The flag must not mutate existing `VariantCostConfig` package fields, `ShippingPackage`, or historical `OrderPackageAllocation` data.

If package profiles are later re-enabled, previously configured packages and variant package preferences should become visible again.

### Provider integrations capability

When `providerIntegrationsEnabled` is false, the app should suppress:

- Provider Connections navigation
- provider setup prompts
- provider mapping sections on variant detail pages
- provider mapping summaries on product/variant index pages
- manual provider mapping entry points
- provider sync controls
- POD-specific setup language in normal cost workflows

Provider-related background jobs should not be scheduled from hidden UI when the capability is disabled.

Historical snapshots that already contain POD cost lines or provider-derived cost flags must remain readable. Disabling the capability must not erase `ProviderConnection`, `ProviderVariantMapping`, `ProviderCatalogVariant`, `ProviderCostCache`, `ProviderSyncRun`, or snapshot POD evidence.

Cost resolution needs an explicit policy:

- Preview mode should ignore provider mappings when `providerIntegrationsEnabled` is false.
- Snapshot mode should ignore provider mappings for new snapshots when `providerIntegrationsEnabled` is false.
- Existing snapshots remain immutable and continue displaying their stored provider/POD evidence.

This avoids a confusing state where a merchant disables provider integrations but new order snapshots still pick up provider-backed costs through hidden mappings.

If provider integrations are re-enabled, existing provider connections, mappings, and cached costs may be reused subject to validation freshness rules from ADR-010.

### Navigation and route access

Capability flags should be enforced consistently at navigation and route levels.

Navigation should hide disabled feature entries.

Routes for disabled capabilities should not expose full editing workflows. They may show a small disabled-state page with:

- the feature name
- a note that it is disabled in Settings
- a link to Settings if the merchant has permission to change capabilities

Route actions for disabled capabilities should reject mutations with a clear response rather than trusting hidden navigation.

Read-only historical evidence routes may continue to show disabled-capability data when the data is part of immutable snapshots, reporting support, or audit history.

### UI composition rules

High-frequency screens should not show large empty cards for disabled or unused capabilities.

On variant detail pages:

- package profile controls should be hidden when Package profiles are disabled
- provider mappings should be hidden when Provider integrations are disabled
- provider mappings should also be omitted when no mapping exists unless the feature is enabled and the page intentionally offers mapping actions
- low-frequency utilities such as copy/promote automation can be collapsed behind disclosures

Feature flags should be checked before rendering large sections, not only before rendering buttons.

### Data and audit behavior

Changing a capability flag is a shop configuration mutation and must write an audit log entry.

Audit payloads should include:

- flag name
- previous value
- next value
- counts of existing related records when useful

The payload should not include provider credentials or sensitive external account data.

Capability changes should be reversible unless a later ADR explicitly defines a destructive cleanup flow.

### Implementation approach

Add a small server-only helper for loading shop capabilities, for example:

- `getShopCapabilities(shopId, db)`
- `requireShopCapability(shopId, capability, db)`

Route loaders should use the helper to decide what to render.

Route actions and service entry points that mutate optional feature data should call the capability guard before writing.

Cost-resolution services should receive capability context or load it internally through an explicit, testable boundary. The behavior must be covered by regression tests, especially for provider cost suppression when provider integrations are disabled.

The initial implementation should avoid scattering raw `shop.packageProfilesEnabled` and `shop.providerIntegrationsEnabled` checks across the codebase. Prefer a typed object:

```ts
type ShopCapabilities = {
  packageProfiles: boolean;
  providerIntegrations: boolean;
};
```

This gives the UI and services stable language even if the underlying storage changes.

## Consequences

Merchants get a quieter default experience while advanced workflows remain available when intentionally enabled.

The app gains a single decision point for optional feature families instead of one-off conditional rendering.

Implementation touches several areas:

- Prisma schema and migration
- Settings loader/action/UI
- admin navigation
- package routes
- provider routes
- variant detail/product/variant list pages
- cost preview and snapshot cost resolution
- setup wizard prompts
- tests

The provider capability is the higher-risk flag because it changes cost-resolution behavior for new previews and snapshots. It must be implemented with explicit tests and clear merchant-facing copy.

The package profile capability is mostly UI/workflow suppression because package allocations are already snapshot evidence and should remain immutable.

## Alternatives considered

### Hide only on the variant page

This reduces immediate clutter but leaves navigation, setup prompts, route actions, and provider/package behavior inconsistent.

Rejected as the long-term architecture, though local route suppression can be used as an interim UX improvement.

### Environment-variable feature flags

Environment flags are useful for deploy-time rollout but do not solve shop-by-shop capability differences. They also require redeploys for merchant configuration changes.

Rejected for merchant-facing capability control.

### Role/permission-based hiding

Permissions answer "who can use this?" not "does this shop use this feature?" They may be layered later but should not replace shop capability flags.

Rejected as the primary model.

### Delete records when disabling

Deleting provider or package records would make the toggle destructive and could damage historical interpretation.

Rejected. Disabling hides active workflows and suppresses future use; it does not delete existing data.

## Follow-up work

Implementation should be staged:

1. Add schema fields, settings toggles, audit logging, and shared capability helper.
2. Gate Package Profiles navigation, route UI, variant Package Profile controls, and setup prompts.
3. Gate Provider Connections navigation, route UI, provider mapping sections, provider setup prompts, and provider sync actions.
4. Update cost preview and snapshot cost resolution to ignore provider mappings when provider integrations are disabled.
5. Add regression tests for route action guards and provider cost suppression.
6. Add or update Playwright coverage for Settings toggles and variant-page suppression.
