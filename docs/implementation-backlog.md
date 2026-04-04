# Implementation Backlog

Use this document for post-spec amendments, follow-up improvements, and design or implementation issues discovered during development.

This is not the source of record for shipped scope. Items here become authoritative only when they are folded into the PRD, build plan, ADRs, or a phase implementation plan.

Issues and improvement ideas identified during Phase 2 development and testing. Each item is analysed, given a complexity estimate, and assigned to the most appropriate phase.

---

## PU-1 — Uses-based costing for shipping materials

**Problem:** Shipping materials such as packing tape are consumable on a per-use basis, but the current schema forces `costingModel = null` for all shipping-type materials. There is no way to express "one piece of tape per order" without over-engineering the quantity field.

**Proposed approach:**
- Allow `costingModel = "uses"` for `type = "shipping"` materials (currently only valid for `type = "production"`).
- Update the materials form: show the costing model selector when `type = "shipping"`, but only offer `"uses"` as an option (yield-based shipping does not make sense).
- Show `totalUsesPerUnit` field when `costingModel = "uses"`.
- Update `CostEngine` packaging rule: the current rule is `max(shippingLineCosts)`. Uses-based shipping lines already compute a line cost via the uses formula, so the packaging rule needs no change — it just needs to handle the case where a shipping line uses the uses formula instead of the quantity formula.
- No schema migration required — `costingModel` is already a nullable string field on `MaterialLibraryItem`.

**Complexity:** Low  
**Phase:** Implement as a Phase 2 amendment before Phase 3 begins.  
**Status:** Ready for Validation

---

## PU-2 — Searchable material/equipment pickers and editable lines in template editor

**Problem:** The add-material and add-equipment dropdowns in the template detail page are plain Polaris `<Select>` elements. With a large library this becomes unusable. Additionally, once a line is added, the only options are view or remove — there is no way to correct a yield value without removing and re-adding.

**Proposed approach:**

**Searchable picker:**
- Replace `<Select>` with Polaris `<Combobox>` + `<Listbox>` for both material and equipment pickers.
- Filter options client-side as the user types.
- No schema changes.

**Editable lines:**
- Add an Edit button to each line row in the template detail page.
- Clicking Edit opens the same modal used for adding, pre-populated with current values.
- On submit, send `intent = "update-material-line"` or `"update-equipment-line"` to the existing action.
- Add those two action handlers: `update-material-line` and `update-equipment-line` — validate and run `updateMany({ where: { id: lineId, templateId }, data: { ... } })`.
- No schema migration required.

**Complexity:** Low–Medium (UI-only, no schema changes)  
**Phase:** Implement as a Phase 2 amendment before Phase 3 begins.

---

## PU-3 — Template line yield/uses overrides per variant

**Problem:** When a Cost Template is assigned to a variant, all template lines use their default yield/uses values. Some variants legitimately need different yields or use counts (e.g., larger sticker requires less yield from a laminate sheet; a 5-pin bundle uses 5× the super glue of a single pin). The current model forces merchants to create a separate template per variant size rather than overriding just the parameters.

**Proposed approach:**

Introduce a `CostTemplateLineOverride` model that stores per-variant overrides for a specific template line:

```
CostTemplateLineOverride
  id              String  @id @default(cuid())
  shopId          String
  configId        String  FK→VariantCostConfig (cascade delete)
  templateLineId  String  FK→CostTemplateMaterialLine or CostTemplateEquipmentLine
  lineType        String  "material" | "equipment"
  yieldOverride   Decimal? @db.Decimal(10,4)
  usesOverride    Decimal? @db.Decimal(10,4)
  minutesOverride Decimal? @db.Decimal(10,4)  (equipment only)
  usesEquipOverride Decimal? @db.Decimal(10,4)  (equipment only)

  @@unique([configId, templateLineId, lineType])
  @@index([shopId])
```

**CostEngine merge logic change:** After merging template lines with variant override lines (by materialId), apply a second pass of `CostTemplateLineOverride` records: for each override, replace the yield/uses on the matched template line before computing cost. Variant lines with `materialId` matching a template line already replace the entire line — overrides only apply to unmatched template lines.

**UI — variant detail page:**
- When a template is assigned, show the template's lines in a "Template Lines" read-only section with an "Override" button per line.
- Clicking Override opens a small modal with only the overridable fields (yield, usesPerVariant for materials; minutes, uses for equipment).
- Show the override value next to the default with a "Reset" button to remove the override.

**Complexity:** Medium (schema migration + CostEngine change + variant detail UI)  
**Phase:** Phase 2 amendment or early Phase 3 — should be resolved before Phase 3 exit criteria since snapshot accuracy depends on correct per-variant costs.

---

## PU-4 — Default labor hourly rate (site-wide setting)

**Problem:** Every variant requires entering an hourly rate manually when configuring labor. For shops where all work is done at a single rate (e.g., the merchant's own time), this is repetitive.

**Proposed approach:**
- Add `defaultLaborRate Decimal? @db.Decimal(10,4)` to the `Shop` model.
- Add a "Default Labor Rate" field to the Settings page Cost Defaults card (alongside the existing mistake buffer field).
- On the variant detail page, show text displaying, `Default: $${shop.defaultLaborRate}/hr`. If per-variant `laborRate` is unset, this default rate is used instead. We do not want to hard-code the default labor rate at the variant level, as we want to be able to ensure all variants are updated with the new labor rate if the default is changed and the variant doesn't override.
- The CostEngine must fall back to the default labor rate if the variant labor rate is unset.
- One Prisma migration required.

**Complexity:** Low  
**Phase:** Implement as a Phase 2 amendment before Phase 3 begins.
**Status:** Added to Settings page. Variant Details have been updated. Cost Engine falls back to default labor rate.
---

## PU-5 — Currency-agnostic display (localisation groundwork)

**Problem:** The dollar sign (`$`) is hard-coded throughout the UI. Count On Us is intended for any Shopify merchant regardless of their store currency.

**Proposed approach (near-term, v1-safe):**
- Add `currency String @default("USD")` to the `Shop` model — populated from `shop.currencyCode` during install and CatalogSync (already available in the existing Shop GraphQL query).
- Create a shared `formatMoney(amount: string | number, currency: string): string` utility in `app/utils/localization.ts`. Use `Intl.NumberFormat` with `style: "currency"` — handles symbol, decimal separator, and grouping for any ISO 4217 code.
- Replace all hard-coded `$` in the UI with this formatter.
- No changes to storage (all monetary values are stored as `Decimal` without currency — this is correct for a single-currency per shop model).

**Full i18n** (translated UI strings, locale-aware formatting) is a post-v1 requirement. This change unblocks currency display without requiring a full i18n library.

**Complexity:** Low (schema migration + shared utility + UI string replacement)  
**Phase:** Implement as a Phase 2 amendment. Every subsequent phase adds more money displays — fixing this early avoids a large cleanup pass later.
**Status:** A `l10n(currency: string = 'USD', locale: string = 'en-US')` wrapper method has been added to `app/utils/localization.ts`. It returns `formatMoney` and `getCurrencySymbol` methods. All money references in the UI have been updated to use these methods. This will allow us to support localization in a more standardized way. Currently, the currency and locale are not being passed in. We'll need to determine the best approach for passing those in that reduces code complexity. The database column has also been created but it is not yet being used in the app. It was also identified that the `Intl.NumberFormat` requires a locale specification. Unclear if this should be stored in the database as currency is or managed in some other way. I also added a `formatPct` method for formatting percents

---

## PU-6 — Staged / draft configuration changes

**Problem:** Bulk-assigning a template to many variants and then needing to individually adjust yield overrides across them requires either doing it in one long session or risk leaving variants in a partially-configured state. A staging layer would let merchants set up changes, review them, and publish atomically.

**Proposed approach (to be designed):**
A full staging system is significant scope — it would require a `draft` state on `VariantCostConfig`, a comparison view, and a publish action. Key design questions:

1. Should drafts be per-variant or per-session/batch?
2. Can a variant have one draft and one live config simultaneously?
3. What is the publish boundary — single variant or batch?
4. Should the CostEngine ever read from draft state? (Probably not — drafts should be invisible to snapshot/preview until published.)

**Recommended deferral:** Do not implement staging in Phase 2 or 3. The cost model and snapshot system need to be fully stable first. Revisit in Phase 4 when the full data model is settled.

**Complexity:** High  
**Phase:** Post-v1 or Phase 4+ after snapshot system is stable.

---

## PU-7 — Full application localisation (i18n)

**Problem:** Count On Us is available to Shopify merchants globally. PU-5 addresses currency display, but a complete localisation effort is broader: all UI strings, date and number formatting, and potentially right-to-left layout support need to work correctly for merchants in non-English locales. Without a proper i18n foundation, adding languages later will require invasive refactoring across every route and component.

**Scope of full localisation:**

**1. UI string translation**
- All user-facing strings extracted to locale resource files (e.g. `app/locales/en.json`).
- A translation function (e.g. `t("key")`) used throughout components and loader/action responses.
- Locale negotiation: read from merchant's Shopify admin locale via the session or a `locale` field stored on `Shop`.
- Initial supported locale: `en`. Additional locales added by providing a translation file — no code changes required per new language.

**2. Number and currency formatting**
- PU-5 provides `formatMoney(amount, currency)` using `Intl.NumberFormat`. This is the correct foundation.
- Decimal separators, thousands separators, and currency symbol placement all vary by locale (e.g. `1.234,56 €` in German vs `$1,234.56` in English).
- The formatter must accept a `locale` argument in addition to `currency`: `formatMoney(amount, currency, locale)`.
- Input fields that accept numeric values (purchase price, yield, etc.) should accept locale-appropriate decimal separators — requires client-side normalisation before submitting form data.

**3. Date and time formatting**
- Dates are displayed on audit logs, order snapshots, expense entries, and reporting periods.
- Replace all `new Date().toLocaleDateString()` calls with `Intl.DateTimeFormat` using the merchant's locale.
- All dates stored in UTC; formatted for display only at render time.

**4. Right-to-left (RTL) layout**
- Polaris 12 includes RTL support via CSS logical properties.
- RTL locales (Arabic, Hebrew) require the `dir="rtl"` attribute on the HTML root.
- Defer RTL until a RTL locale is actively targeted — but do not use directional CSS properties (e.g. `margin-left`) directly; use Polaris layout components throughout so RTL adoption is non-breaking.

**5. Shopify storefront widget (Phase 5)**
- The storefront widget renders in the customer's locale, which may differ from the merchant's admin locale.
- Cause names, donation amounts, and cost breakdowns must be formatted for the customer's locale.
- Use the Shopify Storefront API `MoneyV2` type for customer-facing monetary values (already planned in Phase 5).
- Widget string translation is separate from admin translation — widget strings live in the Theme App Extension, not the app server.

**Recommended approach:**
- **PU-5 first** (currency formatter groundwork) — already scoped as a pre-Phase 3 amendment.
- **i18n string extraction** — introduce the translation function and locale file structure at the start of Phase 5 (before storefront work), so widget strings and admin strings share the same pattern. Retrofitting all strings post-Phase 5 would be a large, risky refactor.
- **Input normalisation** — add decimal separator normalisation to form submissions when Phase 5 introduces the storefront-facing cost display, at which point non-English merchants are a realistic audience.
- **RTL** — defer until a RTL locale is actively targeted, provided Polaris layout components are used consistently (no raw directional CSS).

**Dependencies:**
- PU-5 (currency formatter) is a prerequisite for the number formatting work.
- Shopify provides the merchant's locale via the session; no additional API calls are needed.
- A translation library (e.g. `i18next` with the Remix integration, or a lightweight custom loader) needs to be selected before string extraction begins. Evaluate at the start of Phase 5.

**Complexity:** Medium per area; High if done all at once post-launch  
**Phase:** PU-5 groundwork before Phase 3. String extraction and locale infrastructure at the start of Phase 5. RTL deferred until a RTL locale is targeted.

## PU-8 - Migrate to Polaris Web Components ?
**Problem** It appears as though Polaris for React is deprecated. We should be using Polaris Web Components instead.

**TODO** Need to flesh out this proposed update and identify the necessary work.
