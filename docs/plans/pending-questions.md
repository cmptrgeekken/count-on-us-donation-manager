# Pending Questions

This document tracks product or operational questions that are still unresolved.

Resolved decisions and rationale have been moved to [docs/plans/planning-decisions.md](./planning-decisions.md) so this file stays easy to scan.

## Open Questions

### `#85` Printify rollout breaking-change readiness

- `#85` has a dedicated implementation plan in [docs/plans/issue-85-printify-pod-rollout-plan.md](issue-85-printify-pod-rollout-plan.md).
- Still to confirm:
  - whether disconnecting a provider should remove mappings/cache immediately or preserve historical linkage
  - whether manual sync is enough for the first tranche or whether scheduled sync must land in the same issue
  - whether unmapped provider variants should silently fall back to manual cost config or raise a stronger merchant warning
  - whether POD becomes reviewer-facing immediately after `#85`, or only after follow-on storefront/doc hardening
  - how we want to handle Printify credentials that can access multiple provider shops:
    - automatically bind to the first accessible shop for the first tranche
    - prompt the merchant to choose one shop before mapping/sync
    - or allow syncing multiple Printify shops into one Shopify shop
  - how we want to treat Printify product costs that arrive as cents without an explicit currency field:
    - assume shop currency for first-tranche estimates
    - hard-code USD until provider evidence says otherwise
    - or introduce provider-currency handling before POD costs are considered production-ready

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
