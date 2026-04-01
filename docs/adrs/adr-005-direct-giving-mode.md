# ADR-005: Direct Giving Mode — scope removal and standalone app architecture

| | |
| --- | --- |
| **Status** | Removed from core app / Standalone app (future) |
| **Date** | March 2026 |
| **Depends on** | ADR-001 |
| **Supersedes** | PRD §16 (Direct Giving Mode concept) |

## Context

PRD §16 describes Direct Giving Mode as a future feature of the core app: a purchase flow where the customer donates directly to store causes and submits proof, receiving the product at cost-only pricing. The design assumes a merchant can hold a Shopify Payments authorisation at checkout and programmatically capture it later — after receipt verification.

Pre-launch feasibility testing revealed a critical architectural flaw in this assumption.

### Feasibility finding

Programmatic payment capture via the `orderCapture` GraphQL mutation requires the merchant to have **manual payment capture enabled store-wide** in their Shopify Payments settings. This is a store-level setting the merchant controls — the app cannot configure it. Most merchants run automatic capture by default, which means the customer is charged at checkout immediately, before any receipt is uploaded. The conditional-payment model in the PRD falls apart for these merchants.

The fix — requiring merchants to enable manual capture — creates a second problem: the app would then be responsible for capturing every order on the merchant's store, not just Direct Giving orders. A bug or outage would prevent merchants from being paid across their entire catalog. This is a fundamentally different risk profile from a donation ledger tool.

## Decision

Direct Giving Mode is removed from the core app entirely and designated as a future standalone Shopify app.

### Rationale

**Risk separation.** The core app's value is financial transparency and donation accuracy — a trust tool. Adding a payment capture layer introduces a failure mode where merchants don't get paid, which is a categorically different risk. Keeping the risk profiles separate protects the core app's reputation and merchant trust.

**Responsibility clarity.** A dedicated Direct Giving app that explicitly manages payment capture sets the right expectations. Merchants opt into that responsibility knowingly rather than discovering it embedded in a donation management tool.

### What this means for the core app

- No payment capture logic
- No `write_orders` OAuth scope
- No `PaymentCaptureService`
- No `DirectGivingReceipt` model
- The core app's scope, risk profile, and OAuth scopes are unchanged
- PRD §16 concept is preserved as a reference document for the future standalone app

## Standalone app architecture — for future reference

The following records the intended architecture for the future standalone Direct Giving app. It is not a commitment to build — it is a design reference so the thinking is not lost.

### Capture policy model

The standalone app requires manual capture enabled store-wide. To eliminate the operational burden this creates, the app manages capture for all orders — not just Direct Giving ones. Merchants configure a capture policy for non-Direct Giving orders:

| Policy | Behaviour |
| --- | --- |
| `auto` | App captures all non-DGM orders immediately on `orders/create` webhook. Replicates default Shopify behaviour. Recommended for most merchants. |
| `flow` | App does nothing for non-DGM orders. Merchant handles capture via Shopify Flow or another app (e.g. fraud detection). App only intercepts DGM orders. |
| `manual` | App does nothing for non-DGM orders. Merchant captures from Shopify admin. Full manual control retained. |
| `dgm_only` | App holds DGM orders pending verification, captures immediately on approval, voids on rejection or expiry. All other orders captured automatically. |

### Key data models

**DirectGivingReceipt**

| Field | Type | Notes |
| --- | --- | --- |
| order_id | FK | Shopify order ID |
| required_amount | NUMERIC(10,2) | Combined cause allocation for the order |
| accepted_cause_ids | JSON | Any active 501(c)3 cause on the store |
| upload_file_key | VARCHAR | S3 key for uploaded receipt |
| upload_deadline | TIMESTAMPTZ | Configurable, default 7 days from order |
| verification_status | ENUM | pending / approved / rejected / expired |
| reviewer_notes | TEXT | Nullable |
| verified_at | TIMESTAMPTZ | Nullable |

**CapturePolicy (on Shop)**

| Field | Type | Notes |
| --- | --- | --- |
| non_dgm_capture_policy | ENUM | auto / flow / manual / dgm_only |
| upload_deadline_days | INT | Default 7, max 7 (card auth window) |
| expiry_warning_hours | INT | Notify merchant N hours before expiry |

### Key guard rails

- Direct Giving Mode blocked from being enabled until manual capture is confirmed on in Shopify Payments settings. App detects this via Admin API and shows a blocking prompt — not a warning.
- Upload deadline must be ≤ 7 days (standard Shopify Payments card authorisation window). App enforces this as a hard cap.
- Expiry cron runs daily. Any `DirectGivingReceipt` past `upload_deadline` with no verified upload triggers automatic void via `orderCancel` and customer notification.
- Only products assigned to 501(c)3 causes are eligible. Non-501(c)3 products cannot offer this flow.
- The standalone app requires `write_orders` scope. This scope must not be added to the core app.

### What the core app must expose for integration

- Active 501(c)3 causes per shop — for the standalone app to validate receipt acceptance criteria
- Per-product cause allocation amounts at cost-only price — for determining the required donation amount per order
- A `direct_giving_mode` flag on `OrderSnapshot` — so the core app's donation reporting correctly excludes Direct Giving orders from the standard donation pool

The exact integration mechanism (shared DB reads, internal API, metafield conventions) is deferred to the standalone app's design phase. The core app should not be modified to support the standalone app until that design is settled.

## Consequences

### Benefits

- Core app scope, risk profile, and OAuth scopes remain clean.
- No payment capture failure modes introduced into a trust-sensitive financial tool.
- Standalone app can be built, tested, and released independently.
- Capture policy model is flexible enough to accommodate diverse merchant workflows.

### Costs

- Direct Giving Mode not available at core app launch.
- Two apps for merchants who want both features adds installation overhead.
- Integration between the two apps requires careful design to avoid tight coupling.

## Alternatives considered

**Build Direct Giving Mode into core app as planned (PRD original)** — Rejected. Requires manual capture store-wide plus a capture management layer for all orders. Introduces payment failure risk into a donation ledger tool. Conflates two distinct product responsibilities.

**Full price at checkout, refund on receipt verification** — Rejected as primary model. Customers pay more upfront and wait for a refund — psychologically backwards for a feature designed to make charitable giving feel rewarding. Also complicates the core app's refund handling and snapshot adjustment model.

**Draft order flow — no payment at checkout** — Rejected. Draft orders break Shopify's standard checkout flow, conversion tracking, and fulfilment integrations. Too much friction and too many edge cases around draft order lifecycle.

**Defer entirely with no architecture recorded** — Rejected. The PRD concept is well-reasoned and worth preserving. Recording the corrected architecture now avoids re-discovering these constraints when the standalone app is scoped.

## Links

- PRD §16 (Direct Giving Mode concept — preserved as reference)
- PRD §17 (Future Enhancements — standalone Direct Giving app)
- PRD §11.1 (OAuth Scopes — write_orders excluded from core app)
- PRD §16 (Known Limitations — Direct Giving Mode scope removal)
- Feasibility checklist item 4 (manual payment capture)
- [ADR-001](adr-001-immutable-snapshot-architecture.md) (OrderSnapshot direct_giving_mode flag needed for integration)
