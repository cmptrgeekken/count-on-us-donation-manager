# Issue #85 - Printify POD Rollout Plan

This document turns [GitHub issue #85](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/85) into an implementation plan with explicit scope boundaries, sequencing, validation targets, and breaking changes.

It is intentionally narrower than the full PRD. The goal is to ship one real provider integration end to end, starting with Printify, without accidentally blending in broader storefront or App Review hardening work that belongs in other issues.

## Current Baseline

What exists today:

- Provider Connections has a real admin route and service foundation.
- Printify credentials can be stored encrypted and disconnected later.
- Variant SKU coverage is summarized for readiness review.
- Provider schema tables exist for connection state, variant mappings, and cached provider costs.
- The storefront, post-purchase, snapshot, and order-history surfaces already expose POD-related fields in anticipation of real data.

What is still stubbed or incomplete:

- Printify credentials are not validated against the provider API.
- No provider catalog sync runs today.
- No usable provider mapping workflow exists yet.
- `ProviderCostCache` is not being populated from a real provider sync.
- Snapshot creation does not perform a real live POD fetch before transaction open.
- Provider state is not operationally observable beyond configured/not configured metadata.

## Current Status Checklist

### Done

- [x] Printify credentials can be saved and validated
- [x] Provider Connections shows Printify connection state
- [x] Provider Connections shows token added date
- [x] Provider Connections shows estimated token expiry
- [x] Provider Connections shows unhealthy / sync-failed credential state
- [x] Manual Printify sync can be triggered from the admin
- [x] Sync pulls Printify catalog data
- [x] Unique SKU overlap matching is implemented
- [x] Cached POD fulfillment costs are stored locally
- [x] Admin cost resolution can consume cached POD costs
- [x] Snapshot creation attempts live Printify cost fetch before cache fallback
- [x] Products list shows POD mapping coverage
- [x] Variants list shows POD mapping presence
- [x] Variant Detail shows provider mapping metadata
- [x] Variant Detail shows cached provider cost lines
- [x] Variant Detail preview includes a POD cost row
- [x] Provider sync caches provider catalog variants for later merchant review
- [x] Manual provider-to-Shopify variant mapping UI exists for unresolved Printify variants
- [x] Provider Connections shows richer Printify troubleshooting diagnostics

### Working, But Needs Validation

- [~] POD costs in Variant Detail are only useful when the variant has an active mapping with cached cost lines
- [~] Storefront widget payload path includes POD cost fields
- [~] Storefront reconciliation math includes POD cost inputs server-side
- [~] Storefront widgets should display POD cost rows when POD is non-zero
- [~] Sync/error UX is substantially improved, but still needs real-merchant validation with live Printify data
- [~] Unique-SKU happy path appears implemented, but we still need stronger confidence around edge cases and mixed catalogs
- [~] Variants without a manual `VariantCostConfig` now still resolve cached POD costs, but this path still needs live-storefront validation
- [~] Manual mapping workflow is implemented and covered by automated tests, but still needs live-merchant validation against real Printify catalogs

### Not Built Yet

- [ ] Merchant workflow for resolving duplicate SKU collisions in-app
- [ ] Merchant workflow for handling variants with no SKU in-app
- [ ] Multi-shop Printify selection flow
- [ ] Clear provider-side shipping-cost import strategy
- [ ] Full storefront confidence that mapped variants always surface non-zero POD costs correctly
- [ ] Broader provider support beyond the current Printify tranche
  Current direction per ADR-010: keep the near-term rollout Printify-first, preserve provider-neutral seams, and treat Printful as the next planned provider rather than an implied current capability.
- [ ] Final documentation/ADR treatment for all POD tradeoffs and edge cases

### Open Questions

- [ ] How should tax reserve interact with POD-related contribution math once issue `#82` is addressed?

### Latest Implementation Notes

- Provider sync now persists a local `ProviderCatalogVariant` cache so manual mapping can work against a stable merchant-visible provider catalog snapshot instead of only transient sync output.
- Provider Connections now surfaces unresolved variants with manual mapping controls, SKU diagnostics, and cached provider catalog counts.
- Provider-side shipping is explicitly deferred for the current tranche until we can model it without double-counting against existing packaging/shipping assumptions or blurring shipment-level versus variant-level costs.
- Provider rollout direction is now explicit: Printify is the current merchant-complete tranche, while future provider work should reuse provider-neutral orchestration seams instead of extending Printify-specific logic indefinitely.
- Duplicate/missing-SKU cases should remain informational rather than strong warnings or blockers. These mismatches are often deliberate merchant choices rather than operational failures.

### Recently Resolved

- [x] Variants with active provider mappings but no manual `VariantCostConfig` were falling through the early zero-cost return in `CostEngine`, which suppressed cached POD costs in Variant Detail and storefront payloads

## Goal

Ship the first production-meaningful POD slice:

1. A merchant can connect Printify and confirm the credentials are valid.
2. The app can fetch provider catalog/cost data needed to map Shopify variants.
3. The app can persist and refresh provider mappings and cached POD costs.
4. `CostEngine` uses real POD inputs instead of a zero stub.
5. Snapshots, reporting previews, storefront previews, and post-purchase summaries reflect real POD costs where mappings exist.

## Non-Goals

This issue should not quietly absorb adjacent work that already has a better home.

Out of scope for `#85`:

- Broad storefront batching, proxy redesign, or rate-limit redesign
- Theme compatibility hardening beyond what is required to consume the new data
- Tooltip/disclosure redesign and storefront accessibility cleanup
- Full Printful implementation
- App Review submission cleanup
- Country-aware tax guidance
- Sole proprietor deduction policy changes

Related follow-on issues:

- `#88` storefront proxy, batching, and theme boundary hardening
- `#90` storefront accessibility and customer comprehension
- `#89` docs and setup guidance alignment
- `#87` App Review blockers
- `#98` Printful parity and provider-scope follow-up

## Delivery Strategy

Treat this as a backend-first workstream with a thin admin surface.

Recommended order:

1. Lock the backend contract and schema changes.
2. Implement Printify validation plus provider sync primitives.
3. Implement mapping persistence and sync run visibility.
4. Feed cached/live POD costs into `CostEngine` and snapshot flows.
5. Expose just enough admin UX to make the workflow usable and diagnosable.

The important discipline is to make the money correct before making the storefront prettier.

## Workstreams

### 1. Provider Contract and Schema

Add the data model required for a real provider lifecycle instead of a configuration-only shell.

Planned additions:

- `ProviderSyncRun` table to record sync attempts, trigger source, lifecycle timestamps, counts, and error summary
- richer `ProviderVariantMapping` status fields so mappings can distinguish auto-matched, manually mapped, stale, failed, or unresolved states
- provider-side identifiers needed for supportability, not just a single provider variant id
- cost-cache provenance fields such as source timestamp, stale reason, and currency details if missing today

Principles:

- Keep Printify first-class without over-abstracting for speculative providers.
- Preserve shop isolation on every provider model.
- Make sync state inspectable without reading raw logs.

### 2. Printify Connection Validation

Replace "save credentials" with "validate and save credentials".

Current token requirements for this tranche:

- Printify personal access token with at least:
  - `shops.read`
  - `products.read`
- These scopes cover the two API surfaces we currently use:
  - `GET /v1/shops.json` for validation and shop discovery
  - `GET /v1/shops/{shop_id}/products.json` for sync, SKU matching, and cached POD cost import
- Printify personal access tokens currently expire after 1 year, so reconnect/rotation guidance should be part of merchant support docs

Planned behavior:

- merchant submits Printify API key
- app validates the key against Printify before persisting connected state
- connection record stores validated metadata needed for later syncs
- invalid credentials return a user-facing validation error instead of a silent configuration shell

Acceptance notes:

- a connected provider should mean "provider API can be reached with these credentials", not merely "an encrypted string was stored"
- audit logs should record validation/configuration events without storing sensitive values

### 3. Provider Sync and Catalog Import

Introduce the first real Printify sync path.

Planned behavior:

- manual sync entrypoint from Provider Connections
- background job to fetch provider catalog data needed for mapping and cost cache population
- sync run record written before and after execution
- partial failures captured as sync-state data, not only thrown exceptions

Initial sync targets:

- provider product/shop context needed to identify mappings
- provider variant identifiers/SKUs needed for matching
- provider cost lines required for base POD cost calculation
- shipping/fee dimensions only if the provider API can support them within this tranche

### 4. Variant Mapping Workflow

Create a usable first mapping flow, even if it remains intentionally narrow.

Planned behavior:

- attempt auto-match by SKU where safe
- store the match method and last successful sync timestamp
- surface unmapped variants for merchant review
- support manual mapping updates for unresolved variants

Guardrails:

- do not silently auto-match weak candidates
- prefer leaving a variant unmapped over storing a low-confidence mapping
- every mapped variant should be traceable to the provider-side identifier used for cost resolution

### 5. Cached POD Cost Resolution

Make preview-mode POD costs real.

Planned behavior:

- provider sync populates `ProviderCostCache`
- preview-mode `CostEngine` reads cached POD cost for mapped variants
- if no mapping or no cached cost exists, the system falls back explicitly and records the condition

Rules to preserve:

- mistake buffer still excludes POD
- preview output remains display-safe
- unmapped variants can still rely on manual cost configuration where applicable

### 6. Snapshot-Time Live POD Fetch

Make snapshot mode financially defensible.

Planned behavior:

- snapshot pipeline fetches live POD data before opening the database transaction
- if live fetch succeeds, snapshot persists real POD lines and total POD cost
- if live fetch fails but cache exists, snapshot proceeds with cached POD cost and warning flags
- if live fetch fails and cache does not exist, snapshot proceeds with explicit missing-cost flags per ADR-003 policy

Critical invariant:

- no external provider HTTP calls while a database transaction is open

### 7. Admin Surface Updates

Provider Connections should become operationally honest and minimally usable.

Planned additions:

- validated connection state
- sync action/status
- last sync outcome and timestamp
- mapped vs unmapped counts grounded in real mapping state
- merchant-facing messaging when estimates are using fallback or missing provider cost inputs

Keep the UI narrow:

- this issue should not attempt to perfect the entire provider management UX
- it only needs to be good enough for merchants to connect, sync, map, and understand current state

## Proposed Implementation Phases

### Phase A - Contract and Schema

- finalize provider adapter shape for Printify
- add sync-run and mapping-state schema support
- document fallback semantics at the service boundary
- update tests and fixtures that assume POD remains zero

### Phase B - Connection and Sync Foundation

- validate Printify credentials before save
- persist validated connection metadata
- add manual sync action and background job
- write sync-run records and basic operational errors

### Phase C - Mapping and Cache Population

- implement auto-match by SKU
- expose unmapped variants for review
- support manual mapping updates
- populate `ProviderCostCache` from successful syncs

### Phase D - Cost Engine and Snapshot Integration

- replace `podCost = 0` stub in `CostEngine`
- wire preview mode to cached provider data
- wire snapshot mode to live fetch with cache fallback
- write `OrderSnapshotPODLine` records for real provider costs

### Phase E - Admin Verification and Docs

- tighten Provider Connections page copy and states
- update implementation-status docs
- record reviewer-path guidance if POD review remains in scope

## Test Plan

### Unit Tests

- provider credential validation success/failure
- sync-run lifecycle transitions
- SKU auto-match behavior and low-confidence rejection behavior
- cached POD cost resolution in preview mode
- live-fetch success path for snapshot mode
- live-fetch fallback-to-cache path
- live-fetch with no cache path that sets missing-cost flags
- coexistence of POD cost with manual labor/material/equipment costs
- disconnect behavior and its impact on mappings/cache

### Integration Tests

- Provider Connections action flow from valid/invalid Printify credential submission
- manual sync action queues work and surfaces status
- mapping update path persists the expected provider identifiers
- order snapshot creation persists real `OrderSnapshotPODLine` rows
- order-history surfaces reflect POD lines and flags correctly

### UI / End-to-End Tests

- merchant can connect Printify and see a validated state
- merchant can trigger sync and see the resulting status
- merchant can review mapped/unmapped counts
- storefront/product/cart preview values change when real POD costs are introduced
- degraded-state messaging appears when POD cost is estimated or missing

## Dependencies and Cross-Issue Hand-offs

This issue unblocks or materially changes:

- `#88` because storefront batching and proxy hardening should target the real POD-backed payload shape
- `#90` because disclosure/copy/a11y cleanup should explain actual provider-backed values, not placeholder math
- `#89` because Provider Connections and implementation-status docs must stop describing POD as only a shell
- `#61`, `#62`, `#63`, and `#87` because reviewer guidance changes if POD becomes a real supported slice

## Breaking Changes and Future-Work Impacts

These are the assumptions that will stop being true once `#85` lands.

### 1. POD cost is no longer implicitly zero

Current assumption:

- a large part of the codebase safely treats POD as a placeholder zero-cost component

After `#85`:

- preview totals, retained-by-shop amounts, donation estimates, and reporting previews will change for mapped POD variants
- fixtures and tests that currently expect zero POD cost will need to be rewritten

Future work impact:

- any issue touching storefront reconciliation, reporting previews, post-purchase summaries, or seed data must assume POD can materially affect totals

### 2. Provider Connections becomes a stateful operational surface

Current assumption:

- Provider Connections is mostly a configuration shell

After `#85`:

- provider state includes validation result, sync history, mapping state, and fallback health
- the route and any future API contracts will need to preserve those richer states

Future work impact:

- docs, setup wizard steps, reviewer guidance, and admin UX work should stop describing Provider Connections as placeholder/foundation-only

### 3. Snapshot persistence expectations change

Current assumption:

- `OrderSnapshotPODLine` rows are effectively absent because POD is stubbed

After `#85`:

- snapshots for mapped POD variants should contain real provider-backed POD line items
- `pod_cost_estimated` and `pod_cost_missing` become materially meaningful, not dormant flags

Future work impact:

- order-history, reporting exports, analytical recalculation, and future production-usage reporting must handle real POD rows and flags consistently

### 4. Sync and retry semantics will matter beyond provider pages

Current assumption:

- provider failures are mostly non-events because no real provider sync path exists

After `#85`:

- sync retries, stale cache behavior, and provider outage handling become product behavior

Future work impact:

- `#84`, `#86`, `#88`, and future observability/reporting work should consume provider sync state rather than invent parallel status concepts

### 5. Storefront and post-purchase values become more volatile

Current assumption:

- POD-backed previews are effectively stable because the value is zero

After `#85`:

- preview values can change as provider cache refreshes
- snapshot-time live fetch can diverge from preview-mode cache

Future work impact:

- storefront and post-purchase messaging should explain that values are estimates until snapshot creation
- `#88` should treat batched data loading and cache-aware rate limiting as higher priority once POD is live

### 6. Seed/demo data and review guidance must be revisited

Current assumption:

- POD can be treated as excluded, manual, or not reviewable

After `#85`:

- demo-store prep, listing copy, QA workbook steps, and reviewer instructions need an explicit answer on whether POD review is in scope

Future work impact:

- `#61`, `#62`, `#63`, `#87`, and `#89` should be updated after the implementation direction is confirmed

## Open Decisions to Resolve Early

These should be answered before schema and service work goes too far:

1. Should disconnecting Printify delete mappings and cache rows immediately, or preserve them as inactive history?
2. What minimum provider metadata do we need to support manual mapping cleanly?
3. Should unmapped variants always fall back to manual costs silently, or surface a stronger merchant warning when a provider is configured but a variant is unresolved?
4. Do we need provider-sync scheduling in this issue, or is manual sync plus reusable job infrastructure enough for the first tranche?
5. Should reviewer/demo guidance treat POD as in-scope immediately after this issue, or only after `#88` and `#90` land?

## Recommended Decisions

These are the implementation defaults I recommend unless we deliberately choose otherwise.

### 1. Disconnect should deactivate the provider relationship, clear active use, and preserve audit history

Recommendation:

- disconnect should make the provider unusable immediately
- active mappings should no longer participate in preview or snapshot POD resolution
- cached provider costs should no longer be considered active inputs once the provider is disconnected
- historical sync runs, audit logs, and past snapshots should remain intact

Suggested implementation shape:

- mark connection status as disconnected or remove the live connection record
- soft-deactivate mappings or delete active linkage while preserving historical sync/audit records
- either delete cache rows or mark them inactive/stale so they cannot be read accidentally by `CostEngine`

Why:

- this keeps current behavior safe and unsurprising for merchants
- it preserves operational history without allowing stale cache data to continue influencing new orders
- it avoids rewriting historical snapshot truth, which should remain immutable

### 2. Manual mapping needs more than just a provider variant id

Recommendation:

The minimum metadata we should store or cache for clean manual mapping is:

- provider product id
- provider product title
- provider variant id
- provider variant title
- provider SKU
- provider shop/account identifier if Printify supports multiple shops per credential
- last synced timestamp
- match method (`sku`, `manual`, maybe `imported`)

Why:

- a raw provider variant id is not merchant-friendly enough for a manual mapping UI
- support/debugging will be much easier if we can see which provider shop and product produced the mapping
- this is still a modest footprint and does not require us to over-model the entire provider catalog

### 3. Unmapped variants should fall back to manual costs, but not silently

Recommendation:

- unresolved provider variants should continue using manual costs if manual configuration exists
- they should not silently pretend POD is covered
- the merchant should see clear informational messaging in Provider Connections and any relevant admin preview surface that the variant is unresolved and provider-backed POD costs are not active

Why:

- this preserves business continuity instead of breaking estimates for partially configured catalogs
- it stays aligned with the transparency principle by making fallback visible
- it avoids forcing all-or-nothing provider adoption before the first tranche is useful
- it reflects the reality that SKU mismatches are often deliberate rather than exceptional failures

Suggested wording model:

- “Using manual cost configuration; provider mapping not yet resolved”
- “Provider connected, but this variant is not currently receiving provider-backed POD costs”

### 4. Manual sync plus reusable job infrastructure is enough for the first tranche

Recommendation:

- `#85` should include manual sync plus the underlying queued job infrastructure
- scheduled recurring sync should be treated as a follow-on enhancement unless it falls out naturally once the job primitives exist

Why:

- manual sync is enough to validate the end-to-end provider story
- it reduces moving parts while we are still learning the provider API and mapping model
- it keeps the first tranche focused on correctness instead of completeness theater

Important caveat:

- the schema and job design should still anticipate scheduled sync later
- we should not hard-code assumptions that make automation difficult in the next pass

### 6. Provider-side shipping remains deferred for the first tranche

Recommendation:

- `#85` should stay limited to provider-backed base fulfillment cost for the current rollout
- provider-side shipping estimates should not be imported into the active POD cost model yet

Why:

- provider shipping behaves more like shipment/order economics than a simple variant-level production cost
- importing it now creates meaningful double-counting risk against current packaging/shipping assumptions
- mixed carts, free-shipping strategies, and provider-side shipping taxes make the modeling ambiguous enough that it deserves its own follow-on pass

Follow-up implication:

- future provider shipping work should likely be modeled as a separate shipment-aware cost decision rather than quietly folded into the current provider base-cost cache

### 5. POD should become reviewer-facing only after `#88` and `#90`

Recommendation:

- treat POD as implementation-in-progress after `#85`
- do not immediately make POD a primary reviewer/demo path until storefront hardening and accessibility/comprehension follow-up land

Why:

- `#85` makes the financial path real, which is necessary
- `#88` makes the storefront delivery path more dependable
- `#90` makes the explanation layer more usable and accessible

That means:

- after `#85`, we can say POD support exists in a meaningful technical sense
- after `#88` and `#90`, we can say it is ready to be shown confidently as part of a polished reviewer path

## Working Defaults for Implementation

Unless we explicitly override them, this plan assumes:

- disconnect disables future provider-backed cost resolution immediately
- provider history is preserved, but active linkage is removed or deactivated
- manual mapping stores enough product/variant metadata to be merchant-usable
- unresolved variants fall back to manual costs with explicit merchant warnings
- `#85` ships manual sync and reusable job infrastructure, not necessarily scheduled sync
- provider-side shipping remains deferred until a clearer shipment-level model is chosen
- POD stays out of the primary reviewer path until the storefront hardening follow-ons land

## Exit Criteria

`#85` is complete when all of the following are true:

- Printify credentials are validated before a connection is considered usable.
- A real sync path populates provider-backed mapping/cost data.
- Mapped variants resolve non-zero POD costs where provider data exists.
- Preview and snapshot flows consume POD data through the intended ADR-003 split.
- Snapshot rows and downstream surfaces reflect real POD line items and flags.
- Provider Connections shows enough state for a merchant to understand whether POD data is connected, synced, mapped, and trustworthy.
