# Testing Standards

## Test Runner

Use **Vitest** as the test runner. It is compatible with the Vite build setup and supports TypeScript natively without additional configuration.

Use **Playwright** for browser-level UI and visual regression coverage. Playwright complements Vitest; it does not replace unit, regression, or service-level tests.

Install:
```sh
npm install --save-dev vitest @vitest/coverage-v8
```

Add to `package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

Add a minimal `vitest.config.ts` at the repo root:
```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
  },
});
```

---

## What to Test

### Always test: pure functions with financial logic

The cost engine and any financial helpers are the highest-value test targets. They are pure functions — they take inputs and return outputs with no side effects. A bug here corrupts donation calculations silently.

Mandatory test coverage:
- `resolveCosts()` in `costEngine.server.ts` — all cost model branches (yield, uses, shipping, fallback)
- Mistake buffer calculation (applied to production materials only)
- Packaging cost rule (max of shipping lines, not sum — per ADR-003)
- Labor cost formula (`laborRate * laborMinutes / 60`)
- Template vs. variant override merge logic
- Edge cases: no config (all zeros), zero prices, null optional fields

### Always test: regressions for fixed bugs and corrected behavior

When a bug is found and fixed, add the smallest durable test that would fail if the bug comes back. Treat this as the default, especially when the bug affects financial outcomes, configuration state, or admin workflows.

High-priority regression targets:
- financial calculation bugs in cost resolution, rounding, fallback, or normalization
- template assignment, override, reset, and merge behavior
- data-shaping bugs where the same record can appear in multiple UI sections
- state transitions that can leave stale flags, stale badges, or orphaned rows behind
- validation bugs where malformed or incomplete input was previously accepted
- locale, currency, and formatting logic that can throw at render time or display incorrect money values

Preferred test level:
- unit test for pure calculation and normalization logic
- service test for orchestration and persistence rules
- integration test for database-backed workflows with meaningful state transitions

If you choose not to add a regression test for a bug fix, document why in the PR description or working notes.

### Always test: Zod validation schemas

When you add a Zod schema for action input validation, write a test that verifies:
- Valid input passes
- Each required field, when missing, produces the expected error
- Each field with a constraint (min length, positive number, cuid format) rejects invalid values

### Test when the logic is non-trivial: service functions

Services like `catalogSync.server.ts` or `installService.server.ts` contain conditional logic that is worth unit testing with mocked dependencies when the logic is complex enough that a typo could go unnoticed.

### Do not test: Remix loaders and actions directly

Loaders and actions are integration points — they authenticate, query the DB, and return responses. Testing them in isolation requires mocking too many layers to be meaningful. Test the underlying service functions instead.

If a loader or action bug is fixed, prefer extracting the affected derivation, normalization, or persistence logic into a service/helper that can be tested directly rather than leaving the behavior untested.

### Do not test: Polaris component rendering

Polaris components are well-tested by Shopify. Do not write snapshot tests or shallow render tests for pages that are purely composed of Polaris components.

### Test when browser behavior matters: UI workflows and visual regressions

Use Playwright when the risk is in real browser behavior rather than server logic. High-value targets include:

- modal open/close behavior
- autocomplete and dropdown visibility/positioning
- staged save/discard UI
- filtering and selection behavior
- layout regressions after UI refactors or migrations

For new features and workflow changes, explicitly evaluate whether Playwright coverage should ship in the same branch. The expected default is to consider browser-level coverage when a change affects:

- real user workflows on app routes
- staged editing or save/discard behavior
- modal, dialog, picker, or dropdown interaction
- filtering, selection, or bulk-action flows
- browser-only regressions that unit and service tests would not catch

Prefer a small number of durable screenshot baselines over broad, fragile snapshot coverage. Use deterministic routes or fixture states whenever possible.

---

## Test File Location

Tests live adjacent to the file they test, in the same directory. Name the test file by appending `.test.ts` or `.test.tsx` to the source file name.

```
app/services/costEngine.server.ts
app/services/costEngine.server.test.ts

app/utils/financial.ts
app/utils/financial.test.ts
```

---

## Test Structure

Use `describe` blocks to group related scenarios. Name tests in the form `"<function/behavior> <condition> <expected outcome>"`.

```typescript
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { resolveCosts } from "./costEngine.server";

describe("resolveCosts", () => {
  describe("when no cost config exists", () => {
    it("returns all zeros", async () => {
      // ...
    });
  });

  describe("material cost — yield model", () => {
    it("divides purchase price by yield and multiplies by quantity", async () => {
      // ...
    });

    it("falls back to per-unit when yield is zero", async () => {
      // ...
    });
  });

  describe("packaging cost rule (ADR-003)", () => {
    it("uses the maximum shipping line cost, not the sum", async () => {
      // ...
    });

    it("returns zero when there are no shipping lines", async () => {
      // ...
    });
  });
});
```

---

## Decimal Assertions

Use `Prisma.Decimal` for all financial values in tests. Assert with `.equals()` or `.toString()` — JavaScript `===` does not compare `Decimal` instances by value.

```typescript
// Correct
expect(result.totalCost.equals(new Prisma.Decimal("12.50"))).toBe(true);

// Also correct
expect(result.totalCost.toString()).toBe("12.50");

// Wrong — reference equality, not value equality
expect(result.totalCost).toBe(new Prisma.Decimal("12.50"));
```

---

## Database Tests

When a test requires database interaction (integration tests for services that cannot be meaningfully tested with mocks):

1. Use a separate test database — set `DATABASE_URL` in a `.env.test` file.
2. Run migrations against the test database before the test suite: `prisma migrate deploy`.
3. Wrap each test in a transaction that rolls back after the test, so tests are isolated and leave no state.
4. Do not mock Prisma in integration tests. The mocked behavior frequently diverges from actual Prisma behavior (especially with `$transaction`, `include`, and `Decimal` fields).

```typescript
import { prisma } from "~/db.server";

beforeEach(async () => {
  // Use Prisma's $transaction for test isolation when possible
  // Or seed/teardown with explicit deletes scoped to a test shopId
});
```

---

## Coverage Expectations

Coverage is a signal, not a goal. Do not write tests solely to raise a coverage number.

Required coverage:
- `costEngine.server.ts`: 100% line coverage. Every branch of cost resolution logic must be exercised.
- Zod schemas used in actions: 100% of validation rules tested.

No coverage requirement for:
- Route files (loaders, actions, components)
- Database migration scripts
- Configuration files

---

## Pre-Commit QA Test Review

Before every commit, perform a short QA review focused on missing tests. Ask:
- What behavior changed?
- What would break if this change regressed next week?
- Is that behavior already covered by a test?
- If not, should the coverage be unit, service, integration, or regression-focused?

This review is especially important when a change touches:
- financial logic
- validation
- data normalization or fallback behavior
- assignment/reset/merge workflows
- currency or locale formatting
- UI-visible workflow changes that may need Playwright coverage
- bug fixes prompted by QA, review, or production-like testing

The expected default is to add or update tests in the same branch as the code change. When no test is added, the reason should be explicit.

Run coverage to identify gaps, not to enforce a threshold:
```sh
npm run test:coverage
```
