# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Shopify Donation Manager core app. ADRs record significant architectural decisions, the context that led to them, and the consequences of making them. They are append-only; superseded decisions are marked as such rather than deleted.

## Index

| **ADR** | **Title** | **Status** | **Date** |
| --- | --- | --- | --- |
| [ADR-001](adr-001-immutable-snapshot-architecture.md) | Immutable order snapshot architecture | Accepted | March 2026 |
| [ADR-002](adr-002-dual-track-financial-model.md) | Dual-track financial model | Accepted | March 2026 |
| [ADR-003](adr-003-cost-resolution-strategy.md) | Cost resolution strategy | Accepted | March 2026 |
| [ADR-004](adr-004-storefront-widget-data-delivery.md) | Storefront widget data delivery | Accepted | March 2026 |
| [ADR-005](adr-005-direct-giving-mode.md) | Direct Giving Mode - scope removal and standalone app architecture | Removed from core app / Standalone app (future) | March 2026 |
| [ADR-006](adr-006-bulk-migration-removal.md) | Bulk migration removal and reconciliation scope reduction | Accepted | March 2026 |
| [ADR-007](adr-007-receipt-storage-strategy.md) | Receipt storage strategy for disbursements | Accepted | April 2026 |
| [ADR-008](adr-008-financial-precision-policy.md) | Financial precision policy | Accepted | April 2026 |
| [ADR-009](adr-009-cause-payables-and-cross-period-disbursement.md) | Cause payables and cross-period disbursement application | Accepted | April 2026 |
| [ADR-010](adr-010-provider-rollout-strategy.md) | Provider rollout strategy and provider-neutral integration seams | Accepted | April 2026 |
| [ADR-011](adr-011-marketing-attribution-transparency.md) | Marketing attribution and customer-facing transparency | Accepted | April 2026 |

## Dependencies

```text
ADR-001 (Immutable snapshot)
  -> ADR-002 (Dual-track financial model)
     -> ADR-003 (Cost resolution strategy)
        -> ADR-004 (Storefront widget data delivery)
           -> ADR-005 (Direct Giving Mode)

ADR-006 (Bulk migration removal) - no chain dependency; supersedes PRD section 11.6 and Build Plan section 3.9
ADR-010 (Provider rollout strategy) - guides provider work after ADR-003 and ADR-004 without replacing them
ADR-011 (Marketing attribution transparency) - extends ADR-003, ADR-004, ADR-009, and ADR-010 for acquisition-cost disclosure
```

## Conventions

- One file per ADR, named `adr-NNN-short-slug.md`
- Status values: `Accepted` | `Superseded by ADR-NNN` | `Removed from core app` | `Deprecated`
- ADRs are never deleted; if a decision changes, the original ADR is marked superseded and a new ADR records the new decision
- The PRD references ADRs by number (for example, "See ADR-001"); keep slugs and numbers stable

## Related documents

- [Docs guide](../README.md)
- [PRD v2.3](../prd-v2.3.md)
- [Build Plan v1.2](../build-plan.md)
- Feasibility checklist (inline in session notes - to be extracted)
