# PRD QA Workbook

This workbook is the execution artifact for Issue `#60`.

Status convention:

- `[ ]` Pending / not yet executed
- `[x]` Passed
- `[-]` N/A or intentionally out of scope for the current submission pass

Add concise evidence notes under each section as the checklist is executed.

## Cost Model & Libraries

- [ ] Material library: yield-based item stores purchase_price and purchase_quantity only (no yield, no unit_cost)
- [ ] Material library: uses-based item stores purchase_price, purchase_quantity, and total_uses_per_unit
- [ ] Per-unit cost derived correctly: purchase_price ÷ purchase_quantity
- [ ] Live per-unit cost preview updates in UI as merchant types purchase_price or purchase_quantity
- [ ] Updating purchase_price or purchase_quantity propagates to all referencing templates/variants and does not affect past snapshots
- [ ] Yield-based line item: yield (variant-specific) and quantity entered on template/variant line item
- [ ] Uses-based line item: uses_per_variant entered on template/variant line item; total_uses_per_unit read from library item
- [ ] Yield-based formula: (purchase_price ÷ purchase_qty ÷ yield) × quantity
- [ ] Uses-based formula: (purchase_price ÷ purchase_qty ÷ total_uses_per_unit) × uses_per_variant
- [ ] Example verified: acrylic $40 for 10 sheets, yield=20 small earrings -> $4.00/sheet ÷ 20 = $0.20/earring
- [ ] Example verified: super glue $12 for 5 tubes, 100 uses/tube, 1 use/pin -> $2.40/tube ÷ 100 = $0.024/pin
- [ ] Example verified: same acrylic sheet, large earring yield=8 -> $4.00 ÷ 8 = $0.50/earring
- [ ] Adaptive inputs: yield-based shows yield + quantity; uses-based shows uses_per_variant only
- [ ] Bulk table editor: yield/quantity columns for yield-based line items; uses_per_variant for uses-based
- [ ] Costing model immutable after library item creation
- [ ] Mistake Buffer applies to both yield-based and uses-based production material totals
- [ ] Equipment adaptive inputs: minutes shown only if hourly rate set; uses shown only if per-use cost set
- [ ] Updating material cost propagates to templates and variants and does not affect past snapshots
- [ ] Updating equipment rate propagates and does not affect past snapshots
- [ ] "Used by X templates, Y variants" indicator correct on library items
- [ ] Cost template: create with material, equipment, and shipping material line items
- [ ] Template updates propagate to assigned variants for future orders only
- [ ] Soft-delete: deactivated items hidden from new configs, existing references preserved
- [ ] Mistake Buffer at 0%: no additional cost
- [ ] Mistake Buffer at non-zero %: correct line item beneath Materials in editor and widget
- [ ] Mistake Buffer applies to production materials only; Shipping Materials excluded
- [ ] Mistake Buffer % stored in snapshot for audit
- [ ] Labor: (hourly_rate ÷ 60) × minutes calculated correctly
- [ ] Equipment: (hourly × minutes) + (per_use × uses) calculated correctly
- [ ] Material: (cost ÷ yield) × quantity calculated correctly
- [ ] Shipping material does not scale with quantity; per shipment only
- [ ] Packaging cost rule: max total shipping cost across all shippable variants in order
- [ ] Bulk template assignment to products, variants, and collections
- [ ] Bulk assignment warns when overwriting existing configs
- [ ] Bulk table editor: Tab/Enter/Escape keyboard navigation
- [ ] Live cost preview updates correctly as values change

Notes:

## POD / Third-Party Providers

- [ ] Printful OAuth connection stores encrypted token
- [ ] Printify API key stored encrypted and validated against provider API
- [ ] Auto-match by SKU links variants correctly
- [ ] Unmatched variants surfaced for manual mapping
- [ ] Daily sync updates ProviderCostCache
- [ ] Manual refresh triggers immediate fetch
- [ ] Snapshot creation fetches live POD cost from provider API
- [ ] POD fetch failure: fallback to cached cost, snapshot flagged, merchant notified
- [ ] POD + manual costs coexist correctly
- [ ] Provider credential encryption: plaintext never stored
- [ ] Disconnecting provider removes credentials and clears mappings

Notes:

## Order Snapshots & Reconciliation

- [ ] Snapshot created on orders/create webhook
- [ ] Duplicate webhook: no duplicate snapshot created (idempotency)
- [ ] Snapshot creation is atomic across all child tables
- [ ] OrderSnapshotMaterialLine stores copied material names and costs at order time
- [ ] OrderSnapshotEquipmentLine stores copied equipment names and rates at order time
- [ ] OrderSnapshotPODLine stores provider, cost_line_type, description, and amount individually
- [ ] Four category totals on OrderSnapshotLine match the sum of detail lines
- [ ] POD live fetch completes before DB transaction opens
- [ ] Zero-cost variant: net contribution = sale price, widget shows $0 rows
- [ ] Packaging rule applied correctly for multi-item orders
- [ ] Cause assignment priority (manual override > tag > category > product default)
- [ ] Snapshot is immutable and has no update path
- [ ] Reconciliation job creates missing snapshots for orders within the last 7 days
- [ ] Reconciliation job skips if previous run still active
- [ ] Webhook HMAC-SHA256 verified; unsigned rejected with 401
- [ ] orders/updated only triggers on price/line item changes, not tags/notes/fulfillment

Notes:

## Refunds

- [ ] Negative adjustment created on refunds/create webhook
- [ ] Snapshot values used for adjustment instead of recalculation
- [ ] Partial refund adjustment proportional to refunded quantity
- [ ] Cause balances updated correctly, including going negative

Notes:

## Shopify Charges

- [ ] Balance transactions imported from Shopify Payments API
- [ ] ShopifyChargeTransaction deduplicated by shopify_transaction_id
- [ ] Charges synced on payouts/create equivalent flow and daily job
- [ ] shopify_charges deducted correctly from the donation pool

Notes:

## Reporting & Tax Reserve

- [ ] CauseAllocation computed live when period OPEN
- [ ] CauseAllocation materialised and locked at period CLOSE
- [ ] Tax mode "don't deduct": no reserve applied
- [ ] Tax mode "non-501c3 only": taxable_weight = Σ(non-501c3 cause %) ÷ 100
- [ ] Tax mode "all causes": taxable_weight = 1.0
- [ ] Mixed cause example: 60% 501(c)3, 40% non -> taxable_weight = 0.40 in non-501c3 mode
- [ ] taxable_base = MAX(0, cumulative_net_contribution - period_expenses)
- [ ] taxable_base floors at zero and never goes negative
- [ ] Deduction pool = cumulative 501(c)3 allocations + period non-order expenses
- [ ] taxable_exposure = cumulative_net_contribution - deduction_pool and can go negative
- [ ] taxable_exposure <= 0 suppresses widget tax reserve
- [ ] taxable_exposure > 0 restores widget tax reserve
- [ ] TaxOffsetCache refreshed hourly by ReportingService
- [ ] SnapshotService reads live taxable_exposure from DB at order time
- [ ] Surplus fully covers order -> per_order_tax_reserve = $0
- [ ] Surplus partially covers order -> tax reserve applies only to exposed portion
- [ ] No surplus -> full net contribution taxed at effective_tax_rate × taxable_weight
- [ ] Example verified: surplus $150, order $200 -> taxable_portion = $50
- [ ] Storefront widget reads widget_tax_suppressed from TaxOffsetCache
- [ ] Deductions crossing threshold suppress tax line within 1 hour
- [ ] New orders increasing taxable_exposure above zero restore tax line within 1 hour
- [ ] Reporting dashboard shows deduction_pool, taxable_exposure, and widget suppression status
- [ ] Business expenses do not affect the donation pool
- [ ] Deduction pool formula excludes per-order costs by design
- [ ] Inventory & Materials material_purchase sub-type creates correct BusinessExpense record
- [ ] Inventory & Materials COGS adjustment sub-type creates correct BusinessExpense record
- [ ] All seven expense categories create/edit/delete correctly
- [ ] Expenses are period-only and not retroactively applied to past periods
- [ ] Reporting dashboard shows Donation Pool and Tax Estimation as separate sections
- [ ] Reporting dashboard shows Inventory & Materials subtotals separately
- [ ] True-up surplus updates CauseAllocations per merchant redistribution
- [ ] True-up shortfall reduces donation pool correctly
- [ ] True-up exact match stores record with no pool change
- [ ] TaxTrueUp record stores all required fields for audit
- [ ] 501(c)3 status and legal name fields save to cause metaobject
- [ ] 501(c)3 status at order time stored in snapshot
- [ ] Disbursement logging saves all fields correctly
- [ ] Multiple partial disbursements per cause per period tracked correctly
- [ ] Receipt PII warning shown at upload
- [ ] Receipts accessible in admin and on /apps/donation-receipts
- [ ] Presigned URLs expire after 1 hour and refresh on page load
- [ ] "Run recalculation" async run completes and notifies merchant
- [ ] CSV and PDF exports generate correctly

Notes:

## Storefront Widget

- [ ] Widget hidden for products with no cause assignments
- [ ] Toggle shows and expands inline for donation products
- [ ] Widget remains expanded on variant change and updates in place
- [ ] Widget updates instantly on variant/quantity change
- [ ] Payload >50KB lazy-loads on toggle open
- [ ] Section order: Causes -> Cost Breakdown -> Shopify Fees -> Estimated tax reserve
- [ ] Mistake Buffer displayed as named line item beneath Materials
- [ ] Estimated tax reserve shown when rate > 0% and mode is not "don't deduct"
- [ ] Estimated tax reserve hidden when mode = "don't deduct" or rate = 0%
- [ ] Donation amounts shown in the customer's selected currency
- [ ] Widget shows updated costs on next page load after template/library changes
- [ ] Managed Markets fee shown for international customers and hidden for domestic
- [ ] Localization API failure falls back to currency mismatch only
- [ ] Cart "See your donation impact" button triggers cause summary
- [ ] Cart modal traps focus and returns focus to trigger on close
- [ ] /apps/donation-receipts displays periods, disbursements, and receipt links correctly
- [ ] Receipts page empty state shown when no disbursements are logged

Notes:

## Accessibility (WCAG 2.1 AA)

- [ ] Toggle aria-label is descriptive
- [ ] aria-expanded updates on open/close
- [ ] Focus moves to first focusable element on widget expand
- [ ] aria-live region announces variant/quantity changes
- [ ] Cost breakdown uses semantic HTML table structure with th and caption
- [ ] Sections are differentiated by headings/icons, not colour alone
- [ ] Colour contrast is 4.5:1 for normal text across Dawn and common themes
- [ ] Cart modal focus trap and focus return work correctly
- [ ] Cart modal has an accessible name
- [ ] Wizard progress indicator announces step N of M to screen readers
- [ ] Bulk table Tab/Enter/Escape keyboard behavior works correctly
- [ ] Receipts page uses semantic headings and accessible disbursement tables

Notes:

## Shopify Platform

- [ ] Metafield namespace `donation_manager` has no conflicts
- [ ] Metaobject definition created on install and deleted on uninstall
- [ ] read/write_metaobject_definitions scopes work correctly
- [ ] Product cause metafields read/write correctly with write_products
- [ ] App Proxy HMAC-SHA256 verified; unsigned requests rejected with 403
- [ ] Widget renders on Dawn and two other OS2.0 themes
- [ ] App listing states OS2.0 requirement
- [ ] Install sync: products and variants synced via CatalogSync on install
- [ ] Install sync: balance transactions imported with cursor-based pagination on install
- [ ] ShopifyChargeTransaction deduplicated correctly
- [ ] shopify_charges deducted from donation pool formula

Notes:

## Post-Purchase Experience

- [ ] Checkout UI Extension registered correctly with a ui_extension type
- [ ] purchase.thank-you.block.render target renders on Thank You page
- [ ] customer-account.order-status.block.render target renders on Order Status page
- [ ] Thank You extension fetches snapshot and shows estimated amounts while polling
- [ ] Thank You extension replaces estimates with confirmed amounts once snapshot is available
- [ ] Thank You extension shows "Estimated — we'll confirm this shortly" if snapshot is not available within 30 seconds
- [ ] Thank You extension renders donation summary for orders with cause-assigned products
- [ ] Thank You extension hidden entirely for orders with no donation products
- [ ] Thank You extension fails silently if the app server is unavailable
- [ ] Post-purchase email sent within minutes of order placement after snapshot creation
- [ ] Email contains correct per-cause amounts matching snapshot values
- [ ] Email hidden/skipped for orders with no donation products
- [ ] Post-purchase email disabled in Settings means no email sent
- [ ] Email uses the customer's order currency for amounts
- [ ] Email link to /apps/donation-receipts resolves correctly

Notes:

## GDPR Compliance Webhooks

- [ ] Compliance webhooks configured via compliance_topics in shopify.app.toml and not via API
- [ ] customers/data_request responds 200 immediately and order snapshot data is retrievable within 30 days
- [ ] customers/redact responds 200 immediately and order IDs are nulled in snapshots within 30 days
- [ ] shop/redact deletes merchant data within 48 hours
- [ ] All three compliance webhooks verify HMAC-SHA256 before processing

Notes:

## Post-Install, Reinstall & Error Handling

- [ ] Post-OAuth redirect goes to Dashboard immediately
- [ ] Migration progress banner shown during bulk import
- [ ] Wizard launches after products and variants are synced and not before
- [ ] Migration interrupted shows retry option and resumes from checkpoint
- [ ] Reinstall within 48-hour window cancels deletion and retains existing data
- [ ] Reinstall after deletion behaves as a fresh install
- [ ] Reinstall reconciliation creates no duplicate snapshots or metaobjects
- [ ] React error boundaries show friendly retry state instead of blank screens
- [ ] Expired session re-authenticates transparently
- [ ] API rate limiting applies exponential backoff with usable loading state
- [ ] Empty states appear across all pages for new merchants
- [ ] Security headers present on all admin responses
- [ ] App renders correctly inside Shopify admin iframe
- [ ] Deactivation blocked when cause assigned to active products
- [ ] Deactivated causes hidden from new assignments
- [ ] Historical snapshots with deactivated causes remain intact
- [ ] 501(c)3 status and legal name save correctly

Notes:

## Onboarding & Settings

- [ ] Wizard state persists and the merchant resumes from the last completed step
- [ ] Earlier steps marked done when resuming mid-sequence
- [ ] All wizard steps are skippable
- [ ] Post-wizard checklist shown until all steps complete
- [ ] Settings: Mistake Buffer, effective tax rate, and tax deduction mode save correctly
- [ ] Uninstall webhook triggers deletion schedule and confirmation email

Notes:

## Security & Database

- [ ] shopId enforced on all DB queries
- [ ] Rate limiting on widget endpoint
- [ ] Presigned URLs are not publicly guessable
- [ ] All admin routes reject unauthenticated requests
- [ ] All monetary columns use NUMERIC and not FLOAT or DOUBLE
- [ ] OrderSnapshot unique index prevents duplicates
- [ ] VariantCostConfig unique index enforces one config per variant
- [ ] CauseAllocation lifecycle (live -> materialised) works correctly
- [ ] PostgreSQL advisory lock prevents concurrent reconciliation runs
- [ ] AuditLog records created for all financial mutations
- [ ] Soft-delete status enum usage is consistent across entities

Notes:

## Privacy & GDPR

- [ ] PII warning shown at receipt upload
- [ ] Customer erasure nulls order IDs while preserving totals
- [ ] All merchant data deleted within 48 hours of uninstall
- [ ] Privacy policy URL present in app listing
- [ ] Tax disclaimer visible in documentation and settings

Notes:
