# ADR-022: Equipment component costing

- Status: Proposed
- Date: July 2026
- Depends on: ADR-001, ADR-003, ADR-008, ADR-018, ADR-020

## Context

Count On Us currently models equipment with an optional hourly rate, optional per-use cost, purchase link, equipment cost, notes, and template or variant usage quantities. This works when merchants already know the rate they want to charge for a machine.

Some equipment costs are harder to maintain as a single manually entered rate:

- a CO2 laser may use multiple purifier filters with different replacement costs and hour lifespans
- a 3D printer may consume nozzles, build plates, release film, resin trays, lubricant, and electricity
- a heat press may have pads, platens, teflon sheets, warmup time, standby power, and eventual replacement cost
- a CNC machine may use bits, belts, coolant, spoilboards, vacuum bags, dust collection, and higher electricity draw
- a Cricut or vinyl cutter may use blades, mats, rollers, and weeding tools
- an inkjet or UV printer may use print heads, maintenance tanks, cleaning solution, lamps, filters, and standby maintenance cycles

ADR-018 identified equipment-rate breakdowns as a future expansion candidate. This ADR turns that candidate into a proposed model.

The core accounting requirement remains unchanged: equipment costs are Track 1 direct product costs only when they are attributable to producing sold items. General business overhead still belongs in Track 2 business expenses unless the merchant intentionally allocates it into product cost.

## Decision

The app will support component-based equipment costing while preserving the existing simple equipment-rate workflow.

### Equipment keeps explicit resolved rates

`EquipmentLibraryItem` should continue to expose effective hourly and per-use rates because cost templates and variant cost resolution need stable, simple inputs.

Component fields will calculate suggested hourly and per-use costs. Merchants can either:

- use the calculated rates directly
- override the calculated hourly rate
- override the calculated per-use cost
- continue using only manual hourly and per-use rates

The UI should show whether a rate is calculated, manually overridden, or incomplete.

### Add shop-level electricity default

Settings should add a shop-level default electricity cost:

- `defaultElectricityCostPerKwh`

This belongs near the existing cost defaults, alongside default labor rate and mistake buffer.

The field is a merchant-entered money/rate value and must use `Prisma.Decimal`. It should allow enough decimal precision for utility rates, because electricity can be a fractional dollar amount per kWh such as `0.1425`.

Each equipment item may override it with:

- `electricityCostPerKwhOverride`

If no equipment override exists, equipment electricity cost uses the shop default. If neither value exists, electricity cost is excluded and the equipment rate should be marked partially configured when watts are present.

### Add equipment electricity fields

Equipment should support:

- `wattsPerOperatingHour` - average watts used while actively operating
- `idleWatts` - optional average watts used while powered on but not actively producing
- `warmupMinutes` - optional typical warmup time before production
- `cooldownMinutes` - optional typical cooldown or post-run machine time
- `electricityCostPerKwhOverride` - optional equipment-specific electricity rate

The base active electricity hourly cost is:

```text
(wattsPerOperatingHour / 1000) * effectiveCostPerKwh
```

Warmup, cooldown, and idle electricity should not silently inflate every minute of active use unless the equipment line has a way to allocate those minutes. Near term, the model should either:

- include warmup/cooldown only when a template or variant equipment line explicitly supplies batch or setup allocation data, or
- expose them as informational fields until batch/setup cost support is implemented.

### Add equipment lifespan and depreciation reserve

Equipment should support:

- `acquisitionCost`
- `expectedLifespanHours`
- `salvageValue`
- `replacementReserveEnabled`

The hourly depreciation or replacement reserve is:

```text
max(acquisitionCost - salvageValue, 0) / expectedLifespanHours
```

The existing `equipmentCost` field can remain as purchase metadata during migration, but the product model should converge on `acquisitionCost` for rate calculation. If both exist during transition, implementation should define one canonical calculation source to avoid double counting.

This cost is a production-cost allocation, not tax depreciation. The app must not present it as tax advice and must keep it separate from Track 2 business-expense deductions.

### Add equipment consumables

Equipment should support one or more consumable component rows.

Each consumable should include:

- `name`
- `replacementCost`
- `lifespanQuantity`
- `lifespanUnit` - `hours` or `uses`
- optional `sku`
- optional `purchaseLink`
- optional `replacementReminderThreshold`
- optional `notes`
- `status`

Hourly consumable cost:

```text
replacementCost / lifespanQuantity
```

when `lifespanUnit = "hours"`.

Per-use consumable cost:

```text
replacementCost / lifespanQuantity
```

when `lifespanUnit = "uses"`.

Examples:

- CO2 laser air purifier pre-filter: `$24 / 100 hours`
- medium-efficiency filter: `$36 / 200 hours`
- high-efficiency filter: `$50 / 300 hours`
- carbon filter: `$65 / 300 hours`
- Cricut fine-point blade: `$12 / 500 cuts`
- 3D printer nozzle: `$4 / 120 print hours`
- UV printer maintenance tank: `$18 / 20 cleaning cycles`

Consumables are equipment-level defaults. Template and variant equipment lines should initially consume the equipment's resolved hourly and per-use rates; line-level consumable overrides can be deferred until there is a concrete need.

### Add maintenance and service reserves

Equipment should support optional maintenance reserve fields:

- `maintenanceCost`
- `maintenanceIntervalHours`
- `serviceContractCost`
- `serviceContractIntervalMonths`

Hourly maintenance cost:

```text
maintenanceCost / maintenanceIntervalHours
```

Service contracts may be direct equipment cost only when the merchant chooses to allocate them to production. Because monthly service contracts can behave like general overhead, the UI should label this as optional allocation and warn merchants not to also count the same contract as a Track 2-only expense if they intend to keep product cost conservative.

### Additional fields worth considering

The following fields can improve equipment cost accuracy across lasers, 3D printers, presses, CNC machines, cutters, and printers. They should not all ship at once unless UI complexity remains manageable.

High-value fields for early implementation:

- `setupMinutesDefault` - machine setup, calibration, bed leveling, focusing, jig placement
- `cleanupMinutesDefault` - cleaning, lens wipe, resin cleanup, chip removal, press reset
- `operatorAttentionPercent` - share of machine runtime that requires active labor supervision
- `failureRatePercent` - equipment-specific failed-run reserve, separate from global mistake buffer
- `testRunCost` or `calibrationUsesPerBatch` - test cuts, purge lines, first-layer calibration, color tests
- `maintenanceDowntimePercent` - optional reserve for machine availability loss
- `compressedAirCostPerHour` or `auxiliaryEquipmentCostPerHour` - for external pumps, chillers, dust collectors, air assist, curing stations, wash stations, and compressors

Potential later fields:

- `dutyCyclePercent` - prevents assuming a machine can run continuously at rated output
- `capacityUnitsPerHour` - useful for sanity checking yield-based equipment lines
- `expectedAnnualHours` - useful for monthly or yearly allocations
- `leasePaymentAmount` and `leasePaymentInterval` - for leased equipment instead of owned equipment
- `financingCost` - optional allocation of loan interest if the merchant chooses
- `workspaceUtilityAllocationPerHour` - only if the app later supports explicit overhead allocation
- `softwareRequiredForEquipmentCostPerMonth` - only if tied to one machine and intentionally allocated
- `warrantyCost` and `warrantyLifespanHours`
- `maintenanceKitCost` and `maintenanceKitIntervalHours`
- `meteredClickCost` - for printers that charge per impression or print count
- `inkWastePercent` or `purgeWasteCostPerJob` - especially for inkjet and UV printers
- `bedAdhesiveCostPerUse`, `releaseFilmCostPerHour`, `cuttingMatCostPerUse`, or other machine-specific presets

Machine-specific presets can make this approachable, but the storage model should remain generic enough to avoid one schema per machine type.

### Cost calculation

The resolved equipment hourly rate should be the sum of:

- manual hourly base rate or calculated component hourly rate
- depreciation/replacement reserve per hour
- active electricity per hour
- hourly consumables
- hourly maintenance reserve
- optional allocated auxiliary equipment costs

The resolved equipment per-use cost should be the sum of:

- manual per-use base cost or calculated component per-use cost
- use-based consumables
- use-based maintenance, test, calibration, or metered print costs

Template and variant equipment usage should continue to calculate line cost through ADR-003 semantics:

```text
(resolvedHourlyRate * minutes / 60) + (resolvedPerUseCost * uses)
```

Duration-yield equipment lines should use the resolved hourly rate for the batch duration and divide by yielded quantity, as today.

### Snapshot and audit behavior

Order snapshots must preserve the resolved equipment line costs used at order time. To support auditability, snapshots should eventually store enough equipment component detail to explain the resolved rate, but they do not need to duplicate every mutable library field if the order snapshot already stores line-level resolved money values.

At minimum, snapshots should preserve:

- equipment name
- resolved hourly rate
- resolved per-use cost
- usage mode and quantities
- final equipment line cost

If component costing is implemented, snapshots should also consider preserving a compact component breakdown:

- electricity cost
- depreciation cost
- consumables cost
- maintenance cost
- manual override amount

Mutations to equipment component fields affect financial configuration and require `auditLog` entries.

### UI behavior

The Equipment page should avoid making every merchant fill a complex form.

Recommended UI:

- keep name, rate, purchase link, cost, and notes visible in the primary form
- add an "Advanced cost breakdown" disclosure
- show calculated hourly and per-use totals in a compact summary
- let merchants override calculated totals
- show incomplete components with clear missing-field messages
- support adding, editing, deactivating, and reordering consumables
- add equipment-type presets only after the generic model works

Suggested presets:

- CO2 laser
- 3D printer - FDM
- 3D printer - resin
- Heat press
- CNC router
- Vinyl cutter
- Inkjet printer
- UV printer

Presets should create editable starter fields, not lock merchants into machine-specific assumptions.

## Consequences

### Benefits

- makes equipment rates explainable instead of forcing merchants to maintain a hidden spreadsheet
- supports real consumable-heavy equipment such as lasers, printers, CNC machines, and cutters
- improves donation pool accuracy when equipment wear, electricity, and consumables are material
- keeps the existing simple rate model for merchants who do not need the added detail
- aligns with immutable snapshot and Decimal-based financial math requirements

### Costs

- adds schema, validation, UI, and cost-engine complexity
- increases risk of double counting if merchants include the same consumable or equipment purchase in both calculated equipment rates and separate expenses
- requires careful migration from `equipmentCost` to a clearer acquisition-cost model
- may require snapshot shape changes and reporting updates
- could overwhelm smaller merchants unless advanced fields are progressively disclosed

## Alternatives considered

**Keep only manual hourly and per-use rates** - Rejected as the long-term model. It is simple, but it pushes real cost logic into external spreadsheets and makes rates hard to audit.

**Replace manual rates entirely with component-based rates** - Rejected. Some merchants already know their desired rate, and some equipment costs are too subjective to force into a detailed model.

**Model consumables as materials** - Rejected for equipment-specific consumables. A purifier filter, nozzle, blade, or print head is consumed by equipment runtime or uses rather than by direct product quantity. Materials remain better for product inputs like acrylic sheets, filament, vinyl, ink applied to an item, or transfer paper.

**Model equipment purchases only as business expenses** - Rejected for production costing. Business expenses answer tax and cash-flow questions. Track 1 needs a per-order production-cost allocation when equipment wear is materially attributable to sold products.

**Store only derived totals and discard component detail** - Rejected for configuration. Derived totals are useful for cost resolution, but the app should retain component inputs so merchants can update filter prices, electricity rates, and lifespan assumptions without recalculating by hand.

## Open questions

1. Should equipment-level `warmupMinutes` and `cooldownMinutes` be allocated automatically per equipment line, or only when templates gain explicit batch/setup quantity fields?
2. Should consumables support both expected lifespan and current installed-date tracking for replacement reminders, or is cost calculation enough for the first release?
3. Should electricity defaults be global per shop only, or should the app support location-specific rates for merchants with multiple production locations?
4. Should `failureRatePercent` live on equipment, materials, templates, or variants so it does not overlap confusingly with the existing mistake buffer?
5. Should the first implementation add generic fields only, or include machine-type presets for lasers, 3D printers, CNC machines, cutters, and printers?
6. How much component detail should be copied into immutable order snapshots versus retained as admin-only library history?

## Follow-up implications

- Add shop-level electricity rate settings and audit logging.
- Add equipment component schema, validation, and Decimal parsing.
- Add consumable child records for equipment.
- Update CostEngine to resolve equipment rates from manual and calculated components.
- Update snapshot persistence and public/admin cost displays to preserve and present resolved equipment costs.
- Add regression tests for electricity, depreciation, consumables, override precedence, and snapshot immutability.
- Update ADR-018 if this ADR is accepted, marking equipment-rate breakdowns as covered by ADR-022.

## Links

- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-008](adr-008-financial-precision-policy.md)
- [ADR-018](adr-018-production-cost-model-expansion.md)
- [ADR-020](adr-020-contextual-creation-and-template-promotion.md)
