# Security Standards — OWASP Top 10

This document maps each OWASP Top 10 risk to concrete implementation rules for this app. Review this document when adding any new route, action, webhook handler, or external integration.

---

## A01 — Broken Access Control

**Risk**: A merchant accesses another merchant's data by supplying a known ID.

**Rules**:

1. Every `loader` and `action` must extract `shopId` from the authenticated session — never from URL params, form data, or query strings.
2. Every Prisma query must include `shopId` in the `where` clause alongside any user-supplied ID.
3. When a resource is not found *or* belongs to a different shop, return `404` — not `403`. Do not confirm the resource exists to an unauthorized caller.

```typescript
// Correct — shopId is always from session, never user input
const config = await prisma.variantCostConfig.findFirst({
  where: { id: configId, shopId },
});
if (!config) throw new Response("Not found", { status: 404 });
```

4. Bulk operations must verify ownership of every item before processing. Do not assume items belong to the session shop just because the merchant submitted their IDs.

---

## A02 — Cryptographic Failures

**Risk**: Sensitive data is exposed in transit or at rest.

**Rules**:

1. The app runs exclusively over HTTPS (enforced by Shopify's tunnel and hosting requirements). Never serve over HTTP in production.
2. Do not store sensitive merchant data (order values, financial figures, PII) in cookies, localStorage, or URL parameters.
3. Database connection strings and API secrets must live in environment variables only — never hardcoded, never committed.
4. Session tokens are managed by `@shopify/shopify-app-session-storage-prisma` — do not implement custom session storage.

---

## A03 — Injection

**Risk**: User-supplied input is used to construct database queries or shell commands.

**Rules**:

1. Use Prisma parameterized queries exclusively. Never construct raw SQL strings from user input.
2. If raw queries are ever required (e.g., complex reporting), use Prisma's `$queryRaw` with tagged template literals — never string interpolation.

```typescript
// Correct — Prisma parameterizes automatically
prisma.variant.findMany({ where: { shopId, title: { contains: userInput } } })

// Correct raw query — tagged template is parameterized
prisma.$queryRaw`SELECT * FROM "Variant" WHERE "shopId" = ${shopId}`

// Wrong — string interpolation allows SQL injection
prisma.$queryRawUnsafe(`SELECT * FROM "Variant" WHERE "shopId" = '${shopId}'`)
```

3. Validate and sanitize all inputs with Zod schemas before they reach the database layer.
4. The app does not execute shell commands — do not introduce `child_process` or `exec` calls.

---

## A04 — Insecure Design

**Risk**: The system's architecture enables attacks that secure code alone cannot prevent.

**Rules**:

1. **Multi-tenancy boundary**: `shopId` is the tenant boundary. Every data model that is tenant-scoped must have a `shopId` column with a database-level index and a Prisma unique constraint or compound index that includes `shopId`.
2. **Immutable snapshots**: Order cost snapshots (ADR-001) must be written at order creation and never mutated. This prevents retroactive manipulation of donation pool calculations.
3. **Idempotent webhooks**: Webhook handlers must be idempotent — reprocessing the same webhook must not double-count financial records or create duplicate data.
4. **Rate of change**: Mutations to cost configurations should write to `auditLog` so that anomalous change rates can be detected.

---

## A05 — Security Misconfiguration

**Risk**: Default settings, unnecessary features, or missing hardening expose the app.

**Rules**:

1. Required environment variables must be validated at startup. If `DATABASE_URL`, `SHOPIFY_API_KEY`, or `SHOPIFY_API_SECRET` are missing, the process must fail fast with a clear error — not silently degrade.
2. Do not expose stack traces or internal error messages to the client. Remix `ErrorBoundary` components show generic messages; detailed errors go to server logs only.
3. The Docker image must not run as root. Use the `node` user.
4. `npm audit` must pass with no high or critical severity findings before deployment. Run `npm audit --audit-level=high` in CI.

---

## A06 — Vulnerable and Outdated Components

**Risk**: A known vulnerability in a dependency is exploited.

**Rules**:

1. Run `npm audit` before every deployment. Block deployments with high or critical findings.
2. Keep `@shopify/shopify-app-remix`, `@shopify/polaris`, and `prisma` on current minor versions — these receive security patches regularly.
3. Review `npm audit` output as part of the pre-commit hook or CI pipeline.
4. Do not add new dependencies without evaluating their maintenance status and download count. Prefer dependencies with active maintenance and wide adoption.

---

## A07 — Identification and Authentication Failures

**Risk**: An unauthenticated request accesses protected resources.

**Rules**:

1. All app routes under `/app/*` must call `authenticate.admin(request)` as the first operation. This throws a redirect if the session is invalid — let it propagate.
2. Webhook routes must use `authenticate.webhook(request)`, which verifies the Shopify HMAC signature. Never process a webhook payload without this verification.
3. Do not implement custom session management. Rely entirely on `@shopify/shopify-app-remix`.
4. App Proxy routes (if added) must use `authenticate.public.appProxy(request)`.

---

## A08 — Software and Data Integrity Failures

**Risk**: Code or data is tampered with, or unverified data is trusted.

**Rules**:

1. Shopify webhook HMAC verification (handled by `authenticate.webhook`) must never be disabled or bypassed, even in development.
2. Do not deserialize untrusted data using `eval`, `Function()`, or unsafe deserializers.
3. Snapshot payloads written at order time (ADR-001) are immutable — no update path should exist for them. Enforce this at the Prisma schema level with no `update` operations on snapshot models.
4. Pin critical dependencies to exact versions in `package.json` when a version has been verified in production.

---

## A09 — Security Logging and Monitoring

**Risk**: Attacks go undetected because there is insufficient logging.

**Rules**:

1. Write to `auditLog` for all mutations to financial data and app configuration (see CLAUDE.md §4).
2. Log authentication failures and unexpected `404` responses from ownership checks at `warn` level to the server log.
3. Do not log sensitive values: shop financial data, order totals, PII, or session tokens.
4. Log format for server errors: `[RouteOrService] <message>: <sanitized context>`. The `ErrorBoundary` `console.error` calls already follow this pattern.

---

## A10 — Server-Side Request Forgery (SSRF)

**Risk**: The server is tricked into making requests to internal infrastructure or arbitrary external hosts.

**Rules**:

1. The app currently makes outbound requests only to the Shopify Admin API (via the authenticated session client). This is safe.
2. If any future feature accepts a URL from the merchant (e.g., Printful/Printify integration endpoint URLs), that URL must be validated before use:
   - Parse with `new URL(input)` and catch on failure.
   - Assert the protocol is `https:`.
   - Assert the hostname is on an allowlist of known vendor domains (e.g., `api.printful.com`).
3. Never pass a user-supplied URL directly to `fetch()`.

```typescript
// Correct
const ALLOWED_HOSTS = new Set(["api.printful.com", "api.printify.com"]);

function validateVendorUrl(raw: string): URL {
  const url = new URL(raw); // throws if malformed
  if (url.protocol !== "https:") throw new Error("HTTPS required");
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error("Host not allowed");
  return url;
}
```
