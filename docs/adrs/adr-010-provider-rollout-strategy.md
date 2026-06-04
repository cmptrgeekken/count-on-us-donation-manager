# ADR-010: Provider rollout strategy and provider-neutral integration seams

- Status: Accepted
- Date: April 2026

## Context

The PRD describes both Printify and Printful as POD providers in the broader product vision.

The current implementation work has intentionally focused on Printify first so we can make one provider real end to end before expanding the provider surface further.

That has created two simultaneous needs:

- the current product story must stay honest about what is actually merchant-usable today
- the Printify implementation should not hard-code provider assumptions that make Printful or later providers unnecessarily expensive to add

We do not want to over-engineer a speculative multi-provider framework before a second provider exists.
We also do not want to let Printify-specific assumptions leak so deeply into sync, mapping, cache, and snapshot flows that later provider work becomes a rewrite.

## Decision

The app will adopt a Printify-first rollout with provider-neutral internal seams.

### Printify is the current production-facing provider tranche

Printify remains the only provider we are actively implementing to merchant-complete depth in the current tranche.

Current implementation, testing, and merchant validation work should continue to optimize for finishing the Printify path before expanding provider breadth.

### Printful remains part of the longer-term provider vision, but not the current merchant-complete promise

Printful is not removed from the product direction.

However, the current product and documentation should describe the provider rollout honestly:

- Printify-first in the near term
- Printful planned next, not implied as already supported

### Shared provider lifecycle behavior must be separated from provider-specific API behavior

The app should progressively isolate provider-neutral orchestration from provider-specific implementation details.

Examples of provider-neutral behavior:

- connection state semantics
- sync-run lifecycle and audit logging
- mapped/unmapped/manual mapping status model
- cached provider catalog persistence
- cached provider cost-line persistence
- preview and snapshot fallback semantics

Examples of provider-specific behavior:

- authentication flow
- account/shop discovery
- provider catalog fetches
- auto-match candidate generation
- live cost fetches
- provider-specific fee-line interpretation

### The cost model must assume multiple provider cost lines, not a single provider cost

Even when the current Printify tranche only imports base fulfillment cost, the shared internal model should remain compatible with richer provider cost detail later.

Future providers may contribute:

- base fulfillment cost
- shipping estimates
- branding or packing fees
- digitization or setup fees
- provider-specific surcharge categories

The shared provider cost-line model should therefore stay additive and line-based rather than implying a single provider total.

### Provider costs supplement the app's broader cost model unless a later ADR says otherwise

Provider-backed POD costs do not replace the entire manual cost model.

The intended composition remains:

- provider-backed POD lines when mapped
- manual labor/material/equipment/packaging costs where configured
- explicit rules for whether provider shipping is included, deferred, or modeled separately

### Shared UX should stay consistent where possible

Provider Connections and related admin surfaces should use a common mental model across providers:

- connection state
- validation health
- sync status
- mapping review
- fallback/missing-cost warnings

Provider-specific UI should exist only where the platform or provider behavior truly requires it.

## Consequences

### Benefits

- keeps the near-term roadmap focused on finishing one provider well
- avoids overstating current provider support
- reduces the likelihood that Printify-specific implementation details become architecture
- makes future provider work more incremental and less rewrite-heavy

### Costs

- requires some refactoring or discipline now, before Printful is implemented
- leaves the product in a temporarily asymmetric provider state
- requires docs and backlog language to stay precise about what is current versus planned

## Follow-up implications

- Printful should have its own tracked implementation/scope decision rather than being implied by Printify work.
- Provider work should gradually introduce a small internal adapter contract instead of expanding Printify-specific service logic indefinitely.
- Shared provider tables and service APIs should be reviewed for provider-neutral naming and semantics where practical.
- Provider cost resolution should continue to preserve line-item detail so richer providers can slot in without changing the financial model.

## Status note

This ADR does not require a full provider abstraction rewrite before more Printify work can land.

It establishes the direction:

- finish Printify first
- keep docs honest about that
- create and preserve provider-neutral seams as we continue the implementation
