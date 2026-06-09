# Pending Questions

Archived June 2026. GitHub Issues are now authoritative for open work and unresolved questions. This document is retained for historical context.

This document previously tracked product or operational questions that were unresolved.

Resolved decisions and rationale were moved to [planning-decisions.md](./planning-decisions.md) so this file stayed easy to scan.

## Open Questions

### `#85` Printify rollout breaking-change readiness

- `#85` has a dedicated archived implementation plan in [issue-85-printify-pod-rollout-plan.md](issue-85-printify-pod-rollout-plan.md).
- Direction is now documented in:
  - [issue-85-printify-pod-rollout-plan.md](issue-85-printify-pod-rollout-plan.md)
  - [planning-decisions.md](./planning-decisions.md)
- Still to confirm:
  - the broader post-`#82` tax-reserve policy across deductible cost classes beyond the now-documented near-term POD rule

### `#61` Demo-store review scope

- Direction is documented in [planning-decisions.md](./planning-decisions.md).
- Still to confirm:
  - the exact canonical review store name/domain
  - the exact remote hosted review environment we will use

### `#62` App Store listing final fields

- Direction is documented in [planning-decisions.md](./planning-decisions.md).
- Still to confirm owner-controlled values:
  - final approved app name
  - support contact email / URL
  - privacy policy URL
  - DPA request path
  - response-time commitment wording

### `#87` / `#101` App Review compliance blockers

- Direction is partially documented in [docs/app-store-technical-audit.md](../app-store-technical-audit.md).
- Still to confirm or implement:
  - final privacy policy URL
  - final DPA request path/process
  - active app config entries for all required compliance webhook topics
  - customer data inventory for data request/redact handling
  - whether post-purchase email audit logs should retain, hash, or omit recipient email
  - how receipt uploads are represented in customer-data request/redact responses

### `#100` Managed Markets detection research

- `#100` tracks follow-up research into whether Managed Markets enablement / activation timing can be detected reliably enough for wizard automation.
- Still unresolved:
  - whether Shopify exposes a dependable Managed Markets enabled signal
  - whether Shopify exposes the original activation/apply date

### `#60` / `#63` Final review execution

- Direction is documented in [planning-decisions.md](./planning-decisions.md).
- Still to confirm:
  - the explicit primary owner for the end-to-end workbook run
  - when the workbook will actually be executed
