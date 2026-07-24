# Site interface inventory

This inventory identifies the merchant-facing pages and interactions that should be represented before the reporting redesign is extended across the rest of the site. It is based on the current Remix routes, shared admin navigation, and dialog implementations.

## Proposed top-level structure

The current app has six main areas. The new designs should use separate pages for distinct jobs and reserve tabs or segmented controls for small changes to the same view.

1. **Home** — setup progress, current work, and important warnings.
2. **Products and costs** — products, variants, reusable cost setup, materials, equipment, packaging, and provider connections.
3. **Giving** — causes, product cause assignments, cause payments, and payment history.
4. **Artists** — artists, submissions, product assignments, artist payments, and payment history.
5. **Reports and records** — overview, reporting periods, reviews, production usage, expenses, order history, imports and rebuilds, and audit records.
6. **Settings** — financial, cost, tax, notification, language, storefront, and advanced settings.

The existing prototype already separates giving workflows from reporting details. The full-site prototype should apply that same rule elsewhere: a page should have one primary job, predictable navigation, plain labels, and visible help text for calculated or consequential fields.

## Merchant admin pages

### Home

#### Dashboard

Current route: `/app/dashboard`

Needs to include:

- Setup progress
- Catalog and variant-configuration status
- Next actions
- Important financial or data-quality reviews
- Shortcuts to products, costs, recipients, payments, and reports

Recommended design treatment: make this the operational home page. Keep payment urgency visible, but do not duplicate the full Giving overview.

### Products and costs

#### Products

Current route: `/app/products`

Needs to include:

- Search and filters for product title, handle, collection, tag, provider, and status
- Product donation status
- Cause assignment summary
- Artist assignment summary
- Product and variant readiness
- Bulk product selection and assignment actions
- Provider sync state and Print-on-Demand coverage
- Link to product details

Dialogs and overlays:

- Add causes to selected products
- Choose an artist
- Cause-allocation details
- Confirmation or warning before overwriting existing assignments

#### Product details

Current route: `/app/products/:productId`

Needs to include:

- Product information and image
- Cause assignments and percentages
- Artist assignments
- Variant table
- Price, estimated costs, estimated cause amount, template, provider, and readiness by variant
- Links to variant details
- Customer-facing donation-display status

Dialogs and overlays:

- Add causes
- Add artists
- Remove-assignment confirmation where removal changes customer-facing or financial behavior

#### Variants

Current route: `/app/variants`

Needs to include:

- Search and filters for product, variant, SKU, collection, tag, template, and provider
- Estimated cost and donation readiness
- Production and shipping template assignments
- Provider status
- Bulk selection

Dialogs and overlays:

- Assign template to selected variants
- Choose the template
- Choose whether existing configurations may be overwritten
- Bulk-operation result summary

#### Variant details

Current route: `/app/variants/:variantId`

Needs to include:

- Variant identity, price, and current readiness
- Estimated calculation with help text for every line
- Labor, production materials, equipment, mistake allowance, and packaging
- Production-template assignment
- Shipping-template override
- Variant-specific cost overrides
- Provider or Print-on-Demand costs
- Saved versus inherited values

Dialogs and overlays:

- Assign production template
- Assign shipping template override
- Copy configuration from another variant
- Create production template from the variant
- Create shipping template from the variant
- Choose or create material
- Choose or create equipment
- Confirm removal, reset, or replacement of an override
- Unsaved-changes confirmation

#### Cost templates

Current route: `/app/templates`

Needs to include:

- Separate production and shipping templates
- Name, description, number of cost lines, assignment count, and status
- Search/filter controls
- Clear indication that an assigned template cannot be deleted

Dialogs and overlays:

- New template
- Deactivate template
- Delete template

#### Cost-template details

Current route: `/app/templates/:templateId`

Needs to include:

- Template name, type, description, and status
- Default labor and mistake allowance
- Production-material lines or shipping-material lines
- Equipment lines
- Default shipping template where applicable
- Usage assumptions and calculated per-item amounts
- Products or variants using the template

Dialogs and overlays:

- Choose or create material
- Choose or create equipment
- Choose default shipping template
- Confirm line removal
- Unsaved-changes confirmation

#### Production materials

Current route: `/app/materials`

The current page combines production and shipping materials. The redesign should split these into separate pages or make the separation unmistakable in navigation and wording.

Needs to include:

- Material name and description
- Purchase price and quantity
- Working unit and conversion
- Per-unit cost
- Weight and purchase link
- Templates and variants using the material
- Active/inactive status

Dialogs and overlays:

- New production material
- Edit production material
- Deactivate material
- Delete material
- Explanation when deletion is unavailable because the material is in use

#### Packaging materials

Current source: shipping records in `/app/materials`

Needs to include the same purchasing and unit-conversion fields as production materials, while making clear that these are used to pack orders rather than make products.

Dialogs and overlays:

- New packaging material
- Edit packaging material
- Deactivate packaging material
- Delete packaging material

#### Equipment

Current route: `/app/equipment`

Needs to include:

- Equipment name, description, and SKU
- How use is measured: time, per use, or calculated ownership cost
- Purchase cost and expected lifespan
- Electricity assumptions
- Equipment supplies and consumables
- Effective hourly or per-use rate
- Templates and variants using the equipment
- Active/inactive status

Dialogs and overlays:

- New equipment
- Edit equipment
- Add or edit equipment supplies
- Deactivate equipment
- Delete equipment
- Explanation when deletion is unavailable because equipment is in use

#### Shipping packages

Current route: `/app/packages`

Needs to include:

- Package name, dimensions, empty weight, and maximum weight
- Package materials and calculated material cost
- Purchase information
- Active/inactive status
- Package-assignment review list
- Link from a review item to the affected order

Dialogs and overlays:

- New package
- Edit package
- Choose packaging material
- Add a packaging material inline
- Deactivate or delete package confirmation
- Resolve package-review item

#### Provider connections

Current route: `/app/provider-connections`

Needs to include:

- Provider connection status
- Credential or token setup
- Last synchronization
- Mapped and unmapped variants
- Missing or duplicate SKUs on either side
- Cached provider costs and expiry
- Items requiring review

Dialogs and overlays:

- Add or replace provider credentials
- Disconnect provider confirmation
- Start synchronization confirmation and progress
- Review mapping conflicts

### Giving

#### Causes

Current route: `/app/causes`

Needs to include:

- Cause name, description, icon, URL, and tax-exempt status
- Number of assigned products
- Active/inactive status
- Link to payment details and history in the new reporting structure

Dialogs and overlays:

- New cause
- Edit cause
- Upload or replace icon
- Deactivate cause
- Delete cause
- Explanation when deletion is unavailable due to assignments or historical amounts

#### Cause assignments

Current source: product list and product details

Recommended treatment: this does not need to be a separate duplicate list if the Products page provides a clear assignment mode and useful filters. It does need a distinct workflow state and assignment dialog.

#### Cause payments

Covered by the recommended reporting prototype.

Still needed as interactive states:

- Record-payment dialog
- Oldest-unpaid-period application preview
- Amount override and explanation
- Method, reference, fees, extra amount, and receipt upload
- Success state and printable or downloadable record
- Edit-payment dialog
- Delete or reverse-payment confirmation

#### Cause details and payment history

Covered structurally by the recommended reporting prototype. The cause detail should also be reachable from the Causes page.

### Artists

#### Artists

Current route: `/app/artists`

Needs to include:

- Artist name, credit name, contact details, image, and status
- Assigned products
- Payment basis or agreement summary
- Amount still to pay and link to payment details
- Search and filters

Dialogs and overlays:

- Deactivate artist confirmation
- Delete artist confirmation when allowed
- Remove product assignment confirmation

#### New artist

Current route: `/app/artists/new`

Needs to include the artist profile and payment-agreement fields with plain help text and validation.

#### Artist details

Current route: `/app/artists/:artistId`

Needs to include:

- Artist profile and contact information
- Credit and storefront information
- Payment agreement
- Assigned products
- Earnings summary and link to artist payments
- Related submissions

Dialogs and overlays:

- Add products
- Edit payment agreement
- Remove product
- Unsaved-changes confirmation

#### Artist submissions

Current route: `/app/artist-submissions`

Needs to include:

- Submission status and date
- Artist/contact information
- Artwork or idea
- Uploaded files and portfolio links
- Formats, cause interests, restrictions, preferences, and notes
- Review and conversion into an artist record

Dialogs and overlays:

- Accept or convert submission
- Reject/archive submission confirmation
- Attachment preview
- Link submission to an existing artist

#### Artist payments

Covered by the recommended reporting prototype.

Still needed as interactive states:

- Record-payment dialog
- Earnings and reporting-period application preview
- Amount override and explanation
- Method and reference
- Edit-payment dialog
- Delete or reverse-payment confirmation

### Reports and records

#### Giving overview

Covered by the recommended reporting prototype.

#### Reporting periods

Covered structurally by the recommended reporting prototype.

Still needed:

- Full period-details page
- Calculation breakdown
- Included-order drill-down
- Open-period estimate state
- Closed-period state
- Close-period confirmation
- Close-with-review-items override dialog requiring a reason
- Period changed during review warning

#### Review queue

Covered structurally by the recommended reporting prototype.

Still needed:

- Review-detail drawer or page
- Mark reviewed
- Resolve source data
- Permit override with required reason
- Bulk review where the decision is genuinely shared

#### Payment history

Covered structurally by the recommended reporting prototype.

Still needed:

- Payment record details
- Receipt preview
- Edit payment
- Reverse or delete confirmation

#### Tax report

Current source: Reporting tab `Tax`

Recommended treatment: separate page under Reports and records.

Needs to include:

- Estimated tax reserve
- Effective tax rate
- Taxable base and exposure
- Tax deduction mode
- Period comparisons
- Tax true-ups

Dialogs and overlays:

- Record tax true-up
- Edit tax true-up
- Delete tax true-up confirmation

#### Advanced calculation details

Current source: Reporting tabs `Details` and `Diagnostics`

Recommended treatment: separate advanced page or period subpage, not a primary workflow.

Needs to include:

- Gross contribution
- Labor, material, equipment, artist, marketplace-fee, expense, and tax deductions
- Profit available for giving
- Amount assigned to causes
- Profit kept by the shop
- Saved versus recalculated totals
- Calculation differences
- Adjustment evidence
- Latest recalculation run

#### Advanced ledger

Covered structurally by the recommended reporting prototype.

#### Production usage

Covered structurally by the recommended reporting prototype.

Still needed:

- Material-to-order drill-down
- Equipment-to-order drill-down
- Packaging-to-order drill-down
- Empty, loading, error, and export states

#### Expenses

Current route: `/app/expenses`

Needs to include:

- Expense name, category, date, amount, and notes
- Reporting-period effect
- Deduction-pool, cumulative-profit, and taxable-exposure context
- Search and filters

Dialogs and overlays:

- Add expense
- Edit expense if supported or added
- Delete expense confirmation

#### Order history

Covered structurally by the recommended reporting prototype.

Still needed:

- Pagination and complete filter state
- Bulk lifecycle review
- No-result, error, and stale-calculation states

#### Order details

Covered structurally by the recommended reporting prototype.

Still needed from the current page:

- Order-lifecycle review controls
- Artist-association control
- Package-allocation source and confidence
- Complete production-material and equipment evidence
- Refund and correction detail
- Links to affected reporting periods and recipient amounts
- Review-state and override dialogs

#### Imports and rebuilds

Current route: `/app/reporting-imports`

Needs to include:

- Rebuild current financial records
- Progress, current stage, warnings, and errors
- Preview before replacing reviewed data
- Replacement reason
- Past batch history and result summary

Historical seed-import functionality was previously identified for removal. The redesign should not preserve obsolete seed-import controls merely because they exist in an older interface.

Dialogs and overlays:

- Start rebuild confirmation
- Destructive replacement confirmation requiring typed `REPLACE`
- Reviewed-record replacement confirmation and reason
- Error and warning details

#### Audit records

Current route: `/app/audit-log`

Needs to include:

- Date, actor, action, record type, record identifier, and concise change summary
- Filters and search
- Link to the affected record where available
- Expandable technical payload as an advanced detail

Recommended wording: “Audit records” is more direct than “Audit Log” in navigation, while the page can explain that it is a chronological record of changes.

### Settings

The current settings interface uses six tab-like sections. Because these represent distinct configuration jobs and already appear as navigation destinations, the redesign should treat them as separate settings pages with a shared settings navigation.

#### Financial settings

- Payment-processing rate
- Currency and plan information
- Giving-related defaults
- Plain explanation of which new orders are affected

#### Cost defaults

- Default labor and mistake allowance
- Planning presets
- Default production and packaging behavior

#### Tax settings

- Effective tax rate
- Override rate
- Tax deduction behavior

#### Notification settings

- Artist-submission notification address
- Post-purchase donation-summary email

#### Language and regional settings

- Active language
- Currency display and formatting where configurable

#### Storefront settings

Current source: settings sections and customer-merchandising controls.

- Product-description donation summaries
- Storefront filter and metadata setup
- Shopify storefront synchronization progress
- Customer-facing presentation status

Dialogs and overlays:

- Start storefront synchronization
- Progress and completion result
- Confirm disabling customer-facing content

#### Advanced settings

- Diagnostics and maintenance controls that are safe for a shop admin
- Links to imports/rebuilds and audit records instead of duplicating those workflows
- Clearly isolated destructive actions

## Shared interaction patterns to prototype

These are not standalone pages, but the full-site prototype should include representative working examples because they recur throughout the application.

### Forms

- Create and edit modal with field help and inline validation
- Full-page staged editor for complex records
- Save bar for unsaved changes
- Discard-changes confirmation
- Successful save banner with an accessible live announcement

### Selection and assignment

- Searchable chooser for causes, artists, templates, materials, equipment, packages, products, and variants
- Multi-select bulk action
- Existing-assignment overwrite warning
- Allocation editor where percentages must add up correctly
- Clear summary of what will change before saving

### Confirmations

- Deactivate confirmation
- Permanent-delete confirmation
- Cannot-delete explanation for records in use
- Financial override requiring a reason
- Typed confirmation for reviewed-data replacement
- Payment reversal confirmation

### Evidence and detail

- Calculation-help text next to every financial line
- Source and confidence explanation
- Receipt or attachment preview
- Before-and-after values for changes
- Link from a summary to affected orders, variants, periods, or recipients

### System states

- Loading
- Empty
- No search results
- Validation error
- Server error with retry
- Background job in progress
- Partial success with warnings
- Stale data or changed-during-review warning
- Permission or plan restriction

## Supporting routes that are not admin pages

These should not be added to the merchant-admin navigation, but they may need a separate customer-facing design pass:

- Product donation widget and product-donation data endpoints
- Cart donation summary
- Post-purchase donation preview and email
- Public cause and artist data
- Artist-submission storefront form
- Donation-receipt pages
- Public transparency page
- Artist overlays and public icons
- CSV exports
- Shopify authentication screens

API routes, webhooks, health checks, development routes, and UI fixture routes do not need visual page prototypes.

## Coverage in the recommended prototype

Already represented:

- Giving overview
- Cause payments
- Cause payment details
- Artist payments
- Payment history
- Reporting periods
- Review queue
- Advanced ledger
- Order history
- Order details
- Production usage

Highest-priority pages to design next:

1. Dashboard and the final site navigation
2. Products and product details
3. Variants and variant cost details
4. Production materials and packaging materials as separate pages
5. Equipment and shipping packages
6. Causes and artists
7. Settings page family
8. Expenses, tax report, calculation details, imports/rebuilds, and audit records
9. Provider connections and artist submissions

Highest-priority dialogs to design next:

1. Record cause payment and record artist payment
2. Product cause allocation and artist assignment
3. Assign template to variants, including overwrite behavior
4. Create/edit material and equipment
5. Close reporting period and override a review item
6. Delete/deactivate confirmations
7. Unsaved-changes confirmation
8. Rebuild and reviewed-data replacement confirmation

## Confirmed design decisions

- Include both the merchant admin and the customer-facing storefront experiences in the redesign.
- Make **Production materials** and **Packaging materials** separate navigation pages.
- Place tax and advanced calculation information inside reporting-period detail views instead of creating additional top-level report pages.
- Rename **Audit Log** to **Audit records** in navigation and page copy.
- Use full-page editors for complex records and focused modals for simpler create, edit, assignment, payment, and confirmation flows.
- Preserve the existing customer-facing cost reconciliation in the product, cart, and after-purchase widgets. The redesigned widgets should show the item total; labor, production materials, equipment, packaging, Print-on-Demand costs, mistake allowance, artist pay, fees, and tax reserve when applicable; profit remaining after costs; the amount assigned to causes; and profit kept by the shop. Estimated values must be labeled as estimates.
- Keep detailed customer-facing calculation disclosures collapsed by default. Show the estimated cause total and cause recipients immediately, then let customers open “See how this estimate is calculated.”
- Include dedicated storefront page widgets for the public donation summary, cause directory, and artist directory in addition to the product, cart, after-purchase, receipt, and artist-submission surfaces.
