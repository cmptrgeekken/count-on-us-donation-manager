# Issue 29 Implementation Plan

Use this document as the execution plan for [issue #29](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/29).

It is intentionally narrower than the phase plans: this is a single major feature branch plan for separating Production and Shipping template behavior without blowing up the current Phase 2 and Phase 3 foundations.

## Goal

Introduce a first-class distinction between:

- `production` cost templates
- `shipping` cost templates

while allowing a variant to resolve both independently.

The target behavior is:

- each variant can assign one Production template
- each variant can assign one Shipping template
- a Production template can define a default Shipping template
- the variant inherits that default Shipping template unless it explicitly overrides it

## Why This Matters

Today the app models materials with a `type` of `production` or `shipping`, but templates and variant assignments are still effectively single-track. That means:

- Production and Shipping concerns are mixed together in admin UI
- merchants cannot intentionally pair different production and shipping defaults
- variant assignment UX does not match the actual costing concepts

This feature is the next substantial product capability after Phase 3, and it should be treated as architecture work, not just UI polish.

## Non-Goals

This branch should not:

- split Materials into separate database tables
- redesign every picker/filter pattern in the app
- attempt a full reporting-phase refactor
- revisit all large-list UX issues

Those can follow once the data model and assignment flows are stable.

## Recommended Branch

- `issue-29-production-vs-shipping-templates`

## High-Level Design

### 1. Add template type

Add a template type field to `CostTemplate`:

- `production`
- `shipping`

Expected rule:

- Production templates can optionally reference a default Shipping template
- Shipping templates cannot reference a default Shipping template

### 2. Split variant template assignment semantics

Replace the current “single template assignment” mental model with:

- `productionTemplateId`
- `shippingTemplateId` (explicit override)

Effective Shipping template resolution should be:

1. explicit variant Shipping template, if present
2. Production template's default Shipping template, if present
3. no Shipping template

### 3. Preserve Materials as one table

Keep `MaterialLibraryItem.type` as the differentiator for now:

- `production`
- `shipping`

But reflect that separation consistently in UI:

- Materials list
- Template editor
- Variant editor

## Proposed Implementation Order

### Tranche A: Schema foundation

Add or update:

- `CostTemplate.type`
- `CostTemplate.defaultShippingTemplateId` nullable self-reference
- `VariantCostConfig.productionTemplateId`
- `VariantCostConfig.shippingTemplateId`

Decide whether to:

- migrate existing `templateId` into `productionTemplateId`
- leave `shippingTemplateId` null for migrated records

Exit checks:

- migration applies cleanly
- existing template/variant records preserve behavior
- Prisma client compiles

### Tranche B: Cost resolution update

Update the cost-resolution path so:

- Production materials resolve from the effective Production template stack
- Shipping materials resolve from the effective Shipping template stack
- packaging/shipping cost logic uses the Shipping template path explicitly

Important:

- preserve the existing intended shipping-material costing rule
- keep current variant-level manual lines/overrides working where possible

Exit checks:

- existing cost scenarios still resolve correctly after migration
- a variant with only a Production template still behaves sensibly
- Shipping override precedence is covered by tests

### Tranche C: Template admin updates

Update Templates list/detail pages to:

- create templates as either Production or Shipping
- display template type clearly in list/detail views
- on Production templates, allow selecting an optional default Shipping template
- visually separate Production materials from Shipping materials in the editor

Important guardrail:

- Shipping templates should only contain Shipping materials
- Production templates should only contain Production materials

If mixed-content migration exists, decide whether to:

- auto-migrate
- block invalid additions only going forward
- or require cleanup

Exit checks:

- merchants can create/edit both template types
- Production template can assign a default Shipping template
- invalid cross-type material additions are prevented

### Tranche D: Variant admin updates

Update Variant detail and bulk assignment flows to:

- assign Production template
- optionally assign Shipping template override
- clearly show inherited vs explicit Shipping template state
- separate Production material lines from Shipping material lines in the UI

Important UX rule:

- inherited Shipping template should be visible, not hidden
- merchant should be able to distinguish:
  - inherited
  - explicitly overridden
  - unassigned

Exit checks:

- variant can save Production and Shipping assignment independently
- inherited Shipping template is visible and understandable
- explicit override cleanly replaces inheritance

### Tranche E: Materials page separation

Update Materials UI to present Production vs Shipping more clearly.

Possible lightweight approach:

- grouped sections or tabs
- or a visible type column plus type-specific explanatory copy

Do not over-design this tranche. The main goal is clarity, not a full filtering redesign.

Exit checks:

- merchants can immediately distinguish Production vs Shipping materials
- create/edit flows still work

### Tranche F: Automated coverage

Add or expand:

- Vitest coverage for effective template resolution
- Playwright coverage for:
  - Production template create/edit
  - Shipping template create/edit
  - Production template default Shipping selection
  - variant inherited Shipping behavior
  - variant Shipping override behavior

## Migration Notes

Suggested migration strategy:

- all existing templates become `production`
- existing `VariantCostConfig.templateId` migrates to `productionTemplateId`
- existing `shippingTemplateId` starts null
- existing template material lines remain valid unless future rules reject mixed-type content

This keeps rollout safe and minimizes surprise.

## Open Product Decisions

These should be settled before implementation gets deep:

- Should Shipping templates be allowed to include equipment lines at all?
- Should Production templates be allowed to include Shipping materials during migration only, or never?
- Should bulk assignment in Variants support Production only first, or both Production and Shipping in the same pass?
- How prominent should inherited Shipping template status be in Variant UI?

## Recommended First Milestone

Start with a schema-only or schema-plus-service branch slice:

1. schema migration
2. effective template resolution helper
3. unit tests for inheritance/override behavior

Do not start with the UI first.

This feature has enough moving parts that the resolution rules need to be stable before the editor work begins.
