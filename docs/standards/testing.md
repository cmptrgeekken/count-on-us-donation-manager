# Testing Standards

## Test Runner

Use **Vitest** as the test runner. It is compatible with the Vite build setup and supports TypeScript natively without additional configuration.

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

### Always test: Zod validation schemas

When you add a Zod schema for action input validation, write a test that verifies:
- Valid input passes
- Each required field, when missing, produces the expected error
- Each field with a constraint (min length, positive number, cuid format) rejects invalid values

### Test when the logic is non-trivial: service functions

Services like `catalogSync.server.ts` or `installService.server.ts` contain conditional logic that is worth unit testing with mocked dependencies when the logic is complex enough that a typo could go unnoticed.

### Do not test: Remix loaders and actions directly

Loaders and actions are integration points — they authenticate, query the DB, and return responses. Testing them in isolation requires mocking too many layers to be meaningful. Test the underlying service functions instead.

### Do not test: Polaris component rendering

Polaris components are well-tested by Shopify. Do not write snapshot tests or shallow render tests for pages that are purely composed of Polaris components.

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

Run coverage to identify gaps, not to enforce a threshold:
```sh
npm run test:coverage
```
