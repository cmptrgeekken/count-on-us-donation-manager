**Shopify Donation Manager**

Product Requirements Document

This is the primary product-definition document for the app. Use it for scope, financial rules, user-facing behavior, QA expectations, and release intent.

When this document conflicts with an implementation detail elsewhere, treat the PRD as authoritative unless a newer ADR explicitly changes the decision.

Version 2.3  |  Foundation Build

March 2026

**Amendment log — v2.1**

| **Section** | **Change** | **ADR** |
| --- | --- | --- |
| §7.2 | Full line-item detail now stored in snapshot (OrderSnapshotMaterialLine, OrderSnapshotEquipmentLine, OrderSnapshotPODLine). Reverses "NOT stored" statement. | ADR-001 |
| §9.4 | Added cash-basis assumption disclosure and accrual-basis workaround note. | ADR-002 |
| §9.9 | Production Usage Report no longer requires v2 model extension — snapshot detail available from v1. | ADR-001 |
| §10.1 | Replaced 50KB payload threshold with line item count threshold (< 200 = pre-load). Added extension network config, CORS, and Thank You page one-shot constraint notes. | ADR-003, ADR-004 |
| §10.5 | Added App Proxy cookie limitation and subpath immutability notes. | Feasibility §3 |
| §11.1 | Removed write_orders scope. Added note that it belongs to standalone Direct Giving app only. | ADR-005 |
| §11.4 | Confirmed balance transactions GraphQL feasibility with payments_transfer_id filter pattern. | Feasibility §1 |
| §12.1 | Updated OrderSnapshotLine fields (pod_cost, labor_minutes, labor_rate, mistake_buffer_amount). Added three child tables and VariantCostSummary view. Removed duplicate taxable_exposure_at_order_time column. | ADR-001, ADR-004 |
| §12.4 | Removed ProductionUsagePeriodSnapshot v2 requirement — superseded by ADR-001. | ADR-001 |
| §13.2 | Added POD-fetch-before-transaction ordering rule to SnapshotService. Added display-safe projection note to CostEngine. | ADR-003, ADR-004 |
| §16 | Added: mid-batch price change, POD widget staleness, Direct Giving Mode scope removal. | ADR-003, ADR-004, ADR-005 |
| §17 | Added: accrual-basis tax estimation (high priority v2), standalone Direct Giving app (advanced). Updated Production Usage Report note. | ADR-002, ADR-005 |

**Amendment log — v2.2**

| **Section** | **Change** | **Reason** |
| --- | --- | --- |
| §11.1 | Removed read_metafields and write_metafields (non-existent scopes). Reinstated write_products — required for product metafield writes. | Platform verification during Partner Dashboard setup |
| §14.1 | Updated scope removal note to reflect write_products reinstatement and correction of metafields assumption. | Follows from §11.1 correction |
| §11.6 | Updated bulk migration metafields scope reference from read_metafields to read_products. | Follows from §11.1 correction |
| §18 QA checklist | Updated metafields scope reference from write_metafields to write_products. | Follows from §11.1 correction |

**Amendment log — v2.3**

| **Section** | **Change** | **ADR** |
| --- | --- | --- |
| §11.1 | Removed read_all_orders scope — no longer required. | ADR-006 |
| §11.6 | Bulk migration on install removed. Section replaced with removal notice. | ADR-006 |
| §13.6 | Access token management section removed — was written exclusively for bulk migration. | ADR-006 |
| §18 QA checklist | Removed bulk migration checklist items. | ADR-006 |

# 1. Product Overview

## 1.1 Purpose

Shopify Donation Manager is a free Shopify app published on the Shopify App Store, built for cause-driven and charity-affiliated merchants. It enables merchants to track true per-variant production costs, calculate net donation pools, allocate donations to named charities, and maintain audit-ready financial records.

The app does not process or send payments to charities. It is a financial ledger and reporting tool. Merchants use the data it produces to make donation disbursements independently.

## 1.2 Core Philosophy

Donations are calculated from actual business profitability, not just product price. Every cost the merchant incurs — labor, materials, equipment, shipping, Shopify fees, and taxes — is deducted before calculating what is available to donate. The app evolves from a simple estimated donation display to a full financial donation ledger.

## 1.3 Design Principles

| **Principle** | **Description** |
| --- | --- |
| Financial correctness > convenience | Accuracy is never sacrificed for UX shortcuts |
| Snapshots are immutable | The financial record at order time is the permanent truth |
| All allocations must reconcile | Cause totals must always sum to the donation pool |
| System must be auditable | Every financial change is logged and traceable |
| UI should remain simple | Complexity is hidden behind clean interfaces |
| Maximise donation potential | Tax reserve and expense tracking are designed to free up as much for donation as possible |

## 1.4 Target Users

| **User** | **Description** |
| --- | --- |
| Merchant / Store Owner | Primary admin user. Configures costs, causes, and reviews reports. Single user per shop in v1. |
| Storefront Customer | Views donation estimates and cost breakdowns on the product page and cart summary. |

## 1.5 Distribution

- Platform: Shopify App Store (free)

- Architecture: Multi-tenant — one app instance, data isolated per shop via shopId

- Authentication: Shopify OAuth with App Bridge

- Theme compatibility: Online Store 2.0 themes required for storefront widget (disclosed in app listing and onboarding)

# 2. Goals & Non-Goals

## 2.1 v1 Goals

- Merchant can configure exact per-variant production costs using a reusable Material Library, Equipment Library, and Cost Template system

- Merchant can bulk-assign cost templates and edit yields in a spreadsheet-style table across products and collections

- Merchant can connect Printful and Printify accounts to auto-sync third-party fulfillment costs per variant

- Merchant can assign one or more charities (causes) to each product with percentage-based donation splits

- Immutable order snapshots are created at order time freezing all cost, cause, and tax data

- Donation pool is calculated from net profitability after all deductions: production costs, Shopify fees, Shopify charges, Mistake Buffer, and estimated tax reserve

- Customers see a full cost and donation breakdown on the product page storefront

- Merchant can log non-order business expenses to reduce the taxable base and maximise donations

- Merchant can view, close, and export reporting periods with cause allocation and tax reserve breakdowns

- Refunds create proportional negative adjustments without mutating snapshots

## 2.2 Non-Goals (v1)

- Automated donation disbursement or payment processing to charities

- Artist payout tracking or management

- Multi-user access or staff roles

- Support for payment gateways other than Shopify Payments

- Real-time profit calculation (requires payout data)

- Accounting software integrations (QuickBooks, Wave — planned v2)

- AI cost estimation

- Labor Library with named labor types (planned v2 — single blended rate in v1)

- Shopify Admin UI Extensions on product/variant pages (planned v2)

# 3. Onboarding & App Structure

## 3.1 App Navigation

The app admin is embedded in Shopify using App Bridge and Shopify Polaris. Navigation is grouped into four logical sections to manage the 10+ pages cleanly within Shopify's two-level sidebar navigation.

| **Group** | **Pages** | **Purpose** |
| --- | --- | --- |
| Cost Config | Material Library, Equipment Library, Cost Templates, Variant Costs | Define and manage all production cost inputs |
| Donation Setup | Causes, Product Donations | Configure charities and assign them to products |
| Finance | Reporting, Business Expenses | Reporting periods, disbursements, tax reserve, and non-order expense tracking |
| Operations | Provider Connections, Order History, Dashboard, Settings | POD integrations, order snapshot history, and app configuration |

## 3.2 First-Run Setup Wizard

On first install, a guided setup wizard walks the merchant through configuration. All steps are optional but strongly recommended. Wizard state persists to the database — if the merchant closes the browser mid-wizard, they resume from the last completed step. The wizard includes an accessible progress indicator (aria-label / role='progressbar').

| **Step** | **Description** |
| --- | --- |
| 1. Create first cause | Add at least one charity. Without a cause, no products can have donations assigned. |
| 2. Confirm Shopify Payments fee rate | App auto-detects the merchant's plan. Merchant confirms or corrects the detected rate. |
| 3. Configure Managed Markets enable date | App auto-detects via API. If unavailable, merchant enters manually. Determines applicable fee structure. |
| 4. Set up Material & Equipment Libraries | Add at least one material and/or equipment item. Libraries must be populated before cost templates. |
| 5. Create a Cost Template | Bundle materials and equipment into a reusable template. |
| 6. Configure variant costs | Assign templates to variants. Use bulk assignment for large catalogs. |
| 7. Connect POD providers (optional) | Connect Printful or Printify and map variants to their POD counterparts. |
| 8. Assign causes to products | Link causes to products and set donation percentages. |
| 9. Enable storefront widget | Deep-link to Shopify Theme Editor to activate and position the widget. |

## 3.3 Post-Wizard Reminder

Skipped steps trigger a persistent banner and checklist on the dashboard until all steps are marked complete. Each item links directly to its relevant page. The overall checklist cannot be dismissed until all steps are done.

## 3.4 Post-Install Loading State

After OAuth completes, the merchant is redirected into the embedded app. A catalog sync and balance transaction import run asynchronously in the background. The app must not show a blank or broken state during this period. Required behaviour:

- Redirect immediately to the Dashboard after OAuth — do not wait for sync to complete

- Show a persistent informational banner: 'We're syncing your store catalog. This may take a few minutes. You can start configuring the app while this runs.'

- Show a progress indicator for the sync (products and variants synced, balance transactions imported)

- The wizard launches on top of the dashboard once sync has made sufficient progress to be useful (products and variants synced)

- If sync fails or is interrupted, show a retry option and log the failure for debugging

## 3.5 App Settings Page

| **Setting** | **Detail** |
| --- | --- |
| Shopify Payments fee rate | Currently detected rate. Manual override available. Re-detected daily automatically. |
| Managed Markets enable date | Current stored date. Merchant can update. Determines applicable fee structure. |
| Mistake Buffer | Global % applied to production material costs. Default 0% (disabled). |
| Effective tax rate | Global % of net profit reserved for taxes. Default 0% (disabled). Link to external estimator provided. |
| Tax deduction mode | Don't deduct / Deduct from non-501(c)3 causes only / Deduct from all causes. |
| Post-purchase donation email | Enable/disable the branded donation summary email sent to customers after purchase. Default enabled. |
| Storefront widget | Deep-link to Shopify Theme Editor for widget placement. |
| Audit log | Full audit log of financial changes, filterable by date and event type. |

## 3.6 Uninstall & Data Handling

- All app DB data scheduled for deletion within 48 hours

- Shopify metafields and metaobjects deleted immediately via API

- S3 receipt files scheduled for deletion within 48 hours

- Confirmation email sent to merchant's store email

- Satisfies Shopify app data deletion requirements and GDPR obligations

### Reinstall Behaviour

Shopify App Store review always tests install → uninstall → reinstall. The app must handle all scenarios:

| **Scenario** | **Behaviour** |
| --- | --- |
| Reinstall within 48-hour deletion window | Deletion job is cancelled. Existing data is retained. App resumes as if uninstall had not occurred. Merchant shown their existing configuration. |
| Reinstall after deletion completes | App treats merchant as a new installation. Catalog sync and balance transaction import run from scratch. Wizard launches fresh. |
| Reinstall with partial data state | App performs a reconciliation pass on install to detect any existing snapshots or metafields and resume correctly rather than duplicating records. |

# 4. Financial Model

## 4.1 Donation Pool Formula

The donation pool is calculated at the period level as:

remaining_for_donation =

  payouts

- sales_tax

- direct_costs

- shipping_costs

- packaging_costs

- payment_processing_fees

- managed_markets_fees

- shopify_charges

- estimated_tax_reserve

- non-donation_revenue

- tips

Shopify charges (shipping labels, app fees, balance transaction debits) are sourced automatically from the Shopify Payments balance transactions API. Payment processing and Managed Markets fees are defined in Section 4.5. The estimated tax reserve is defined in Section 4.6.

## 4.2 Cause Allocation

Each product may have zero or more causes assigned, each with a percentage of net profit (0% exclusive to 100% inclusive). Exceeding 100% is a hard error. Products with no causes assigned donate 0% — valid for non-donation products in the catalog.

cause_weight = Σ(net_contribution per cause) ÷ Σ(total net_contribution)

cause_allocation = remaining_for_donation × cause_weight

## 4.3 Rounding Rules

| **Rule** | **Detail** |
| --- | --- |
| Internal precision | NUMERIC(10,2) — all monetary values stored at cent precision |
| Per-cause rounding | Each cause allocation rounded independently to nearest cent |
| Discrepancy handling | Sub-cent discrepancies silently accepted — expected consequence of independent rounding |
| Period close | Sub-cent discrepancies do not block close and are not flagged |
| Display | All values displayed to 2 decimal places |

## 4.4 Donation Configuration per Product

| **Rule** | **Detail** |
| --- | --- |
| Donation basis | Percentage of net profit after all costs (not sale price) |
| Configured at | Product level — shared across all variants |
| Storage | Shopify product metafields (donation_manager namespace) |
| No causes assigned | Valid — product donates 0%. No donation entry created. |
| Partial (1–99%) | Valid — remainder stays in merchant revenue |
| Full (100%) | Valid — entire net profit donated across assigned causes |
| Over 100% | Hard error — save blocked. Clear validation message required. |
| UI | Product Donations page in Donation Setup group |

## 4.5 Shopify Fee Calculation

### Payment Processing Fees

Auto-detected from merchant's Shopify plan via Admin API. Re-detected daily. Merchant can manually override in Settings.

| **Plan** | **Rate** | **Flat Fee** |
| --- | --- | --- |
| Basic | 2.9% | $0.30 |
| Shopify | 2.6% | $0.30 |
| Advanced | 2.4% | $0.30 |
| Plus | 2.15% | $0.30 |

Flat $0.30 fee deducted at order level in reporting only — not allocated per line item.

payment_processing_fee = (order_subtotal × rate) + $0.30

### Managed Markets Fees

| **Enabled Date** | **Plan** | **Fee** | **Includes Payment Processing?** |
| --- | --- | --- | --- |
| Before Oct 15, 2025 | All plans | 6.5% of order total | Yes |
| Oct 15, 2025 or later | Non-Plus | 3.5% of order total | No — charged separately |
| Oct 15, 2025 or later | Plus | 3.25% of order total | No — charged separately |

Fee structure determined by when the merchant enabled Managed Markets (not order date). App auto-detects enable date via API; falls back to manual entry if unavailable.

### Storefront Widget Detection

- Primary: currency mismatch → show Managed Markets fee

- Fallback: Shopify Storefront Localization API determines customer country

- No third-party geolocation required

## 4.6 Estimated Tax Reserve

An optional mechanism to reserve a portion of net profit for income, business, and self-employment taxes before calculating the donation pool. Designed to prevent over-donating before actual tax liability is known, while maximising what can be donated.

The system tracks a running deduction pool against cumulative net contribution each period. When 501(c)3 charitable giving and non-order business expenses together exceed cumulative net sales, the merchant's effective taxable income is zero — no tax reserve applies and the tax line is suppressed from the storefront widget automatically.

### Configuration (App Settings)

| **Setting** | **Detail** |
| --- | --- |
| Effective tax rate | Single global blended rate. Default 0% (disabled). Link to external estimator provided (e.g. IRS self-employment calculator). This is an estimate — not a tax filing tool. |
| Tax deduction mode | (1) Don't deduct. (2) Deduct from non-501(c)3 causes only — reserve applied proportionally to non-501(c)3 cause allocation. (3) Deduct from all causes. |

### Non-Order Business Expenses & COGS

Logged on the Business Expenses page, these form the expense side of the deduction pool for tax reserve estimation. They do not affect the donation pool calculation — per-order material costs (variant line items) handle that separately. This separation is intentional and eliminates any risk of double-counting:

| **Track** | **Purpose** | **Input source** | **Affects** |
| --- | --- | --- | --- |
| Donation pool track | Calculate net contribution available for donation after production costs | Per-order variant material, labor, equipment, and shipping costs | Donation pool only — not tax reserve |
| Tax estimation track | Estimate tax liability by measuring deductible business outlays against net sales | Business Expenses page entries (COGS + other expenses) + 501(c)3 allocations | Deduction pool and tax reserve only — not donation pool |

This means a merchant who buys $500 of sticker paper in a period will enter it as a COGS expense on the Business Expenses page. The per-order material cost (e.g. $0.30/sheet consumed per sticker sold) continues to reduce the donation pool as orders come in — both numbers are correct and serve different purposes. The $500 purchase is a cash-basis business deduction; the per-order amounts are the true cost of production.

### Deduction Pool & Taxable Exposure

The deduction pool is built entirely from Business Expenses page entries and 501(c)3 allocations. Per-order material costs are explicitly excluded — they belong to the donation pool track, not the tax estimation track. This architectural separation means there is no double-counting risk by design.

deduction_pool = cumulative_501c3_allocations + period_business_expenses

                 (excludes per-order material, labor, equipment, shipping costs)

taxable_exposure = cumulative_net_contribution - deduction_pool

Taxable exposure is unbounded — it can go negative. A negative value represents a deduction surplus: more deductible activity has accumulated than net sales, so future orders are absorbed by the surplus before any tax reserve applies.

Only 501(c)3 cause allocations count toward the deduction pool — non-501(c)3 donations are not guaranteed tax-deductible and are excluded.

### Per-Order Tax Reserve (Snapshot)

At snapshot creation time, the SnapshotService reads the live taxable_exposure directly from the database (not the hourly cache) to compute the precise tax reserve for this specific order. This ensures the financial record is accurate regardless of cache staleness:

surplus_before_order = MAX(0, -taxable_exposure_at_order_time)

taxable_portion = MAX(0, order_net_contribution - surplus_before_order)

per_order_tax_reserve = taxable_portion × effective_tax_rate × taxable_weight

Three scenarios:

- Surplus fully covers order (surplus_before_order ≥ order_net_contribution): per_order_tax_reserve = $0. Full deduction buffer absorbs this order.

- Surplus partially covers order (0 < surplus_before_order < order_net_contribution): tax reserve applies to the exposed portion only.

- No surplus (taxable_exposure already ≥ 0): full net contribution is taxable — standard calculation.

Example: deduction_pool = $800, cumulative_net_contribution = $650, taxable_exposure = -$150 (surplus). New order: net_contribution = $200. surplus_before_order = $150. taxable_portion = MAX(0, $200 − $150) = $50. Tax reserve applies to $50 only, not $200.

After snapshotting, the order's net_contribution is added to cumulative_net_contribution, reducing the surplus for subsequent orders. This update feeds into the next hourly cache refresh.

### Widget Display (Hourly Cache)

The widget uses a simpler binary display rule based on the hourly-cached taxable_exposure. Per-order proportional amounts are not shown on the widget — customers see either the full estimated tax reserve for this product or nothing at all:

widget_tax_suppressed = (taxable_exposure <= 0)

When widget_tax_suppressed = true, the estimated tax reserve section is hidden entirely from the product page widget. This keeps the customer-facing display clean and avoids showing confusing partial amounts that change order-to-order. The hourly cache lag (up to 1 hour) is acceptable given estimates are already approximate.

### Period-Level Tax Reserve Formula

The period-level tax reserve (used in reporting and the donation pool calculation) continues to use the floored taxable_base:

taxable_weight = Σ(cause_% for non-501c3 causes) ÷ 100  [mode: non-501c3 only]

taxable_weight = 1.0  [mode: all causes]

taxable_weight = 0  [mode: don't deduct]

taxable_base = MAX(0, cumulative_net_contribution - period_non_order_expenses)

period_tax_reserve = taxable_base × effective_tax_rate × taxable_weight

Note: taxable_base floors at zero for period-level reporting. taxable_exposure does not floor at zero — it is the more precise value used for per-order snapshot calculations and widget suppression. The two values diverge when the deduction pool exceeds cumulative net contribution.

The per-order snapshot tax reserve (computed at order time) will sum to approximately the period-level reserve over a full period, but may differ order-to-order as the surplus is consumed and replenished. The period-level figure is always the authoritative number for disbursement and true-up purposes.

### Tax True-Up

After filing taxes, a true-up form per reporting period records actual tax paid and redistributes the difference.

| **Scenario** | **Action** | **Result** |
| --- | --- | --- |
| Surplus (estimated > actual) | Merchant enters actual tax paid. Manually specifies redistribution across causes. | Surplus added to donation pool for active period. CauseAllocations updated. |
| Shortfall (estimated < actual) | Merchant enters actual tax paid. Confirms shortfall deduction. | Shortfall deducted from donation pool for active period. |
| Exact match | Merchant records actual tax paid. | No pool change. Record stored for audit. |

Known limitation: true-up applies to the currently active period, which may differ from periods where the reserve was originally deducted (e.g. filing March taxes for prior year). True-up form states which period receives the adjustment.

### Tax Reporting

- Total estimated tax reserve for the period

- Cumulative net contribution (donation pool track — not used in tax calculation)

- Deduction pool breakdown: cumulative 501(c)3 allocations + period business expenses by category

- Inventory & Materials sub-totals: material purchases and COGS adjustments separately

- Taxable exposure: remaining net contribution not yet covered by deductions (may be negative)

- Current widget suppression status

- Effective tax rate and tax deduction mode

- Per-cause breakdown: taxable vs non-taxable allocation

- True-up history: estimated vs actual, surplus/shortfall, redistribution log

Note: the reporting dashboard makes clear which track each figure belongs to. Net contribution and per-order costs appear under Donation Pool; deduction pool entries and tax reserve appear under Tax Estimation. These are displayed as separate sections to reinforce the architectural separation.

## 4.7 Packaging Cost Rule

order_packaging_cost = max(total shipping material cost among all shippable variants in order)

The total shipping material cost for a variant is the sum of all shipping material line items in its cost template. The max-cost rule applies the most expensive variant's shipping setup — reflecting one package per order. Allocated across line items by revenue share. True cartonization is a future enhancement.

# 5. Cost Model

## 5.1 Cost Types Overview

| **Cost Type** | **Library** | **Scales With Quantity?** | **Formula** |
| --- | --- | --- | --- |
| Labor | None in v1 — direct on variant | Yes | (hourly_rate ÷ 60) × minutes_of_labor |
| Equipment | Equipment Library | Yes | (hourly_rate ÷ 60 × minutes) + (per_use_cost × uses) |
| Materials (yield-based) | Material Library (type: Material, costing: yield) | Yes | per_unit_cost = purchase_price ÷ purchase_qty; line cost = (per_unit_cost ÷ yield) × quantity |
| Materials (uses-based) | Material Library (type: Material, costing: uses) | Yes | per_unit_cost = purchase_price ÷ purchase_qty; line cost = (per_unit_cost ÷ total_uses_per_unit) × uses_per_variant |
| Mistake Buffer | App Settings (global %) | Yes — applied to production material total | material_total × (mistake_buffer_% ÷ 100) |
| Shipping Materials | Material Library (type: Shipping Material) | No — per shipment | per_unit_cost = purchase_price ÷ purchase_qty; line cost = (per_unit_cost ÷ yield) × quantity |
| POD / Third-Party | Provider connection (Printful, Printify) | Yes — per unit | Sum of all cost line items from provider API |

v1 Labor: single blended rate per variant (minutes + hourly rate). Labor Library with named types (Assembly, Design, Packaging, Painting) planned for v2.

## 5.2 Material Library

Single library page for both Material and Shipping Material types, filterable by type. When a material's purchase price or quantity is updated, the derived per-unit cost propagates automatically to all templates and variants referencing it — but never affects past snapshots. The UI displays the derived per-unit cost live as the merchant types, so they can verify the math before saving. Supports soft delete only (status: active/inactive). Each item shows 'used by X templates, Y variants' before deactivation.

Materials support two costing models selected when the item is created. The model determines which fields live on the library item vs on the template/variant line item:

| **Field** | **Required** | **Stored on** | **Description** |
| --- | --- | --- | --- |
| Name | Yes | Library item | e.g. 'Acrylic sheets 12x12 (pack of 10)', 'Super glue tubes (pack of 5)', 'Padded mailers (box of 100)' |
| Type | Yes | Library item | Material or Shipping Material. Materials scale with quantity; Shipping Materials are per-shipment. |
| Costing model | Yes (type: Material only) | Library item | Yield-based: per-unit cost divided by a variant-specific yield. Uses-based: per-unit cost divided by a fixed total uses per unit. Shipping Materials always use yield-based. |
| Purchase price | Yes | Library item | Total price paid for the purchase batch. e.g. $15.00 for 100 sheets, $12.00 for a pack of 5 glue tubes. |
| Purchase quantity | Yes | Library item | Number of individual units in the purchase batch. e.g. 100 sheets, 5 tubes, 1 bottle. Divides into purchase_price to derive per_unit_cost. |
| Per-unit cost (derived) | n/a | Library item (computed) | purchase_price ÷ purchase_quantity. Displayed live in the UI as merchant types. Used in all cost formulas. e.g. $15.00 ÷ 100 = $0.15/sheet. |
| Total uses per unit | Yes if uses-based | Library item | Fixed property of the material — how many discrete applications one purchase unit provides. e.g. one tube of super glue = 100 uses. Intrinsic to the material, not the variant. |
| Unit description | No | Library item | e.g. 'sheet', 'tube', 'bottle' — shown in cost editor alongside the derived per-unit cost |
| Status | Yes | Library item | Active or Inactive (soft delete) |
| Notes | No | Library item | Internal merchant notes |
| Yield | Yes if yield-based | Line item (template or variant) | How many units of this variant can be produced from one purchase unit of this material. Variant-specific. e.g. small earring = 20 per sheet; large earring = 8 per sheet. |
| Quantity | Yes if yield-based | Line item (template or variant) | How many purchase units are consumed per production run. Usually 1, but may be higher (e.g. a large canvas uses 2 sheets). |
| Uses per variant | Yes if uses-based | Line item (template or variant) | How many uses of this material are consumed to produce one unit of this variant. e.g. a pin = 1 use of super glue; a multi-piece earring = 3 uses. |

Key distinction: for yield-based materials, yield is variant-specific (entered on the line item) because how many pieces fit on a sheet depends on each variant's size and shape. For uses-based materials, total uses is material-specific (stored on the library item) because a tube of super glue always yields the same number of applications regardless of what you're making.

Full cost formulas:

per_unit_cost = purchase_price ÷ purchase_quantity

yield-based line item cost  = (per_unit_cost ÷ yield) × quantity

uses-based line item cost   = (per_unit_cost ÷ total_uses_per_unit) × uses_per_variant

Examples:

| **Material** | **Model** | **Purchase** | **Library stores** | **Line item stores** | **Formula** |
| --- | --- | --- | --- | --- | --- |
| Acrylic sheets | Yield-based | $40.00 for 10 sheets | purchase_price=$40, purchase_qty=10 → per_unit=$4.00 | yield=20 (small earrings/sheet), qty=1 | ($4.00÷20)×1 = $0.20/earring |
| Sticker paper | Yield-based | $15.00 for 100 sheets | purchase_price=$15, purchase_qty=100 → per_unit=$0.15 | yield=12 (stickers/sheet), qty=1 | ($0.15÷12)×1 = $0.0125/sticker |
| Super glue | Uses-based | $12.00 for 5 tubes | purchase_price=$12, purchase_qty=5 → per_unit=$2.40, total_uses=100 | uses_per_variant=1 (per pin) | ($2.40÷100)×1 = $0.024/pin |
| Acrylic paint | Uses-based | $5.00 for 1 bottle | purchase_price=$5, purchase_qty=1 → per_unit=$5.00, total_uses=50 | uses_per_variant=2 (per earring) | ($5.00÷50)×2 = $0.20/earring |
| Padded mailers | Yield-based | $45.00 for 100 mailers | purchase_price=$45, purchase_qty=100 → per_unit=$0.45 | yield=1, qty=1 | ($0.45÷1)×1 = $0.45/shipment |

## 5.3 Equipment Library

Separate library for equipment. Each item can have an hourly rate, a per-use cost, or both. At least one must be set. Follows the same soft-delete model as materials with usage indicators.

| **Field** | **Required** | **Description** |
| --- | --- | --- |
| Name | Yes | e.g. 'Inkjet printer', 'Cricut Maker', 'Laser cutter' |
| Hourly rate | No | Cost per hour. If set, variant supplies minutes of use. |
| Per-use cost | No | Cost per activation. If set, variant supplies number of uses. |
| Status | Yes | Active or Inactive (soft delete) |
| Notes | No | Internal merchant notes |

## 5.4 Mistake Buffer

| **Property** | **Detail** |
| --- | --- |
| Scope | Production materials only (type: Material, both yield-based and uses-based). Shipping Materials, Equipment, Labor, and POD costs excluded. |
| Configuration | Single global % in App Settings. Default 0% (disabled). No per-product override. |
| Formula | mistake_buffer_cost = material_total × (mistake_buffer_% ÷ 100) |
| Display | Named line item 'Mistake Buffer' in variant cost editor and storefront widget, beneath the Materials section. |
| Snapshot | Buffer % stored in snapshot for audit purposes. Included in material_cost rolled-up total. |

Example: $4.00 in materials + 15% buffer = $0.60 added, total material cost $4.60.

## 5.5 Cost Templates

Reusable bundles of materials, equipment, and shipping materials. Live references — CostEngine resolves costs from template and library at calculation time. Past snapshots are never affected.

| **Property** | **Detail** |
| --- | --- |
| Material line items (yield-based) | References a yield-based Material Library item. Line item stores yield (variant-specific: how many of this variant per purchase unit) and quantity (how many purchase units consumed per run). Per-unit cost = (unit_cost ÷ yield) × quantity. |
| Material line items (uses-based) | References a uses-based Material Library item. Line item stores uses_per_variant (how many uses this variant consumes). total_uses_per_unit is read from the library item. Per-unit cost = (unit_cost ÷ total_uses_per_unit) × uses_per_variant. |
| Shipping material line items | References a Shipping Material item (always yield-based). Line item stores yield and quantity. Does NOT scale with order quantity — per shipment only. |
| Equipment line items | References Equipment Library item. Line item stores default minutes of use (if hourly rate set) and/or number of uses (if per-use cost set). |
| Resolution | CostEngine resolves live from template and library at calculation time. No fan-out jobs. |
| Snapshot behaviour | Costs frozen at order time as four rolled-up totals (labor, materials, equipment, packaging). |
| Inactive items | CostEngine uses last known values for deactivated library items. |
| Per-variant overrides | Yield, quantity, and uses_per_variant independently editable per variant without breaking template link. |
| Template deactivation | Soft delete only. Active variants continue resolving correctly. |
| Usage indicator | Template list shows 'used by X variants'. Library items show 'used by X templates, Y variants'. |

Example — Sticker template: Cricut Maker (equipment, hourly), sticker paper (material, yield-based), laminate sheet (material, yield-based), padded mailer (shipping material), address label (shipping material).

Example — Resin jewellery template: Laser cutter (equipment, hourly), resin bottle (material, uses-based: 30 pours), super glue tube (material, uses-based: 100 uses), acrylic paint (material, uses-based: 50 uses), small box (shipping material), tissue paper (shipping material).

## 5.6 Variant Cost Configuration

Each variant has its own cost configuration — template-assigned (live reference) or from scratch. Labor is a single direct line item (minutes + hourly rate). When a material is assigned, the UI displays its derived per-unit cost (purchase_price ÷ purchase_quantity) alongside the material name so the merchant knows the rate they're working from. Adaptive material inputs reflect the costing model: yield-based materials show yield and quantity fields; uses-based materials show uses_per_variant only. Adaptive equipment inputs: minutes shown only if hourly rate set; uses shown only if per-use cost set. Live cost preview updates net contribution as values are entered.

| **Scenario** | **Approach** |
| --- | --- |
| Acrylic earrings — same sheet, different yields per size | Assign 'Acrylic' template with the acrylic sheet material. Per variant: set yield to how many of that earring size fit on the sheet (e.g. small = 30, large = 12). |
| Pin with super glue — same 1 use per variant | Assign template with super glue (uses-based). All variants default to uses_per_variant = 1. No per-variant adjustment needed. |
| Complex earring using more glue than a simple one | Same template, different uses_per_variant per variant (e.g. simple = 1 use, multi-piece = 3 uses). |
| Template as base + extra material | Assign template, then add extra line item directly on variant. |
| Unique setup | Configure from scratch without a template. |

Example — small acrylic earring: acrylic sheet $4.00, yield = 30 (small earrings per sheet), quantity = 1. Cost = $4.00 ÷ 30 = $0.13 per earring.

Example — large acrylic earring: same $4.00 sheet, yield = 8 (large earrings per sheet), quantity = 1. Cost = $4.00 ÷ 8 = $0.50 per earring. Same material library item, different yield on the line item.

## 5.7 Bulk Cost Management

### Bulk Template Assignment

| **Property** | **Detail** |
| --- | --- |
| Targets | Individual variants, entire products, or all variants in a Shopify collection |
| Post-assignment | Each variant gets template as live reference. Yields, quantities, and uses_per_variant adjustable individually or via bulk table editor. |
| Existing configs | Warning shown if selected variants already have configs. Confirmation required before overwriting. |

### Bulk Table Editor

Polaris IndexTable-based view with columns for each cost line item. Edit yield, quantity, uses_per_variant, minutes, and equipment uses inline across multiple rows. Adaptive columns — yield and quantity columns shown for yield-based material line items; uses_per_variant column shown for uses-based material line items. The costing model is determined by the material library item referenced, not configurable per row. Paginated for large catalogs. Keyboard navigation: Tab between cells, Enter activates edit mode, Escape cancels, Save accessible via keyboard.

## 5.8 Third-Party Cost Providers (POD)

### Supported Providers

| **Provider** | **Authentication** | **Costs available** |
| --- | --- | --- |
| Printful | OAuth — merchant connects via OAuth flow in app | Base product cost, shipping estimates, branding/packing fees, digitization fees |
| Printify | API key — merchant enters key from Printify dashboard | Base product cost, shipping estimates, additional fees |

### Variant Linking

| **Method** | **Detail** |
| --- | --- |
| Auto-match | On connection, app matches Shopify variants to POD variants by SKU. Matched variants linked automatically. |
| Manual mapping | Unmatched variants surfaced in Provider Connections with a manual mapping UI. |
| Unmapped | Variants with no POD mapping use manual cost config only. |

### Cost Sync Model

| **Scenario** | **Behaviour** |
| --- | --- |
| Daily sync | Scheduled job fetches latest costs for all linked variants from each provider. Stores in ProviderCostCache. |
| Manual refresh | Merchant triggers immediate refresh from Provider Connections page. |
| Snapshot creation | SnapshotService fetches live cost from provider API at order time for accuracy. |
| Provider unavailable | Fallback to cached cost. Snapshot flagged 'POD cost estimated'. Merchant notified. |
| Widget estimates | Uses daily-synced cached cost — no live API call on page load. |

POD costs coexist with manual costs per variant. Merchant chooses whether POD replaces or supplements manual config (e.g. POD base cost + manual labor for quality checking).

# 6. Cause Management

## 6.1 Overview

Causes (charities/nonprofits) are stored as Shopify metaobjects under the donation_manager.cause definition. This makes them natively available to the storefront Theme Extension without additional API calls. The Causes page is in the Donation Setup navigation group.

## 6.2 Cause Data Model

| **Field** | **Required** | **Storage** | **Notes** |
| --- | --- | --- | --- |
| Name | Yes | Metaobject field | Display name of the charity |
| Description | Yes | Metaobject field | Short description shown to customers |
| Legal nonprofit name | No | Metaobject field | Legal registered name if different from display name — for tax filing |
| 501(c)3 status | No | Metaobject field | Boolean. Used by tax reserve engine to determine taxable_weight. |
| Icon / Image | No | Metaobject field | Logo for storefront display |
| Donation Link | No | Metaobject field | Direct URL to donate — opens in new tab on storefront |
| Website URL | No | Metaobject field | Charity's main website |
| Instagram URL | No | Metaobject field | Charity's Instagram profile |
| Status | Yes | Metaobject field | Active or Inactive (soft delete) |

## 6.3 UI Behaviour

| **Action** | **Behaviour** |
| --- | --- |
| Create | Modal over Causes list. Name and description required. All other fields optional. |
| Edit | Same modal pre-populated. All fields editable. |
| Deactivate | Soft deactivation. Blocked if cause is assigned to active products — merchant shown list of affected products to reassign first. Inactive causes hidden from new assignments but preserved in snapshots. |
| Reactivate | Available at any time. Cause becomes selectable again for new assignments. |
| Delete | Not supported in v1. Deactivation is the only removal path. |

## 6.4 Product Cause Assignment

On the Product Donations page (Donation Setup group), merchants assign causes and set donation percentages at the product level (shared across all variants). Data stored as Shopify product metafields in the donation_manager namespace.

| **Metafield** | **Type** | **Purpose** |
| --- | --- | --- |
| donation_manager.cause_ids | List of metaobject GIDs | Which causes are assigned to the product |
| donation_manager.cause_percentages | JSON map of cause GID to % | Donation split per cause |
| donation_manager.donation_percentage | NUMERIC | Overall % of net profit to donate for this product |

## 6.5 Cause Assignment Priority

| **Priority** | **Rule** |
| --- | --- |
| 1 (highest) | Manual override on order line item |
| 2 | Tag-based override |
| 3 | Category override |
| 4 (default) | Product default cause assignment |

# 7. Order Snapshot System

## 7.1 Purpose

At order creation, the app creates an immutable accounting record freezing all cost, pricing, cause, and tax data as it existed at that moment. This is the permanent financial source of truth. Snapshots are never mutated. Changes are handled via adjustments or recalculation runs.

## 7.2 Snapshot Contents

Per line item:

- variant_id, quantity, price

- labor_cost, material_cost (includes Mistake Buffer), equipment_cost, packaging_cost — four rolled-up totals

- mistake_buffer_percentage — rate applied at order time (audit)

- taxable_exposure_at_order_time — live period taxable_exposure when snapshot was created (signed value, may be negative)

- surplus_absorbed — portion of this order's net contribution covered by the deduction surplus (may be zero)

- taxable_portion — net contribution subject to tax after surplus absorption

- estimated_tax_reserve — per-order tax reserve (taxable_portion × rate × weight)

- effective_tax_rate, tax_deduction_mode, taxable_weight — tax settings at order time (audit)

- net_contribution — price minus all costs including per-order tax reserve

- assigned causes with percentage allocations and 501(c)3 status at order time

- origin flag — webhook or reconciliation-originated

Full line-item detail is stored in three child tables per snapshot line for audit and drill-down purposes. Four category totals (labor, materials, equipment, packaging) are also stored as denormalised sums on OrderSnapshotLine for fast reporting queries. The snapshot is fully self-contained — it does not depend on any library, template, or config record to be meaningful or auditable. Material and equipment names, prices, and all cost fields are copied at order time. See ADR-001.

**OrderSnapshotMaterialLine** (snapshot_line_id FK, material_id, material_name, material_type ENUM, costing_model ENUM, purchase_price NUMERIC(10,2), purchase_quantity NUMERIC(10,4), per_unit_cost NUMERIC(10,4), yield NUMERIC(10,4) nullable, uses_per_variant NUMERIC(10,4) nullable, quantity NUMERIC(10,4), line_cost NUMERIC(10,2))

**OrderSnapshotEquipmentLine** (snapshot_line_id FK, equipment_id, equipment_name, hourly_rate NUMERIC(10,2) nullable, per_use_cost NUMERIC(10,2) nullable, minutes NUMERIC(10,2) nullable, uses NUMERIC(10,2) nullable, line_cost NUMERIC(10,2))

**OrderSnapshotPODLine** (snapshot_line_id FK, provider ENUM, cost_line_type, description, amount NUMERIC(10,2))

## 7.3 Refunds & Adjustments

- Refunds create negative adjustments against snapshot values — original snapshot never modified

- Partial refunds: adjustment proportional to refunded quantity vs original (2 of 5 units = 2/5 of values)

- Donation pool and cause allocations updated by the negative adjustment

- Cause balances may go temporarily negative — expected and preserved for accuracy

- AdjustmentService handles all refund changes. Adjustments are append-only and audit-logged.

# 8. Webhook Handling & Reconciliation

## 8.1 Webhooks

| **Webhook** | **Trigger** | **Handler** |
| --- | --- | --- |
| orders/create | New order placed | SnapshotService. Idempotent — no action if snapshot exists. Uses order ID as idempotency key. Triggers EmailService after snapshot confirmed. |
| orders/updated | Price or line item changes only (tags/notes/fulfillment ignored) | Adjustment against existing snapshot if subtotal or line items changed. |
| refunds/create | Refund issued | AdjustmentService with refunded items and quantities from payload. |
| products/update | Product changes | CatalogSync. |
| variants/update | Variant price/title changes | CatalogSync. |
| payouts/create | Shopify Payments payout issued | Anchor ReportingPeriod. Trigger balance transaction sync for Shopify charges. |
| app/uninstalled | Merchant uninstalls the app | Delete metafields/metaobjects immediately. Schedule DB and S3 deletion within 48 hours. Cancel deletion if merchant reinstalls within window. |

All webhook subscriptions managed declaratively via shopify.app.toml (see Section 13.5). Shopify controls retry delivery (exponential backoff, up to 48 hours). App returns 2xx immediately; processing is async. All webhooks verified via HMAC-SHA256 — unverified payloads rejected with 401 and logged.

## 8.2 Daily Reconciliation Job

Server-side cron job runs daily as a safety net for missed snapshots. Acquires a PostgreSQL advisory lock before running — if a run is still active, the new run is skipped and logged.

| **Property** | **Detail** |
| --- | --- |
| Frequency | Once daily (server cron) |
| Method | Queries Shopify Orders API for all orders since last run; checks each against existing snapshots |
| On missing snapshot | Creates snapshot using costs and cause assignments current at reconciliation time |
| Audit flag | Flagged as reconciliation-originated. Visible only via Order History filter. |
| Stale data note | Uses current cost config, not config at order time. Disclosed in known limitations. |

## 8.3 Shopify Charges Sync

Balance transactions (shipping labels, app fees, adjustments) are imported from the Shopify Payments Balance Transactions API and stored in ShopifyChargeTransaction, deducted from the donation pool as shopify_charges.

| **Property** | **Detail** |
| --- | --- |
| Scope | Requires shopify_payments_payouts OAuth scope |
| Transaction types | charge, debit, adjustment — any balance reduction |
| Sync trigger | On payouts/create webhook and daily reconciliation job |
| Deduplication | shopify_transaction_id UNIQUE index prevents double-counting |
| Display | Shopify Charges line item in Reporting. Deducted from donation pool. |
| Historical import | All available balance transactions imported on install via cursor-based pagination |

# 9. Reporting System

## 9.1 Reporting Periods

Anchored to Shopify payout cycles. Supports monthly, campaign, and custom date range views.

| **State** | **Description** |
| --- | --- |
| OPEN | Active. Orders added, totals live. Tax reserve and CauseAllocation computed live from snapshot data. |
| CLOSING | Merchant-initiated. Totals finalising. No new orders added. |
| CLOSED | Locked. All totals, allocations, and snapshots frozen. CauseAllocation materialised. Required before disbursement logging. |

## 9.2 Summary Dashboard

Donation-centric view of the current period:

- Per-cause allocation amounts

- Disbursed vs pending per cause

- Tax reserve summary: taxable base, rate, mode, expenses deducted

- Shopify charges deducted for the period

## 9.3 Disbursement Logging

Multiple partial disbursements per cause per period. Cumulative disbursed vs remaining tracked across all payments.

| **Field** | **Required** | **Notes** |
| --- | --- | --- |
| Cause | Yes | Selected from active causes |
| Amount paid | Yes | Dollar amount |
| Date of payment | Yes |  |
| Payment method | Yes | e.g. check, wire transfer, online |
| Reference / transaction ID | No | For audit |
| Receipt upload | No | Image or PDF. PII warning shown at upload. Stored in S3, served via presigned URL (1hr expiry). Visible on /apps/donation-receipts storefront page. |

## 9.4 Business Expenses

The Business Expenses page (Finance group) allows merchants to log non-order expenses per reporting period. These entries feed the tax estimation track only — they reduce the deduction pool and taxable exposure, but have no effect on the donation pool. Per-order material costs (from variant cost configuration) are not entered here and are not part of this calculation.

Each entry includes: category, sub-type (where applicable), name, amount, date, and optional notes. All entries are editable and deletable. The page shows a running total of expenses for the period and the resulting reduction in estimated tax reserve.

| **Category** | **Sub-type** | **Examples** | **Notes** |
| --- | --- | --- | --- |
| Inventory & Materials | Material purchase | Sticker paper case, acrylic sheets, padded mailers, super glue bulk order, resin bottles | Cash-basis inventory purchases. Log when purchased, not when consumed. This is the correct tax deduction basis for most small businesses and complements (but does not overlap with) per-order material costs. |
| Inventory & Materials | COGS adjustment | Period-end COGS correction based on merchant's own inventory accounting | Optional manual adjustment for merchants who track inventory more precisely. Use when actual COGS differs from material purchase totals. |
| Software subscriptions | — | Shopify plan, Canva, Adobe Creative Cloud, design tools |  |
| Equipment purchases | — | Cricut Maker, laser cutter, printer (capital expenses) |  |
| Professional services | — | Accountant, legal fees |  |
| Bank & payment fees | — | PayPal fees, wire charges outside Shopify |  |
| Home office / workspace | — | Proportional rent, utilities, internet |  |
| Other | — | Any other deductible expense (freeform notes) |  |

Tax disclaimer: this app is not tax accounting software. The COGS and expense entries here are used solely to estimate the tax reserve and reduce it where possible. Merchants should consult a qualified accountant for their actual tax obligations, particularly regarding inventory accounting method (cash vs accrual basis).

**Accounting basis assumption:** This page assumes cash-basis accounting — expenses are deducted in the period the cash is paid, not when inventory is consumed. This is the correct default for most small businesses. Accrual-basis merchants should not enter full material purchase amounts here, as per-order consumption is already tracked separately via variant cost configuration. Accrual-basis merchants who need a more precise deduction can use the COGS adjustment sub-type to enter only the consumed portion for the period. Full accrual-basis support is planned for a future version — see Section 17.

## 9.5 Historical View & Trends

- Per-cause donation totals over time

- Revenue and costs over time

- All closed periods accessible with locked production data

## 9.6 Recalculation Delta View

Merchant triggers 'Run recalculation' button. Async run notified on completion. Shows per-period and per-cause delta between immutable snapshot values and recalculated values. Analytical only — does not affect authoritative figures.

## 9.7 Tax True-Up

Per-period form after tax filing. Records actual tax paid vs estimated reserve. Surplus redistributed manually by merchant across causes. Shortfall deducted from donation pool. All scenarios audit-logged in TaxTrueUp record.

## 9.8 Export

| **Format** | **Use case** |
| --- | --- |
| CSV | Accounting software or further analysis |
| PDF | Stakeholders, evidence of donation activity |

## 9.9 Production Usage Report (v2)

Planned v2 report: operations-centric view of material consumption, equipment hours, labor, shipping materials, and POD costs per period. Follows the same live-when-open, materialised-at-close lifecycle as CauseAllocation. Per ADR-001, full line-item detail is now stored in OrderSnapshotMaterialLine, OrderSnapshotEquipmentLine, and OrderSnapshotPODLine from v1 — the ProductionUsagePeriodSnapshot model extension noted in earlier drafts is no longer required. Export: CSV and PDF.

# 10. Storefront Display

## 10.1 Product Page — Cost Breakdown Widget

A Shopify Theme App Extension (App Block with JavaScript rendering) renders a cost transparency widget on each product page. Hidden by default — revealed via a toggle link (e.g. 'See how we calculate this'). Expands inline below the toggle. OS2.0 themes only.

### Visibility Rules

| **Condition** | **Behaviour** |
| --- | --- |
| Product has causes assigned | Toggle shown. Widget expands inline on click. |
| Product has no causes (0% donation) | Toggle and widget hidden entirely. Page unaffected. |
| Variant has no cost config | Widget shown with 'Not configured' placeholder for cost rows. |
| Cost data fails to load | Graceful error: 'Cost breakdown unavailable'. Toggle remains visible. |
| Localization API fails | Falls back to currency mismatch detection only. |

### Reactivity & Performance

Variant cost data delivered via a threshold-based dual strategy. Before any cost resolution, the server runs a cheap aggregate query — total line items (material + equipment + shipping material lines) across all variants for the product. If total line items < 200: all variant cost data is resolved at page render time and embedded as JSON in a `<script type="application/json">` block (pre-load strategy, zero network requests on interaction). If total line items ≥ 200: no cost data is embedded at page render; the widget fetches from the app server on first toggle open only, then caches in memory for subsequent variant switches (lazy-load strategy, single fetch on first open). Both strategies produce identical widget behaviour — the customer experience is the same. A `variant_cost_summary` view or denormalised line item count on `VariantCostConfig` is required to make the threshold query cheap. See ADR-004.

The storefront cost data endpoint returns a display-safe projection only — it must never include net contribution amounts, profit margins, or material purchase prices. Rate-limited per shop to prevent margin data scraping.

**Extension network configuration:** The Checkout UI Extension (Thank You page) requires `network_access = true` and an `allowed_urls` whitelist in `shopify.extension.toml` specifying the app server URL. The extension will silently fail to deploy without the `allowed_urls` entry. The app server must return correct `Access-Control-Allow-Origin` headers for the Shopify checkout domain — fetch calls from the extension are made client-side and CORS applies.

**Thank You page one-shot constraint:** The Thank You page (`purchase.thank-you.block.render`) is shown exactly once per order. If the customer refreshes or revisits the URL, they are redirected to the Order Status page. The 30-second polling window is the only opportunity to show confirmed amounts on the Thank You page. The Order Status page (`customer-account.order-status.block.render`) serves as the recovery path for customers who revisit.

### Widget Section Order

| **Order** | **Section** | **Contents** |
| --- | --- | --- |
| 1 | Causes | Icon/logo, name, estimated donation in customer's selected currency (Shopify Storefront API MoneyV2), donation link (new tab). Reflects variant and quantity. |
| 2 | Cost Breakdown | Each cost line item: labor, equipment, materials, Mistake Buffer, shipping materials. Name, quantity, rate, line total. Scaled by quantity. |
| 3 | Shopify Fees | Payment processing fee and Managed Markets fee (international only). Scaled by quantity and variant price. |
| 4 | Estimated tax reserve | Shown only when ALL of: (a) effective_tax_rate > 0%, (b) mode ≠ 'don't deduct', and (c) taxable_exposure > 0 (period deductions have not yet offset cumulative net sales). Suppressed entirely when deductions cover taxable exposure. Labelled 'Estimated tax reserve'. |

All values are estimates. Widget labelled clearly: 'Estimated breakdown — actual donation confirmed after purchase'.

### Accessibility (WCAG 2.1 AA)

- Toggle link keyboard accessible with descriptive aria-label

- aria-expanded on toggle communicates open/closed state

- Focus moves to first focusable element inside widget on expand

- Variant/quantity changes announced via aria-live region

- Cost breakdown rendered as semantic HTML table with th, td, caption

- Sections differentiated by headings/icons — not colour alone

- Colour contrast: 4.5:1 for normal text across common themes

## 10.2 Cart Summary — Cause Totals

'See your donation impact' button near cart opens a modal with per-cause donation totals for the full cart. Not the full line-item breakdown.

| **Property** | **Detail** |
| --- | --- |
| Trigger | 'See your donation impact' button near cart |
| Display | Per-cause totals across all cart items with cause assignments |
| Cause detail | Icon, name, total donation in customer's currency, donation link (new tab) |
| Excludes | Full cost/fee breakdown (product page only) |
| Non-donation items | Omitted ($0 contribution) |
| Error state | 'Donation summary unavailable' if cart data fails |
| Accessibility | Focus trapped in modal when open. Returns to trigger on close. Accessible name via aria-label. |

## 10.3 Thank You Page — Donation Confirmation

A Checkout UI Extension renders a donation summary block on the Thank You page immediately after purchase. This is the primary post-purchase touchpoint — shown at the moment the customer is most engaged and emotionally invested.

Implementation: Checkout UI Extension registered in shopify.app.toml under [[extensions]] with type ui_extension. Uses the purchase.thank-you.block.render target for the Thank You page and the customer-account.order-status.block.render target for the Order Status page (so customers can revisit their donation summary later). Both targets must be exported from the same extension entry point.

### Order Data Timing Constraint

On the Thank You page (purchase.thank-you.block.render), the order may not yet be fully created in Shopify's system at the moment the extension first renders — there is a processing delay between checkout completion and order creation. The order ID is available, but the snapshot may not yet exist. The extension must handle this gracefully:

- On mount: attempt to fetch donation data from the app server using the order ID

- If snapshot not yet available (404 or empty): display an estimated donation amount derived from cart line items and configured cause percentages

- Poll the app server every 3 seconds for up to 30 seconds for the confirmed snapshot

- Once snapshot confirmed: replace estimates with confirmed amounts, clearly labelled as 'Confirmed donation'

- If snapshot never arrives within 30 seconds: show estimated amounts with label 'Estimated — we'll confirm this shortly'

| **Property** | **Detail** |
| --- | --- |
| Trigger | Automatically shown after checkout for any order containing donation products |
| Content | Per-cause donation amounts in customer's currency, cause icons and names, donation links (new tab), total donated this order |
| Empty state | Hidden entirely if no products in the order have cause assignments |
| Error state | If app server unavailable, extension fails silently — Thank You page is unaffected |
| Accessibility | Semantic heading structure, non-colour differentiation, readable on mobile |
| Merchant control | Merchant can enable/disable via Theme Editor |

## 10.4 Post-Purchase Donation Email

A branded transactional email is sent to the customer after every order containing donation products. This is separate from Shopify's order confirmation email — the app sends it independently via a transactional email provider. Shopify's order confirmation email cannot be modified by apps without the merchant manually editing Liquid templates, which is fragile and unsupported.

| **Property** | **Detail** |
| --- | --- |
| Trigger | orders/create webhook — sent after snapshot creation confirms donation amounts |
| Customer email source | Retrieved from the orders/create webhook payload (contact_email field). No additional read_customers scope required — order webhook payload includes customer contact details. |
| Timing | Sent within minutes of order placement, after snapshot is created |
| From address | Configurable by merchant in Settings (e.g. donations@theirstore.com or a default app address) |
| Subject line | e.g. 'Your donation impact from [Store Name] — Order #12345' |
| Content | Thank you message, per-cause donation amounts and icons, donation links, link to /apps/donation-receipts for history, store branding (logo, name, colours from Shopify shop object) |
| Opt-in | Merchant enables/disables in Settings. Default enabled. Customer cannot opt out in v1 (v2 enhancement). |
| Unsubscribe | v2 enhancement — requires managing an unsubscribe list. Noted in limitations. |
| Provider | Transactional email provider (e.g. Postmark, SendGrid, Resend). Configured at app level. |
| GDPR | Customer email address used for this single transactional purpose only. Not stored beyond delivery. Disclosed in privacy policy. |

## 10.5 Donation Receipts Page

Shopify App Proxy serves a public storefront page at /apps/donation-receipts. App Proxy requests verified via HMAC-SHA256 — unsigned requests rejected with 403.

| **Property** | **Detail** |
| --- | --- |
| URL | Merchant-configurable, e.g. /apps/donation-receipts. Note: the proxy subpath is immutable after installation — changes to the subpath in shopify.app.toml only apply to new installs, not existing merchants. |
| Layout | Closed periods in reverse chronological order. Each shows: dates, total donated, disbursements with cause/amount/date/method/receipt link. |
| Empty state | Message explaining receipts appear here after donations are made. |
| Receipts | Presigned S3 URLs, 1hr expiry, refreshed on page load. Rate-limited to prevent enumeration. |
| PII warning | Shown at upload: 'This receipt will be publicly visible. Redact all personal information before uploading.' |
| Accessibility | Semantic heading structure, skip navigation, accessible disbursement table (WCAG 2.1 AA) |
| Rate limiting | Must be IP-based or token-based. App Proxy strips all cookies — session-based rate limiting is not available on this endpoint. |

# 11. Shopify Integration

## 11.1 OAuth Scopes

All scopes declared at install. Changing scopes requires merchant re-authorisation.

| **Scope** | **Purpose** | **Notes** |
| --- | --- | --- |
| read_products, write_products | Sync product catalog via CatalogSync; read/write product cause assignment metafields (donation_manager namespace) | write_products is required for product metafield writes — standalone write_metafields scope does not exist in Shopify API |
| read_orders | Order snapshot creation and reconciliation (7-day lookback) |  |
| read_metaobjects, write_metaobjects | Read/write Cause records stored as metaobjects |  |
| read_metaobject_definitions, write_metaobject_definitions | Create donation_manager.cause definition on install; delete on uninstall |  |
| shopify_payments_payouts | Payouts (reporting periods) and balance transactions (Shopify charges) | Replaces incorrect read_payment_terms from earlier spec |
| write_app_proxy | Serve /apps/donation-receipts via App Proxy |  |
| read_locales | Storefront Localization API for international customer detection |  |

Note: `write_orders` is intentionally excluded. It is required for programmatic payment capture and belongs exclusively to the future standalone Direct Giving app. Adding it to the core app would introduce payment capture responsibility and a categorically different risk profile. See ADR-005.

Note: `read_all_orders` has been removed. Historical order import is not implemented — see ADR-006. The reconciliation job uses a 7-day lookback window which falls within the standard `read_orders` 60-day scope.

## 11.2 Mandatory GDPR Compliance Webhooks

Shopify requires all public App Store apps to implement three mandatory compliance webhooks. These are distinct from regular event webhooks and must be configured using the compliance_topics field in shopify.app.toml. Failure to implement these is one of the most common causes of App Store rejection.

| **Webhook topic** | **Trigger** | **Required handler behaviour** |
| --- | --- | --- |
| customers/data_request | A customer requests their data from the merchant | Retrieve all OrderSnapshot records linked to the customer's order IDs. Provide the data to the merchant (not directly to the customer) within 30 days. Respond 200 immediately. |
| customers/redact | A customer requests data deletion from the merchant (withheld 6 months if recent orders) | Null the shopify_order_id on all relevant OrderSnapshotLine records. Financial totals are preserved for reporting integrity. Respond 200 immediately; complete within 30 days. |
| shop/redact | 48 hours after the merchant uninstalls the app | Delete all remaining merchant data from the database and S3. Same as the app/uninstalled flow in Section 3.5 — this webhook is the authoritative trigger for shop data deletion. |

Configuration in shopify.app.toml:

[[webhooks.subscriptions]]

compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]

uri = "/webhooks/compliance"

## 11.3 App Name

⚠️ The name 'Shopify Donation Manager' will be rejected by the Shopify App Store. Shopify prohibits the use of 'Shopify' in app names. The app listing must use a distinct name such as 'Donation Manager' or a branded name (e.g. 'GiveTrack', 'CauseCount'). The internal codebase, repository, and documentation can retain the working title.

## 11.4 GraphQL Admin API Requirement

As of April 1, 2025, all new public Shopify apps must be built exclusively with the GraphQL Admin API. The REST Admin API is considered legacy and must not be used. This has implications for the following:

| **Feature** | **Consideration** |
| --- | --- |
| Balance transactions / payouts | Confirmed feasible via GraphQL. Use `shopifyPaymentsAccount { balanceTransactions }` with the `payments_transfer_id` filter to query by payout ID (e.g. `query: "payout_date:{{date}} payments_transfer_id:{{payoutId}}"`). The `payout_id` parameter from the REST API does not exist directly in GraphQL — use `payments_transfer_id` instead. Confirmed working by community as of mid-2025. |
| Bulk Operations API | Already GraphQL-based — no issue. |
| Product / variant sync | GraphQL Admin API fully supports this. |
| Metafields / metaobjects | GraphQL Admin API fully supports this. |
| Webhooks | GraphQL-based webhook subscriptions supported via Shopify CLI and TOML configuration. |

Action required: verify at implementation start that all required data (especially balance transactions and payout summaries) is available at the required granularity via the GraphQL Admin API before committing to the data model.

## 11.5 Metafield & Metaobject Definitions

| **Type** | **Namespace / Definition** | **Fields** | **Purpose** |
| --- | --- | --- | --- |
| Product metafield | donation_manager.cause_ids | List of metaobject GIDs | Cause assignments per product |
| Product metafield | donation_manager.cause_percentages | JSON map of cause GID to % | Donation split per cause per product |
| Product metafield | donation_manager.donation_percentage | NUMERIC | Total donation % for product |
| Metaobject definition | donation_manager.cause | name, legal_nonprofit_name, is_501c3, description, icon, donation_link, website_url, instagram_url, status | Cause records |

## 11.6 Bulk Migration on Install

**Removed in v2.3. See ADR-006.**

Historical order import is not implemented. Pre-install orders have no cost configuration or cause assignments, making retroactive snapshots inaccurate and potentially misleading to charity partners and auditors. Count On Us begins tracking from the point of installation and configuration.

On install, the following data is still synced:

| **Data type** | **Approach** | **Scope required** |
| --- | --- | --- |
| Products & variants | Full catalog sync via CatalogSync with cursor-based pagination. | read_products |
| Balance transactions | Import all Shopify Payments balance transaction history. Cursor-based pagination. | shopify_payments_payouts |

Order history import is not performed. The onboarding wizard communicates the "starts fresh" model clearly to merchants.

## 11.7 Theme Extension

App Block with JavaScript rendering (not Liquid settings — avoids 25-settings-per-block limit). Compatible with Online Store 2.0 themes only. Merchant positions via Theme Editor. Legacy theme support planned for v2.

## 11.8 App Store Requirements

### Pre-Submission Technical Gates

- Comply with Shopify's Built for Shopify standards for embedded apps

- All three mandatory GDPR compliance webhooks implemented and responding correctly (customers/data_request, customers/redact, shop/redact) — configure via compliance_topics in shopify.app.toml

- Correct security headers set on all responses: Content-Security-Policy with frame-ancestors, HSTS, X-Content-Type-Options (see Section 14.2)

- Install → uninstall → reinstall flow tested and working correctly on a development store

- All admin pages have empty states — no blank pages for new merchants

- React error boundaries implemented on all major page components

- Theme App Extension and Checkout UI Extension tested on Dawn and at least two other OS2.0 themes

- App listing states Online Store 2.0 requirement for storefront widget and Thank You extension

- Publicly accessible privacy policy URL in app submission

- Data Processing Agreement (DPA) available to merchants on request

- Handle app/uninstalled webhook — data deletion within 48 hours

- Request only minimum necessary OAuth scopes — reviewers flag over-scoped apps

- GraphQL Admin API used exclusively — no REST Admin API calls

### App Listing Requirements

- App name must not contain 'Shopify' — use a distinct name (see Section 11.3)

- App category: Finance / Reporting

- Minimum 3 screenshots showing key flows (cost configuration, donation reporting, storefront widget)

- Promotional video strongly recommended for complex apps

- Key benefits section: 3 concise bullet points

- Detailed description matching actual app functionality exactly — misleading descriptions cause rejection

- Support contact information and response commitment

### Demo Store

- A working demo store with the app installed is required for App Store review

- Demo store must have: at least one cause configured, at least one product with cost config and cause assignment, a visible storefront widget, and sample reporting period data

- Provide test credentials for Printful or Printify connection if reviewers test POD functionality

- Demo store should be on a Shopify Payments-enabled plan or use a test payout configuration

# 12. Data Architecture

## 12.1 Core Data Models

Shop (shopId PK, shopify_domain, plan_tier, managed_markets_enable_date,

     payment_processing_rate NUMERIC(5,2), mistake_buffer_percentage NUMERIC(5,2),

     effective_tax_rate NUMERIC(5,2), tax_deduction_mode ENUM,

     wizard_step, created_at, updated_at)

├── WizardState (shopId FK, step_index, steps_completed JSON, updated_at)

├── MaterialLibraryItem (shopId FK, id PK, name, type ENUM, costing_model ENUM,

│     purchase_price NUMERIC(10,2), purchase_quantity NUMERIC(10,4),

│     total_uses_per_unit NUMERIC(10,2) nullable,

│     unit_description, status ENUM, notes, created_at, updated_at)

│   note: per_unit_cost = purchase_price ÷ purchase_quantity (derived, not stored)

│         total_uses_per_unit required if costing_model = 'uses'; null if costing_model = 'yield'

│         yield is NOT stored on the library item — it is variant-specific and stored on line items

├── EquipmentLibraryItem (shopId FK, id PK, name, hourly_rate NUMERIC(10,2),

│     per_use_cost NUMERIC(10,2), status ENUM, notes, created_at, updated_at)

├── CostTemplate (shopId FK, id PK, name, status ENUM, created_at, updated_at)

│   ├── CostTemplateMaterialLine (template_id FK, material_id FK,

│   │     yield NUMERIC(10,4) nullable, quantity NUMERIC(10,4) nullable,

│   │     uses_per_variant NUMERIC(10,4) nullable)

│   │   note: yield+quantity used if material is yield-based; uses_per_variant if uses-based

│   └── CostTemplateEquipmentLine (template_id FK, equipment_id FK, default_minutes NUMERIC(10,2), default_uses NUMERIC(10,2))

├── Product (shopId FK, shopify_product_id PK, title, updated_at)

│   ├── Variant (shopId FK, shopify_variant_id PK, product_id FK, title, price NUMERIC(10,2))

│   │   ├── VariantCostConfig (shopId FK, variant_id FK, template_id FK nullable,

│   │   │     labor_minutes NUMERIC(10,2), labor_rate NUMERIC(10,2), updated_at)

│   │   ├── VariantMaterialLine (config_id FK, material_id FK,

│   │   │     yield NUMERIC(10,4) nullable, quantity NUMERIC(10,4) nullable,

│   │   │     uses_per_variant NUMERIC(10,4) nullable)

│   │   └── VariantEquipmentLine (config_id FK, equipment_id FK, minutes NUMERIC(10,2), uses NUMERIC(10,2))

│   └── ProductCauseAssignment (Shopify metafield — cause ref + donation %)

├── Cause (Shopify metaobject — name, legal_nonprofit_name, is_501c3, icon, links, status)

├── ProviderConnection (shopId FK, id PK, provider ENUM, auth_type ENUM,

│     credentials_encrypted, status ENUM, last_synced_at, created_at)

├── ProviderVariantMapping (shopId FK, variant_id FK, provider ENUM,

│     provider_variant_id, match_method ENUM, last_cost_synced_at)

├── ProviderCostCache (mapping_id FK, cost_line_type, amount NUMERIC(10,2), currency, synced_at)

├── ShopifyChargeTransaction (shopId FK, id PK, shopify_transaction_id UNIQUE,

│     type ENUM, source_type, amount NUMERIC(10,2), fee NUMERIC(10,2),

│     net NUMERIC(10,2), payout_id FK nullable, period_id FK nullable,

│     processed_at, merchant_notes, created_at)

├── OrderSnapshot (shopId FK, id PK, shopify_order_id UNIQUE, origin ENUM,

│     period_id FK nullable, created_at)

│   └── OrderSnapshotLine (snapshot_id FK, variant_id, quantity, price NUMERIC(10,2),

│         labor_cost NUMERIC(10,2), material_cost NUMERIC(10,2),

│         equipment_cost NUMERIC(10,2), packaging_cost NUMERIC(10,2),

│         pod_cost NUMERIC(10,2),                              -- denormalised sum

│         labor_minutes NUMERIC(10,2), labor_rate NUMERIC(10,2),  -- stored for labor audit

│         net_contribution NUMERIC(10,2), mistake_buffer_percentage NUMERIC(5,2),

│         mistake_buffer_amount NUMERIC(10,2),                -- derived, stored for audit

│         taxable_exposure_at_order_time NUMERIC(10,2),       -- signed, may be negative

│         surplus_absorbed NUMERIC(10,2), taxable_portion NUMERIC(10,2),

│         estimated_tax_reserve NUMERIC(10,2), effective_tax_rate NUMERIC(5,2),

│         tax_deduction_mode ENUM, taxable_weight NUMERIC(5,4))

│         ├── LineCauseAllocation (line_id FK, cause_id, percentage NUMERIC(5,2),

│         │     amount NUMERIC(10,2), is_501c3 BOOLEAN)

│         ├── OrderSnapshotMaterialLine (snapshot_line_id FK, material_id,

│         │     material_name, material_type ENUM, costing_model ENUM,

│         │     purchase_price NUMERIC(10,2), purchase_quantity NUMERIC(10,4),

│         │     per_unit_cost NUMERIC(10,4), yield NUMERIC(10,4) nullable,

│         │     uses_per_variant NUMERIC(10,4) nullable,

│         │     quantity NUMERIC(10,4), line_cost NUMERIC(10,2))

│         │   note: all fields copied at order time — snapshot self-contained, no

│         │         dependency on MaterialLibraryItem for audit purposes

│         ├── OrderSnapshotEquipmentLine (snapshot_line_id FK, equipment_id,

│         │     equipment_name, hourly_rate NUMERIC(10,2) nullable,

│         │     per_use_cost NUMERIC(10,2) nullable, minutes NUMERIC(10,2) nullable,

│         │     uses NUMERIC(10,2) nullable, line_cost NUMERIC(10,2))

│         └── OrderSnapshotPODLine (snapshot_line_id FK, provider ENUM,

│               cost_line_type, description, amount NUMERIC(10,2))

├── VariantCostSummary (shopId FK, variant_id FK, product_id FK,

│     line_item_count INT)

│   note: materialised view or denormalised count maintained on insert/delete of

│         VariantMaterialLine and VariantEquipmentLine. Used by storefront widget

│         endpoint to determine pre-load vs lazy-load delivery strategy (threshold: 200

│         total line items per product). See ADR-004.

├── Adjustment (shopId FK, id PK, snapshot_line_id FK, type ENUM,

│     amount NUMERIC(10,2), created_at)

├── ReportingPeriod (shopId FK, id PK, status ENUM, start_date, end_date,

│     payout_id, closed_at nullable, created_at)

│   ├── CauseAllocation (period_id FK, cause_id, allocated NUMERIC(10,2),

│   │     disbursed NUMERIC(10,2) — live when OPEN; materialised at CLOSE)

│   ├── Disbursement (period_id FK, cause_id, amount NUMERIC(10,2), paid_at,

│   │     payment_method, reference_id, receipt_file_key, created_at)

│   ├── BusinessExpense (period_id FK, category ENUM, sub_type ENUM nullable,

│   │     name, amount NUMERIC(10,2), expense_date, notes, created_at)

│   │   note: sub_type used for 'Inventory & Materials' category only

│   │         (values: material_purchase | cogs_adjustment)

│   └── TaxTrueUp (period_id FK, estimated_tax NUMERIC(10,2), actual_tax NUMERIC(10,2),

│         delta NUMERIC(10,2), redistribution_notes TEXT, filed_at, created_at)

├── AuditLog (shopId FK, id PK, entity_type, entity_id, action, payload JSON, created_at)

├── RecalculationRun (shopId FK, id PK, status ENUM, triggered_at, completed_at nullable)

└── TaxOffsetCache (shopId FK PK, period_id FK, deduction_pool NUMERIC(10,2),

      cumulative_net_contribution NUMERIC(10,2),

      taxable_exposure NUMERIC(10,2),  -- unbounded: negative = surplus

      widget_tax_suppressed BOOLEAN, computed_at TIMESTAMPTZ)

## 12.2 Column Types & Precision

| **Data type** | **PostgreSQL type** | **Rationale** |
| --- | --- | --- |
| All monetary values | NUMERIC(10,2) | Exact decimal. Never use FLOAT or DOUBLE for money. |
| Yield and quantity | NUMERIC(10,4) | Four decimal places for fractional yields (e.g. 1/30 = 0.0333) |
| Percentages | NUMERIC(5,2) | e.g. 33.33% |
| Tax weights | NUMERIC(5,4) | e.g. 0.4000 |
| Status fields | ENUM or VARCHAR with CHECK constraint | Consistent 'active'/'inactive' across all soft-delete entities |
| Timestamps | TIMESTAMPTZ | Always store with timezone |
| Shopify IDs | VARCHAR | Shopify IDs can be large integers or GID strings |

## 12.3 Critical Indexes

| **Table** | **Index** | **Purpose** |
| --- | --- | --- |
| OrderSnapshot | (shopId, shopify_order_id) UNIQUE | Idempotency — prevent duplicate snapshots |
| OrderSnapshot | (shopId, period_id) | Period aggregation |
| OrderSnapshotLine | (snapshot_id) | Line item lookups |
| LineCauseAllocation | (line_id) | Cause aggregation |
| Adjustment | (shopId, snapshot_line_id) | Refund lookups |
| VariantCostConfig | (shopId, variant_id) UNIQUE | CostEngine lookup |
| ReportingPeriod | (shopId, status) | Open period queries |
| CauseAllocation | (period_id, cause_id) UNIQUE | Period cause rollup |
| AuditLog | (shopId, created_at) | Date-filtered audit log |
| MaterialLibraryItem | (shopId, status) | Active item filtering |
| EquipmentLibraryItem | (shopId, status) | Active item filtering |
| ShopifyChargeTransaction | (shopId, shopify_transaction_id) UNIQUE | Deduplication |

## 12.4 Key Data Integrity Rules

- All data scoped by shopId — cross-shop access impossible

- OrderSnapshot and OrderSnapshotLine never updated after creation

- Costs resolved live at calculation time and frozen as flat NUMERIC(10,2) values in snapshot

- CauseAllocation computed live from LineCauseAllocation when OPEN; materialised at period CLOSE

- Adjustments are append-only

- All financial mutations audit-logged via AuditLog

- ReportingPeriod CLOSED prevents all edits to related records

- Soft-deleted entities use status ENUM consistently ('active'/'inactive')

- v2: No ProductionUsagePeriodSnapshot model required — full line-item detail is stored in OrderSnapshotMaterialLine, OrderSnapshotEquipmentLine, and OrderSnapshotPODLine from v1. Production Usage Report (v2) can be built directly from snapshot detail. See ADR-001.

## 12.5 Distributed Lock

Daily reconciliation cron uses PostgreSQL advisory locks (pg_try_advisory_lock). No external Redis required. Lock key derived from shopId to allow concurrent runs across different shops.

## 12.6 Backup & Recovery

- Managed PostgreSQL with automated daily backups and PITR enabled

- Backup retention: 30 days operational; audit logs 3 years per financial record requirements

- RTO: 1 hour for full database restore

- RPO: 1 hour maximum (continuous WAL archiving recommended)

## 12.7 Archival Strategy

AuditLog and Adjustment tables partitioned by created_at (monthly or quarterly). Partitions older than retention window detached and archived to cold storage. Implement before tables exceed 10 million rows.

# 13. System Architecture

## 13.1 Stack

| **Layer** | **Technology** | **Notes** |
| --- | --- | --- |
| Frontend (Admin) | Shopify App Bridge 3 (@shopify/app-bridge-react) + React Router + Shopify Polaris | App Bridge 3 required for current session token handling. Two-level grouped navigation. |
| Frontend (Storefront) | Shopify Theme App Extension (App Block) + Checkout UI Extension (Thank You page) | Theme-native styles. OS2.0 only. No document access, scoped CSS, no localStorage. |
| ORM | Prisma | With migration tooling. Zero-downtime additive migrations in production. |
| Database | PostgreSQL (managed production, Docker locally) |  |
| File Storage | Cloud object storage e.g. AWS S3 (US-East) | Receipt files. Server-side encryption. Presigned URLs. EU-US DPF certified provider required. |
| Email | Transactional email provider (e.g. Postmark, SendGrid, Resend) | Post-purchase donation summary email. App sends independently — not via Shopify email templates. |
| Runtime | Node.js |  |
| Dev tooling | Shopify CLI, Docker Compose |  |

## 13.2 Services

| **Service** | **Responsibility** |
| --- | --- |
| CatalogSync | Sync Shopify products/variants. Cursor-based pagination. Bulk Operations API for large catalogs. |
| PODSyncService | Daily job fetching costs from Printful/Printify for all mapped variants. Handles manual refresh. Stores in ProviderCostCache. |
| CostEngine | Calculate net contribution. Resolves manual costs from library/templates and POD costs from cache (or live API at snapshot time). Currency conversion. In preview mode (storefront widget, admin cost editor), returns a display-safe projection only — never includes net contribution amounts, profit margins, or material purchase prices. In snapshot mode, returns the full cost structure for persistence. See ADR-003, ADR-004. |
| SnapshotService | Create immutable snapshots on orders/create. Idempotent via order ID key. Retries 3x with backoff if Shopify API unavailable before queuing for reconciliation. At snapshot creation, reads live taxable_exposure from the period (not hourly cache) to compute the precise per-order tax reserve: surplus absorbed first, only the exposed portion taxed. Critical ordering: POD live fetch must complete before the database transaction opens — never hold a DB transaction open during an external HTTP call. CostEngine resolution and all snapshot table writes (OrderSnapshotLine, OrderSnapshotMaterialLine, OrderSnapshotEquipmentLine, OrderSnapshotPODLine, LineCauseAllocation) must be wrapped in a single atomic transaction. See ADR-001, ADR-003. |
| ReconciliationService | Daily cron. PostgreSQL advisory lock. Detects and backfills missing snapshots. Restartable if interrupted. |
| PlanDetectionService | Daily job re-detecting Shopify plan and updating fee rate. Notifies merchant in-app if rate changes. |
| ChargeSyncService | Syncs Shopify Payments balance transactions on payout webhook and daily job. Deduplicates by shopify_transaction_id. |
| ReportingService | Aggregates period totals, CauseAllocation (live or materialised), and tax reserve calculations. Runs hourly job to compute deduction_pool (cumulative 501(c)3 allocations + non-order expenses), taxable_exposure, and widget_tax_suppressed flag. Writes result to TaxOffsetCache for storefront widget consumption. |
| AdjustmentService | Handles refund-driven negative adjustments. Append-only, audit-logged. |
| RecalculationService | What-if runs for analytical delta views. Triggered by merchant. |
| EmailService | Sends post-purchase donation summary email to customer via transactional email provider. Triggered by orders/create webhook after snapshot creation. Respects merchant opt-in setting. |

## 13.3 Admin UI Error Handling

The admin UI must handle failure states gracefully. Shopify reviewers will test with bad network conditions, expired sessions, and API rate limiting. Required:

- React error boundaries on all major page components — catch unexpected errors and show a friendly 'Something went wrong' state with a retry option

- Expired session handling: App Bridge detects expired tokens and re-authenticates transparently

- API rate limit handling: all API calls implement exponential backoff; UI shows loading state not blank screen

- Empty states for all pages (e.g. no materials yet, no orders yet, no causes yet) — never show a broken or blank page to a new merchant

- Network offline detection: show a banner when the app detects loss of connectivity

## 13.4 Server-Side API Rate Limit Handling

The GraphQL Admin API uses a cost-based leaky bucket model. Services that make large numbers of API calls (CatalogSync, ChargeSyncService, ReconciliationService) must handle rate limits explicitly:

| **Strategy** | **Detail** |
| --- | --- |
| Check throttle status | Inspect extensions.cost.throttleStatus in every GraphQL response. Track actualQueryCost and currentlyAvailable. |
| Back off when throttled | If THROTTLED status returned, pause and retry after the calculated restore time: (requestedQueryCost - currentlyAvailable) ÷ restoreRate seconds. |
| Bulk Operations for large datasets | Use Shopify Bulk Operations API for any query returning thousands of records — avoids per-request rate limits. |
| Queue-based processing | Long-running sync jobs process records in batches with deliberate pacing rather than hammering the API at full speed. |
| Logging | All rate limit encounters logged with shop ID, service name, and retry count for monitoring. |

## 13.5 Webhook Subscription Method

All webhook subscriptions (both event webhooks and mandatory compliance webhooks) are managed declaratively via shopify.app.toml using Shopify CLI. This is the correct approach for new apps in 2025/2026 — API-based webhook registration is legacy and should not be used.

Example shopify.app.toml webhook configuration:

[webhooks]

api_version = "2026-01"

[[webhooks.subscriptions]]

topics = ["orders/create", "orders/updated", "refunds/create",

          "products/update", "variants/update", "payouts/create",

          "app/uninstalled"]

uri = "/webhooks"

[[webhooks.subscriptions]]

compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]

uri = "/webhooks/compliance"

## 13.6 Access Token Management

**Removed in v2.3. See ADR-006.**

This section described access token refresh handling for long-running bulk migrations. Bulk migration on install has been removed. Standard session token handling via `authenticate.admin()` is sufficient for all remaining app operations.

# 14. Security & Data Integrity

## 14.1 Authentication & Authorization

- Shopify OAuth for merchant authentication. App Bridge session token validation on all admin routes.

- Multi-tenant isolation: shopId enforced on all DB queries — cross-shop access architecturally impossible

- ShopifyChargeTransaction and financial snapshot tables are sensitive — shopId isolation is the primary access control

## 14.2 Security Headers

Embedded Shopify apps must set correct HTTP security headers on all responses to pass App Store review. Missing headers are a common rejection cause.

| **Header** | **Required value** | **Purpose** |
| --- | --- | --- |
| Content-Security-Policy | frame-ancestors https://[shop].myshopify.com https://admin.shopify.com | Prevents clickjacking — required for all embedded app responses |
| X-Content-Type-Options | nosniff | Prevents MIME type sniffing |
| X-Frame-Options | Not set (use CSP frame-ancestors instead) | CSP frame-ancestors supersedes X-Frame-Options for modern browsers |
| Strict-Transport-Security | max-age=31536000; includeSubDomains | Enforces HTTPS |
| Referrer-Policy | strict-origin-when-cross-origin | Limits referrer information |

The frame-ancestors directive must dynamically include the merchant's shop domain from the session. Use Shopify CLI / Remix adapter which sets these headers automatically when using the authenticate.admin() middleware.

See Section 11.1 for full scope table. Scopes removed from earlier drafts: read_all_orders (bulk migration removed — see ADR-006), read_files / write_files (receipts in S3, not Shopify Files API), read_payment_terms (replaced by shopify_payments_payouts). Note: write_products was previously removed on the incorrect assumption that a standalone write_metafields scope exists — it does not. write_products is required for product metafield writes and has been reinstated in §11.1.

## 14.3 Webhook Security

- HMAC-SHA256 signature verified on all incoming webhooks before processing

- Webhooks return 2xx immediately; processing is async

- Unverified payloads rejected with 401 and logged

## 14.4 Storefront Widget Security

- Variant cost data endpoint rate-limited to prevent margin data scraping

- No internal financial data (net margins, absolute costs) exposed beyond what is intentionally displayed

- Read-only endpoint — rate limiting is primary protection

## 14.5 Receipt File Storage

- Stored in AWS S3 (US-East). Server-side encryption at rest.

- Presigned URLs scoped by shopId. Expire after 1 hour. Refreshed on page load.

- Receipts page rate-limited to prevent URL enumeration

- PII warning displayed at upload time before receipts become public

- Receipt redaction tool planned for v2

## 14.6 Credential & Secret Storage

- POD provider credentials (API keys, OAuth tokens) encrypted at rest using AES-256

- All app secrets in environment variables — never committed to source control

- Database queries use Prisma parameterised statements — no SQL injection risk

- Dependency scanning and regular updates required

## 14.7 Audit & Data Integrity

- Snapshots immutable — no update endpoints exposed

- Adjustments append-only

- All financial mutations logged to AuditLog with entity, action, and payload

- Audit log retention: minimum 3 years. Merchant-accessible via Settings.

- ReportingPeriod CLOSED prevents edits to related records

# 15. Privacy, GDPR & Legal

## 15.1 Data Processing Role

This app is a data processor on behalf of the merchant (data controller). It processes Shopify order IDs and associated financial data. Order IDs can retrieve customer PII via the Shopify Admin API, making snapshot records subject to GDPR obligations.

## 15.2 Required Legal Documents

| **Document** | **Requirement** | **Notes** |
| --- | --- | --- |
| Privacy Policy | Shopify App Store listing required | Must disclose: data collected, US data processing, cloud provider, retention periods, merchant rights |
| Data Processing Agreement (DPA) | GDPR compliance required | Available on request. Covers processor role, sub-processors (AWS), data subject rights. |
| App Store listing disclosure | Required by Shopify | Data types collected, retention period, privacy policy link |

## 15.3 Data Residency

All data hosted in US-East (PostgreSQL + S3). Cloud provider must be EU-US Data Privacy Framework certified (AWS, Google Cloud, and Azure all qualify) to satisfy GDPR cross-border transfer requirements. Confirm certification before public launch. EU data residency option planned for v2.

## 15.4 Data Subject Access Requests (DSARs)

| **Request type** | **Scope** | **Handling** |
| --- | --- | --- |
| Merchant data access | All app DB records for the shopId | Export via reporting CSV/PDF. Full export endpoint added as needed. |
| Customer data erasure | OrderSnapshot records linked to Shopify order ID | Merchant notifies app developer. Order ID nulled in snapshot; financial totals preserved for reporting integrity. |
| Merchant uninstall | All merchant data | Deleted within 48 hours per Section 3.5. |

## 15.5 Retention Periods

| **Data type** | **Retention** | **Rationale** |
| --- | --- | --- |
| OrderSnapshot & financial records | 3 years after period close | Financial record keeping |
| AuditLog | 3 years | Financial audit requirements |
| Disbursement receipts | 3 years after upload | Financial record keeping |
| Merchant plan/settings data | Deleted on uninstall | No ongoing purpose |
| Backup data | 30 days rolling | Operational recovery only |

## 15.6 Tax Disclaimer

This app is a financial tracking and donation ledger tool. It is not a tax compliance product. Donation tracking data should not be the sole basis for tax filings without independent verification. In some jurisdictions (EU, UK), business donations may have VAT implications. The app does not store charity registration numbers or issue tax receipts. Merchants should consult a qualified tax advisor.

## 15.7 CCPA Assessment

CCPA/CPRA applies to businesses meeting: $25M revenue, 100,000+ California consumers' data, or 50%+ revenue from selling data. As a free app for a small operator, none of these thresholds apply at v1 launch. GDPR-aligned DSAR handling (Section 15.4) already satisfies substantive CCPA rights. No 'Do Not Sell' link required — app does not sell data. Financial data as merchant business records does not trigger CPRA SPI opt-out requirements. Future checkpoint: conduct formal CCPA review and update DPA when thresholds are met.

# 16. Known Limitations

| **Limitation** | **Impact** | **Workaround / Note** |
| --- | --- | --- |
| No native Shopify packaging data | Cannot determine exact box/mailer used | Max-variant packaging cost model as approximation |
| Payout grouping complexity | Orders may span multiple payouts | Reporting periods anchored to payout events |
| No per-line payment fee data | Cannot attribute exact fees per line item | Payout-based accounting used instead |
| Snapshot vs recalculation drift | Numbers may differ between snapshot and recalculated views | Clearly labeled in UI; recalculation delta is analytical only |
| No real-time profit | Requires payout data before final figures | Estimates shown; actuals available after payout |
| Cost accuracy dependency | Bad merchant input = bad estimates | Validation and live preview panel mitigates this |
| Shopify cart page limits | Cannot render full widget on native cart | Modal/interstitial used for cart cause summary |
| Reconciliation uses current costs | Late-reconciled snapshots may not reflect order-time costs | Flagged as reconciliation-originated for audit |
| Zero-cost variants | Net contribution equals sale price | Valid and supported. Widget displays $0 rows correctly. |
| Theme Extension sandbox | No document access, scoped CSS, no localStorage | Widget self-contained; large payloads lazy-load on toggle |
| OS2.0 themes only | Legacy theme merchants cannot use storefront widget or Thank You extension | Disclosed in listing and onboarding. Legacy support planned v2. |
| App name | The name 'Shopify Donation Manager' cannot be used on the App Store | Must use a distinct name (e.g. 'Donation Manager', branded name). Internal codebase unaffected. |
| No post-purchase email opt-out | Customers cannot unsubscribe from donation summary emails in v1 | Merchant can disable entirely in Settings. Per-customer opt-out planned for v2. |
| US-East data residency | EU merchants' data processed in US | Mitigated by EU-US DPF certification. Disclosed in privacy policy. |
| No tax compliance | App does not produce tax receipts or handle VAT | Tax disclaimer in app and documentation. |
| Tax reserve widget suppression has up to 1hr lag | When deductions cross the taxable_exposure threshold, the widget may continue showing the tax line for up to an hour | Acceptable for estimates — disclosed in widget label 'Estimated tax reserve' |
| Tax true-up applied to active period | True-up may differ from periods where reserve was deducted | Form clearly states which period receives adjustment. |
| Tax reserve is an estimate | Effective rate is merchant-entered, not jurisdiction-calculated | Link to external estimator provided. |
| App tracks donations from install date only | Historical orders predate cost and cause configuration — retroactive snapshots would be inaccurate. | Communicated clearly in onboarding wizard. See ADR-006. |
| Mid-batch price change | If a merchant updates a material price while a batch of orders is processing, different orders in the same webhook batch may snapshot at slightly different costs | Correct behaviour — each order reflects the price at its own transaction time. Disclosed here for merchant awareness. |
| POD costs on widget up to 24 hours stale | Storefront widget uses ProviderCostCache (daily-synced). A merchant who updates POD pricing will not see it reflected on the widget until the next daily sync. | Live POD fetch only occurs at snapshot time. Acceptable for estimated display — disclosed in widget label. |
| Direct Giving Mode removed from core app | The conditional payment capture model in the original PRD concept requires manual capture store-wide, which is a merchant-controlled store setting. Adding payment capture responsibility to a donation ledger tool creates an unacceptable risk profile. | Redesigned as a standalone app. See ADR-005 and Section 17. |

# 17. Future Enhancements

## High Priority (v2)

- Labor Library — named labor types (Assembly, Design, Packaging, Painting) with individual hourly rates, replacing blended v1 rate

- Shopify Admin UI Extensions — variant detail page: full cost config; product detail page: cause assignment and donation %

- Additional POD providers: Gelato, SPOD, Gooten

- POD invoice reconciliation — compare actual provider invoice vs snapshot estimate

- Production Usage Report — per-period material consumption, equipment hours, labor, and POD costs. Full line-item detail is available from v1 snapshot tables (OrderSnapshotMaterialLine, OrderSnapshotEquipmentLine, OrderSnapshotPODLine) — no additional model extension required.

- Accrual-basis tax estimation — merchant-selectable accounting basis (cash or accrual). Under accrual mode, Track 2 deduction pool derives COGS from OrderSnapshotMaterialLine consumption totals rather than Business Expenses entries. Requires: accounting basis setting per merchant, controlled Track 1 → Track 2 data flow under accrual mode only, and suppression of Inventory & Materials category on Business Expenses page for accrual merchants to prevent double-entry. See ADR-002.

- Receipt redaction tool — in-app PII redaction before publishing receipts

- Period notification — in-app and email alert when payout triggers a new period ready to close

- Per-tax-year true-up spanning multiple reporting periods

- Accounting software import (QuickBooks, Wave, FreshBooks) — import actual expenses to derive tax obligations from real data

- Shopify Flow integration — expose triggers (e.g. 'Donation threshold reached', 'Period closed') and actions (e.g. 'Log disbursement') for merchant automation workflows

- Post-purchase email customer opt-out — unsubscribe link and preference management

## Medium Priority

- WCAG 2.2 AA upgrade from WCAG 2.1 AA

- Legacy theme support — alternative widget delivery for pre-OS2.0 themes

- EU data residency option for GDPR-regulated jurisdictions

- Bulk cause assignment via Shopify tags

- Cost groups — additional material bundling beyond templates

- Donation disbursement automation

- Multi-user access with role-based permissions

- In-app storefront widget preview before enabling in Theme Editor

- Dynamic tax rate estimation by jurisdiction and business structure

## Advanced / Long-term

- Artist payout model

- AI cost estimation from product descriptions

- Real cartonization engine for accurate packaging costs

- Accounting integrations (QuickBooks, Xero)

- Support for additional payment gateways

- Standalone Direct Giving app — a separate Shopify app that enables customers to donate directly to store causes and submit proof, receiving the product at cost-only pricing. Requires manual payment capture store-wide; the standalone app manages capture for all orders via a configurable capture policy (auto / flow / manual / dgm_only). Kept separate from the core app to avoid introducing payment capture risk into a financial ledger tool. Core app must expose active 501(c)3 causes and per-product cause allocation amounts for integration, and OrderSnapshot requires a direct_giving_mode flag to correctly exclude Direct Giving orders from the standard donation pool. See ADR-005 for full architecture.

## Concept: Direct Giving Mode — Superseded by ADR-005

⚠️ The design below has been superseded. Pre-launch feasibility testing identified that the conditional payment capture model requires manual payment capture enabled store-wide, which is a merchant-controlled setting the app cannot configure. Adding payment capture responsibility to a donation ledger tool creates an unacceptable risk profile. Direct Giving Mode has been redesigned as a standalone Shopify app — see ADR-005 and the Advanced / Long-term section above for the corrected architecture. The concept below is preserved as a reference for the standalone app's design phase.

A distinct purchase mode where the customer donates directly to any of the store's causes themselves and submits proof, receiving the product at cost-only pricing. This allows customers to claim a personal tax deduction and potentially trigger employer donation matching — neither of which is possible when buying through a for-profit store.

### Motivation

The core app model works well for cause-driven stores but has a limitation: because the store is not a registered nonprofit, customers purchasing through it cannot claim a tax deduction for the charitable portion of their purchase, and employer matching programs (which typically require donations to registered 501(c)3 organisations via approved channels) are not available. Direct Giving Mode addresses this by flipping the relationship — the customer becomes the donor, the store becomes the fulfillment vehicle.

### Multi-Product & Multi-Cause Simplification

A customer ordering multiple products may have different causes assigned to each. Requiring per-cause, per-product donation proof would be prohibitively complex for the customer. Instead, the model accepts a single donation receipt for the full combined charitable amount to any cause listed on the store — the merchant is indifferent to which specific cause receives the donation, provided the total giving equals what the store would have donated. The customer self-selects the cause that benefits them most (tax deduction eligibility, employer matching, personal affinity).

| **Scenario** | **Required proof** |
| --- | --- |
| Single product, single cause | Receipt showing donation ≥ product's cause allocation to any store cause |
| Multiple products, same cause | Single receipt showing donation ≥ combined cause allocation to that cause or any store cause |
| Multiple products, different causes | Single receipt showing donation ≥ combined total cause allocation across all products to any store cause |
| Product with no cause assigned | No donation proof required — product fulfills at full price as normal |

### Proposed Flow

| **Step** | **Actor** | **Detail** |
| --- | --- | --- |
| 1. Product page | Customer | Product page shows standard price AND a 'Give Directly' option. Selecting it shows: the list of store causes with their direct donation links, the combined suggested donation amount for this product (equivalent to its cause allocation), and an explanation of the benefit (tax deduction, employer matching eligibility). Customer adds to cart at cost-only price. |
| 2. Checkout | Customer | Customer proceeds to checkout at cost-only price (production costs + shipping, no donation allocation included). Payment is authorised but NOT captured at this point. |
| 3. Post-purchase upload | Customer | Order confirmation email includes a link to a dedicated receipt submission page (App Proxy, separate from /apps/donation-receipts). Customer uploads a single donation receipt covering the full combined charitable amount. Receipt must show: donor name, charity name (any store cause), amount ≥ combined cause allocation, and date within a reasonable window. Upload deadline configurable by merchant (default 7 days, matching typical card authorisation hold period). |
| 4. Verification | Merchant / App | Merchant reviews the uploaded receipt in the app admin against the required amount and cause list. Verification approach left open for v1 of this feature — options range from fully manual to automated OCR parsing. Merchant approves or rejects with optional notes. |
| 5a. Approved | App | App triggers payment capture for the cost-only amount. Order fulfills normally. Receipt stored against the order for audit. |
| 5b. Rejected or no upload | App | App voids the payment authorisation (no charge to the customer). Order is cancelled. Customer notified with reason and option to resubmit or place a new order at full price. |

### Why Not Product Page File Upload?

Shopify supports file uploads via line item properties — a file input on the product form attaches a reference to the cart line item. This is technically viable for a single product but has significant drawbacks for this use case:

- Each product requires a separate upload — a customer buying three products must upload three receipts before adding each to the cart

- The donation amount per product is unknown until the cart is assembled — a customer can't know the correct combined amount when uploading per-product

- Multi-cause orders become especially complex: the customer would need to match receipts to specific causes per product

- File uploads on the product page create checkout friction before payment, which increases cart abandonment

Post-purchase upload via App Proxy is cleaner in every dimension: one upload per order, correct combined amount known, and friction occurs after commitment rather than before.

### Key Design Considerations

| **Consideration** | **Detail** |
| --- | --- |
| Payment mechanism | Requires Shopify manual payment capture. App must capture before card authorisation expires (typically 7 days). Authorisation expiry window drives the upload deadline shown to customers. |
| Cost-only pricing | The cost-only price at checkout can be implemented as a Shopify automatic discount applied when the customer selects 'Give Directly', or as a dedicated variant. Discount approach is simpler; variant approach is more explicit in order history. |
| Per-product opt-in | Direct Giving Mode configured per product, defaulting off. Products without it show only the standard purchase flow. |
| Cause eligibility | Only products assigned to 501(c)3 causes should be eligible — non-501(c)3 donations do not qualify for tax deductions or employer matching. |
| Accepted causes | Any active 501(c)3 cause listed on the store is valid. The customer is not required to donate to the specific cause(s) assigned to the product. |
| Employer matching nuance | Employer matching programs vary — some require donations through specific portals (e.g. Benevity, YourCause). A direct charity donation may or may not qualify. Storefront should note 'potentially eligible' rather than guaranteed. |
| Verification approach | Left open intentionally. Options: fully manual (merchant reviews PDFs), semi-automated (OCR parsing of amount, date, charity name), or third-party verification service. Right approach depends on merchant trust model and order volume. |
| Fraud risk | Receipts can be fabricated. For high-value products, manual review is strongly recommended. Optional friction (e.g. require charity confirmation email forwarded directly) can be added as a verification step. |
| Tax disclaimer | App should not guarantee tax deductibility or employer matching eligibility. Disclaimer shown on product page and upload page: 'Consult your tax advisor and employer matching program for eligibility.' |

### Relationship to Existing Architecture

- OrderSnapshot model needs a direct_giving_mode BOOLEAN flag and verified_receipt_file_key field

- New DirectGivingReceipt model: order_id FK, required_amount NUMERIC(10,2), accepted_cause_ids (any store cause), upload_file_key, upload_deadline, verification_status ENUM, reviewer_notes, verified_at

- PaymentCaptureService: new service triggering Shopify payment capture on approval and void on rejection or expiry

- Receipt submission App Proxy page shares infrastructure with /apps/donation-receipts but is a separate endpoint — authenticated by order token, not shop-level access

- Expiry job: daily cron checks for DirectGivingReceipt records past upload_deadline with no verified upload, triggers void and cancellation

# 18. QA Testing Checklist

## Cost Model & Libraries

- Material library: yield-based item stores purchase_price and purchase_quantity only (no yield, no unit_cost)

- Material library: uses-based item stores purchase_price, purchase_quantity, and total_uses_per_unit

- Per-unit cost derived correctly: purchase_price ÷ purchase_quantity

- Live per-unit cost preview updates in UI as merchant types purchase_price or purchase_quantity

- Updating purchase_price or purchase_quantity propagates to all referencing templates/variants — does NOT affect past snapshots

- Yield-based line item: yield (variant-specific) and quantity entered on template/variant line item

- Uses-based line item: uses_per_variant entered on template/variant line item; total_uses_per_unit read from library item

- Yield-based formula: (purchase_price ÷ purchase_qty ÷ yield) × quantity

- Uses-based formula: (purchase_price ÷ purchase_qty ÷ total_uses_per_unit) × uses_per_variant

- Example: acrylic $40 for 10 sheets, yield=20 small earrings → $4.00/sheet ÷ 20 = $0.20/earring

- Example: super glue $12 for 5 tubes, 100 uses/tube, 1 use/pin → $2.40/tube ÷ 100 = $0.024/pin

- Example: same acrylic sheet, large earring yield=8 → $4.00 ÷ 8 = $0.50/earring

- Adaptive inputs: yield-based shows yield + quantity; uses-based shows uses_per_variant only

- Bulk table editor: yield/quantity columns for yield-based line items; uses_per_variant for uses-based

- Costing model immutable after library item creation

- Mistake Buffer applies to both yield-based and uses-based production material totals

- Equipment adaptive inputs: minutes shown only if hourly rate set; uses shown only if per-use cost set

- Updating material cost propagates to templates and variants — does NOT affect past snapshots

- Updating equipment rate propagates — does NOT affect past snapshots

- 'Used by X templates, Y variants' indicator correct on library items

- Cost template: create with material, equipment, and shipping material line items

- Template updates propagate to assigned variants for future orders only

- Soft-delete: deactivated items hidden from new configs, existing references preserved

- Mistake Buffer at 0%: no additional cost

- Mistake Buffer at non-zero %: correct line item beneath Materials in editor and widget

- Mistake Buffer applies to production materials only — Shipping Materials excluded

- Mistake Buffer % stored in snapshot for audit

- Labor: (hourly_rate ÷ 60) × minutes calculated correctly

- Equipment: (hourly × minutes) + (per_use × uses) calculated correctly

- Material: (cost ÷ yield) × quantity calculated correctly

- Shipping material does NOT scale with quantity — per shipment only

- Packaging cost rule: max total shipping cost across all shippable variants in order

- Bulk template assignment to products, variants, and collections

- Bulk assignment warns when overwriting existing configs

- Bulk table editor: Tab/Enter/Escape keyboard navigation

- Live cost preview updates correctly as values change

## POD / Third-Party Providers

- Printful OAuth connection stores encrypted token

- Printify API key stored encrypted, validated against provider API

- Auto-match by SKU links variants correctly

- Unmatched variants surfaced for manual mapping

- Daily sync updates ProviderCostCache

- Manual refresh triggers immediate fetch

- Snapshot creation fetches live POD cost from provider API

- POD fetch failure: fallback to cached cost, snapshot flagged, merchant notified

- POD + manual costs coexist correctly

- Provider credential encryption: plaintext never stored

- Disconnecting provider removes credentials and clears mappings

## Order Snapshots & Reconciliation

- Snapshot created on orders/create webhook

- Duplicate webhook: no duplicate snapshot created (idempotency)

- Snapshot creation is atomic: all child tables (OrderSnapshotLine, OrderSnapshotMaterialLine, OrderSnapshotEquipmentLine, OrderSnapshotPODLine, LineCauseAllocation) written in a single transaction — partial writes not possible

- OrderSnapshotMaterialLine: material_name and all cost fields copied at order time, not referenced from library

- OrderSnapshotEquipmentLine: equipment_name and all rate fields copied at order time

- OrderSnapshotPODLine: each provider cost line stored individually with provider, cost_line_type, description, amount

- Four category totals on OrderSnapshotLine match sum of detail table line_cost values

- POD live fetch completes before DB transaction opens — no DB connection held during external HTTP call

- Zero-cost variant: net contribution = sale price, widget shows $0 rows

- Packaging rule applied correctly for multi-item orders

- Cause assignment priority (manual override > tag > category > product default)

- Snapshot immutable — no update path exists

- Reconciliation job creates missing snapshots for orders within the last 7 days with reconciliation-originated flag

- Reconciliation job skips if previous run still active (advisory lock)

- Webhook HMAC-SHA256 verified; unsigned rejected with 401

- orders/updated: only triggers on price/line item changes, not tags/notes/fulfillment

## Refunds

- Negative adjustment created on refunds/create webhook

- Snapshot values used for adjustment (not recalculated)

- Partial refund: adjustment proportional to refunded quantity

- Cause balances updated, including going negative

## Shopify Charges

- Balance transactions imported from Shopify Payments API

- ShopifyChargeTransaction deduplicated by shopify_transaction_id

- Charges synced on payouts/create and daily job

- shopify_charges correctly deducted from donation pool

## Reporting & Tax Reserve

- CauseAllocation computed live when period OPEN

- CauseAllocation materialised and locked at period CLOSE

- Tax mode 'don't deduct': no reserve applied

- Tax mode 'non-501c3 only': taxable_weight = Σ(non-501c3 cause %) ÷ 100

- Tax mode 'all causes': taxable_weight = 1.0

- Mixed cause (60% 501c3, 40% non): taxable_weight = 0.40 in non-501c3 mode

- taxable_base = MAX(0, cumulative_net_contribution - period_expenses)

- taxable_base floors at zero — no negative reserve

- Deduction pool = cumulative 501(c)3 allocations + period non-order expenses (non-501c3 donations excluded)

- taxable_exposure = cumulative_net_contribution - deduction_pool (unbounded — can be negative)

- taxable_exposure ≤ 0 (surplus): widget_tax_suppressed = true, tax line hidden on all product pages

- taxable_exposure > 0: widget_tax_suppressed = false, tax line shown normally

- TaxOffsetCache refreshed hourly by ReportingService for widget consumption

- SnapshotService reads live taxable_exposure from DB at order time — not from hourly cache

- Snapshot: surplus fully covers order → per_order_tax_reserve = $0

- Snapshot: surplus partially covers order → tax reserve applies to exposed portion only

- Snapshot: no surplus → full net contribution taxed at effective_tax_rate × taxable_weight

- Example verified: surplus $150, order $200 → taxable_portion = $50, not $200

- Storefront widget reads widget_tax_suppressed from TaxOffsetCache — no per-request computation

- Deductions cross threshold: tax line suppressed within 1 hour of next cache refresh

- New orders increase taxable_exposure above zero: tax line restored within 1 hour of next refresh

- Reporting dashboard shows deduction_pool, taxable_exposure, and widget suppression status

- Business expenses do NOT affect the donation pool — per-order material costs and business expenses are on separate tracks

- Deduction pool formula excludes per-order material, labor, equipment, and shipping costs by design

- Inventory & Materials: material purchase sub-type creates correct BusinessExpense record

- Inventory & Materials: COGS adjustment sub-type creates correct BusinessExpense record

- All seven expense categories: create, edit, delete with correct category and sub-type

- Expenses per-period only — not retroactively applied to past periods

- Reporting dashboard shows Donation Pool and Tax Estimation as separate sections

- Reporting dashboard shows Inventory & Materials sub-totals (material purchases vs COGS adjustments) separately

- True-up surplus: CauseAllocations updated per merchant redistribution

- True-up shortfall: donation pool reduced correctly

- True-up exact match: no pool change, record stored

- TaxTrueUp record stores all fields for audit

- 501(c)3 status and legal name fields save to cause metaobject

- 501(c)3 status at order time stored in snapshot

- Disbursement logging: all fields save correctly

- Multiple partial disbursements per cause per period tracked correctly

- Receipt PII warning shown at upload

- Receipts accessible in admin and on /apps/donation-receipts

- Presigned URLs expire after 1 hour and refresh on page load

- 'Run recalculation' async run completes and notifies merchant

- CSV and PDF exports generate correctly

## Storefront Widget

- Widget hidden for products with no cause assignments

- Toggle shows and expands inline for donation products

- Widget remains expanded on variant change (updates in place)

- Widget updates instantly on variant/quantity change

- Payload >50KB: lazy-loads on toggle open

- Section order: Causes → Cost Breakdown → Shopify Fees → Estimated tax reserve

- Mistake Buffer displayed as named line item beneath Materials

- Estimated tax reserve shown when rate > 0% and mode ≠ 'don't deduct'

- Estimated tax reserve hidden when mode = 'don't deduct' or rate = 0%

- Donation amounts in customer's selected currency (Storefront API MoneyV2)

- Widget shows updated costs on next page load after template/library change

- Managed Markets fee shown for international customers; hidden for domestic

- Localization API failure falls back to currency mismatch only

- Cart 'See your donation impact' button triggers cause summary

- Cart modal: focus trapped; returns to trigger on close

- /apps/donation-receipts page: periods, disbursements, receipt links displayed correctly

- Receipts page empty state shown when no disbursements logged

## Accessibility (WCAG 2.1 AA)

- Toggle aria-label descriptive

- aria-expanded updates on open/close

- Focus moves to first focusable element on widget expand

- aria-live region announces variant/quantity changes

- Cost breakdown is semantic HTML table with th and caption

- Sections differentiated by headings/icons, not colour alone

- Colour contrast 4.5:1 for normal text across Dawn and common themes

- Cart modal focus trap and return on close

- Cart modal accessible name via aria-label or aria-labelledby

- Wizard progress indicator announces step N of M to screen readers

- Bulk table: Tab/Enter/Escape keyboard behaviour

- Receipts page: semantic headings, accessible disbursement table

## Shopify Platform

- Metafield namespace 'donation_manager' — no conflicts

- Metaobject definition created on install, deleted on uninstall

- read/write_metaobject_definitions scopes working correctly

- Product cause metafields read/written with write_products scope

- App Proxy HMAC-SHA256 verified; unsigned requests rejected 403

- Widget renders on Dawn and two other OS2.0 themes

- App listing states OS2.0 requirement

- Install sync: products and variants synced via CatalogSync on install

- Install sync: balance transactions imported with cursor-based pagination on install

- ShopifyChargeTransaction deduplicated correctly

- shopify_charges deducted from donation pool formula

## Post-Purchase Experience

- Checkout UI Extension registered correctly in shopify.app.toml with ui_extension type

- purchase.thank-you.block.render target renders on Thank You page

- customer-account.order-status.block.render target renders on Order Status page

- Thank You extension: on mount, fetches snapshot; shows estimated amounts while polling

- Thank You extension: replaces estimates with confirmed amounts once snapshot available

- Thank You extension: shows 'Estimated — we'll confirm this shortly' if snapshot not available within 30 seconds

- Thank You extension renders donation summary for orders with cause-assigned products

- Thank You extension hidden entirely for orders with no donation products

- Thank You extension fails silently if app server unavailable — Thank You page unaffected

- Post-purchase email sent within minutes of order placement after snapshot creation

- Email contains correct per-cause amounts matching snapshot values

- Email hidden/skipped for orders with no donation products

- Post-purchase email disabled in Settings: no email sent

- Email uses customer's order currency for amounts

- Email link to /apps/donation-receipts resolves correctly

## GDPR Compliance Webhooks

- Compliance webhooks configured via compliance_topics in shopify.app.toml — not via API

- customers/data_request: responds 200 immediately; order snapshot data retrievable within 30 days

- customers/redact: responds 200 immediately; order IDs nulled in snapshots within 30 days

- shop/redact: all merchant data deleted within 48 hours — equivalent to app/uninstalled flow

- All three compliance webhooks verified via HMAC-SHA256 before processing

## Post-Install, Reinstall & Error Handling

- Post-OAuth redirect goes to Dashboard immediately — no waiting for migration

- Migration progress banner shown during bulk import

- Wizard launches after products and variants are synced — not before

- Migration interrupted: retry option shown; migration resumes from checkpoint

- Reinstall within 48-hour window: deletion cancelled, existing data retained, merchant sees prior config

- Reinstall after deletion: treated as fresh install, catalog sync and balance transaction import re-runs, wizard launches

- Reinstall reconciliation: no duplicate snapshots or metaobjects created

- React error boundaries: major page errors show friendly state with retry, not blank screen

- Expired session: App Bridge re-authenticates transparently

- API rate limit: exponential backoff applied; loading state shown, not blank page

- Empty states: all pages show helpful empty state for new merchants (no materials, no causes, etc.)

- Security headers present on all admin responses: CSP frame-ancestors, HSTS, X-Content-Type-Options

- App renders correctly inside Shopify admin iframe — no clickjacking errors in browser console

- Deactivation blocked when cause assigned to active products

- Deactivated causes hidden from new assignments

- Historical snapshots with deactivated causes remain intact

- 501(c)3 status and legal name save correctly

## Onboarding & Settings

- Wizard state persists — merchant resumes from last completed step

- Earlier steps marked done when resuming mid-sequence

- All steps skippable

- Post-wizard checklist shown until all steps complete

- Settings: Mistake Buffer, effective tax rate, tax deduction mode all save correctly

- Uninstall webhook triggers deletion schedule and confirmation email

## Security & Database

- shopId enforced on all DB queries — no cross-shop access

- Rate limiting on widget endpoint

- Presigned URLs not publicly guessable

- All admin routes reject unauthenticated requests

- All monetary columns NUMERIC(10,2) — no FLOAT or DOUBLE

- OrderSnapshot unique index prevents duplicates

- VariantCostConfig unique index enforces one config per variant

- CauseAllocation lifecycle (live → materialised) correct

- PostgreSQL advisory lock prevents concurrent reconciliation runs

- AuditLog records created for all financial mutations

- Soft-delete status ENUM consistent across all entities

## Privacy & GDPR

- PII warning at receipt upload

- Customer erasure: order ID nulled, totals preserved

- All merchant data deleted within 48 hours of uninstall

- Privacy policy URL in app listing

- Tax disclaimer visible in documentation and settings

# 19. Design Principles

| **Principle** | **Description** |
| --- | --- |
| Financial correctness > convenience | Accuracy is never sacrificed for UX shortcuts |
| Snapshots are immutable | The financial record at order time is the permanent truth |
| All allocations must reconcile | Cause totals must always sum to the donation pool |
| System must be auditable | Every financial change is logged and traceable |
| UI should remain simple | Complexity is hidden behind clean interfaces |
| Maximise donation potential | Tax reserve, expense tracking, and cost automation designed to free up as much for charity as possible |
| Transparency by default | Customers see full cost and donation breakdown — not just a number |
