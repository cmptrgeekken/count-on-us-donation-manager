# Prototype E functionality gap audit

This audit compares `prototype-e-full-site.html` with the current merchant-admin routes, storefront extension blocks, shared interactions, and server actions. It distinguishes functionality that is missing from the prototype from functionality that is represented only at a summary level.

## Summary

Prototype E covers the primary information architecture and the most important financial, product-cost, payment, and storefront concepts. It does not yet represent every operational action, configuration branch, or system state in the current application.

The largest remaining gaps are:

1. Setup-wizard workflow and catalog synchronization
2. Detailed product cause-routing and artist-override behavior
3. Advanced variant cost actions and inherited-value management
4. Manual order review and correction workflows
5. External-settlement and analytical-recalculation workflows
6. Historical import preview/application and batch history
7. Provider variant mapping
8. Full settings maintenance controls
9. Complete artist-submission form behavior
10. Artist image overlays on product cards

## Implementation progress after the audit

The following high-priority recommendations are now represented in Prototype E:

- Setup step progress, completion, skipping, and resuming
- Shopify catalog synchronization and running-progress state
- Product cause-routing source, artist preferences, explicit 0%, and clearing an override
- Variant value-source labels, reset-to-template, fresh-versus-cached preview, configuration copy, template promotion, and advanced reconciliation
- Order lifecycle review, manual financial correction, order artist attribution, package confidence, detailed saved evidence, and later changes
- External marketplace settlement confirmation, correction, and ignore-with-reason
- One-period and all-period rebuild previews
- Historical import preview, warnings, errors, and batch history, while keeping the obsolete seed importer excluded
- Artist product-card badges and their storefront settings
- Expanded artist-submission form fields, restrictions, preferences, files, and acknowledgments

The remaining items in this document should now be read as a completeness checklist. Several sections marked “partially represented” have more coverage than when the audit was first written, but their listed edge states and secondary operations still remain relevant.

The second completeness pass also added:

- Package material-line quantities, quick creation, removal, full purchase fields, and review resolution
- Provider refresh progress, manual variant mapping, SKU conflicts, cache expiry, and disconnection
- Saved-versus-recalculated financial comparisons, cause differences, recalculation runs, and supporting evidence
- Payment extras, shop-covered fees, and exact period application
- Currency refresh, plan-derived versus overridden processing rates, Managed Markets date, and tax deduction modes
- Granular storefront synchronization, progress, warnings, and cancellation
- Period-grouped public donation receipts, cause breakdowns, missing evidence, and empty-state guidance
- Product/cart widget loading, mixed-cart, unavailable, rounding, and optional line-detail states
- Audit event/date filters, record payload detail, and cursor-style pagination
- Export configuration, progress/result guidance, reactivation, and cannot-delete references
- Shared empty, no-results, validation, background-job, stale-data, plan-restriction, upload-failure, and partial-success states

## Merchant admin gaps

### Dashboard and setup

Status: **Partially represented**

Prototype E shows setup progress and next actions, but does not implement the current step-by-step setup wizard.

Missing:

- Current setup-step title and description
- Step progress indicator
- Open the current setup task
- Mark a manual step complete
- Skip an optional step or skip a required step for now
- Resume a skipped step
- Catalog-not-synchronized state
- Live completion announcement after catalog synchronization

Current implementation:

- `app/routes/app.dashboard.tsx`
- `app/services/setupWizard.server.ts`

### Product catalog synchronization

Status: **Missing**

The Products prototype does not include:

- Sync Shopify catalog
- Synchronization-in-progress state
- Last completed synchronization
- Partial failure or warning result
- Refresh of product and variant counts after synchronization

Current implementation: `app/routes/app.products._index.tsx`

### Product cause routing

Status: **Partially represented**

Prototype E includes cause assignment and percentage splitting, but the current application supports more routing states.

Missing:

- Use artist cause preferences
- Manual product cause routing
- Explicitly assign 0% to causes
- Clear a product cause override and return to inherited artist preferences
- Bulk clear cause overrides
- Display of the cause-routing source
- Warning and preview when a bulk action changes mixed routing sources

Current implementation:

- `app/routes/app.products._index.tsx`
- `app/routes/app.products.$productId.tsx`
- `app/components/AssignmentControls.tsx`

### Product artist assignment

Status: **Partially represented**

Prototype E has a basic artist assignment modal. It does not show all current product-level override behavior.

Missing:

- Multiple artist assignments where supported
- Artist default versus product-specific payout override
- Credit-name override
- Customer-facing credit enable/disable override
- Percentage and other payout rules represented with their current validation
- Clear override and return to the artist default
- Bulk artist assignment result for mixed existing assignments

Current implementation:

- `app/routes/app.products._index.tsx`
- `app/routes/app.products.$productId.tsx`
- `app/components/ArtistProfileForm.tsx`

### Variant cost editor

Status: **Partially represented; significant functional gaps**

Prototype E represents the main cost categories and template assignment. The production editor has many additional actions.

Missing:

- Refresh current cost preview
- Cached estimate versus newly calculated preview
- Copy configuration from another variant
- Create a production template from a variant
- Create a shipping template from a variant
- Assign a newly created template back to the variant
- Remove a template assignment
- Save variant-specific material overrides
- Reset a material override to its template value
- Save variant-specific equipment overrides
- Reset an equipment override to its template value
- Clear visual distinction among inherited, overridden, and variant-specific lines
- Include/exclude effective material, equipment, and labor values during template promotion
- Set a shipping template as the production template's default
- Detailed equipment components and consumables
- Advanced reconciliation values: assigned causes, shop-retained amount, rounding remainder, fee estimate, tax reserve, and suppression state
- Provider mapping and latest cached Print-on-Demand cost details

Current implementation: `app/routes/app.variants.$variantId.tsx`

### Cost-template editor

Status: **Partially represented**

Missing:

- Quick-create material without leaving the template
- Quick-create equipment without leaving the template
- Default shipping-template selection for production templates
- Detailed usage-basis fields for material and equipment lines
- Reactivate inactive template
- Cannot-delete explanation showing specific assignments

Current implementation:

- `app/routes/app.templates._index.tsx`
- `app/routes/app.templates.$templateId.tsx`

### Production and packaging material libraries

Status: **Partially represented**

Missing:

- Deactivate confirmation distinct from permanent deletion
- Reactivate material
- Cost-method variants and their conditional fields
- Weight field and purchase link in the list/detail treatment
- Specific templates and variants using a material
- Cannot-delete-in-use state with affected references
- Error, validation, and successful-save states in the modal

Current implementation: `app/routes/app.materials.tsx`

### Equipment library

Status: **Partially represented**

Missing:

- Full equipment-supply/consumable editor
- Acquisition cost versus legacy equipment cost behavior
- Expected lifespan using the supported lifespan bases
- Per-use as well as time-based calculation branches
- Reactivate equipment
- Cannot-delete-in-use references
- Purchase link and SKU behavior

Current implementation: `app/routes/app.equipment.tsx`

### Shipping packages

Status: **Partially represented**

Missing:

- Add and remove multiple packaging-material lines
- Quantity for each material line
- Quick-create packaging material from the package editor
- Empty package weight and purchase fields
- Package notes
- Resolve package-review item and show its saved resolution
- Review severity and reason filters
- Inactive package state

Current implementation: `app/routes/app.packages.tsx`

### Provider connections

Status: **Partially represented; significant functional gaps**

Missing:

- Manual mapping between local and provider variants
- Mapping validation and save result
- Local and provider duplicate-SKU groups
- Missing-SKU groups on each side
- Provider cost-cache expiry and refresh outcome
- Disconnect-provider confirmation
- Credential-validation failure
- Connection expiration and reconnect states

Current implementation: `app/routes/app.provider-connections.tsx`

### Cause library

Status: **Partially represented**

Missing:

- Reactivate cause
- Separate deactivate and delete behavior
- Cannot-delete state for historical allocations or active product assignments
- Complete link fields currently supported by the cause form
- Icon preview, replacement, and upload-error states
- Metaobject/storefront publication state and synchronization outcome

Current implementation: `app/routes/app.causes.tsx`

### Artist profiles

Status: **Partially represented**

Missing:

- Full current profile schema and conditional payout fields
- Public profile links and media behavior
- Cause preferences used for product routing
- Product-specific payout and credit overrides
- Deactivation/reactivation where supported
- Assignment removal confirmation
- Related submission history

Current implementation:

- `app/routes/app.artists.new.tsx`
- `app/routes/app.artists.$artistId.tsx`
- `app/components/ArtistProfileForm.tsx`

### Artist-submission review

Status: **Partially represented**

Missing:

- Update all current review statuses
- Internal reviewer notes
- Convert into a draft artist with conversion result
- Full attachment list and secure preview/download behavior
- Contact preference and contact details
- Local connection
- Format and sales-channel restrictions
- Cause preference, cause links, and cause interests
- Artist-share and proof-approval preferences

Current implementation: `app/routes/app.artist-submissions.tsx`

### Cause and artist payments

Status: **Partially represented**

Missing or simplified:

- Extra amount beyond allocated amount
- Fees covered by the shop
- Exact applied-to-period preview for partial and overpayments
- Replacement receipt behavior when editing
- Actual artist payout amount versus calculated amount
- Existing payment edit validation and immutable fields
- Payment failure, upload failure, and partial-success states
- Prior-period overdue indicators and balances

Current implementation: `app/routes/app.reporting.tsx`

### Reporting-period details

Status: **Partially represented; significant functional gaps**

Prototype E includes the main calculation, tax summary, and close-period review. It does not include the full current reporting workspace.

Missing:

- Reporting-period selector behavior and empty state before a payout exists
- Gross, deduction-pool, and reference-amount sections in full
- Line-level cause-allocation evidence
- Surplus redistribution notes
- Cause deltas and adjustment evidence
- Authoritative versus recalculated net contribution
- Authoritative versus recalculated donation pool
- Authoritative versus recalculated cause allocations
- Latest analytical-recalculation run
- Run analytical recalculation
- Charge synchronization details
- Widget-tax suppression state
- Full tax-deduction modes: all causes, non-501(c)(3) causes only, or no deduction
- Tax true-up filed date, actual tax paid, and adjustment detail
- Close-period state when a required blocker cannot be overridden
- Period closing concurrency/stale-data failure

Current implementation: `app/routes/app.reporting.tsx`

### External marketplace settlements

Status: **Missing**

The current reporting route supports settlement review for external marketplace orders.

Missing:

- Amount received
- Marketplace fee
- Confidence and source
- Confirm settlement
- Ignore settlement with a required reason
- Existing external-settlement history
- Orders with no Shopify-paid amount

Current implementation: `app/routes/app.reporting.tsx`

### Order history and order details

Status: **Partially represented; significant functional gaps**

Missing:

- Bulk lifecycle review on the order list
- Origin filters matching webhook, reconciliation, and historical import
- Confirm active/paid, fully refunded, or canceled/voided status
- Required Shopify-review acknowledgment
- Lifecycle-review notes
- Add a manual financial adjustment with amount, reason, and explanation
- Complete adjustment history
- Assign or change the artist on an order
- Option to apply an artist association to the customer's future orders
- Cause allocation per order line
- Material and equipment line evidence
- Print-on-Demand cost flags and captured lines
- Package source, confidence, and material allocation
- Direct Shopify order, product, and variant links

Current implementation:

- `app/routes/app.order-history._index.tsx`
- `app/routes/app.order-history.$snapshotId.tsx`

### Imports and rebuilds

Status: **Partially represented; significant functional gaps**

Prototype E includes rebuild and reviewed-record replacement concepts. It does not show the current import workflow.

Missing:

- Historical import file/source input where still retained by the application
- Dry-run import
- Import warnings and errors
- Apply a reviewed import
- Rebuild one reporting period
- Rebuild all periods
- Dry-run replacement of snapshots
- Per-batch kind, status, created date, and result summary
- Batch history
- Detailed failure rows and resolution guidance

The previously rejected seed-import functionality should still be removed rather than prototyped. This gap applies only to historical import behavior that remains intentionally supported.

Current implementation: `app/routes/app.reporting-imports.tsx`

### Expenses

Status: **Partially represented**

Missing:

- Current category set and category-specific explanatory text
- Cumulative net contribution, deduction pool, and taxable exposure metrics
- Delete confirmation separate from the editor
- Current limitation that expenses can be created and deleted but not edited, unless production behavior is intentionally changed

Current implementation: `app/routes/app.expenses.tsx`

### Audit records

Status: **Partially represented**

Missing:

- Exact event-type filter populated from recorded actions
- Start and end date filters
- Cursor-based next page
- Formatted payload expansion
- Current entity and entity-ID display
- Empty and invalid-date states

Current implementation: `app/routes/app.audit-log.tsx`

### Settings

Status: **Partially represented; significant functional gaps**

Missing:

- Refresh shop currency from Shopify
- Payment-rate override enable, update, and disable states
- Plan-derived rate versus manual override comparison
- Managed Markets enable date
- Tax deduction mode selection
- Supported tax planning presets
- Granular storefront synchronization: all, products, causes, or artists
- Cancel storefront synchronization
- Storefront synchronization progress and partial result
- Storefront filter setup warning and resolution
- Open audit records from settings
- Clear before/after explanation for settings that affect only future calculations

Current implementation: `app/routes/app.settings.tsx`

### Exports

Status: **Only represented as generic buttons**

The prototype shows export actions but not their option, progress, or failure states.

Current export routes:

- `app/routes/app.reporting-export.tsx`
- `app/routes/app.production-usage-export.tsx`
- `app/routes/app.variants-export.tsx`

## Storefront and customer-facing gaps

### Product donation widget

Status: **Partially represented**

Prototype E now includes the complete high-level reconciliation and correctly collapses details by default.

Still missing:

- Variant selection changes the estimate
- Quantity changes scale the estimate
- Loading, unavailable, and no-cause states
- Optional material, equipment, and packaging line-item details
- Detailed equipment-component breakdown
- Cause links
- Rounding or unattributed-remainder row when present
- Open-state preservation after a live estimate refresh
- Accessible live announcements
- Theme-editor configurable heading and description

Current implementation:

- `extensions/count-on-us-product-widget/blocks/donation-widget.liquid`
- `extensions/count-on-us-product-widget/assets/product-donation-widget.js`

### Cart donation summary

Status: **Partially represented**

Missing:

- Compact cart trigger and modal presentation
- Reading live cart lines and grouping duplicate products
- Mixed carts containing items without cause assignments
- Empty/no-donation cart state
- Live cart refresh
- Cause links
- Unattributed remainder
- Loading and error states

Current implementation:

- `extensions/count-on-us-product-widget/blocks/cart-donation-summary.liquid`
- `extensions/count-on-us-product-widget/assets/cart-donation-summary.js`

### Donation summary/transparency widget

Status: **Partially represented**

Prototype E now includes overview totals, reconciliation, cause summaries, and receipt history.

Still missing:

- Merchant-configurable minimal, standard, and detailed disclosure tiers
- Hide/show overview, causes, receipt history, and financial reconciliation independently
- Month, year, and all-period rollups as configured widget states
- Coverage label
- No-public-activity state
- Receipt expansion by cause
- Loading and error states

Current implementation:

- `extensions/count-on-us-product-widget/blocks/transparency-page.liquid`
- `extensions/count-on-us-product-widget/assets/transparency-page.js`

### Cause directory

Status: **Mostly represented**

Still missing:

- True list-layout example
- Directory empty, loading, and error states
- Independent merchant controls for public links and nonprofit badges
- Icon unavailable/fallback state

Current implementation:

- `extensions/count-on-us-product-widget/blocks/causes-directory.liquid`
- `extensions/count-on-us-product-widget/assets/public-directory.js`

### Artist directory

Status: **Mostly represented**

Still missing:

- True list-layout example
- Directory empty, loading, and error states
- Independent merchant controls for public links and supported causes
- Icon unavailable/fallback state

Current implementation:

- `extensions/count-on-us-product-widget/blocks/artists-directory.liquid`
- `extensions/count-on-us-product-widget/assets/public-directory.js`

### Artist image overlays

Status: **Missing entirely**

The current extension can add artist badges to product cards.

Missing:

- Badge on collection/search product cards
- Top-left, top-right, bottom-left, and bottom-right positions
- Hide on small screens
- Maximum artist-label length
- Multiple-product loading behavior and image/card matching

Current implementation:

- `extensions/count-on-us-product-widget/blocks/artist-overlay.liquid`
- `extensions/count-on-us-product-widget/assets/artist-overlay.js`

### Artist-submission form

Status: **Partially represented; significant functional gaps**

Missing:

- Full and minimal form templates
- Preferred contact method and conditional contact detail
- Multiple public links
- Local connection
- Format and sales-channel restrictions
- Cause preference and conditional cause links
- Cause interests
- Artist-share preference
- Proof-approval preference
- Multiple artwork files and upload progress/failure
- Configurable collaboration terms link
- Separate terms and payment acknowledgments
- Configurable privacy note and submit label
- Complete inline validation and submission success state

Current implementation:

- `extensions/count-on-us-product-widget/blocks/artist-submission-form.liquid`
- `extensions/count-on-us-product-widget/assets/artist-submission-form.js`

### Donation receipts page

Status: **Partially represented**

Prototype E shows one receipt-style record. The current page is organized by closed reporting period.

Missing:

- Multiple reporting periods
- Total donated and disbursement count per period
- Cause allocation breakdown per period
- Disbursement table with method and reference
- Missing-receipt state
- No-receipts page
- Refreshed signed receipt links

Current implementation: `app/routes/apps.count-on-us.donation-receipts.tsx`

### After-purchase and email summary

Status: **Concept represented; delivery states missing**

Missing:

- Confirmed-snapshot version distinct from estimated version
- No-cause order behavior
- Mixed-order behavior
- Email delivery setting and delivery failure state
- Customer identity or access failure where applicable

Current implementation:

- `app/services/postPurchaseDonation.server.ts`
- `app/services/postPurchaseEmail.server.ts`

## Shared interaction and state gaps

Prototype E has representative modal types, but it does not yet show every reusable state needed for implementation.

Missing shared examples:

- Searchable autocomplete with keyboard behavior
- Modal field-validation errors
- File-upload progress and failure
- Save-bar behavior for staged full-page editors
- Browser/navigation interception for unsaved changes
- Background-job progress with cancel
- Partial success with per-record warnings
- Stale data changed during review
- Permission or plan restriction
- Empty, loading, no-results, and server-error variants for each major table/widget
- Pagination and cursor navigation
- Mobile layouts for dense financial tables and dialogs
- Focus return after closing a modal
- Accessible live-region success and error announcements

Shared implementations:

- `app/components/admin-ui.tsx`
- `app/components/AppSaveBar.tsx`
- `app/utils/use-unsaved-changes-guard.ts`

## Intentional consolidations that are not gaps

- Production materials and packaging materials are deliberately split into separate prototype pages even though the current material library combines them.
- Tax and advanced financial evidence are deliberately placed inside reporting-period details rather than separate top-level pages.
- Audit Log is deliberately renamed Audit records.
- The obsolete seed importer is deliberately excluded.
- Complex editors are deliberately full pages; simple create/edit actions use modals.

## Recommended prototype additions

### Highest priority

1. Order review and manual correction detail
2. External marketplace settlement review
3. Variant inherited/override editor and cost-preview states
4. Product cause-routing modes and override clearing
5. Historical import preview, warnings, batch history, and period rebuild
6. Setup wizard and catalog synchronization
7. Artist image overlay storefront example
8. Full artist-submission form and validation states

### Next priority

1. Provider manual mapping and conflict states
2. Settings maintenance and storefront-sync progress
3. Full reporting recalculation and authoritative-versus-recalculated evidence
4. Package material-line editor and review resolution
5. Product/cart live and empty/error states
6. Period-grouped donation receipts

### Final completeness pass

1. Reactivation and cannot-delete states across libraries
2. Export state examples
3. Audit pagination and payload detail
4. Shared loading, error, no-results, stale-data, and plan-restriction states
5. Responsive variants for dense screens
