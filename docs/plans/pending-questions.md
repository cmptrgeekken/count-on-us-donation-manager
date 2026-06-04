# Pending Questions

This document tracks product or operational questions that are still unresolved.

Resolved decisions and rationale have been moved to [docs/plans/planning-decisions.md](./planning-decisions.md) so this file stays easy to scan.

## Open Questions

### `#85` Printify rollout breaking-change readiness

- `#85` has a dedicated implementation plan in [docs/plans/issue-85-printify-pod-rollout-plan.md](issue-85-printify-pod-rollout-plan.md).
- Direction is now documented in:
  - [docs/plans/issue-85-printify-pod-rollout-plan.md](issue-85-printify-pod-rollout-plan.md)
  - [docs/plans/planning-decisions.md](./planning-decisions.md)
- Still to confirm:
  - the broader post-`#82` tax-reserve policy across deductible cost classes beyond the now-documented near-term POD rule

### `#61` Demo-store review scope

- Direction is documented in [docs/plans/planning-decisions.md](./planning-decisions.md).
- Still to confirm:
  - the exact canonical review store name/domain
  - the exact remote hosted review environment we will use

### `#62` App Store listing final fields

- Direction is documented in [docs/plans/planning-decisions.md](./planning-decisions.md).
- Still to confirm owner-controlled values:
  - final approved app name
  - support contact email / URL
  - privacy policy URL
  - DPA request path
  - response-time commitment wording

### `#100` Managed Markets detection research

- `#100` tracks follow-up research into whether Managed Markets enablement / activation timing can be detected reliably enough for wizard automation.
- Still unresolved:
  - whether Shopify exposes a dependable Managed Markets enabled signal
  - whether Shopify exposes the original activation/apply date

### `#60` / `#63` Final review execution

- Direction is documented in [docs/plans/planning-decisions.md](./planning-decisions.md).
- Still to confirm:
  - the explicit primary owner for the end-to-end workbook run
  - when the workbook will actually be executed
