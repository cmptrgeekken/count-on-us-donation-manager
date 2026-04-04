# Polaris Web Components Spike Plan

## Purpose

Validate whether Count On Us should begin migrating from Polaris React to Polaris Web Components before Phase 3 expands the admin UI surface area.

## Goal

Establish one working migration pattern in the current Remix app without starting a repo-wide rewrite.

## Spike scope

Start with low-risk routes:

- `app/components/PlaceholderPage.tsx`
- `app/routes/app.dashboard.tsx`
- `app/routes/app.settings.tsx`

Do not start with:

- `app/routes/app.templates.$templateId.tsx`
- `app/routes/app.variants.$variantId.tsx`
- `IndexTable`-heavy list routes

## Questions to answer

1. Do Polaris Web Components render cleanly inside the current `AppProvider` shell?
2. Can we replace `Page`, `TitleBar`, banners, sections, buttons, and basic form fields without introducing awkward wrappers?
3. How much custom typing or local glue is needed in TypeScript?
4. Are there clear blockers for more complex routes such as staged editors, tables, and searchable dialogs?

## Success criteria

- Low-risk routes are working with Polaris Web Components.
- The repo has a documented JSX/typing pattern for web components.
- We know whether to continue incrementally or stop after the spike.
- Follow-up migration work can be split into route groups.

## Route sequencing

1. Placeholder surfaces
2. Dashboard
3. Settings
4. Simple list/index routes
5. Complex modal-driven editors
6. Template and variant staged editors last

## What to watch

- Title and page action behavior in embedded admin
- Form event handling in React
- Accessibility parity
- TypeScript friction
- Whether web components reduce or increase local complexity

## Findings Log

### Shell bootstrap

- Issue: Web Components initially rendered as mostly unstyled HTML.
- Cause: The app shell was not loading the Polaris Web Components runtime.
- Recovery:
  - Added the Polaris runtime script in `app/root.tsx`.
  - Added a `shopify:navigate` bridge in `app/root.tsx` so navigation events route through Remix.
- Takeaway: Route-level conversion is not enough; the root shell must be prepared first.

### TypeScript / JSX interop

- Issue: JSX typing failed for Polaris custom elements.
- Cause: TypeScript did not know about `s-*` and `ui-*` elements used in the app.
- Recovery:
  - Added local intrinsic element typings in `app/globals.d.ts`.
- Takeaway: Incremental migration is feasible, but it requires a local typing layer.

### Web Components modal interop in React

- Issue: `s-modal` triggers opened unreliably after the first close, and primary action rendering was inconsistent in the deactivate flow.
- Cause: The command-based modal flow and React-driven state updates proved brittle in this app stack.
- Recovery:
  - Prototyped `s-modal` and documented the failure mode.
  - Switched the `Materials` prototype to native `dialog` for reliable reopen/close behavior while keeping the page shell and table on Polaris Web Components.
- Takeaway: We should not assume `s-modal` is ready for complex admin editing flows in this Remix app without further focused validation.

### Web Components select interop in React

- Issue: `Type` and `Costing model` stopped responding inside the modal prototype.
- Cause: `s-select` plus React-controlled state inside the modal was not reliable enough for this route.
- Recovery:
  - Replaced those fields with native `<select>` controls inside the prototype dialog.
- Takeaway: Native form controls may be the safer bridge for modal-heavy admin editors until we have a proven Web Components form pattern.

### Table migration boundary

- Issue: Polaris React `IndexTable` patterns do not have a clean drop-in equivalent in the current prototype.
- Cause: `s-table` works well for display tables, but row selection and bulk actions need a redesigned interaction model.
- Recovery:
  - Converted `Materials` to a read/write per-row action table without selection.
  - Reused the same pattern on `Equipment` to confirm it is portable across similar library-management routes.
  - Converted `Cost Templates` to the same per-row-action table/dialog pattern after confirming it did not truly depend on selection behavior.
  - Replaced `Variants` selection-heavy `IndexTable` behavior with an explicit redesign using native filters, checkbox selection, and native dialogs for bulk assignment.
- Takeaway: Migrate simple tables first and verify whether `IndexTable` usage was actually essential before redesigning around it. When selection is real, redesign the interaction directly instead of trying to emulate Polaris React.

### Recommended interim pattern

- Use Polaris Web Components for:
  - page shell
  - title bar integration
  - banners
  - simple tables
  - badges
  - simple text fields and buttons
- Use native browser elements for now when reliability matters more than purity:
  - `dialog` for modal editing flows
  - `select` for dropdowns inside modal forms
  - `textarea` for multiline editing
  - checkbox inputs for row selection when building bulk-action tables
- Capture event values immediately in handlers instead of reading from event objects later.

### Selection, filtering, and bulk assignment pattern

- Filtering:
  - Use native `<select>` controls, but apply them through client-side Remix navigation rather than a raw browser GET.
  - Keep filter state in the URL so routes stay shareable and server-driven.
  - Show active filters back to the merchant as badges.
- Selection:
  - Store selected row IDs in React state.
  - Use native checkboxes per row plus a “select all visible” checkbox in the table header/filter area.
  - Prune the selection whenever loader data changes so filtered-out rows do not remain selected invisibly.
- Bulk assignment:
  - Show a dedicated summary section when one or more rows are selected instead of relying on hidden table bulk-action affordances.
  - Launch a native `dialog` to choose the target template/action.
  - If the action is destructive or overwrites existing configuration, use a second confirmation dialog before submitting.
- Reuse note:
  - This same pattern can be revisited later for `Materials`, `Equipment`, or other large admin lists once those pages need filters, selection, or bulk actions.

### Shopify-style filters gap

- Polaris React provided a rich, first-party `Filters` composite that handled chips, shortcuts, and popover-driven filter UX.
- Polaris Web Components do not currently give us that same higher-level filter abstraction in this app.
- Interim approach:
  - compose filters from native inputs plus URL-backed client navigation
  - represent active filters as badges
  - keep the interaction model simple and explicit until Shopify offers a stronger first-party equivalent or we choose to build our own reusable filter bar
