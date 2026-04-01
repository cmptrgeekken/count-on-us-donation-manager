# ADR-006: Bulk migration removal and reconciliation scope reduction

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | March 2026 |
| **Deciders** | Product, Engineering |
| **Supersedes** | PRD §11.6 (Bulk Migration on Install), Build Plan §3.9 |

## Context

PRD §11.6 specifies a bulk migration that runs on install, importing all historical orders as reconciliation-originated snapshots using the Shopify Bulk Operations API. This design requires the `read_all_orders` scope, which needs explicit Partner Dashboard approval from Shopify before it can be used on non-development stores.

During Partner Dashboard setup, it became clear that `read_all_orders` requires a specific approval request with written justification — an unpredictable dependency that was already flagged in the build plan as a hard launch blocker. This prompted a re-examination of whether the bulk migration is worth that dependency.

### The core problem with historical order snapshots

Historical orders predate the app's installation. By definition they have no:

- Cause assignments — the merchant had not yet configured which causes their products donate to
- Cost configuration — no materials, equipment, labor, or packaging costs are defined
- Charitable intent — the merchant had not yet committed to donating a portion of those sales

Retroactively applying current cost and cause configuration to historical orders would produce snapshots that are inaccurate by design. The cost figures would reflect current config, not order-time config. ADR-001 already acknowledges this as a known limitation of reconciliation-originated snapshots ("reconciliation snapshots use current config — a known and disclosed limitation"). For bulk migration specifically, the limitation is more severe: the config simply did not exist at order time.

The resulting donation pool from historical orders would be financially meaningless — it would not reflect money the merchant actually set aside for charity, and any figures produced would be misleading to charity partners and auditors. This conflicts directly with the transparency tenet.

### The reconciliation job is still needed — but with a narrow scope

The daily reconciliation job (§3.7) exists to catch orders that were missed by the webhook handler due to delivery failures or downtime. This is a legitimate and necessary function. However, it only needs to look back a short window — missed webhooks are a recency problem, not a historical data problem. A 7-day lookback window is sufficient to catch any realistic webhook failure scenario and falls entirely within the standard `read_orders` 60-day window. No special scope approval is required.

## Decision

1. **Remove the bulk migration on install entirely.** No historical orders are imported on install. The app's financial records begin at the point of installation and configuration.

2. **Redefine the reconciliation job as a short-window missed-webhook catcher.** `ReconciliationService` looks back a maximum of 7 days. This is sufficient to catch any realistic webhook delivery failure and requires only `read_orders`, which is already in the scope list.

3. **Remove `read_all_orders` from the OAuth scope list.** It is no longer required for any function the app performs. This reduces the scope footprint presented to merchants at install time.

4. **The merchant onboarding story is "starts fresh."** Count On Us tracks donations from the moment the merchant configures it. The first reporting period reflects only orders placed after installation and cost/cause configuration is complete. This is communicated clearly in the onboarding wizard.

## Consequences

### Benefits

- `read_all_orders` Partner Dashboard approval is no longer required — removes a hard launch dependency with unpredictable timeline.
- Fewer OAuth scopes at install time — merchants see a smaller, more focused permission list, which improves trust and reduces install abandonment.
- No misleading historical donation figures — charity partners and auditors see only data that reflects genuine charitable intent and accurate cost configuration.
- Simpler install flow — no bulk migration progress indicator, no access token refresh handling for long-running jobs, no migration resumption logic.
- Consistent with the transparency tenet — every figure in the donation ledger is traceable to a real order placed after the merchant committed to the donation model.

### Costs

- Merchants with existing stores start with an empty donation history. This is a UX consideration to address in onboarding copy — not a technical problem.
- The reconciliation job's 7-day window means orders missed more than 7 days ago will not be automatically recovered. Manual snapshot creation via the admin UI (already specced) remains available for edge cases.

### No impact on

- The snapshot architecture (ADR-001) — snapshots remain immutable and self-contained.
- The dual-track financial model (ADR-002) — Track 1 and Track 2 separation is unchanged.
- The reconciliation origin flag on `OrderSnapshot` — snapshots created by the reconciliation job are still flagged as reconciliation-originated, for transparency in the Order History UI.

## Document changes required

The following documents must be updated to reflect this decision:

| Document | Section | Change |
| --- | --- | --- |
| PRD v2.2 | §11.1 scope table | Remove `read_all_orders` row |
| PRD v2.2 | §11.6 | Replace bulk migration spec with "not implemented — see ADR-006" |
| PRD v2.2 | §13.5 webhook config | Remove `read_all_orders` from webhook toml example if present |
| PRD v2.2 | §13.6 access token management | Remove — was written exclusively for long-running bulk migration |
| PRD v2.2 | §18 QA checklist | Remove bulk migration checklist items |
| Build Plan v1.0 | Pre-build actions table | Remove `read_all_orders` approval row |
| Build Plan v1.0 | §3.9 | Remove bulk migration section entirely |
| Build Plan v1.0 | §3.7 | Update reconciliation to 7-day lookback, remove `read_all_orders` reference |
| Build Plan v1.0 | Phase 6 exit criteria | Remove `read_all_orders` approval confirmation item |
| API Contract | §18 webhooks | No change — `orders/create` handler stub unchanged |

## Alternatives considered

**Keep bulk migration, accept the `read_all_orders` dependency** — Rejected. The figures produced are inaccurate and potentially misleading. Launching with a misleading historical donation pool conflicts with the transparency tenet regardless of the disclosure. The dependency risk is secondary to the data quality problem.

**Keep bulk migration but only for orders within 60 days of install** — Rejected. The same accuracy problem applies. Orders within the last 60 days also predate the merchant's cost and cause configuration. The cutoff is arbitrary and the figures are still inaccurate.

**Allow merchant to manually trigger a historical import with explicit accuracy disclaimer** — Rejected for v1. This could be revisited in v2 as an opt-in feature with explicit per-order cost override UI, but the complexity is out of scope and the use case is niche.

**Extend reconciliation lookback beyond 7 days** — Rejected. A longer lookback does not improve accuracy and creates a larger API surface than necessary. 7 days is the right balance between resilience and minimal scope.

## Links

- PRD §11.6 (Bulk Migration on Install — superseded)
- PRD §11.1 (OAuth Scopes — `read_all_orders` removed)
- Build Plan §3.7 (Daily reconciliation — updated)
- Build Plan §3.9 (Bulk migration on install — removed)
- [ADR-001](adr-001-immutable-snapshot-architecture.md) — reconciliation-originated snapshot flag preserved
- [ADR-005](adr-005-direct-giving-mode.md) — prior example of scope reduction for trust and risk reasons
