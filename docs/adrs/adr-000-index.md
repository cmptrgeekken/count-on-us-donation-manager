# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Shopify Donation Manager core app. ADRs record significant architectural decisions, the context that led to them, and the consequences of making them. They are append-only — superseded decisions are marked as such rather than deleted.

## Index

| **ADR** | **Title** | **Status** | **Date** |
| --- | --- | --- | --- |
| [ADR-001](adr-001-immutable-snapshot-architecture.md) | Immutable order snapshot architecture | Accepted | March 2026 |
| [ADR-002](adr-002-dual-track-financial-model.md) | Dual-track financial model | Accepted | March 2026 |
| [ADR-003](adr-003-cost-resolution-strategy.md) | Cost resolution strategy | Accepted | March 2026 |
| [ADR-004](adr-004-storefront-widget-data-delivery.md) | Storefront widget data delivery | Accepted | March 2026 |
| [ADR-005](adr-005-direct-giving-mode.md) | Direct Giving Mode — scope removal and standalone app architecture | Removed from core app / Standalone app (future) | March 2026 |
| [ADR-006](adr-006-bulk-migration-removal.md) | Bulk migration removal and reconciliation scope reduction | Accepted | March 2026 |

## Dependencies

```
ADR-001 (Immutable snapshot)
  └── ADR-002 (Dual-track financial model)
        └── ADR-003 (Cost resolution strategy)
              └── ADR-004 (Storefront widget data delivery)
                    └── ADR-005 (Direct Giving Mode)

ADR-006 (Bulk migration removal) — no chain dependency; supersedes PRD §11.6 and Build Plan §3.9
```

## Conventions

- One file per ADR, named `adr-NNN-short-slug.md`
- Status values: `Accepted` | `Superseded by ADR-NNN` | `Removed from core app` | `Deprecated`
- ADRs are never deleted — if a decision changes, the original ADR is marked superseded and a new ADR records the new decision
- The PRD references ADRs by number (e.g. "See ADR-001") — keep slugs and numbers stable

## Related documents

- [PRD v2.3](../shopify_donation_manager_prd_v2-3.md)
- Feasibility checklist (inline in session notes — to be extracted)
