# UI Testing Implementation Plan

## Purpose

Add a browser-level UI testing layer that catches interaction and visual regressions before they reach review or merge.

This should complement the current Vitest suite, not replace it. Vitest remains the right tool for financial logic, normalization, validation, and regression tests around pure or service-level behavior.

## Why This Matters

Recent migration work exposed problems that static validation did not catch:

- broken modal open/close behavior
- regressions in dropdown visibility and positioning
- layout spacing drift after component migration
- filter/navigation behavior that only failed in the browser

These are exactly the kinds of issues a UI test layer should catch earlier.

## Recommended Stack

- **Playwright** for browser automation and screenshots
- Existing **Vitest** suite for unit and service/regression logic tests

## Goals

- Add deterministic browser tests for the highest-value user flows.
- Add a small visual regression layer using screenshots.
- Make it possible to compare stable UI states before and after a change.
- Build a fixture strategy that avoids depending on live Shopify login for every test.

## Non-Goals

- Full end-to-end Shopify OAuth automation in the first pass
- Screenshot coverage for every route or component state
- Replacing existing regression tests for server logic

## Constraints In This Repo

- Most admin routes are gated behind `authenticate.admin(request)`.
- Embedded app flows are harder to automate than public routes.
- Some important UI states are easiest to test through deterministic fixtures instead of live app data.

## Delivery Plan

### Phase 1: Playwright Foundation

- Add Playwright dependency and config
- Add scripts:
  - `test:ui`
  - `test:ui:headed`
  - `test:ui:update`
- Set stable defaults:
  - fixed viewport
  - reduced motion
  - screenshot path conventions

### Phase 2: Public Smoke Test

- Add a public UI smoke test for the login route
- Verify:
  - page renders
  - core input/button surfaces exist
  - no obvious shell/render failure

### Phase 3: Fixture-Driven UI States

- Add test-only or test-friendly fixture routes under a dedicated namespace such as `/__ui/*`
- Back them with stable mock data
- Use them to snapshot high-risk states like:
  - template editor with add/edit dialogs
  - variant editor with save bar and overrides
  - autocomplete search open/closed states
  - variants index selection and bulk assignment states

### Phase 4: Visual Regression Coverage

- Add screenshot assertions for a small set of high-value screens
- Keep the initial baseline intentionally narrow:
  - login
  - materials fixture
  - template editor fixture
  - variant editor fixture
  - variants bulk-assignment fixture

### Phase 5: Authenticated Admin Coverage

- Decide on the long-term strategy for `/app/*` route automation:
  - stored Playwright auth state against a seeded dev shop
  - local test bypass for specific environments
  - session bootstrap helper
- Once stable, add workflow tests for real admin pages

## Initial Test Priorities

1. Login page renders correctly
2. Autocomplete remains closed until focus/click
3. Autocomplete opens on focus and closes on selection
4. Save/discard surfaces appear when a staged editor becomes dirty
5. Variant bulk selection and bulk-assignment panel render correctly

## Fixture Guidance

Fixture routes should:

- be deterministic
- avoid database dependencies when possible
- avoid Shopify auth when possible
- be clearly separated from production routes

If we do not want them available outside test workflows, gate them behind an environment check.

## Snapshot Guidance

- Prefer a few durable snapshots over many fragile ones
- Snapshot full dialogs or page sections, not every micro-state
- Keep data, viewport, and motion stable
- Treat snapshots as regression alarms, not design signoff

## Documentation Follow-Up

After the first implementation pass lands, update:

- `docs/standards/testing.md`
- `docs/project-instructions.md`
- `CLAUDE.md`

Add explicit rules for:

- when a UI test should be added
- when a screenshot baseline should be added
- when to choose Playwright vs Vitest

## Recommendation

Start with Playwright foundation plus one smoke test and one or two deterministic fixture-based screenshot tests. That gives fast value without blocking on full embedded-auth automation.
