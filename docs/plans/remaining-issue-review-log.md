# Remaining Issue Review Log

This document tracks the multi-issue implementation pass after the Phase 4 reporting core landed.
Each section is meant to give a compact review summary, automated/manual test focus, and any follow-up questions.

## Working Order

1. `#69` Standardize admin auth helper usage across app routes
2. `#70` Standardize Decimal parsing for monetary form inputs
3. `#52` Add audit log browsing UI
4. `#50` Add analytical recalculation delta view
5. Remaining issues to follow in priority order after the cleanup tranche

## Issue `#69` Review Notes

### Summary

- Replace remaining `/app/*` route uses of `authenticate.admin(...)` with `authenticateAdminRequest(...)`.
- Keep Shopify admin access only where it is actually needed, with explicit fallback behavior for local fixture mode.

### Files

- `app/routes/app._index.tsx`
- `app/routes/app.dashboard.tsx`
- `app/routes/app.provider-connections.tsx`
- `app/routes/app.settings.tsx`
- `app/utils/admin-auth.server.test.ts`

### Test Cases For Review

#### Automated

- `admin-auth.server.test.ts`
  - local Playwright bypass returns a synthetic session and skips Shopify admin auth
  - normal requests still call through to Shopify admin auth
- full `npm test`
  - regression coverage stays green after the route auth swap

#### Manual

- Open Dashboard, Settings, and Provider Connections through the embedded admin.
- Confirm the app root still redirects to Dashboard.
- In local fixture mode, confirm Settings still loads and the refresh-currency action fails gracefully instead of crashing.

## Issue `#70` Review Notes

### Summary

- Remove the remaining money-related `parseFloat(...)` writes from Variant configuration actions.
- Standardize labor rate and mistake buffer writes onto shared Decimal-based parsing helpers.

### Files

- `app/routes/app.variants.$variantId.tsx`
- `app/utils/money-parsing.ts`
- `app/utils/money-parsing.test.ts`

### Test Cases For Review

#### Automated

- `money-parsing.test.ts`
  - optional percent parsing returns `null` for blank input
  - optional percent parsing stores rounded four-decimal rates for percent inputs
- full `npm test`
  - existing reporting, receipt, export, and parser coverage remains green after the Decimal parsing cleanup

#### Manual

- On a Variant detail page:
  - update labor minutes and labor rate
  - update mistake buffer
  - save and reload
  - confirm values persist and display correctly
- Try invalid values:
  - negative labor rate
  - mistake buffer over `100`
  - invalid numeric text
  - confirm user-facing validation remains intact

## Pending Questions

- `#45` appears functionally complete in code and tests already. It may only need issue/status cleanup unless you want an additional merchant-facing charge-sync control surface.

## Issue `#52` Review Notes

### Summary

- Add a merchant-facing audit log page under `/app/audit-log`.
- Link it from Settings and the embedded admin nav.
- Support reverse-chronological browsing, event-type filtering, date filtering, payload inspection, and pagination.

### Files

- `app/routes/app.audit-log.tsx`
- `app/routes/app.settings.tsx`
- `app/routes/app.tsx`
- `app/routes/ui-fixtures.audit-log-bootstrap.tsx`
- `app/utils/audit-log.ts`
- `app/utils/audit-log.test.ts`
- `tests\ui\audit-log-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `audit-log.test.ts`
  - normalizes event/date filters safely
  - formats payloads and date boundaries consistently
- full `npm test`
  - regression coverage stays green with the audit helpers added

#### Manual

- Open Audit Log from Settings.
- Confirm newest events appear first.
- Filter by event type and verify rows narrow correctly.
- Filter by date range and verify rows narrow correctly.
- Open a payload block and confirm before/after details are readable.
- Navigate to the next page when more than one page of logs exists.

## Issue `#50` Review Notes

### Summary

- Add asynchronous analytical recalculation runs for reporting periods.
- Persist run status/results separately from authoritative reporting data.
- Show merchant-facing analytical-only deltas for period totals and cause allocations.

### Files

- `prisma/schema.prisma`
- `prisma/migrations/20260409030000_issue50_analytical_recalculation_runs/migration.sql`
- `app/services/analyticalRecalculation.server.ts`
- `app/services/analyticalRecalculation.server.test.ts`
- `app/jobs/processors.server.ts`
- `app/jobs/processors.server.test.ts`
- `app/routes/app.reporting.tsx`
- `app/routes/ui-fixtures.reporting-bootstrap.tsx`
- `tests/ui/reporting-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `analyticalRecalculation.server.test.ts`
  - queuing creates a run and audit event
  - summary calculation produces period/cause deltas
  - analytical recalculation does not mutate snapshots, allocations, or disbursements
  - worker completion persists a completed summary
- `processors.server.test.ts`
  - reporting recalculation queue jobs invoke the analytical service
- full `npm test`
  - regression coverage remains green with the new reporting worker/service

#### Manual

- On Reporting, click `Run recalculation` for a period.
- Confirm the page clearly labels the results as analytical-only.
- While a run is pending, confirm the status banner indicates refresh/polling behavior.
- After completion, confirm period deltas and per-cause deltas are visible.
- Verify authoritative period figures elsewhere on the page do not change after the analytical run.
