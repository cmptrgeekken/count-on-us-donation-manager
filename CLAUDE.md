# Count On Us — Donation Manager

A Shopify embedded app for cause-driven merchants. Tracks per-variant production costs, calculates net donation pools from actual business profitability, and allocates donations to named charities. Not a payment processor — merchants disburse donations manually.

## Stack

| Layer | Technology |
|---|---|
| Framework | Remix (Vite) |
| UI | React 18, Shopify Polaris v12, App Bridge React v4 |
| Auth | Shopify OAuth via `@shopify/shopify-app-remix` |
| Database | PostgreSQL + Prisma 6 |
| Job Queue | pg-boss |
| Language | TypeScript 5 (strict mode) |

## Development

```sh
npm run dev          # shopify app dev (tunneled)
npm run lint         # eslint
npm run setup        # prisma generate + migrate deploy
npx tsc --noEmit     # type-check without building
```

## Architecture Decisions

See [docs/adr/](docs/adr/) for ADRs covering immutable order snapshots (ADR-001), dual-track financial models (ADR-002), cost resolution rules (ADR-003), and more.

---

## Coding Standards

### 1. Authentication and Shop Isolation (CRITICAL)

Every `loader` and `action` must begin with:

```typescript
const { session } = await authenticate.admin(request);
const shopId = session.shop;
```

Every database query must include `shopId` in its `where` clause. Never query by a user-supplied ID alone — this is the primary guard against cross-tenant data leakage in a multi-tenant app.

```typescript
// Correct
prisma.costTemplate.findFirst({ where: { id: templateId, shopId } })

// Wrong — any shop's data is accessible if templateId is known
prisma.costTemplate.findFirst({ where: { id: templateId } })
```

### 2. Input Validation with Zod

All action form data and webhook payloads must be validated with Zod before touching business logic or the database. Never use raw `.get()` casts from `formData` as the sole validation.

```typescript
import { z } from "zod";

const Schema = z.object({
  templateId: z.string().cuid(),
  variantIds: z.array(z.string().cuid()).min(1),
});

const result = Schema.safeParse(rawInput);
if (!result.success) {
  return Response.json({ ok: false, errors: result.error.flatten() }, { status: 400 });
}
// Use result.data from here on
```

Install: `npm install zod`

### 3. Financial Math

Never use JavaScript `number` or `parseFloat` for monetary values. All financial calculations must use `Prisma.Decimal`. Convert to `number` only as the final rendering step via `.toNumber()`.

```typescript
// Correct
const total = materialCost.add(laborCost).add(equipmentCost);

// Wrong — floating-point errors corrupt financial calculations
const total = parseFloat(materialCost.toString()) + parseFloat(laborCost.toString());
```

### 4. Audit Logging

Write to `auditLog` for all mutations that affect financial data or app configuration. Follow the canonical field conventions:

| Field | Value |
|---|---|
| `shopId` | From `session.shop` |
| `entity` | Prisma model name (e.g., `"VariantCostConfig"`) |
| `action` | `SCREAMING_SNAKE_CASE` verb (e.g., `"TEMPLATE_ASSIGNED"`) |
| `actor` | `"merchant"` or `"system"` |
| `payload` | Minimal JSON — IDs and counts only, no raw user input, no PII |

Mutations requiring audit log entries: creates/updates/deletes on `VariantCostConfig`, `CostTemplate`, `MaterialLibraryItem`, `EquipmentLibraryItem`, and any order snapshot write.

### 5. Prisma Patterns

**Transactions**: Wrap any action that performs multiple writes in `prisma.$transaction()`. The audit log write must be inside the same transaction as the mutation it records.

```typescript
await prisma.$transaction(async (tx) => {
  await tx.variantCostConfig.update({ where: { id, shopId }, data: { templateId } });
  await tx.auditLog.create({ data: { shopId, entity: "VariantCostConfig", action: "TEMPLATE_ASSIGNED", actor: "merchant", payload: { templateId } } });
});
```

**No N+1 queries**: Use `include` or `select` in Prisma to load relations in a single query. Never issue a query inside a loop.

**Cost engine**: Always pass the Prisma client (or transaction client `tx`) explicitly to `resolveCosts()`. The cost engine accepts a `PrismaClient` — never import `prisma` directly inside it.

### 6. TypeScript

- No `any`. Use `unknown` and narrow it, or define a proper type.
- Explicit return types on all `loader`, `action`, and server-side service functions.
- Use `satisfies` rather than `as T` when asserting shape. `as T` is only acceptable after a runtime narrowing check.
- Server-only modules must be named `*.server.ts` to prevent accidental client-side bundling.

### 7. Error Boundaries

Every route file must export an `ErrorBoundary`. Follow the established pattern:

```typescript
export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[RouteName] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Page Title" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">Something went wrong.</Text>
          <Text as="p" variant="bodyMd">Please refresh the page. If the problem persists, contact support.</Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
```

### 8. Shopify UI

- Use Polaris components exclusively. Do not introduce third-party component libraries.
- All status feedback (success, error) must use a Polaris `Banner` paired with a visually-hidden `aria-live="polite"` region so screen readers announce the result. See `app/routes/app.variants._index.tsx` for the established pattern.
- Page titles must use `TitleBar` from App Bridge React — do not use the `Page title` prop.
- Destructive or irreversible actions must be gated behind a confirmation modal using Polaris `Modal` with `destructive: true` on the primary action.

### 9. Security

See [docs/standards/security.md](docs/standards/security.md) for full OWASP Top 10 implementation details.

Key rules:
- Webhook HMAC verification is handled by `@shopify/shopify-app-remix`. Never bypass or disable it.
- Never log sensitive merchant data (order totals, PII, financial figures).
- Never construct raw SQL — use Prisma parameterized queries exclusively.
- Validate any user-supplied URL before making server-side HTTP requests (SSRF prevention).

### 10. Accessibility (WCAG 2.1 AA)

See [docs/standards/accessibility.md](docs/standards/accessibility.md) for full implementation details.

Key rules:
- All interactive elements must be keyboard operable and have an accessible name.
- Use semantic HTML — `<button>` for actions, `<a>`/Remix `<Link>` for navigation. Never `<div onClick>`.
- Images must have descriptive `alt` text. Decorative images use `alt=""`.
- Color alone must never convey meaning — pair color with text or icon.

### 11. Testing

See [docs/standards/testing.md](docs/standards/testing.md) for full details.

Key rules:
- Pure calculation functions (cost engine, financial helpers) must have unit tests.
- Bug fixes and behavior corrections should usually add a regression test that would fail if the bug returns.
- Changes to financial resolution, validation, normalization, or state-merging logic should be assumed to need regression coverage unless there is a clear written reason they do not.
- Tests live adjacent to their source file: `costEngine.server.test.ts` alongside `costEngine.server.ts`.
- Do not mock the database in integration tests — use a real test database.
- Use Vitest as the test runner.

---

## Pre-commit Checks

The pre-commit hook runs in order:
1. `npm run lint` — ESLint must pass with zero errors
2. `npx tsc --noEmit` — TypeScript must type-check cleanly
3. TuringMind code review — blocks on Critical severity findings

Steps 1 and 2 block the commit immediately on failure. Do not use `git commit --no-verify` to bypass them. Fix the root cause.

Before every commit, run a brief QA Engineer persona pass and answer: "What tests should exist if this change breaks?" At minimum, check for:
- new or changed financial branches that need unit tests
- bug fixes that should add a regression test
- validation changes that should add schema coverage
- workflow or merge/reset behavior that should be covered by a service or integration test

If no new tests are added, record the reason in the commit notes, PR description, or working notes so the omission is explicit rather than accidental.
