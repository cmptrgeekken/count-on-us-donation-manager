# ADR-025: Template assignment product yield

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | July 2026 |
| **Depends on** | ADR-001, ADR-003, ADR-008, ADR-020, ADR-022 |

## Context

Production templates currently bundle reusable material, equipment, and labor defaults. They support line-level yield fields, and variants can override those template line fields. This works for exact copies of a template, but it creates unnecessary template duplication when one production process has the same inputs but different finished-product yield by variant.

Sticker production is the motivating example. A reusable sticker template might require:

- one vinyl sticker sheet
- two transparent laminate sheets
- one printer run
- one cutter run

The only variant-specific difference may be how many finished stickers fit in that production layout. A small sticker might yield ten products, while a larger sticker yields six. Creating separate templates such as `Stickers (6x)`, `Stickers (8x)`, and `Stickers (10x)` duplicates the same production structure and makes future library/template maintenance harder.

The yield must act as a denominator over each line's own batch input. If a six-sticker layout uses one sticker sheet and two laminate sheets, the per-product usage is one sixth of a sticker sheet and one third of a laminate sheet. The assignment yield should not replace the template line quantity.

## Decision

`VariantCostConfig` stores an optional production template product yield. This assignment-level yield represents the number of finished sellable products produced by the assigned production template's batch/layout for that specific variant.

Cost resolution applies the assignment yield only to yield-aware production template lines when no explicit variant line override exists:

- material template lines whose library item uses `costingModel = "yield"` use the assignment yield as the effective material yield
- equipment template lines whose usage mode is `duration_yield` or `use_yield` use the assignment yield as the effective `yieldQuantity`
- template line `quantity`, `yieldDurationMinutes`, and `yieldUses` remain line-specific batch inputs and are not overwritten

Precedence is:

1. Explicit per-template-line variant override.
2. Assignment-level template product yield for eligible production template lines.
3. Template line default.
4. Existing cost-engine fallback behavior for missing or zero values.

Shipping templates, counted materials, portioned-use materials, direct equipment usage, labor, mistake buffer, POD costs, and variant-specific additional lines are not affected by the assignment yield.

## Consequences

### Benefits

- One reusable production template can support multiple product layouts with different yields.
- Template line quantities continue to express batch inputs, so mixed inputs such as one sticker sheet and two laminate sheets resolve correctly.
- Explicit line overrides remain available for exceptions.
- Existing immutable snapshots continue to store fully materialized line costs and effective yield values at order time.

### Costs

- Cost resolution needs one more precedence rule when merging template and variant lines.
- Variant and bulk assignment screens need a product-yield input and validation.
- Merchants must understand that assignment yield applies only to yield-aware template lines.

### Rejected alternatives

**Separate templates per yield** - Rejected because it duplicates otherwise-identical production structures and makes updates error-prone.

**Template-level product yield** - Rejected because the yield is often variant/layout-specific, not an inherent property of the reusable template.

**Materializing generated line overrides on assignment** - Rejected as the primary model because it obscures the single source of truth and makes later template-yield changes harder to distinguish from intentional per-line overrides. Explicit overrides remain materialized only when the merchant edits a line.

## Links

- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-008](adr-008-financial-precision-policy.md)
- [ADR-020](adr-020-contextual-creation-and-template-promotion.md)
- [ADR-022](adr-022-equipment-component-costing.md)
