# Phase 1 Foundation Spec

Use this document as the execution-level spec for Phase 1.

It translates the build plan into concrete implementation detail for the foundation phase. If this document conflicts with the build plan, ADRs, or PRD, treat those higher-level documents as authoritative unless this spec reflects an intentional later clarification.

**App:** Count On Us
**Version:** 1.1
**Date:** March 2026
**Phase goal:** A working Shopify app shell with OAuth, database, core schema, and webhook infrastructure in place. Nothing financial yet — just the plumbing that everything else depends on.
**Feeds into:** Phase 2 (Cost model)

**Amendment log — v1.1**

| Section | Change | Source |
|---|---|---|
| §2.3 | Prisma middleware changed from "warn" to "throw in dev/test, log CRITICAL in production." Test added to §8. | Security-1 panel flag |
| §5.4 | Empty state pages replaced with shared `<PlaceholderPage />` component pattern. | FE-1 panel flag |
| §4.3 | pg-boss pool size specified. `DATABASE_POOL_SIZE` and `JOBS_POOL_SIZE` environment variables added. | BE-1 panel flag |
| §1.3 | `.env.example` table updated with pool size variables. | BE-1 panel flag |
| §8 | Added `DeletionJob` status transition test and pg-boss schema isolation test. | QA panel notes |
| §5.7 | Added `aria-live` announcement requirement on banner dismissal. | Accessibility panel note |
| §6.4 | Added accessible state communication requirement for plan override toggle. | Accessibility panel note |
| §1.4 | Added note on `automatically_update_urls_on_dev` staging behaviour. | Shopify Developer panel note |

---

## Scope

Phase 1 delivers exactly six things:

1. A scaffolded Shopify app that installs, authenticates, and embeds correctly in the Shopify admin
2. A PostgreSQL schema with four Phase 1 tables
3. A webhook pipeline that accepts, verifies, and queues payloads asynchronously
4. An admin shell with navigation, empty states, and error boundaries
5. Shopify plan detection and storage
6. A deletion and reinstall lifecycle that satisfies App Store review requirements

Nothing financial is implemented. No cost engine, no snapshots, no causes, no reporting. Any feature that touches money is explicitly out of scope.

---

## 1. App scaffolding

### 1.1 Project initialisation

Initialise using Shopify CLI with the React Router template:

```bash
shopify app init --template=remix
```

The project must use:
- **Node.js LTS** (v22 at time of writing)
- **React Router v7** (Shopify CLI default for new apps)
- **Prisma ORM** with PostgreSQL adapter
- **PostgreSQL** — Docker Compose locally, managed instance on staging server

### 1.2 Docker Compose setup

`compose.yml` defines three services:

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment: [env_file references]
    depends_on: [db, jobs]

  db:
    image: postgres:16
    volumes: [postgres_data:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: countonus
      POSTGRES_USER: countonus
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  jobs:
    # pg-boss runs inside the app container — no separate service needed
    # jobs service entry reserved for future use if needed
```

`pg-boss` runs within the app process. It does not require a separate container. At startup, the app initialises pg-boss after the Prisma client is ready, and shuts it down cleanly on `SIGTERM`.

### 1.3 Environment variables

All secrets in `.env`, never committed to source control. `.env.example` committed with all keys and placeholder values.

| Variable | Purpose |
|---|---|
| `SHOPIFY_API_KEY` | Partner Dashboard Client ID |
| `SHOPIFY_API_SECRET` | Partner Dashboard Client Secret |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_POOL_SIZE` | Prisma connection pool size (default: 5) |
| `JOBS_POOL_SIZE` | pg-boss connection pool size (default: 3) |
| `APP_URL` | Public HTTPS URL (ngrok/Cloudflare tunnel for dev, fixed domain for staging) |
| `NODE_ENV` | `development` / `production` |

### 1.4 `shopify.app.toml`

```toml
name = "Count On Us"
client_id = "${SHOPIFY_API_KEY}"
application_url = "${APP_URL}"
embedded = true

[access_scopes]
scopes = "read_products,write_products,read_orders,read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions,shopify_payments_payouts,write_app_proxy,read_locales"

[auth]
redirect_urls = [
  "${APP_URL}/api/auth/callback"
]

[webhooks]
api_version = "2026-01"

[[webhooks.subscriptions]]
topics = [
  "orders/create",
  "orders/updated",
  "refunds/create",
  "products/update",
  "variants/update",
  "payouts/create",
  "app/uninstalled"
]
uri = "/webhooks"

[[webhooks.subscriptions]]
compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
uri = "/webhooks/compliance"

[build]
automatically_update_urls_on_dev = true
include_config_on_deploy = true
```

> **Note:** `automatically_update_urls_on_dev = true` causes Shopify CLI to overwrite the app URL in the Partner Dashboard every time `shopify app dev` runs. This is correct for local development with a tunnel. On the staging server with a fixed domain, set this to `false` to prevent a local dev session from overwriting the staging URL. Consider maintaining separate toml configurations or using environment-specific overrides for staging.

> **Note:** `api_version` should be verified against the current stable Shopify release at time of development. Shopify releases new versions quarterly.

### 1.5 Security headers middleware

Applied to all admin responses via a middleware function that runs before route handlers.

| Header | Value |
|---|---|
| `Content-Security-Policy` | `frame-ancestors https://{shop}.myshopify.com https://admin.shopify.com` — shop domain injected dynamically from session |
| `X-Content-Type-Options` | `nosniff` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

`X-Frame-Options` is **not** set — CSP `frame-ancestors` supersedes it for modern browsers.

When using the Shopify CLI Remix adapter, `authenticate.admin()` sets the CSP `frame-ancestors` header automatically. Verify this is in place on every admin route before adding custom middleware that might conflict.

---

## 2. OAuth and session management

### 2.1 Install flow

The Shopify CLI Remix adapter handles the OAuth install flow. The app must:

1. Complete OAuth via `authenticate.admin()` on all admin routes
2. On first install, create a `Shop` record and enqueue the post-install job (§6)
3. Redirect to the Dashboard after install completes

The install route (`/api/auth`) and callback route (`/api/auth/callback`) are handled by the adapter. Do not implement OAuth manually.

### 2.2 Session token validation

All admin routes are protected by `authenticate.admin()` from the Shopify CLI adapter. This handles session token validation, token refresh, and re-authentication transparently.

No admin route handler may access the database or return data without passing through `authenticate.admin()`. This is the primary authentication control.

### 2.3 Multi-tenant isolation

Every database query must include a `shopId` filter. This is the primary access control for financial and merchant data.

Implementation pattern:

```typescript
// Every loader and action extracts shopId from the authenticated session
const { session } = await authenticate.admin(request);
const shopId = session.shop;

// Every query scopes by shopId
const shop = await prisma.shop.findUnique({
  where: { shopId }
});
```

A Prisma middleware layer enforces this at the ORM level as a belt-and-suspenders control:

```typescript
prisma.$use(async (params, next) => {
  const tenantScopedModels = ['Shop', 'WizardState', 'AuditLog', 'DeletionJob'];

  if (tenantScopedModels.includes(params.model ?? '') && params.action !== 'create') {
    const hasShopId = params.args?.where?.shopId !== undefined;
    if (!hasShopId) {
      if (process.env.NODE_ENV === 'production') {
        // Log as CRITICAL — do not throw in production to avoid availability impact,
        // but alert immediately for investigation
        logger.critical('SECURITY: Unscoped query on tenant model', {
          model: params.model,
          action: params.action,
        });
      } else {
        // Throw in development and test — fail fast, catch early
        throw new Error(
          `Security violation: query on tenant-scoped model '${params.model}' missing shopId filter`
        );
      }
    }
  }

  return next(params);
});
```

**Cross-shop access must be architecturally impossible.** Test this explicitly before Phase 2 (see §8).

### 2.4 App Bridge

Use the current Shopify embedded app auth pattern via the React Router adapter. The build plan references "App Bridge 3" as shorthand for the current Shopify embedded auth approach. Verify the correct adapter version at scaffold time via Shopify CLI documentation and use whatever is current.

---

## 3. Database schema — Phase 1 tables

Deploy a single Prisma migration containing exactly these four tables. No other tables are created in Phase 1.

### 3.1 `Shop`

```prisma
model Shop {
  id              String    @id @default(cuid())
  shopId          String    @unique  // Shopify shop domain e.g. mystore.myshopify.com
  shopifyDomain   String    @unique
  planTier        String?             // Detected Shopify plan name
  paymentRate     Decimal?  @db.Decimal(5, 4)  // e.g. 0.0290 for 2.90%
  planOverride    Boolean   @default(false)     // True if merchant manually overrode plan
  wizardStep      Int       @default(0)         // Last completed wizard step (0 = not started)
  catalogSynced   Boolean   @default(false)     // Set to true by CatalogSync in Phase 2
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  wizardState     WizardState?
  auditLogs       AuditLog[]
}
```

### 3.2 `WizardState`

```prisma
model WizardState {
  id              String    @id @default(cuid())
  shopId          String    @unique
  shop            Shop      @relation(fields: [shopId], references: [shopId])
  currentStep     Int       @default(0)
  completedSteps  Int[]                         // Array of completed step numbers
  skippedSteps    Int[]                         // Array of skipped step numbers
  updatedAt       DateTime  @updatedAt
}
```

### 3.3 `AuditLog`

```prisma
model AuditLog {
  id          String    @id @default(cuid())
  shopId      String
  shop        Shop      @relation(fields: [shopId], references: [shopId])
  entity      String    // e.g. "OrderSnapshot", "Disbursement", "Shop"
  entityId    String?   // ID of the affected record
  action      String    // e.g. "CREATE", "UPDATE", "DELETE", "CLOSE"
  actor       String    // e.g. "system", "merchant", "webhook"
  payload     Json?     // Before/after or relevant context
  createdAt   DateTime  @default(now())

  @@index([shopId, createdAt])
}
```

> All financial mutations must write an `AuditLog` entry. This is enforced from Phase 1 so the pattern is established before any financial data exists. Phase 1 financial mutations: Shop creation, plan detection writes, deletion scheduling.

### 3.4 `DeletionJob`

The build plan lists `RecalculationRun` as a Phase 1 table but this was removed (BE-1 flag from the pre-Phase 1 panel review). In its place, Phase 1 needs a way to track scheduled deletion jobs for the uninstall/reinstall lifecycle.

```prisma
model DeletionJob {
  id            String    @id @default(cuid())
  shopId        String    @unique
  scheduledFor  DateTime              // 48 hours after uninstall
  status        String    @default("pending")  // pending / cancelled / completed
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

> **Note:** pg-boss manages job execution. `DeletionJob` is the DB-side record that allows the reinstall handler to find and cancel a pending deletion. The pg-boss job references the `DeletionJob` record by `shopId`.

### 3.5 Indexes

```prisma
// In addition to @unique and @id constraints above:
@@index([shopId, createdAt])  // on AuditLog — date-filtered audit log queries
```

### 3.6 Migration

Run a single Prisma migration for all four tables:

```bash
npx prisma migrate dev --name phase1_foundation
```

Migration must be checked into source control. The migration file is the authoritative schema history.

---

## 4. Webhook infrastructure

### 4.1 HMAC verification middleware

All requests to `/webhooks` and `/webhooks/compliance` must pass HMAC-SHA256 verification before any handler runs.

```typescript
function verifyWebhookHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(hmacHeader)
  );
}
```

Unverified requests return `401` immediately and are logged with the shop domain and topic.

**Critical:** Read the raw request body before any parsing. Once a framework parses the body, the raw bytes are lost and HMAC verification will fail.

### 4.2 Async processing pattern

All webhook handlers follow the same pattern:

1. Verify HMAC — return `401` if invalid
2. Return `200` immediately
3. Enqueue a pg-boss job with the raw payload
4. The job processor handles the actual work asynchronously

```typescript
// Webhook handler — runs synchronously
export async function action({ request }: ActionFunctionArgs) {
  const rawBody = await request.arrayBuffer();
  const hmac = request.headers.get('x-shopify-hmac-sha256') ?? '';

  if (!verifyWebhookHmac(Buffer.from(rawBody), hmac, process.env.SHOPIFY_API_SECRET!)) {
    return new Response(null, { status: 401 });
  }

  const topic = request.headers.get('x-shopify-topic') ?? '';
  const shop = request.headers.get('x-shopify-shop-domain') ?? '';
  const payload = JSON.parse(Buffer.from(rawBody).toString('utf-8'));

  await jobQueue.send(`webhook.${topic.replace('/', '.')}`, {
    shop,
    topic,
    payload,
  });

  return new Response(null, { status: 200 });
}
```

### 4.3 Job queue configuration (pg-boss)

```typescript
import PgBoss from 'pg-boss';

export const jobQueue = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.JOBS_POOL_SIZE ?? '3'),  // pg-boss connection pool
  retryLimit: 3,
  retryDelay: 30,      // seconds between retries
  retryBackoff: true,  // exponential backoff
  deleteAfterDays: 7,  // retain completed jobs for 7 days for debugging
});

// Initialise at app startup — after Prisma client is ready
await jobQueue.start();

// Shutdown on process exit
process.on('SIGTERM', async () => {
  await jobQueue.stop();
  process.exit(0);
});
```

Prisma connection pool is configured via the `DATABASE_URL` connection string or `DATABASE_POOL_SIZE` environment variable:

```
DATABASE_URL="postgresql://user:pass@host:5432/countonus?connection_limit=5"
```

Or via Prisma datasource in `schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // connection_limit defaults to DATABASE_POOL_SIZE env var if set
}
```

**Default pool sizes: Prisma = 5, pg-boss = 3.** Total = 8 connections, well within PostgreSQL's default `max_connections = 100`. Both values are tunable via environment variables without code changes.

> **Note:** pg-boss creates its own schema (`pgboss`) in the same PostgreSQL database. This does not conflict with Prisma migrations. Do not include `pgboss` schema in Prisma migrations. Verify with `prisma migrate status` after first initialisation (see §8 exit criteria).

### 4.4 Job failure requirements (from QA-1 panel flag)

The following must be true before Phase 2:

- A job that throws an error is retried up to 3 times with exponential backoff
- After 3 failures, the job enters a `failed` state in pg-boss
- Failed jobs are logged with `shopId`, `topic`, and error message to application logs
- A test verifies that a deliberately failing job is retried and eventually enters `failed` state

### 4.5 Phase 1 webhook handlers

**`orders/create` — stub only**

```typescript
// Verified, queued, logged. No processing in Phase 1.
jobQueue.work('webhook.orders.create', async (job) => {
  const { shop, payload } = job.data;
  await prisma.auditLog.create({
    data: {
      shopId: shop,
      entity: 'OrderSnapshot',
      entityId: payload.id?.toString(),
      action: 'WEBHOOK_RECEIVED',
      actor: 'webhook',
      payload: { orderId: payload.id, note: 'Phase 1 stub — not yet processed' },
    }
  });
});
```

**`app/uninstalled` — functional**

```typescript
jobQueue.work('webhook.app.uninstalled', async (job) => {
  const { shop } = job.data;

  // 1. Delete metafields and metaobjects immediately via Admin API
  await deleteShopMetaobjects(shop);
  await deleteShopMetafields(shop);

  // 2. Schedule DB + S3 deletion in 48 hours via pg-boss delayed job
  const scheduledFor = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await prisma.deletionJob.upsert({
    where: { shopId: shop },
    create: { shopId: shop, scheduledFor, status: 'pending' },
    update: { scheduledFor, status: 'pending' },
  });

  await jobQueue.sendAfter('shop.delete', { shop }, {}, scheduledFor);

  await prisma.auditLog.create({
    data: {
      shopId: shop,
      entity: 'Shop',
      action: 'UNINSTALL',
      actor: 'webhook',
      payload: { scheduledDeletion: scheduledFor },
    }
  });
});
```

**`shop.delete` — the actual deletion job (runs 48hrs after uninstall)**

```typescript
jobQueue.work('shop.delete', async (job) => {
  const { shop } = job.data;

  const deletionJob = await prisma.deletionJob.findUnique({ where: { shopId: shop } });
  if (!deletionJob || deletionJob.status === 'cancelled') return; // Reinstall cancelled it

  // Delete all shop data from DB in dependency order
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { shopId: shop } }),
    prisma.wizardState.deleteMany({ where: { shopId: shop } }),
    prisma.deletionJob.deleteMany({ where: { shopId: shop } }),
    prisma.shop.deleteMany({ where: { shopId: shop } }),
  ]);
  // S3 deletion added in Phase 4 when S3 is introduced
});
```

**Reinstall within deletion window**

On install (OAuth callback), before creating a new `Shop` record:

```typescript
const pending = await prisma.deletionJob.findUnique({ where: { shopId: shop } });
if (pending && pending.status === 'pending') {
  // Cancel the deletion job
  await prisma.deletionJob.update({
    where: { shopId: shop },
    data: { status: 'cancelled' }
  });
  // pg-boss job will check DeletionJob status and no-op if cancelled
  // Existing Shop and data are retained — do not re-run onboarding
}
```

### 4.6 GDPR compliance webhooks

All three compliance webhooks return `200` immediately. Processing is async.

| Topic | Phase 1 handler |
|---|---|
| `customers/data_request` | Log receipt. Actual data retrieval implemented in Phase 3 when `OrderSnapshot` exists. |
| `customers/redact` | Log receipt. Actual redaction implemented in Phase 3. |
| `shop/redact` | Triggers the same deletion flow as `app/uninstalled`. This is the authoritative data deletion trigger for GDPR. |

---

## 5. Admin shell

### 5.1 Navigation structure

Shopify Polaris `Navigation` component with four grouped sections. Navigation sections use flat grouped items (section headings with items beneath) — not collapsible sub-navigation.

```
Cost Config
  ├── Material Library        (Phase 2)
  ├── Equipment Library       (Phase 2)
  ├── Cost Templates          (Phase 2)
  └── Variant Costs           (Phase 2)

Donation Setup
  ├── Causes                  (Phase 3)
  └── Product Donations       (Phase 3)

Finance
  ├── Reporting               (Phase 4)
  └── Business Expenses       (Phase 3)

Operations
  ├── Dashboard               (Phase 1 ✓)
  ├── Provider Connections    (Phase 2)
  ├── Order History           (Phase 3)
  └── Settings                (Phase 1 shell ✓)
```

In Phase 1, only Dashboard and Settings are real pages. All other nav items render their empty state pages.

### 5.2 Dashboard page

The dashboard in Phase 1 shows a single empty state. It does not render any financial data.

**Empty state content:**

```
[Icon: chart or donation box]
Welcome to Count On Us

You're all set up. Start by configuring your production costs,
then assign causes to your products.

[Button: Get started →]  (links to Material Library in Phase 2; disabled with tooltip in Phase 1)
```

The heading uses `<h1>` semantically. No colour-only indicators. Empty state is readable without CSS.

### 5.3 Settings page shell

A Polaris `Page` with `Card` sections. Fields are present but non-functional in Phase 1 — they will be wired up as each phase delivers their underlying data.

Sections rendered in Phase 1 (all read-only placeholders):

- **Shopify Payments** — fee rate field, plan detection status, manual override toggle (wired in §6)
- **Donation email** — enable/disable toggle (wired in Phase 5)
- **Audit log** — link placeholder (wired in Phase 4)

### 5.4 Placeholder pages

All navigation items that don't have Phase 1 content render a single shared `<PlaceholderPage />` component. Each route simply imports and renders this component -- no page-specific empty state logic.

```tsx
// components/PlaceholderPage.tsx
export function PlaceholderPage() {
  return (
    <Page>
      <EmptyState
        heading="Coming soon"
        image={emptyStateImage}
      >
        <p>This section will be available once you complete setup.</p>
      </EmptyState>
    </Page>
  );
}

// app/routes/materials.tsx (Phase 2 will replace this entire file)
export default function MaterialsPage() {
  return <PlaceholderPage />;
}
```

When Phase 2 builds the Material Library, it replaces `app/routes/materials.tsx` entirely. It never touches `PlaceholderPage.tsx`. This means Phase 2+ development only touches the route file it is building -- it does not need to hunt down per-page empty state implementations.

No page returns a blank screen or unhandled error for a new install.

### 5.5 React error boundaries

Every major page component is wrapped in an error boundary. The boundary renders a recoverable fallback — not a blank screen.

```tsx
function ErrorFallback({ error }: { error: Error }) {
  return (
    <Banner tone="critical" title="Something went wrong">
      <p>There was a problem loading this page. Please refresh and try again.</p>
      <p>If this keeps happening, contact support.</p>
    </Banner>
  );
}
```

Error boundaries must be tested by deliberately throwing inside a page component. The fallback must be keyboard accessible and readable by screen readers.

### 5.6 Wizard launch gating stub

The wizard must not launch until `CatalogSync` completes (Phase 2). In Phase 1, `catalog_synced` on `Shop` defaults to `false`. The wizard launch check reads this flag.

```typescript
// In the post-install flow, after Shop record is created:
const shop = await prisma.shop.findUnique({ where: { shopId } });
if (shop?.catalogSynced) {
  // Launch wizard — will not happen in Phase 1
} else {
  // Show post-install loading state (§5.7)
}
```

This stub means the Phase 2 wizard implementation does not require any changes to the install flow — it simply sets `catalogSynced = true` and the existing check handles it.

### 5.7 Post-install loading state

After OAuth completes, the merchant sees the Dashboard with a persistent banner:

```
ℹ️  We're syncing your store catalog. This may take a few minutes.
    You can start exploring the app while this runs.
```

The banner persists until `catalog_synced` is `true`. In Phase 1, since `CatalogSync` doesn't exist, the banner will always show. Phase 2 resolves this by setting the flag on sync completion.

The banner must use Polaris `Banner` with `tone="info"`, which renders accessible markup by default. When the banner dismisses (on `catalogSynced = true`), render a brief `aria-live="polite"` announcement so screen reader users are informed that sync completed:

```tsx
{catalogSynced && (
  <div aria-live="polite" className="sr-only">
    Store catalog sync complete.
  </div>
)}
```

This element should be present in the DOM from page load and updated when `catalogSynced` transitions to `true`, rather than being conditionally mounted, to ensure the live region is reliably announced.

---

## 6. Shopify plan detection

### 6.1 `PlanDetectionService`

A pure function that queries the Shopify Admin GraphQL API for the merchant's current plan and extracts the payment processing rate.

```typescript
async function detectPlan(admin: AdminApiContext): Promise<{
  planTier: string;
  paymentRate: number;
}> {
  const response = await admin.graphql(`
    query {
      shop {
        plan {
          displayName
          partnerDevelopment
          shopifyPlus
        }
      }
    }
  `);

  const plan = response.shop.plan;
  const rate = lookupPaymentRate(plan.displayName, plan.shopifyPlus);

  return {
    planTier: plan.displayName,
    paymentRate: rate,
  };
}
```

**Payment rate lookup table** (stored in code, not DB — these are Shopify's published rates):

| Plan | Rate |
|---|---|
| Basic | 2.90% |
| Shopify | 2.60% |
| Advanced | 2.40% |
| Plus | 2.15% |
| Development / Partner | 0% |
| Unknown | null (manual override required) |

### 6.2 On install

`PlanDetectionService` runs immediately after the `Shop` record is created. The result is stored in `Shop.planTier` and `Shop.paymentRate`.

### 6.3 Daily re-detection

A pg-boss scheduled job runs daily:

```typescript
await jobQueue.schedule('plan.detect.daily', '0 6 * * *', {}); // 6am UTC daily

jobQueue.work('plan.detect.daily', async () => {
  const shops = await prisma.shop.findMany({
    where: { planOverride: false }  // Skip shops with manual override
  });

  for (const shop of shops) {
    await jobQueue.send('plan.detect', { shopId: shop.shopId });
  }
});
```

### 6.4 Manual override

The Settings page has a manual override toggle. When enabled:
- `Shop.planOverride = true`
- The fee rate field becomes editable
- The daily re-detection job skips this shop
- An `AuditLog` entry records the override with before/after values

**Accessibility requirement:** When the toggle is switched on, the fee rate field transitions from disabled to editable. This state change must be communicated to screen readers. Use an `aria-live="polite"` region that announces "Manual override enabled. You can now edit the fee rate." when the field becomes editable, and "Manual override disabled. Fee rate will be detected automatically." when it reverts. Polaris `TextField` with `disabled` prop handles visual state but does not automatically announce the transition.

---

## 7. Accessibility — Phase 1 checklist

The following must pass before Phase 2 begins (from build plan §1.5):

- [ ] App renders correctly inside Shopify admin iframe with no console errors
- [ ] Navigation: all items keyboard accessible via Tab, current page indicated to screen readers via `aria-current="page"`
- [ ] Dashboard empty state: uses semantic `<h1>` heading, no colour-only indicators, renders meaningfully without CSS
- [ ] Error boundary fallback states: readable by screen reader, all interactive elements keyboard accessible
- [ ] Settings page: all form fields have associated `<label>` elements or `aria-label`, no unlabelled inputs

---

## 8. Tests to pass before Phase 2

These are the Phase 1 exit criteria from the build plan, expanded with specific test cases.

### Install lifecycle

- [ ] Fresh install: OAuth completes, `Shop` record created, merchant redirected to Dashboard
- [ ] Dashboard shows empty state immediately after install — no blank screen
- [ ] Post-install banner shown when `catalog_synced = false`

### Uninstall / reinstall

- [ ] Uninstall: `app/uninstalled` webhook received, metafields/metaobjects deleted, `DeletionJob` created, 48hr deletion job enqueued
- [ ] Reinstall within 48hr window: `DeletionJob` status set to `cancelled`, existing `Shop` data retained, no wizard re-launch
- [ ] Reinstall after deletion: `Shop` and all related records deleted, fresh install proceeds as new
- [ ] After successful deletion: `DeletionJob.status` is `completed`
- [ ] After cancellation: `DeletionJob.status` is `cancelled`

### Webhook infrastructure

- [ ] HMAC verification: tampered payload returns `401`, valid payload returns `200`
- [ ] Async pattern: webhook handler returns `200` before job processor runs (verified by timing)
- [ ] Job retry: deliberately failing job retries 3 times then enters `failed` state
- [ ] Failed job logged with `shopId` and error message
- [ ] `orders/create` stub: received, queued, `AuditLog` entry created, no other processing

### GDPR compliance webhooks

- [ ] `customers/data_request`: returns `200`, receipt logged
- [ ] `customers/redact`: returns `200`, receipt logged
- [ ] `shop/redact`: returns `200`, triggers same deletion flow as `app/uninstalled`

### Security

- [ ] Security headers present on all admin responses (verify with browser dev tools)
- [ ] CSP `frame-ancestors` includes merchant shop domain dynamically
- [ ] No cross-shop data access possible (test: query with shopId A, verify shopId B data unreachable)
- [ ] Prisma middleware: unscoped query on a tenant-scoped model throws in dev/test environment
- [ ] pg-boss schema isolation: run `prisma migrate status` after pg-boss initialisation and confirm `pgboss` schema does not appear in Prisma migration output

### Plan detection

- [ ] Plan detected on install, stored in `Shop.planTier` and `Shop.paymentRate`
- [ ] Manual override: `planOverride = true`, rate editable, daily re-detection skipped
- [ ] Daily job: runs for shops without override, skips shops with override

### Admin shell

- [ ] All nav items render without blank screens or unhandled errors
- [ ] Error boundary: deliberately thrown error shows fallback, not blank screen
- [ ] Phase 1 accessibility checklist (§7) all items passing

---

## 9. Out of scope for Phase 1

The following are explicitly deferred to later phases. Do not implement them here.

| Item | Phase |
|---|---|
| `CatalogSync` (product/variant sync) | 2 |
| Cost engine, materials, equipment | 2 |
| Causes, metaobject definitions | 3 |
| `SnapshotService`, `orders/create` processing | 3 |
| Reporting periods, `ChargeSyncService` | 4 |
| Storefront widget, email | 5 |
| All snapshot, library, reporting, and POD schema tables | 2–5 |

---

## 10. Open questions

None blocking Phase 1. The following are noted for awareness:

- **App Bridge version** — verify correct adapter at scaffold time; "App Bridge 3" in the build plan is shorthand for the current embedded auth pattern.
- **Polaris version** — use whatever is installed by the Shopify CLI template; do not pin a specific version manually.
- **pg-boss schema isolation** — confirm `pgboss` schema does not appear in `prisma migrate status` output. If it does, add it to `prisma.schema` `datasource` exclusions.
