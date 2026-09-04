## Why

The shared schedule-evidence cache is implemented under the one-hop consumer even though Input Pack, pipeline, project-graph, visualization, and multiple reconciliation stages all depend on it. This creates a pervasive reverse dependency from evidence collection into a downstream consumer and makes future refactoring riskier than the cache behavior itself warrants.

## What Changes

- Move the canonical schedule-evidence cache implementation into the neutral `scripts/evidence/` layer.
- Keep the current one-hop module path as a compatibility facade so external or un-migrated callers do not break.
- Migrate repository-owned production and test imports to the canonical evidence-layer path.
- Add a module-boundary regression that prevents `scripts/input/` from importing the one-hop cache implementation again.
- Preserve every exported API, default cache root, on-disk layout, validation rule, hash, error, and fail-closed behavior.
- Do not change lineage semantics, artifact schemas, `docs/`, or any product-facing command.

## Capabilities

### New Capabilities

None. This is a behavior-preserving internal refactor.

### Modified Capabilities

None. `skip_specs: true` is declared because no requirement or externally observable behavior changes.

## Impact

- Affects `scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts`, its repository-owned importers, and focused cache/module-boundary tests.
- Establishes `scripts/evidence/` as the dependency-neutral home for schedule evidence alongside existing SQL read/write evidence modules.
- Adds no dependency, changes no CLI contract, and does not require edits to `docs/`.
