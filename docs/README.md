# Docs Guide

This folder is organized by purpose rather than by a global numbering scheme.

## Start Here

- [Work Tracking Policy](work-tracking.md)
  Source-of-truth rules for GitHub Issues vs repo docs.
- [Project Instructions](project-instructions.md)
  Collaboration rules, transparency tenet, persona model, and the main reference list.
- [Current Implementation Status](current-implementation-status.md)
  Practical snapshot of what is implemented right now.
- [App Store Listing Draft](app-store-listing-draft.md)
  Working listing copy, screenshot plan, and submission disclosures draft.
- [App Store Technical Audit](app-store-technical-audit.md)
  Submission-readiness checklist with repo evidence and manual verification gaps.
- [Final Pre-Submission Review](final-pre-submission-review.md)
  Go/no-go template for the last submission readiness review.
- [PRD QA Workbook](prd-qa-workbook.md)
  Execution workbook for the full PRD QA checklist before submission.

## Product And Planning

- [PRD v2.3](prd-v2.3.md)
  Product requirements, financial model, QA checklist, and release scope.
- [Build Plan v1.2](build-plan.md)
  Phase-by-phase delivery plan and dependencies.
- [Internal API Contract](internal-api-contract.md)
  Intended API surface and response conventions.

## Active Work

GitHub Issues are authoritative for outstanding work, blockers, deferred scope, and open questions. Local planning/backlog docs that previously duplicated GitHub now live in [Archive](archive/README.md).

## Standards

- [Security Standard](standards/security.md)
- [Accessibility Standard](standards/accessibility.md)
- [Testing Standard](standards/testing.md)

These are implementation rules, not optional guidance.

## ADRs

- [ADR Index](adrs/adr-000-index.md)

ADRs keep their numbering because they are stable architectural records. Outside the ADRs, descriptive filenames are preferred over a repository-wide numeric scheme.

## Archive

- [Documentation Archive](archive/README.md)
  Historical plans, audits, and backlog documents retained for context.

## Naming Notes

- ADRs remain numbered: `ADR-001`, `ADR-002`, and so on.
- Historical phase-specific execution docs live in `docs/archive/plans/`.
- Standards live in `docs/standards/`.
- Top-level docs are reserved for the most important cross-cutting references.

## Maintenance Notes

- Prefer updating links immediately when files move or are renamed.
- Use this file as the main entry point for future documentation cleanup.
- Avoid duplicating the same guidance across multiple docs when one canonical source can be linked instead.

## Source Of Truth

When multiple docs touch the same topic, use this order of precedence:

1. GitHub Issues for open work, blockers, deferred scope, and unresolved questions.
2. ADRs for architectural decisions that explicitly change or constrain prior assumptions.
3. Standards for security, testing, accessibility, and operating rules.
4. PRD for product behavior, financial rules, and release scope.
5. Build plan for sequencing, dependencies, and phase exit criteria.
6. Current implementation status for repo reality today.
7. Archived docs for historical context only.
