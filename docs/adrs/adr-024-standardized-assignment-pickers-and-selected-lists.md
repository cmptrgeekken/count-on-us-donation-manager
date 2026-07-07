# ADR-024: Standardized assignment pickers and selected lists

- Status: Proposed
- Date: July 2026
- Depends on: ADR-013, ADR-015, ADR-020

## Context

Count On Us has many admin workflows where a merchant chooses one record and assigns it to another:

- cost templates choose materials and equipment
- variants choose templates, materials, equipment, shipping templates, and copy sources
- products choose Causes and Artists
- Artists choose preferred Causes and product mappings
- bulk product and variant pages choose assignment targets
- imported orders may be associated with Artists after import

These selectors evolved independently. Some use plain `<select>` controls, some use custom autocomplete dropdowns, and some show every possible target as a permanent field list.

The result is difficult to use at production scale:

- dropdowns can be clipped by surrounding layout
- merchants must already know the exact item name to search effectively
- repeated assignment requires opening a dialog, searching, selecting, confirming, and starting over
- selected-item lists consume a large amount of screen space
- edit fields are always visible even when the merchant only needs to scan assignments
- validation rules are not represented consistently in the UI
- Artist Cause preferences incorrectly implied that every active Artist must allocate 100%

ADR-020 covers contextual creation of missing related records. This ADR covers the selection and selected-list experience regardless of whether inline creation is available.

## Decision

Count On Us will use shared assignment controls for relationship editing.

The standard pattern has two parts:

1. A searchable assignment picker for adding related records.
2. A compact expandable selected-list display for reviewing and editing existing assignments.

### Assignment picker

Assignment pickers should be dialog or drawer based, not layout-constrained dropdowns.

The picker must support:

- search across name, handle, status, and relevant metadata
- multi-select when a workflow naturally assigns several items
- single-select when the domain allows only one target
- a selected count before confirmation
- "Add selected" and, for multi-select workflows, "Add and keep open"
- disabled options or explanatory metadata when useful
- contextual create actions where ADR-020 allows them

The picker should return selected ids to the parent workflow. The parent remains responsible for defaults, validation, save behavior, and audit logging.

### Selected-list display

Selected assignments should render as compact rows by default.

Each selected row should show:

- primary identity
- useful secondary identity such as handle, status, credit name, or source
- the most important numeric or status summary
- remove or clear action when allowed
- an expandable details area for editable fields

Long selected lists should support filtering selected rows and expanding or collapsing all rows.

Rows with missing required values, validation conflicts, or newly added incomplete configuration should open by default.

The selected-list pattern is preferred over always-visible full edit cards for repeated assignments.

### Validation vocabulary

Each assignment workflow must declare its sum and cardinality rule explicitly:

- exact 100%: artist collaboration shares on a product
- 100% or less: direct product Cause allocations
- optional 0-100%: Artist-selected Cause preferences
- one selected target: single assignment fields such as templates
- many selected targets: materials, equipment, product mappings, and comparable join records

Artist-selected Cause preferences are optional. An Artist may have no preferred Cause routing or may allocate less than 100%.

When Artist product routing derives product Cause rollups, only the explicitly assigned Artist Cause percentage is converted into Cause routing. Any unallocated Artist preference remains unallocated rather than blocking the product assignment.

### Rollout order

The first implementation wave should prioritize the most painful and highest-volume relationship editors:

- Artist profile Cause preferences
- Artist product mappings
- product Artist collaboration assignments
- product direct Cause assignments

The second implementation wave should migrate cost setup selectors:

- template material and equipment assignment
- variant additional material and equipment assignment
- shipping package material assignment
- variant template and copy-source selection

The third implementation wave should migrate bulk and review surfaces:

- product bulk Cause and Artist assignment
- variant bulk template assignment
- order-level Artist association after import

Inline creation should follow ADR-020 and can be added to these picker surfaces once the shared picker flow is stable.

## Consequences

### Benefits

- avoids clipped dropdowns in dense admin layouts
- makes assignment flows consistent across products, Artists, variants, templates, and orders
- reduces repeated add friction with multi-select picker flows
- makes long selected lists scannable
- keeps edit fields available without forcing every field on screen
- aligns Artist Cause preference UI with the intended optional business rule

### Costs

- requires migrating existing route-local picker implementations
- shared components must remain flexible enough for different assignment domains
- some workflows need careful defaulting when multiple records are added at once
- Playwright coverage should be added for picker behavior on the highest-risk UI flows

## Alternatives considered

**Keep native selects everywhere** - Rejected. Native selects are simple, but they do not scale to large product, material, equipment, Artist, or Cause libraries and do not support multi-add ergonomics.

**Use route-specific custom autocomplete controls** - Rejected. This is the current pattern and has already produced inconsistent behavior and clipping.

**Show all selectable records as permanent fields** - Rejected. This works only for very small lists and becomes bulky quickly. It also makes optional assignments look mandatory.

**Require exact 100% Artist Cause preferences** - Rejected. An Artist may not have a preferred Cause, and product Artist routing can still be valid when the Artist's donated share has no explicit Cause preference.

## Follow-up implications

- Continue replacing route-local selectors with shared assignment controls.
- Add contextual create affordances to shared picker flows after ADR-020 first-wave create helpers are stable.
- Add UI tests for picker search, multi-select, row expansion, and save payload behavior.
- Update help text and validation copy wherever a workflow uses exact, max, optional, single, or many assignment rules.

## Links

- [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md)
- [ADR-015](adr-015-dedicated-admin-web-experience.md)
- [ADR-020](adr-020-contextual-creation-and-template-promotion.md)
