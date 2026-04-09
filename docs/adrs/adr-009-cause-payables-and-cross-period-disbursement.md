# ADR-009: Cause payables and cross-period disbursement application

- Status: Accepted
- Date: April 2026

## Context

The current Phase 4 reporting model records cause allocations and disbursements against reporting periods.

That is sufficient if every period is fully paid out before the next period matters. It breaks down once unpaid cause balances are expected to roll forward:

- a merchant may close a period and disburse later
- a merchant may have multiple closed periods with unpaid balances
- the amount "still owed" to a cause becomes larger than any single period's remaining balance
- requiring disbursements to target only the latest closed period would be operationally awkward and financially misleading

At the same time, reporting periods must remain immutable for audit purposes. Once a period closes, its allocated obligation should not be rewritten just because a later payment was made.

## Decision

The app will distinguish between:

1. period-scoped obligations
2. cause-level outstanding payables
3. dated disbursement events
4. disbursement application records

### Period-scoped obligations remain immutable

`CauseAllocation` continues to represent what was owed to each cause when a reporting period was closed.

The period close output is historical truth and must not be mutated later to "move" balances between periods.

### Cause payables roll forward across periods

The merchant-facing concept of "what we still owe this cause" is not period-scoped. It is the sum of unpaid obligations across closed periods, adjusted by later disbursements and true-up effects.

The current period's payable view should therefore include outstanding balances from prior periods.

### Disbursements remain dated and period-associated

Disbursements should continue to be recorded with the real `paidAt` date and operational context.

A disbursement date occurring after the end of the period whose obligation it satisfies is acceptable and expected.

### Application ledger is the source of settlement truth

Rather than forcing the payment itself to "belong" to the historical period, the system should record how a disbursement is applied to prior obligations.

The default application rule should be FIFO against the oldest outstanding cause obligations first, unless a later ADR explicitly introduces manual reassignment.

### Prior-period outstanding balances must be visibly highlighted

The reporting UI must clearly surface overdue or prior-period unpaid cause balances.

The merchant should be able to distinguish:

- current-period allocated
- prior-period outstanding
- total current outstanding

These prior-period balances should be visually highlighted as requiring prompt disbursement.

## Consequences

### Benefits

- preserves immutable period-close reporting
- allows real-world delayed disbursement timing
- keeps the payable balance aligned with the merchant's true obligation to each cause
- supports clearer overdue / outstanding balance UX
- gives exports and audit tooling a proper settlement history to build on

### Costs

- introduces a more complex ledger model
- requires additional UI to explain outstanding balances and application order
- changes how reporting summaries and exports should be interpreted

## Follow-up implications

- Reporting should gain an `Outstanding cause payables` section.
- Exports should include both period obligations and payment applications.
- Audit log browsing should expose true-up and disbursement application behavior.
- FIFO auto-application is the starting point; merchant-adjustable application remains future work.

## Status note

This ADR establishes the intended model direction. Implementation may land incrementally, but future reporting and disbursement work should align to this structure rather than treating period remaining balances as the only source of truth.
