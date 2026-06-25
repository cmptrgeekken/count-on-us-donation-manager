# ADR-020: Contextual creation and template promotion

- Status: Proposed
- Date: June 2026
- Depends on: ADR-003, ADR-008, ADR-013, ADR-015, ADR-018

## Context

Count On Us has several admin workflows where a merchant is configuring one thing but must choose another existing record:

- template material lines choose `MaterialLibraryItem`
- template equipment lines choose `EquipmentLibraryItem`
- variant additional material and equipment lines choose library items
- shipping package material lines choose shipping materials
- product Cause assignments choose active Causes
- product Artist collaboration assignments choose active Artists
- Artist profile Cause routing chooses active Causes

Today, if the needed record does not exist, the merchant must leave the current workflow, navigate to the relevant library page, create the missing record, then return and recreate their local editing context.

This is especially painful in cost setup because materials, equipment, templates, and variants are usually discovered together. A merchant may be configuring a variant and realize a material, equipment item, or reusable template does not yet exist.

The app also has an emerging inverse workflow: a merchant may configure a variant first, then realize that the effective setup should become a reusable cost template for future variants. The current template workflow is library-first, so creating a template from an already configured variant requires manually re-entering the same material, equipment, and labor structure.

## Decision

Count On Us will support contextual creation for selected related records and a variant-to-template promotion workflow.

These features are intended to reduce context switching while preserving the existing source-of-truth library records and audit model.

### Inline creation pattern

When a picker is empty, search has no matching result, or the user recognizes the needed record is missing, the UI may offer a contextual "Create" action.

Inline creation must create the real canonical record, not a local embedded copy.

After successful creation, the current workflow should:

- add the new record to the local option list
- select it automatically when that is the natural next step
- keep the surrounding draft state intact
- display success or validation errors in the contextual dialog
- avoid navigating away from the current route

Inline creation must use the same validation, shop isolation, financial parsing, and audit logging rules as the standalone library page.

For financial values, server-side parsing remains authoritative. Client-side formatting may normalize display values, but it must not replace server validation.

Inline creation must also check for likely duplicates before creating a new record.

For first-wave cost records, duplicate detection should compare normalized name, shop, type/category where applicable, and active/inactive status. The first implementation may block exact normalized duplicates or present an explicit "use existing" choice. It should not silently create a second active material, equipment item, Cause, or Artist with the same merchant-visible identity.

The contextual create response should include enough data for deterministic UI behavior. For first-wave targets, successful creation must:

- select the new material in the template material-line dialog
- select the new equipment item in the template equipment-line dialog
- select the new material in the variant additional material-line dialog
- select the new equipment item in the variant additional equipment-line dialog
- select the new shipping material in the package material-line form

### First-wave inline creation targets

The first implementation wave should focus on cost setup records:

- `MaterialLibraryItem` from template material-line picker
- `EquipmentLibraryItem` from template equipment-line picker
- `MaterialLibraryItem` from variant additional material-line picker
- `EquipmentLibraryItem` from variant additional equipment-line picker
- shipping `MaterialLibraryItem` from package material-line picker

These workflows are tightly coupled to cost configuration and are relatively safe because the created records are ordinary library records with no downstream public disclosure or payout routing until explicitly used.

Contextual defaults should be derived from the current workflow:

- production templates default new materials to `type = "production"`
- shipping templates and package material lines default new materials to `type = "shipping"`
- variant production material flows default to production materials
- variant shipping/package flows default to shipping materials
- equipment creation defaults to active status and requires at least one usable rate, matching the equipment library behavior

The user should still be able to adjust relevant defaults before saving.

First-wave inline-created materials and equipment should be active immediately. They are created specifically so the merchant can use them in the current configuration workflow.

### Second-wave inline creation targets

Cause and Artist assignment workflows can also benefit from contextual creation, but they should be implemented after the cost-library pattern is stable.

Candidate workflows:

- product Cause assignment can create a Cause inline
- product Artist collaboration assignment can create an Artist inline
- Artist profile Cause routing can create a Cause inline

These records have broader implications:

- Cause assignments affect storefront donation routing and public transparency summaries
- Artist assignments can derive Cause rollups and may create artist payable obligations
- Artist records include payout settings, credit display, cause routing, and optional submission/conversion lifecycle data

For that reason, second-wave inline creation should use a limited quick-create shape and clearly identify required follow-up configuration.

Example quick-create boundaries:

- Cause quick-create: name, donation link, optional 501(c)(3) flag, status
- Artist quick-create: display/credit name, status, payout defaults, optional minimal Cause routing

Cause and Artist quick-create should create draft/incomplete records unless all information required for safe active use is provided.

For Causes, active use generally requires enough information to support merchant review and storefront/public routing, including at minimum a merchant-visible name and any required donation destination fields for the current app configuration. If those required fields are incomplete, the Cause should be draft/inactive and must not be selectable for live product routing until completed.

For Artists, active use generally requires enough information to support product attribution, Cause routing, and payout behavior. If the quick-create flow does not capture required Cause routing or payout defaults, the Artist should be draft/inactive and must not create live Artist collaboration assignments until completed.

If a required downstream configuration cannot be completed safely inline, the UI should create the record as draft/incomplete where the domain model supports it, or route the user to the full edit screen after preserving the original assignment context.

### Not every selector should get inline creation

Inline creation should not be added automatically to every selector.

It is most appropriate when:

- the missing record is a reusable merchant-owned library/configuration record
- the create form is short enough to complete without obscuring the parent workflow
- creating the record does not trigger irreversible external effects
- the new record can be safely selected immediately after creation

It is less appropriate when:

- the selected record is imported from Shopify or another external provider
- creation requires OAuth, external validation, file upload, or long-form review
- the new record would immediately affect historical reports or payment evidence
- incomplete records would create ambiguous storefront or payout behavior

### Shared implementation approach

Inline creation should be backed by shared server helpers or service functions rather than duplicated route-local logic.

Recommended service boundaries:

- material library create/update validation and persistence
- equipment library create/update validation and persistence
- Cause quick-create validation and persistence
- Artist quick-create validation and persistence

Route actions may expose context-specific intents, but the canonical business rules should live in reusable server-only modules.

Each contextual create action must:

- authenticate the admin request
- use the authenticated `shopId`
- validate input with Zod or existing parsing helpers before writes
- write an audit log entry in the same transaction as the mutation
- return a compact serialized record that the client can insert into its option list

### Template from variant

Count On Us will support creating a production cost template from a configured variant.

This workflow promotes the variant's effective cost setup into a reusable template.

The initial implementation should be available from the variant detail page and should create a `CostTemplate` with:

- name
- description
- production material lines from the variant's effective production material configuration
- equipment lines from the variant's effective equipment configuration
- default labor minutes and default labor rate from the variant's effective labor configuration
- optional default shipping template selection when one is already effectively selected

The first version should create a production template only.

Shipping template extraction may be added later as a separate option because shipping materials, packages, dimensions, and default shipping-template relationships have different semantics.

The initial dialog should offer:

- template name
- optional description
- include production materials
- include equipment
- include labor defaults
- assign the new template back to this variant

When "assign back to this variant" is selected, the app should avoid changing the variant's effective cost unexpectedly.

The safest first behavior is:

- create the template from the current effective values
- assign the template to the variant
- remove exact duplicate variant-only production material/equipment lines that were promoted into the template
- remove stale template-linked material/equipment override rows from the previous template when their effective values are now represented by the newly promoted template
- keep variant lines that differ from the promoted template values
- preserve explicit variant labor overrides unless the promoted template exactly matches them and the UI explains the cleanup
- preserve unrelated shipping configuration and package configuration

The workflow should report any retained same-item mismatches for manual review, mirroring the bulk template assignment cleanup behavior.

Stale template-linked override rows require special handling. When the source variant used an existing template with template-line overrides, the promotion flow should materialize the effective values into the new template and then remove or remap the old override rows so they do not continue referencing obsolete template line ids. It must not leave hidden override rows that are ignored by cost resolution but still appear as variant-specific configuration debt.

### Effective values vs raw values

Template promotion should use effective values, not only raw variant-only additions.

For example, if a variant currently uses a template line with a variant override, the new template should capture the value the merchant sees as effective for that variant.

This makes the workflow match the merchant's mental model: "turn this variant's current setup into a reusable template."

The implementation must avoid copying shipping material lines into a production template unless the user explicitly chooses a future shipping-template extraction flow.

Labor promotion must distinguish between explicit variant labor and inherited labor.

The first version should copy labor values into the new template only when:

- the user chooses "include labor defaults"; and
- the effective labor value comes from the variant itself or an existing template default; or
- the user explicitly chooses to freeze the current shop default into the new template.

If the variant's effective labor rate only comes from the shop default and the user has not chosen to freeze it, the promoted template should leave `defaultLaborRate` blank so future changes to the shop default continue to flow through. The same principle applies to any future shop-level labor defaults beyond rate.

The UI should make this distinction visible, for example:

- "Use inherited shop default rate"
- "Copy current shop default rate into template"
- "Copy variant/template labor values"

## Consequences

### Benefits

- reduces navigation churn during cost setup
- keeps merchants in the workflow where they discovered missing records
- encourages reusable library records instead of ad hoc local copies
- makes template creation easier after real variants are configured
- aligns template promotion with effective cost resolution
- creates a reusable pattern for future Cause and Artist quick-create workflows

### Costs

- route actions and client state become more complex
- shared service helpers are needed to avoid duplicated validation and audit behavior
- inline create dialogs can become too large if they try to mirror full library screens
- quick-created Causes or Artists may require follow-up configuration before they are truly ready
- template promotion must be carefully tested to avoid changing effective variant costs
- duplicate detection can require additional UX for choosing an existing record instead of creating a new one

## Alternatives considered

**Keep all creation on standalone library pages** - Rejected. It keeps source-of-truth boundaries simple but creates unnecessary workflow interruption and repeated draft reconstruction.

**Create local embedded material/equipment records inside variants or templates** - Rejected. It would fragment cost data and undermine reusable library records.

**Add inline creation everywhere immediately** - Rejected. Cause and Artist records have broader storefront and payout implications, so they should follow after the cost-library pattern is proven.

**Create templates only from raw variant-only lines** - Rejected. Merchants expect "create template from variant" to capture the effective configuration they see, including inherited template values and overrides.

**Always assign the new template back to the source variant** - Rejected. Assignment should be explicit because some merchants may want to use the source variant only as a starting point.

## Follow-up implications

- Extract material and equipment create logic from route files into reusable server services.
- Add inline material/equipment creation to template detail dialogs.
- Add inline material/equipment creation to variant detail dialogs.
- Add inline shipping material creation to package material-line editing.
- Add a production-template-from-variant action and dialog on the variant detail page.
- Consider Cause quick-create on product assignment and Artist profile routing after the cost-library pattern is stable.
- Consider Artist quick-create on product Artist collaboration assignment after quick-create boundaries are defined.
- Add regression coverage for contextual create validation, audit logging, automatic selection, and template promotion cost equivalence.
- Add duplicate-detection coverage for normalized name collisions in inline material/equipment create flows.
- Add promotion equivalence coverage proving estimated cost before promotion equals estimated cost after promotion and assignment-back, including inherited template lines, template-linked overrides, variant-only lines, retained mismatches, and labor inheritance.
- Add coverage proving old template-linked override rows are removed or remapped during assignment-back and do not remain as hidden stale configuration.

## Links

- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-008](adr-008-financial-precision-policy.md)
- [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md)
- [ADR-015](adr-015-dedicated-admin-web-experience.md)
- [ADR-018](adr-018-production-cost-model-expansion.md)
