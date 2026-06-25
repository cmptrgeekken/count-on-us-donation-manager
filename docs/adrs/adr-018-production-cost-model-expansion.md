# ADR-018: Production cost model expansion candidates

- Status: Proposed
- Date: June 2026
- Depends on: ADR-001, ADR-003, ADR-017

## Context

Count On Us currently models product economics through materials, equipment, labor, packaging, cost templates, provider-backed POD cost mappings, and planned outsourced production cost lines.

Recent material terminology work clarified three merchant-facing material cost methods:

- Counted parts
- Variable yield
- Portioned use

Equipment currently supports hourly and per-use rates. In current merchant practice, consumables, electricity, maintenance, wear, and replacement reserves can be rolled into those equipment rates.

That means the current implementation is not obviously missing those costs, but future merchant workflows may benefit from more explicit modeling if equipment or overhead costs become materially significant or hard to reason about.

## Decision

The app will treat the following production cost areas as future expansion candidates, not immediate scope.

### Equipment cost components

The current equipment hourly/per-use fields remain the recommended near-term way to capture:

- equipment depreciation or replacement reserve
- consumable machine parts such as blades, mats, nozzles, filters, belts, and lenses
- maintenance and cleaning supplies
- electricity or other machine utility usage
- calibration, warmup, cooldown, and routine machine-prep overhead when the merchant chooses to spread it into an hourly rate

Future versions may split these into explicit subcomponents if merchants need clearer auditability or if equipment rates become hard to maintain manually.

Possible future fields include:

- acquisition cost
- expected useful life or replacement cycle
- maintenance reserve
- consumables reserve
- electricity rate or watts/kWh estimate
- setup/warmup/cooldown cost
- notes explaining what is included in the rate

### Scrap and waste

The app should consider a future waste adjustment model for materials.

Examples:

- unusable acrylic sheet edges
- failed cuts
- 3D print supports or failed prints
- sanding, polishing, or finishing loss
- test pieces and calibration pieces

Possible implementation options:

- material-level default waste percentage
- template-line or variant-line waste percentage
- global mistake buffer remains separate and broader

Waste should not be folded silently into donation math. If modeled, it should be visible in cost previews and snapshots.

### Batch and setup costs

Some costs happen once per production run rather than once per item.

Examples:

- machine setup
- file preparation
- jig setup
- mold preparation
- outsourced vendor setup fees
- minimum-order or batch fees

ADR-017 already identifies setup, batch, and minimum-order costs as relevant to outsourced production. The same concept may eventually apply to in-house production templates.

Future implementations should decide whether batch/setup costs belong on:

- equipment lines
- cost templates
- variants
- outsourced production lines
- a generalized custom production cost-line model

### Indirect supplies and fulfillment overhead

Some small costs are easy to miss but may matter over volume.

Examples:

- gloves, masks, wipes, alcohol, polish, sealants, and finishing supplies
- printer ink, thermal labels, tape, stickers, care cards, inserts, and packing slips
- storage bins, shelving, and organization supplies
- returns, replacements, damaged shipments, or quality reserves

Near term, these can be represented as materials, packaging materials, equipment rates, or business expenses depending on whether they are directly attributable to the product.

If direct attribution becomes burdensome, the app may consider an overhead allocation model.

### Overhead allocation

General overhead may include:

- design software
- Shopify apps
- bookkeeping and accounting
- workspace utilities
- insurance
- internet
- storage
- administrative labor

The app should avoid forcing general business overhead into per-variant cost by default. Count On Us has a dual-track financial model, and general business expenses are intentionally separate from direct product costs.

A future overhead allocation feature should be optional, clearly labeled, and carefully separated from business-expense reporting so merchants do not double count costs.

Possible allocation options:

- percentage applied to direct production cost
- fixed amount per item
- amount per labor hour
- amount per machine hour
- manually entered custom cost line

## Consequences

### Benefits

- preserves the current simple equipment-rate model
- documents which costs can already be rolled into equipment hourly/per-use rates
- creates a roadmap for more explicit cost modeling without prematurely adding UI complexity
- keeps direct product costs separate from general business expenses
- aligns future expansion with immutable snapshots and cost-resolution architecture

### Costs

- future explicit modeling may add complexity to the variant and template editors
- merchants may need guidance to avoid double counting costs already included in equipment rates
- overhead allocation can become subjective and should not be presented as exact accounting
- batch/setup costs may require quantity assumptions that are not currently present in the cost engine

## Alternatives considered

**Add explicit equipment depreciation, electricity, maintenance, and consumables now** - Rejected for immediate scope. The current merchant can roll these into hourly or per-use equipment rates, and adding separate fields now would increase UI complexity before there is clear operational need.

**Treat all overhead as business expenses only** - Rejected as a universal rule. Some overhead-like costs, such as machine maintenance or consumables, may be direct enough to belong in product cost when the merchant chooses to allocate them.

**Force overhead allocation into every variant** - Rejected. General overhead is not always product-specific, and mandatory allocation would risk false precision and double counting.

**Use only a global mistake buffer for waste** - Rejected as a complete answer. A global mistake buffer is useful, but some materials or processes may have materially different waste profiles.

## Follow-up implications

- Add help text to Equipment explaining that hourly/per-use rates may include consumables, electricity, maintenance, and depreciation.
- Consider a future equipment-rate breakdown UI that calculates an hourly/per-use rate from optional components while still storing a simple resolved rate.
- Consider material waste fields if acrylic/sheet usage, 3D printing supports, or failed production runs become material.
- Consider batch/setup cost support alongside ADR-017 outsourced production implementation.
- Consider a future overhead allocation feature only after the admin cost model is stable enough to explain the accounting implications.

## Links

- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-003](adr-003-cost-resolution-strategy.md)
- [ADR-017](adr-017-outsourced-production-costs.md)
