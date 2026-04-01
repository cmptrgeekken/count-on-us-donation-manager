# ADR-002: Dual-track financial model

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | March 2026 |
| **Depends on** | ADR-001 |

## Context

The app must answer two fundamentally different financial questions from the same underlying business activity:

1. **Donation pool question:** after all production costs, what net revenue is available to donate this period?
2. **Tax estimation question:** given deductible business expenses and charitable giving, what portion of net sales is likely taxable income?

These questions require different cost inputs, operate on different time horizons, and produce outputs that serve different purposes. Attempting to answer both from a single cost track produces either an inflated donation pool (if tax deductions are applied directly) or an inaccurate tax estimate (if only per-order costs are used).

## Decision

The app maintains two strictly separated financial tracks. They share no inputs. Their outputs never feed into each other's calculations — with one controlled exception: the Track 2 tax reserve total may be deducted from the Track 1 donation pool as a line item, but no Track 2 input cost crosses into Track 1.

### Track 1 — Donation pool

| Property | Detail |
| --- | --- |
| **Purpose** | Net revenue available to donate after true production costs |
| **Cost inputs** | Per-order variant costs only: materials, labor, equipment, packaging, Shopify fees, POD costs |
| **Timing** | Per-order, frozen in snapshot at order time |
| **Output** | net_contribution → donation pool → cause allocations |
| **Explicitly excluded** | Business Expenses entries. 501(c)3 allocations. Track 2 input costs. |

### Track 2 — Tax estimation

| Property | Detail |
| --- | --- |
| **Purpose** | Estimate taxable income to reserve funds before over-donating |
| **Cost inputs** | Business Expenses page entries: COGS purchases, subscriptions, equipment, professional services. Plus 501(c)3 allocations. |
| **Timing** | Period-level, entered manually by merchant. Cash-basis only in v1. |
| **Output** | deduction_pool → taxable_exposure → tax_reserve |
| **Explicitly excluded** | Per-order material, labor, equipment, and packaging costs. These belong exclusively to Track 1. |

## On the apparent double-counting

> **Note for accountants reviewing this design**
>
> A reviewer may observe that a material purchase (e.g. $500 of sticker paper) appears to affect both tracks: per-order material costs reduce the donation pool on Track 1, while the $500 cash purchase is entered on the Business Expenses page and reduces taxable exposure on Track 2. This is not double-counting. The two tracks answer different questions and their outputs never interact.

Track 1 uses per-order consumption costs to measure the true cost of production. Track 2 uses cash-basis purchase costs to estimate tax deductibility. A business simultaneously tracks COGS per unit sold (Track 1) and deductible purchases per period (Track 2) — these are standard accounting concepts that coexist without conflict.

### Worked example

$500 sticker paper purchase, 1,000 stickers sold at $2.00 each:

| | |
| --- | --- |
| Track 1: per-order material cost (1,000 × $0.0125) | $12.50 deducted from donation pool |
| Track 2: cash purchase entered on Business Expenses | $500 added to deduction pool |
| Track 1 donation pool (simplified) | $2,000 − $12.50 = $1,987.50 |
| Track 2 taxable exposure | $2,000 − $500 deductions = $1,500 |
| Track 2 tax reserve (at 25%) | $1,500 × 25% = $375 |
| Final donation pool after tax reserve deduction | $1,987.50 − $375 = $1,612.50 |

The $500 and the $12.50 are not the same cost viewed twice. The $12.50 is consumed inventory value for the period. The $500 is the cash outlay for the full purchase. A merchant who bought 10,000 sheets but sold nothing this period would show $0 on Track 1 and $500 on Track 2 — correctly reflecting that they spent $500 in cash but incurred no production cost this period.

## Known limitation — cash-basis only in v1

Track 2 is designed for cash-basis accounting only. Under cash basis, a merchant deducts the full cost of a material purchase in the period it is paid, regardless of how much inventory is consumed that period. This is the correct default for most small businesses.

Accrual-basis merchants deduct material costs only when the corresponding inventory is sold. For these merchants, the correct Track 2 deduction would be derived from actual per-order consumption data — which is precisely what Track 1 calculates. Full accrual support would therefore require Track 2 to consume Track 1 outputs as an input — a controlled violation of the strict track separation this architecture enforces. This is a non-trivial change deferred to a future version.

**v1 behaviour:**

- Cash-basis accounting is assumed. Disclosed in the app's tax disclaimer and on the Business Expenses page.
- Accrual-basis merchants will get incorrect tax estimates if they enter full purchase amounts on the Business Expenses page. The COGS adjustment sub-type exists as a partial workaround — merchants can enter only the consumed portion manually — but the app cannot calculate this automatically in v1.
- Full accrual-basis support requires: a per-merchant accounting basis setting, Track 1 consumption totals feeding Track 2 deduction pool under accrual mode, and suppression of the Inventory & Materials category on the Business Expenses page for accrual merchants to prevent double-entry. See PRD §17.

## Enforcement rules

- No Business Expenses entry ever reduces the donation pool directly.
- No per-order material, labor, equipment, or packaging cost ever appears in the deduction pool or tax estimation calculation.
- Only the Track 2 tax reserve total may cross into Track 1 — as a line-item deduction from the donation pool. No Track 2 input cost crosses.
- Only 501(c)3 cause allocations contribute to the deduction pool. Non-501(c)3 donations are excluded.
- The reporting dashboard must display Track 1 and Track 2 figures in strictly separate sections. This is a UI-level enforcement of the architectural separation.

## Consequences

### Benefits

- No double-counting risk by design — the schema makes it structurally impossible to use a cost in both tracks simultaneously.
- Donation pool reflects true production economics.
- Tax estimation reflects real cash-basis deductibility.
- Each track can be audited independently.
- Track 2 is entirely optional — merchants who don't use tax estimation are unaffected.

### Costs

- More complex mental model for merchants — the app must clearly explain why material costs appear in two places.
- Reporting UI must enforce strict visual separation to avoid confusion.
- Onboarding must distinguish entering a material purchase on Business Expenses vs configuring per-order costs in cost templates.
- Cash-basis assumption excludes accrual-basis merchants from accurate tax estimation in v1.

## Alternatives considered

**Single unified cost track** — Rejected. Per-order consumption costs and cash-basis purchase costs are different accounting concepts. A single track cannot correctly answer both questions. A merchant who buys $500 of materials but sells nothing that period still has a $500 deductible expense — a per-order model would show $0.

**Business Expenses entries also reduce the donation pool** — Rejected. Per-order material costs already reduce the donation pool. Applying the cash purchase on top would double-count the same economic value and systematically understate donations.

**Omit tax estimation entirely** — Rejected. Without tax estimation, merchants risk over-donating before their tax liability is known. Reserving for taxes before disbursing is essential to the "maximise donation potential" design principle.

**Support accrual basis in v1** — Rejected for v1. Accrual support requires Track 2 to consume Track 1 outputs, which violates the track separation principle and adds significant complexity. Deferred to v2. Cash-basis covers the majority of the target merchant base.

## Links

- PRD §4.1 (Donation Pool Formula)
- PRD §4.6 (Estimated Tax Reserve)
- PRD §9.4 (Business Expenses)
- PRD §17 (Future Enhancements — accrual-basis tax estimation)
- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-003](adr-003-cost-resolution-strategy.md)
