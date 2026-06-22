# Admin Page Audit

Date: June 21, 2026

## Purpose

This audit reviews every current admin page against the app's actual workflow needs and against common Shopify admin app conventions. The goal is not to make every page look identical. The goal is to make each page recognizable as one of a small number of patterns so merchants can predict where actions, status, forms, and lists live.

## External Standards Reviewed

Official Shopify guidance points in a consistent direction:

- App experiences should feel predictable inside Shopify Admin and put merchant needs ahead of novelty: https://shopify.dev/docs/apps/design
- App navigation should be organized around merchant tasks, use the fewest useful categories, keep labels short, and avoid long flat navigation lists: https://shopify.dev/docs/apps/design/navigation
- Tabs should be secondary navigation, used sparingly, should only change content below the tabs, and should not wrap: https://shopify.dev/docs/apps/design/navigation
- Pages should generally have a single purpose, with page-header actions reserved for page-specific actions: https://shopify.dev/docs/apps/design/navigation
- Resource index pages should use a single-column hierarchy with page-level actions, filters/sorting/multi-select controls, and a main resource list: https://polaris-react.shopify.com/patterns/resource-index-layout
- Resource detail pages should pair with resource indexes and usually place primary content and secondary context in a two-column layout: https://polaris-react.shopify.com/patterns/resource-details-layout
- Settings pages should group related settings so merchants can scan and find configuration areas quickly: https://polaris-react.shopify.com/patterns/app-settings-layout
- Layout should be responsive, use consistent density, keep content in containers, and use secondary styling for table actions: https://shopify.dev/docs/apps/design/layout

## Current Global Findings

The app currently has 16 Shopify `ui-nav-menu` items. Shopify guidance warns that more than seven nav items are truncated into "View more", and ADR-015 already identifies this flat nav as a scaling problem. The current nav should be treated as a compatibility surface, not the long-term information architecture.

Route complexity is concentrated in a few very large route files:

- `app.variants.$variantId.tsx`: 2775 lines
- `app.reporting.tsx`: 2739 lines
- `app.causes.tsx`: 1173 lines
- `app.templates.$templateId.tsx`: 991 lines
- `app.materials.tsx`: 928 lines
- `app.products.$productId.tsx`: 871 lines
- `app.settings.tsx`: 807 lines
- `app.variants._index.tsx`: 800 lines

The UI uses at least three overlapping approaches:

- Shopify web components (`s-page`, `s-section`, `s-table`, `s-button`)
- The local `polaris-shim.tsx`
- Hand-styled native inputs, buttons, dialogs, cards, and grids

Repeated local patterns are everywhere:

- fetcher success/error banners
- field and select styling
- empty table rows with blank cells
- date/currency summaries
- native dialog shells
- table action cells
- page intro and section header layouts
- multi-step or tab-like workflows inside very long pages

## Proposed Count On Us Admin Page Standards

### Resource Index

Use for: Products, Variants, Causes, Artists, Materials, Equipment, Templates, Expenses, Order History, Audit Log, Provider Connections when it becomes connection-list first.

Expected structure:

- title bar with resource name and one primary create/import/sync action where appropriate
- optional setup or sync banner above the list
- filters/search/sort/selection controls at the top of the list
- resource list/table as the main content
- bulk actions in a selection area, not as persistent page clutter
- empty state with one clear next action
- table row actions should be secondary or compact, not primary

### Resource Detail

Use for: Product detail, Variant detail, Template detail, Artist detail, Order snapshot detail.

Expected structure:

- title bar with back affordance or obvious route back to parent index
- primary content grouped into cards/sections
- secondary/contextual information in a right column or lower summary group
- one save model per page: either immediate actions or a staged save bar, not a mixture
- destructive actions secondary and separated
- fields use shared styling and validation display

### Operational Workflow

Use for: Reporting, Dashboard, Provider setup, possibly Product bulk assignment.

Expected structure:

- top panel answers "what needs attention?"
- action panels are close to the object being acted on
- do not rely on scrolling as a primary workflow transition
- use tabs or separate routes when a workflow contains distinct tasks
- payment/logging forms should replace or sit directly beside the selected payable, not live far below it

### Settings

Use for: Settings and future capability configuration.

Expected structure:

- grouped settings navigation
- each group has title, explanation, and form controls
- save action per group
- advanced/audit controls separated from normal setup
- avoid a single long stack of unrelated controls

## Page-by-Page Audit

### Dashboard

Current role: App home, setup wizard, catalog sync state, high-level counts.

Fit against convention: Good candidate for Shopify App Home. It is task-oriented and has a clear setup concept.

Issues:

- Setup wizard is useful, but visually custom and not yet connected to capability-aware onboarding from ADR-015.
- Dashboard metrics are lightweight and do not reflect the deeper operational state: unpaid payables, unresolved packaging review, unconfigured products, provider problems, artist submissions.
- The dashboard currently competes with the nav rather than becoming the "daily work" center.

Recommendations:

- Turn Dashboard into Home: setup state plus operational alerts.
- Add next-action cards for unpaid payables, products without routing, pending submissions, packaging review, failed provider sync, and open reporting period.
- Keep a single-column dashboard unless it becomes an operations console.

### Settings

Current role: Financial assumptions, cost defaults, tax, localization, notifications, audit shortcut.

Fit against convention: Improving. The in-page grouped tabs are a good step, but Shopify's settings pattern is usually more contextual than a raw tabbed form stack.

Issues:

- The page still uses several small forms and local controls in one file.
- The grouped tabs can wrap on narrow widths; Shopify warns against tabs wrapping.
- Financial settings, notification settings, and advanced controls need more explanatory hierarchy.

Recommendations:

- Replace tab wrapping with a select/segmented responsive pattern on small screens.
- Move each settings group into a component with a consistent group header, help text, validation, and save footer.
- Add future capability settings here only after capability policy exists server-side.

### Materials

Current role: Resource index plus create/edit/deactivate/delete dialogs for material library.

Fit against convention: Should be a resource index. Current behavior is close, but route-local patterns make it feel different from Equipment, Causes, and Templates.

Issues:

- Large route file with local dialog and form state.
- Create/edit/deactivate/delete dialogs are repeated patterns also present in Equipment and Templates.
- Table and empty states are custom rather than shared.
- Page title uses "Material Library" while nav says "Materials".

Recommendations:

- Standardize naming: use "Materials" everywhere unless "Library" becomes a deliberate product term across Materials and Equipment.
- Extract `ResourceDialog`, `DeleteDialog`, `StatusBanners`, `EmptyTableRow`, and shared field styles.
- Align row actions with secondary/compact styling.

### Equipment

Current role: Resource index plus create/edit/deactivate/delete dialogs for equipment library.

Fit against convention: Same pattern as Materials.

Issues:

- Duplicate structure with Materials but independently implemented.
- Naming mismatch: "Equipment Library" vs "Equipment".
- Page-level action, empty state, dialog handling, and field layout should match Materials.

Recommendations:

- Refactor after Materials using the same resource-library primitive.
- Consider a combined "Cost Inputs" area in the future shell with Materials and Equipment as sibling subpages.

### Shipping Packages

Current role: Package registry, package-material assignment, packaging review queue.

Fit against convention: Mixed resource index and operational queue.

Issues:

- Package creation form appears above the list, making the index feel like an admin form rather than a resource list.
- Package material assignment is embedded inside table cells, creating dense nested controls.
- Packaging review queue is a separate operational workflow on the same page.

Recommendations:

- Split into tabs or sections: `Packages` and `Review Queue`.
- Use a package detail/editor or inline drawer for material composition instead of nested table forms.
- Move packaging review count to Dashboard and Reporting Details.

### Cost Templates Index

Current role: Resource index for cost templates with create/deactivate/delete dialogs.

Fit against convention: Good resource-index candidate.

Issues:

- Similar dialog and table patterns to Materials/Equipment but implemented separately.
- Create primary action exists in title bar and also in empty/table areas.
- The page is resource-like but not yet using a consistent resource index shell.

Recommendations:

- Use shared `ResourceIndexPage` conventions.
- Keep "New template" as the title-bar primary action.
- Use compact table row actions and a standard empty state.

### Cost Template Detail

Current role: Complex resource detail/editor for production costing templates.

Fit against convention: Resource detail, but high complexity may justify an app-window style editor later.

Issues:

- Uses `TitleBar` from the Polaris shim while many other pages use `ui-title-bar`.
- Page owns a lot of draft/editor logic.
- Save behavior is more sophisticated than many other pages, but the pattern is not standardized across product/variant/template editing.

Recommendations:

- Decide whether complex editors use the shim/Page model or Shopify web components.
- Extract staged editor/save bar behavior as the standard for complex editable resources.
- Add a consistent back action to Templates.

### Variants Index

Current role: Resource index for variants, filters, export, and bulk assignment.

Fit against convention: Resource index with bulk actions.

Issues:

- Dense table and bulk assignment controls are useful but local.
- Filter/search/sort patterns should align with Products and Order History.
- Export is an index-level secondary action, which is appropriate, but should live in a predictable header/action area.

Recommendations:

- Standardize with Products as "Catalog resources".
- Use a shared bulk-selection panel for Variants and Products.
- Keep export secondary and move it into a common page action region.

### Variant Detail

Current role: Very complex resource detail/editor for variant cost configuration.

Fit against convention: Resource detail plus complex editor.

Issues:

- Largest route in the app.
- Uses the Polaris shim and bespoke modal patterns while newer pages use web components.
- Multiple assignment/edit dialogs and preview/override concepts live in one file.
- Likely too complex for a single route component.

Recommendations:

- Split into components: header/context, production template assignment, shipping template assignment, materials, equipment, estimate preview, save workflow.
- Standardize staged save behavior with Template detail.
- Consider two-column detail layout: editor left, estimate/summary right.

### Products Index

Current role: Resource index, catalog sync, product assignment counts, bulk cause/artist assignment.

Fit against convention: Resource index with sync/setup state and bulk actions.

Issues:

- Catalog sync is prominent, but after setup it should probably be less dominant.
- Bulk assignment panel is useful and should become the shared pattern for resource bulk actions.
- Products are operationally central but page title/actions do not clearly distinguish catalog sync, cause routing, and artist attribution.

Recommendations:

- Move catalog sync into a dismissible/status section after initial sync.
- Promote filters for "unassigned", "has artist", "has cause", and "needs review".
- Keep bulk assignment, but make it visually match Shopify bulk actions rather than a full page section.

### Product Detail

Current role: Product-level artist collaboration assignment and cause assignment.

Fit against convention: Resource detail, but it combines two different routing models that conflict.

Issues:

- Artist assignment and cause assignment compete on the same page.
- Validation rules are domain-specific but displayed as local text.
- Save actions are immediate custom button handlers, not a consistent form/save model.
- The page likely needs a clearer "Routing mode": cause-only vs artist collaboration.

Recommendations:

- Use a detail layout: product context at top, routing mode and assignments as primary content.
- Make routing mode explicit.
- Use shared allocation-row controls for cause and artist percentages.
- Consider replacing dynamic row editing with a guided modal if validation remains complex.

### Causes

Current role: Resource index with create/edit/deactivate/delete dialogs.

Fit against convention: Resource index.

Issues:

- Good use of table filters slot, but not a standardized pattern yet.
- Title bar primary action uses a native `button` while table filter uses `s-button`.
- Local dialog stack duplicates Materials/Equipment/Templates.
- Route is large for a relatively standard CRUD page.

Recommendations:

- Convert to shared resource index/dialog primitives.
- Use one button system.
- Keep "New cause" in the title bar and table filter header, but style consistently.

### Artists Index

Current role: Resource index for artists.

Fit against convention: Good resource index, currently much smaller than most.

Issues:

- Table-only page with little orientation.
- Empty state is a table row rather than a page empty state.
- Actions and new artist flow should align with Causes.

Recommendations:

- Give Artists the same resource index treatment as Causes.
- Use a proper empty state with "Add first artist".
- Add filters for active/inactive/payment-enabled once data volume grows.

### Artist Detail / New Artist

Current role: Resource detail form powered by `ArtistProfileForm`.

Fit against convention: Good candidate for resource detail/new resource layout.

Issues:

- Artist form is shared, which is good, but field styling is local to the component.
- Product mapping autocomplete had layering problems previously, indicating this needs a standard picker/popover pattern.
- Detail page needs clearer relation between artist profile, product mappings, cause preferences, and payment settings.

Recommendations:

- Split Artist detail into grouped sections or tabs: Profile, Products, Payment, Internal Notes.
- Standardize product picker/dropdown behavior across Artist and Product pages.
- Add clear back navigation to Artists index.

### Artist Submissions

Current role: Operational queue for submitted artist forms.

Fit against convention: Queue/resource index.

Issues:

- Needs triage states: new, reviewed, accepted, rejected, converted to artist.
- Current page likely mixes review and resource creation concerns.
- Should connect to Artist detail/new flow.

Recommendations:

- Treat as an inbox/queue page under Artists.
- Add filters by status and primary row action "Review".
- Consider a detail route or modal for reviewing submissions.

### Provider Connections

Current role: Provider setup and sync operations.

Fit against convention: Setup/workflow page, not a simple resource index.

Issues:

- Many banners and setup states make the page feel noisy.
- Provider connection, credentials, sync status, and mapping problems are separate jobs.
- It may belong under Products or Settings depending on capability model.

Recommendations:

- Split into tabs: Connections, Sync Status, Mapping Issues, Advanced.
- Put provider health and next action at the top.
- Move credentials/configuration into Settings if provider setup becomes feature configuration.

### Reporting

Current role: Operational financial console: period close, payables, disbursements, artist payments, exports, tax true-up, diagnostics.

Fit against convention: Workflow dashboard, not a conventional resource index.

Issues:

- Still too large and high-risk as one route.
- Scroll-dependent workflows were unreliable; recent tab/in-place changes are moving in the right direction.
- Cause and artist payment flows should not duplicate form logic in multiple places.
- Details, payments, tax, and diagnostics are distinct jobs and should not be one continuous page.

Recommendations:

- Keep the top "What needs attention" recipient worklist.
- Make pay actions open in-place forms or dedicated workflow tabs, never jump down the page.
- Extract payment form components and history tables.
- Consider subroutes after the tab model stabilizes: `/app/reporting/payables`, `/app/reporting/periods/:id`, `/app/reporting/tax`, `/app/reporting/diagnostics`.

### Expenses

Current role: Resource index and expense entry for business expenses.

Fit against convention: Resource index plus create dialog.

Issues:

- Likely belongs to Reporting/Financial operations, but nav makes it peer-level.
- Form/dialog patterns should match Materials/Equipment.
- Expense categories and tax effects need clearer contextual help.

Recommendations:

- Keep as a resource index, but move under Reporting in future shell.
- Use shared create/edit/delete dialog and empty state.
- Expose whether each expense affects Track 2/tax calculations.

### Audit Log

Current role: Read-only financial/system event log.

Fit against convention: Resource index / log index.

Issues:

- Should be filter-first: event type, actor, date range, entity.
- Audit log is in top-level nav despite being advanced/support-oriented.
- Empty state and detail payload display need consistency.

Recommendations:

- Move under Reporting or Settings Advanced in future shell.
- Use index layout with filters and compact expandable detail rows.
- Do not make audit log a primary merchant workflow unless compliance needs demand it.

### Order History Index

Current role: Historical order snapshot list.

Fit against convention: Resource index.

Issues:

- Needs stronger filters/search by order number, product, cause, artist, review status.
- Top-level nav competes with Reporting; this likely belongs under Reporting or Orders/History.
- It should make immutable snapshot status and review needs obvious.

Recommendations:

- Use resource index pattern with filters and row links.
- Surface packaging review and calculation anomalies.
- Move under Reporting/History in future shell.

### Order Snapshot Detail

Current role: Resource detail for immutable order snapshot, line items, allocations, receipts/links.

Fit against convention: Resource detail / read-only detail.

Issues:

- Needs clearer "read-only historical snapshot" framing.
- Large detail tables can be hard to scan.
- Should connect back to Order History and Reporting period.

Recommendations:

- Add back action to Order History.
- Use two-column layout: order/customer/context summary on the side, line/financial details as primary content.
- Use consistent "read-only historical data" banner when applicable.

## Public and Utility Surfaces

These are not merchant admin pages, but they still need visual consistency and accessibility:

- Donation receipts
- Transparency page
- Product donation widget fixture/surface
- Cart donation summary
- Artist submission public surface
- App proxy/widget API routes

Recommendations:

- Audit separately as customer/public surfaces.
- Keep them visually aligned with storefront expectations, not admin conventions.
- Maintain strict privacy boundaries from ADR-012 and artist privacy assumptions from ADR-013/014.

## Navigation Recommendation

The current flat nav should be replaced, or at least mentally modeled, as these groups:

- Home: Dashboard
- Products: Products, Variants, Cost Templates, Materials, Equipment, Shipping Packages, Provider Connections
- Giving: Causes, product assignments, donation receipts, transparency
- Artists: Artists, Artist Submissions, artist product mapping
- Reporting: Reporting, Expenses, Order History, Audit Log
- Settings: Settings, capabilities, notifications, localization, advanced controls

This aligns with ADR-015 and Shopify guidance to build navigation around merchant tasks instead of implementation modules.

## Consolidation Backlog

Highest leverage primitives:

1. `ResourceIndexPage`: title/action/filter/table/empty structure.
2. `ResourceDialogs`: create/edit/deactivate/delete native dialog wrappers.
3. `EmptyTableRow`: standard table empty row with correct cell count.
4. `StatusBanners`: already started; migrate all fetcher banners.
5. `FieldGroup`: label/help/error/input wrapper.
6. `ActionFooter`: consistent save/cancel/delete placement.
7. `WorkflowTabs`: non-wrapping secondary navigation with mobile fallback.
8. `BulkSelectionPanel`: shared Products/Variants bulk action pattern.
9. `ReadOnlyDetailLayout`: order snapshots, audit events, reporting diagnostics.
10. `StagedEditorShell`: variant and template complex editors.

## Suggested Implementation Sequence

1. Stabilize Reporting's payables workflow and extract payment form/history components.
2. Normalize Settings tab responsiveness and group form components.
3. Build resource index primitives and apply them to Artists, Causes, Materials, Equipment, Templates.
4. Align Products and Variants around a shared catalog index/bulk-selection pattern.
5. Split Variant detail and Template detail into componentized resource-detail editors.
6. Move Expenses, Audit Log, and Order History into a Reporting/Financial operations mental model.
7. Spike the ADR-015 shell with grouped navigation and capability-aware route visibility.

