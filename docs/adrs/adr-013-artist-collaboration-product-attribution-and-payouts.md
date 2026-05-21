# ADR-013: Artist collaboration product attribution and payouts

- Status: Proposed
- Date: May 2026
- Depends on: ADR-001, ADR-002, ADR-008, ADR-009, ADR-012

## Context

Count On Us currently supports assigning one or more Causes directly to a Shopify product, then freezing those product-level Cause percentages into immutable order snapshots.

That is sufficient for merchant-managed donation products, but it does not cover artist collaboration products where:

- a product may credit one or more collaborating artists
- an artist may choose one or more Causes connected to their work
- an artist may donate their share or elect to receive a percentage of gross sales
- artist credit may need to be public, pseudonymous, anonymous, or different from private legal/payment records
- artist payment obligations need to be tracked separately from Cause donation obligations

The PRD previously listed artist payout tracking as a v1 non-goal and artist payout modeling as long-term work. The collaboration program makes that model first-class.

The sample artist collaboration terms also include many intake and agreement details that are operationally useful, but not all of them need to become structured application data. The app should store the information required for product attribution, donation math, payout tracking, tax/payment follow-up, and public disclosure boundaries. Long-form intake answers, artwork discussion, proofing history, and unsigned negotiation context may remain in an external form, email thread, document, or Shopify-native workflow.

## Decision

The app will introduce an artist collaboration model that is separate from, but integrated with, the existing Cause assignment and reporting model.

### Artists are first-class merchant records

The app will store artist records scoped to a shop.

Core artist data should include:

- public display name / credit name
- credit preference: public name, artist name, studio name, handle-only, pseudonym, anonymous, or uncredited
- optional public bio and public links
- private contact name and email
- status: draft, active, inactive, or revoked
- payment election: disabled by default
- default payout rate: 10% when payment election is enabled
- payment/tax follow-up status, such as W-9 requested, received, not required, or blocked
- payment method notes or payout recipient notes, without storing sensitive bank or tax identifiers
- agreement metadata, such as terms accepted date, effective date, revoked date, restricted sales channels, restricted product formats, and internal notes

Sensitive tax identifiers, bank account details, and full W-9 contents must not be stored in the app. The app may store that documentation exists, where the merchant keeps it outside the app, and whether payment is blocked until follow-up is complete.

### Artist-selected Causes are modeled at the artist level

Each artist may have one or more active Cause assignments.

For an artist to be used on an active collaboration product, their active Cause percentages must total 100%. Draft artists may have incomplete Cause assignments while intake is in progress.

Artist Cause assignments are the default donation routing for that artist's collaboration products. Product-specific Cause overrides are deferred unless a later ADR introduces them.

### Products can have one or more artist assignments

A product may be assigned to one or more artists through a product-artist join model.

Each product-artist assignment should include:

- artist id
- product id and Shopify product id
- attribution order
- optional product-specific credit override
- collaboration share percentage
- optional product-specific payout election/rate override
- effective status

For products with multiple artists, collaboration share percentages must total 100%. A single artist assignment defaults to 100%.

The collaboration share controls how the product's artist payout basis and post-artist-share donation amount are divided between assigned artists before applying each artist's Cause split.

### Collaboration products use artist-derived donation routing

The app will distinguish donation routing sources:

- direct product Cause assignments
- artist collaboration assignments

For non-collaboration products, existing product Cause assignments remain authoritative.

For collaboration products, active product-artist assignments become authoritative. The app derives Cause allocations from:

1. the product's artist collaboration shares
2. each artist's payment election and payout rate
3. each artist's active Cause percentages

The existing Product Cause assignment UI and storefront/widget contracts may continue to show a product-level Cause rollup, but for collaboration products that rollup is derived from artist assignments rather than independently edited as the source of truth.

### Artist payout is a separate payout obligation, not a production cost

Artist payout is calculated from gross sales basis, not from net contribution.

For direct Shopify website sales, the default gross basis is the line subtotal amount Sparkly Rocketship receives for the product before production costs, platform fees, taxes, reserves, donations, or other deductions.

For wholesale, consignment, retail partner, market, fundraiser, or other partner-channel sales, the basis may be the amount Sparkly Rocketship actually receives for that product rather than the final retail price paid by the end customer, when that lower received amount is modeled.

Artist payout must not be stored as material cost, labor cost, equipment cost, packaging cost, POD cost, or Business Expense input. It is a separate non-donation payout category that reduces the amount available for Cause allocation after product-level production economics are known.

When artist payment is disabled, no artist payable is created and the artist's share remains available for the artist-selected Causes.

When artist payment is enabled, the app creates artist payout allocations and reduces the amount routed to the artist's selected Causes by the same amount.

The default policy is that gross-based artist payout is not capped by net contribution unless a product-specific agreement says otherwise. If an artist payout exceeds the line's net contribution, the Cause-routable amount floors at zero and the shortfall remains a merchant-side loss or retained-negative outcome. The app must not create a negative Cause obligation solely because a gross-based artist payout exceeded the product's net contribution.

### Snapshots freeze artist collaboration math

Order snapshots must freeze the artist collaboration state used at order time.

Snapshot data should capture:

- artist id, public credit name, and credit preference at sale time
- product-artist collaboration share percentage
- payout election and payout rate used
- artist payout basis
- artist payout amount
- Cause allocation amounts derived from the artist's remaining donation amount
- source metadata indicating that the Cause allocation came from artist collaboration routing

Later edits to artist names, payment elections, Cause choices, or product assignments must not mutate historical snapshot lines.

### Artist payables mirror Cause payable behavior

Artist payout obligations should roll forward across reporting periods in the same spirit as Cause payables.

The app should distinguish:

1. period-scoped artist payout allocations
2. artist-level outstanding payables
3. dated artist payment events
4. payment application records

Artist payments should apply FIFO to the oldest outstanding artist payout allocations by default unless a later ADR introduces manual reassignment.

Cause disbursement and artist payment ledgers should remain separate. Paying an artist must not reduce Cause disbursement balances except through the original snapshot allocation math.

### Public disclosure must respect artist privacy

Public product and transparency surfaces may show:

- artist credit name, public bio, and public links when enabled
- anonymous or uncredited collaboration status when requested
- aggregate artist payout category amounts when the merchant's public policy includes artist payout disclosure
- Cause amounts after artist payout has been applied

Public surfaces must not expose:

- legal name unless explicitly chosen as the public credit
- private contact details
- W-9 or tax status details
- payment method notes
- internal restrictions or negotiation notes
- raw artist payment identifiers

This extends ADR-012. Detailed public transparency may include artist payout as a display-safe aggregate category, but detailed does not mean raw artist payment records.

### Intake can be external in the first implementation

The first implementation does not need to expose a public artist intake form.

Admins may collect artist interest through an external form, Shopify-native form, email, or manual process, then enter the operationally relevant records into Donation Manager.

An in-app or app-proxy intake form remains future work. If added later, submitted intake data should stage into draft artist records and avoid storing sensitive tax/payment identifiers directly.

## Consequences

### Benefits

- supports artist collaboration products without overloading Cause records
- keeps public artist credit separate from private payment/tax details
- preserves immutable order snapshots and historical attribution
- makes artist payouts auditable as obligations rather than informal notes
- keeps Cause payables and artist payables separate but conceptually aligned
- allows external intake workflows without blocking core collaboration management

### Costs

- introduces another payable ledger alongside Cause payables
- requires product assignment UI to explain direct Cause routing vs artist collaboration routing
- requires snapshot, reporting, export, and public transparency updates
- requires care around privacy and payment/tax status handling
- requires migration or compatibility work for existing manually tagged artist products

## Alternatives considered

**Store artists as Causes** - Rejected. Artists are not donation recipients in the same sense as Causes, and artist private payment/tax details do not belong on Cause records.

**Treat artist payout as a production cost** - Rejected. Artist payout is a collaboration payment category based on gross sales, not a material, labor, equipment, packaging, or POD cost. Treating it as production cost would obscure public donation math and violate the separation established by ADR-002.

**Use only product-level Cause assignments and store artist names in notes** - Rejected. This cannot support multi-artist products, artist-specific Cause choices, public credit preferences, or artist payout ledgers.

**Build public artist intake before admin management** - Rejected for the first implementation. The operational need is to manage collaborations and payouts inside the ledger. Intake can remain external until the core model is stable.

**Allow incomplete Cause percentages on active artist products** - Rejected. Collaboration products need deterministic order-time allocation math. Draft records can be incomplete, but active products need complete Cause routing.

## Follow-up implications

- Add schema models for Artist, ArtistCauseAssignment, ProductArtistAssignment, line-level artist payout snapshots, period artist allocations, artist payments, and artist payment applications.
- Add admin screens for Artists and product artist assignments.
- Update product donation setup to show routing source and prevent conflicting direct Cause edits on artist-routed products.
- Update snapshot creation and analytical recalculation to freeze and validate artist-derived Cause allocations.
- Update reporting to include outstanding artist payables separately from outstanding Cause payables.
- Update exports to include artist payout allocations and artist payment applications.
- Update public widget/transparency contracts to include display-safe artist attribution and optional aggregate artist payout disclosure.
- Update PRD v2.3 or the next PRD revision to move artist payout tracking out of non-goals.

## Links

- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-002](adr-002-dual-track-financial-model.md)
- [ADR-008](adr-008-financial-precision-policy.md)
- [ADR-009](adr-009-cause-payables-and-cross-period-disbursement.md)
- [ADR-012](adr-012-public-financial-disclosure-boundaries.md)
- [Sample artist collaboration notes](../../sample-artist-stuff.md)
