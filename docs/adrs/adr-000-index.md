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
| [ADR-012](adr-012-public-financial-disclosure-boundaries.md) | Public financial disclosure boundaries | Accepted | April 2026 |
| [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md) | Artist collaboration product attribution and payouts | Proposed | May 2026 |
| [ADR-014](adr-014-artist-submission-storefront-widget.md) | Artist submission storefront widget | Proposed | May 2026 |
| [ADR-015](adr-015-dedicated-admin-web-experience.md) | Dedicated admin web experience | Proposed | May 2026 |
| [ADR-016](adr-016-vps-deployment-and-ci-cd-strategy.md) | Single-server Docker deployment and CI/CD strategy | Proposed | June 2026 |
| [ADR-017](adr-017-outsourced-production-costs.md) | Outsourced production costs | Proposed | June 2026 |
| [ADR-018](adr-018-production-cost-model-expansion.md) | Production cost model expansion candidates | Proposed | June 2026 |
| [ADR-019](adr-019-merchant-triggered-historical-backfill.md) | Merchant-triggered historical backfill | Proposed | June 2026 |
| [ADR-020](adr-020-contextual-creation-and-template-promotion.md) | Contextual creation and template promotion | Proposed | June 2026 |
| [ADR-021](adr-021-shop-capability-feature-flags.md) | Shop capability feature flags | Proposed | July 2026 |
| [ADR-022](adr-022-equipment-component-costing.md) | Equipment component costing | Proposed | July 2026 |
| [ADR-023](adr-023-external-marketplace-settlements.md) | External marketplace settlement review | Proposed | July 2026 |

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
ADR-012 (Public financial disclosure boundaries) - extends ADR-001, ADR-002, ADR-003, ADR-008, ADR-009, and ADR-011 for public payout/reconciliation summaries
ADR-013 (Artist collaboration product attribution and payouts) - extends ADR-001, ADR-002, ADR-008, ADR-009, and ADR-012 for artist-routed products and artist payables
ADR-014 (Artist submission storefront widget) - extends ADR-004, ADR-012, and ADR-013 for storefront artist intake and upload handling
ADR-015 (Dedicated admin web experience) - extends ADR-001, ADR-003, ADR-004, ADR-010, ADR-012, ADR-013, and ADR-014 for a custom admin shell and shop-scoped capability configuration
ADR-016 (Single-server Docker deployment and CI/CD strategy) - extends ADR-001, ADR-004, ADR-007, ADR-010, ADR-012, and ADR-015 for low-cost Proxmox/VPS hosting, Docker Compose production deployment, network-isolated containers, object storage, and staged GitHub Actions CI/CD
ADR-017 (Outsourced production costs) - extends ADR-003, ADR-010, and ADR-013 for manual third-party production costs, variant-level production economics, and future variant donation override implications
ADR-018 (Production cost model expansion candidates) - extends ADR-001, ADR-003, and ADR-017 for equipment-rate breakdowns, scrap/waste, batch/setup costs, indirect supplies, and optional overhead allocation
ADR-019 (Merchant-triggered historical backfill) - extends ADR-001, ADR-002, ADR-003, ADR-006, ADR-009, and ADR-012 for explicit owner-controlled historical imports and reporting regeneration using current Count On Us configuration
ADR-020 (Contextual creation and template promotion) - extends ADR-003, ADR-008, ADR-013, ADR-015, and ADR-018 for inline creation of related library/configuration records and creating reusable templates from effective variant cost configuration
ADR-021 (Shop capability feature flags) - extends ADR-003, ADR-010, ADR-015, ADR-018, and ADR-020 for merchant-facing shop capability toggles that suppress optional package/provider workflows without deleting historical data
ADR-022 (Equipment component costing) - extends ADR-001, ADR-003, ADR-008, ADR-018, and ADR-020 for calculated equipment hourly/per-use rates from electricity, depreciation, consumables, maintenance, and manual overrides
ADR-023 (External marketplace settlement review) - extends ADR-002, ADR-006, ADR-009, ADR-012, and ADR-019 for orders paid outside Shopify, merchant-reviewed external payouts, marketplace fee treatment, and period close safeguards
```

## Conventions

- One file per ADR, named `adr-NNN-short-slug.md`
- Status values: `Proposed` | `Accepted` | `Superseded by ADR-NNN` | `Removed from core app` | `Deprecated`
- ADRs are never deleted; if a decision changes, the original ADR is marked superseded and a new ADR records the new decision
- The PRD references ADRs by number (for example, "See ADR-001"); keep slugs and numbers stable

## Related documents

- [Docs guide](../README.md)
- [PRD v2.3](../prd-v2.3.md)
- [Build Plan v1.2](../build-plan.md)
- Feasibility checklist (inline in session notes - to be extracted)
