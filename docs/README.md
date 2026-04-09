# Docs Guide

This folder is organized by purpose rather than by a global numbering scheme.

## Start Here

- [Project Instructions](project-instructions.md)
  Collaboration rules, transparency tenet, persona model, and the main reference list.
- [Current Implementation Status](current-implementation-status.md)
  Practical snapshot of what is implemented right now.
- [App Store Listing Draft](app-store-listing-draft.md)
  Working listing copy, screenshot plan, and submission disclosures draft.

## Product And Planning

- [PRD v2.3](prd-v2.3.md)
  Product requirements, financial model, QA checklist, and release scope.
- [Build Plan v1.2](build-plan.md)
  Phase-by-phase delivery plan and dependencies.
- [Internal API Contract](internal-api-contract.md)
  Intended API surface and response conventions.
- [Implementation Backlog](implementation-backlog.md)
  Proposed updates, amendments, and follow-up work identified during development.

## Phase Plans

- [Phase 1 Foundation Spec](plans/phase-1-foundation-spec.md)
- [Phase 2 Implementation Plan](plans/phase-2-implementation-plan.md)
- [Phase 3 Implementation Plan](plans/phase-3-implementation-plan.md)

Use these when planning or validating work within a specific phase.

## Standards

- [Security Standard](standards/security.md)
- [Accessibility Standard](standards/accessibility.md)
- [Testing Standard](standards/testing.md)

These are implementation rules, not optional guidance.

## ADRs

- [ADR Index](adrs/adr-000-index.md)

ADRs keep their numbering because they are stable architectural records. Outside the ADRs, descriptive filenames are preferred over a repository-wide numeric scheme.

## Naming Notes

- ADRs remain numbered: `ADR-001`, `ADR-002`, and so on.
- Phase-specific execution docs live in `docs/plans/`.
- Standards live in `docs/standards/`.
- Top-level docs are reserved for the most important cross-cutting references.

## Maintenance Notes

- Prefer updating links immediately when files move or are renamed.
- Use this file as the main entry point for future documentation cleanup.
- Avoid duplicating the same guidance across multiple docs when one canonical source can be linked instead.

## Source Of Truth

When multiple docs touch the same topic, use this order of precedence:

1. ADRs for architectural decisions that explicitly change or constrain prior assumptions.
2. PRD for product behavior, financial rules, and release scope.
3. Build plan for sequencing, dependencies, and phase exit criteria.
4. Phase plans/specs for execution detail within a specific phase.
5. Current implementation status for repo reality today.
6. Implementation backlog for follow-up ideas that are not yet canonical.
