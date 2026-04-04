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
