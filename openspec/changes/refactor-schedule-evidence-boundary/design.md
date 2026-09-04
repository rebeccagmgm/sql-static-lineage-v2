## Context

See `proposal.md` for motivation. The cache module is a 500-line filesystem-backed evidence adapter with a stable exported API and on-disk contract. It currently lives under the one-hop consumer but is imported by Input Pack collectors, pipeline orchestration, project-graph projections, visualization, one-hop, multi-hop, and tests. The repository already has a neutral `scripts/evidence/` layer for SQL read/write evidence.

The v2 directory intentionally has no Git metadata and will later become a new repository. During this change, the old repository remains a read-only comparison baseline; no old branch, index, worktree, or remote is changed.

## Goals / Non-Goals

**Goals:**

- Make dependency direction reflect ownership: collection and downstream consumers depend on a neutral evidence module, never on one-hop internals.
- Preserve source compatibility at the old import path while migrating every repository-owned caller to the canonical path.
- Make future one-hop and Input Pack refactors independent of cache storage details.
- Prove that relocation changes module ownership only, not cache behavior or artifacts.

**Non-Goals:**

- Redesigning the cache schema, fixed root, file names, atomic-write behavior, validation, or error vocabulary.
- Changing evidence collection, network fallback, lineage decisions, or publication flow.
- Splitting the cache implementation into smaller files in the same change.
- Refactoring `producer-index.ts`, `reconcile-one-hop.ts`, Plan Facts, or SQL operator semantics.
- Editing or reorganizing `docs/` or retiring unrelated experimental code.

## Decisions

### 1. Use `scripts/evidence/schedule-evidence-cache.ts` as the canonical module

The cache represents reusable schedule evidence, not one-hop behavior. `scripts/evidence/` already owns cross-layer SQL evidence utilities, so this location removes the `input -> reconcile/consumer/one-hop` reverse dependency without introducing a new top-level architecture concept.

Alternatives considered:

- `scripts/input/shared/`: rejected because pipeline, project-graph, visualization, and reconciliation also consume the cache; moving it there would replace one misplaced owner with another.
- A new infrastructure/storage layer: rejected as unnecessary abstraction for a mechanical relocation.

### 2. Preserve the old module as a thin compatibility facade

`scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts` will contain only an explicit re-export from the canonical evidence module. Repository-owned imports will move to the canonical path, while unknown external scripts keep working.

Deleting the old path immediately was rejected because this copied codebase may have callers outside the repository and the refactor has no requirement to break them.

### 3. Move implementation without semantic edits

The implementation body moves byte-for-byte except for the relative import of `machine-facts-contract.ts`. Export names, constant values, union members, object ordering, hashing inputs, filesystem layout, and thrown error text remain unchanged. No opportunistic formatting or helper extraction is allowed in this change.

### 4. Enforce the boundary with a source-level regression

A focused test will scan repository-owned TypeScript/JavaScript imports beneath `scripts/input/` and fail if they reference the one-hop compatibility facade. Existing behavioral tests remain the authority for cache reads/writes and consumers; the boundary test only protects dependency direction.

### 5. Use focused verification proportional to the change

Verification will cover type checking, direct cache tests, representative Input Pack callers, one-hop/multi-hop, `lineage:all`, and task-local schedule consumers. It will not run real remote collection or rewrite canonical artifacts. `npm` project scripts remain the supported dependency/bootstrap route.

## Risks / Trade-offs

- [A repository-owned import is missed] -> search all source and test imports after migration, run typecheck, and keep the old facade as a runtime safety net.
- [The relative Machine Facts import changes behavior] -> make that the only implementation-line change and exercise hash/read/write cache tests.
- [A new circular dependency appears] -> keep the evidence module dependent only on Node built-ins and the Machine Facts contract, then verify the import graph and typecheck.
- [The compatibility facade becomes permanent duplication] -> keep it implementation-free and add a test that production callers use only the canonical module.
- [No local Git rollback exists in v2] -> compare affected files against the read-only old-repository snapshot and limit this change to explicitly listed paths; the old module can be restored by reversing the relocation.

## Migration Plan

1. Add the canonical evidence-layer module with the unchanged implementation.
2. Replace the old implementation with the compatibility re-export.
3. Migrate repository-owned production imports, then test imports, to the canonical path.
4. Add the dependency-boundary regression and verify no `scripts/input/` import points to the facade.
5. Run focused behavioral tests and typecheck; compare the final changed-file set against the proposal.

Rollback is mechanical: restore the implementation at the legacy path, restore imports, and remove the new canonical module and boundary test. No data or artifact migration is required.
