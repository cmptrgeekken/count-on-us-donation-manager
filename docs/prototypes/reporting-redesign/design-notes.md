# Reporting redesign working notes

## Current workflow inventory

The existing reporting route combines these jobs behind local tabs:

1. Select and close a reporting period.
2. Explain donation capacity, requested donations, retained profit, and final pool.
3. Review cause allocations and accumulated cause payables.
4. Record and edit cause disbursements and inspect receipts.
5. Review artist allocations, accumulated artist payables, and payments.
6. Calculate tax exposure and record true-ups.
7. Confirm external settlements and inspect Shopify charges.
8. Review packaging and extreme-adjustment exceptions.
9. Run analytical recalculation and compare current configuration with snapshots.
10. Export period evidence and navigate to imports/rebuilds.

The local tab state is not represented by a route, mixes period-scoped and
shop-wide concepts, and makes disbursement history appear subordinate to the
selected period even though payments can apply across multiple periods.

## Shared proposal across all prototypes

- Give disbursements/payments a shop-wide route with search, filters, evidence,
  and applications to one or more periods.
- Give period detail its own route and keep the period selector off global pages.
- Separate current obligations from completed payment history.
- Preserve a clear calculation bridge:
  net contribution → available capacity → requested donation → capped pool →
  retained profit.
- Put settlement, packaging, lifecycle, and extreme-adjustment exceptions in one
  visible review queue.
- Keep imports/rebuilds as an administrative tool, not a primary reporting page.

## Questions for refinement

1. Is the primary recurring job “pay recipients,” “close the next period,” or
   “understand financial performance”? This determines the best default page.
2. Should cause disbursements and artist payments share one payment ledger, or
   remain separate pages with a shared reporting home?
3. Should the global payment ledger include only completed payments, or use a
   debit/credit model that also shows obligations, adjustments, and running
   balances?
4. Do merchants normally pay one recipient at a time, or should the design
   prioritize a batch-payment workflow?
5. Should open-period cause commitments appear in global payables as “projected,”
   or remain hidden until the period closes?
6. Is period closure a formal review/checklist that must block on unresolved
   settlements and extreme adjustments, or should authorized merchants be able
   to close with an explicit override?
7. Which figures must be visible on the reporting home every visit? Candidates:
   final pool, retained profit, outstanding cause payables, outstanding artist
   payables, donated year-to-date, and tax reserve.
8. Should tax and diagnostics be first-class sidebar destinations, or secondary
   pages reached from a period statement and review queue?
9. Should public-transparency readiness and missing receipt evidence appear in
   the merchant's main action queue?
10. For exports, is the dominant need a period audit package, a recipient giving
    statement, an annual tax package, or a general transaction CSV?

## Prototype trade-offs

| Prototype | Best for | Main trade-off |
|---|---|---|
| A — Financial hub | Balanced overview and discoverability | More top-level pages |
| B — Action center | Merchants who return to complete operational tasks | Financial detail is one level deeper |
| C — Ledger first | Strong audit trail and payment reconciliation | Most accounting-oriented terminology |

## Decisions from the first review

- The primary recurring job is paying recipients.
- Cause disbursements and artist payments should have separate pages.
- Open-period obligations should appear as clearly labeled projections.
- Individual payment entry is sufficient; batch payments are not a priority.
- Period closure may proceed with an explicit, auditable override when reviews
  remain unresolved.
- Outstanding cause and artist payments are the highest-priority landing-page
  figures.
- The full ledger is useful only as an advanced view and should not dominate the
  default experience.
- Export design is deferred. The likely future target is a consolidated report
  of profit, costs, donation payouts, and artist payouts.
- Cause and artist payments can share a filterable history page while retaining
  separate payment workflows.
- Payments apply automatically to the oldest eligible obligations.
- Projected commitments remain prominent on the Overview but visually separate
  from payable closed-period balances.
- Recipient detail pages should explain how obligations and outstanding totals
  were calculated, not merely list transactions.

### Period-close override policy

Evidence and judgment exceptions may be overridden with a required reason and
an audit event. Examples include an unconfirmed external settlement, an extreme
allocation adjustment left at its guarded value, or low-confidence packaging.

Closing should remain impossible when the system cannot produce a coherent
financial result. Proposed hard blockers:

- reporting calculation or required rebuild is running, failed, or stale;
- an order lifecycle is unknown/review-required, so order eligibility is not
  known;
- current snapshot identity/revision data is inconsistent;
- final cause allocations do not reconcile to the donation pool;
- a period overlaps another period or has an invalid date range;
- a concurrent close/rebuild/import changed the period after review began;
- monetary rows use incompatible currencies without a resolved conversion.

These decisions are represented in `prototype-d-recommended-hybrid.html`.
