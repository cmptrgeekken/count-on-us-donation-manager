# ADR-008: Financial precision policy

**Status:** Accepted  
**Date:** April 2026

## Context

The application mixes several kinds of numeric values:

- merchant-entered money values such as purchase price, hourly rate, disbursements, expenses, and tax true-ups
- percentage and rate inputs such as Shopify payment rate and mistake buffer
- operational quantities such as purchase quantity, yield, uses, minutes, and weight
- internally derived cost-basis and allocation values used during snapshotting, allocation, and adjustment workflows

Over time, some routes started parsing persisted monetary inputs through JavaScript `number` / `parseFloat`, while parts of the schema retained higher-precision decimal columns for internal math. This created ambiguity about where two-decimal currency rules should apply and where higher precision is intentional.

## Decision

The system distinguishes between two numeric classes:

### 1. Posted / merchant-entered money

These values are normalized to **two decimal places** at write time using `Prisma.Decimal`:

- purchase price
- hourly rate
- per-use cost
- equipment cost
- default labor rate
- business expenses
- disbursements
- Shopify charges
- tax true-up values
- storefront-facing totals that represent money paid or owed

These values may be stored in schema columns with scale greater than 2 in some legacy or transitional cases, but the application must still normalize them to cents before persistence.

### 2. Operational or internal precision values

These values may retain **more than two decimal places** where precision is useful for costing or allocation math:

- purchase quantity
- per-unit cost
- minutes
- weight in grams
- snapshot cost-basis line items
- internal allocation and adjustment math

These values are allowed to use higher precision in both code and schema so the system can avoid cumulative rounding drift during cost resolution, snapshot creation, and financial adjustments.

### 3. Whole-number operational counts

These values represent discrete units and must be validated as **whole numbers**:

- `yield`, when it represents discrete finished units produced from one purchase unit
- `usesPerVariant`, when it represents discrete consumptions/applications per variant
- other discrete count fields already governed by integer-only validation and DB constraints

For this project, `yield` is defined as discrete finished units, so it belongs in this category rather than the high-precision operational category.

## Consequences

- Routes must not use JavaScript `number` / `parseFloat` when persisting merchant-entered money.
- Money parsing should use shared `Prisma.Decimal` helpers and normalize to two decimals before DB writes.
- Operational quantities and internal cost-basis math may continue to use 3-6 decimal places where the schema and business rules require it.
- Discrete operational counts such as `yield` and `usesPerVariant` must be enforced as whole numbers in both route validation and database constraints.
- Display formatting alone is not sufficient; posted money precision must be enforced at write time.
- Future schema changes should evaluate whether a field is:
  - a posted money value, or
  - an operational/internal precision value

## Notes

- This ADR clarifies policy; it does not require an immediate schema rewrite of every historical decimal column.
- Where money columns currently use scale > 2, application-level normalization remains the source of truth unless and until a later migration narrows the schema.
