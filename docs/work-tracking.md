# Work Tracking Policy

GitHub Issues are the source of truth for outstanding work.

Use GitHub Issues for:

- bugs
- open product questions
- App Store blockers
- follow-up implementation work
- deferred or de-scoped requirements
- review findings that still need a decision or fix

Use repo docs for:

- durable architectural decisions in ADRs
- standards and operating rules
- current implementation snapshots
- release, deployment, seed, QA, and review guides
- historical planning material in `docs/archive/`

If a repo doc describes future work, it should link to the GitHub issue that owns that work. Avoid adding new local backlog lists unless they are temporary migration notes and have an explicit cleanup path.

## Prominence Rules

Prominent docs should answer one of these questions:

- What is true in the repo now?
- What rule or standard should contributors follow?
- What operational process needs to be executed?
- What durable decision constrains future work?

Historical docs should live in `docs/archive/` when they answer:

- What did we consider earlier?
- How did a completed phase get planned?
- What backlog existed before GitHub Issues became authoritative?
- What audit or review snapshot has been superseded?

## Issue Hygiene

Preferred issue shape:

- one concrete outcome per issue
- acceptance criteria in the issue body
- links to any supporting ADR, standard, or archived plan
- close the issue when the work is done, even if follow-up ideas remain
- create a new follow-up issue instead of reopening an old completed plan

Recommended labels:

- `blocker`
- `app-store`
- `compliance`
- `bug`
- `enhancement`
- `docs`
- `research`
- `deferred`
- `post-v1`
