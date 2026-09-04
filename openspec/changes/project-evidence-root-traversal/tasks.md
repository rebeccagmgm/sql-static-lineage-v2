> Extraction boundary update (2026-08-31): the source-side direct
> orchestration/cache was not carried into the standalone product because no
> safe producer-boundary caller exists in this extraction. The external
> implementation currently exposes only `LEGACY_ARTIFACT_PAIRS` through
> `E:\02_area\股衍数据-数据cookbook\scripts\data-graph\src\project-graph\topology\project-topology-cli.ts`.
> The direct/cache tasks below remain historical deferred work and are not
> claimed as shipped by the source repository.

## 1. Freeze Scope And Baselines

- [x] 1.1 Record the current `lineage:all --task-ids` sequential orchestration and the exact duplicated stages without changing it.
- [x] 1.2 Freeze compact fixtures covering shared Tasks at different depths, cycles, terminal/reference-config stops, schedule-only parents, primary/additional/unknown/candidate roles, partition decisions, checkdbflag exclusion and per-root truncation.
- [x] 1.3 Record exact current source fingerprints, Producer Index identity, terminal-config hash and formal multi-hop hashes/counts for real roots `176827`, `181058` and `209119`.
- [x] 1.4 Record pre-run hashes for canonical task artifacts and unrelated dirty files so direct-project acceptance cannot claim or hide mutations.

## 2. Direct Project Source Contracts

- [x] 2.1 Add contracts for frozen project source identity, Task-local evidence identity, root membership, traversal observations, boundary occurrences, source mode and direct-project limits.
- [x] 2.2 Add deterministic identities/hashes excluding timestamps, absolute paths and cache HIT/MISS state while retaining evidence provenance outside identity.
- [x] 2.3 Implement fail-closed validation for project key/roots, Input Pack fingerprint, Producer Index content, terminal config, Machine Facts contract and source drift.
- [x] 2.4 Add failing tests for mixed source modes, cross-fingerprint roots, changed inputs, duplicate/conflicting Task-local facts and invalid root overlays.

## 3. Shared Project Workset

- [x] 3.1 Extract or add a bounded multi-root workset that carries per-root membership while deduplicating Task-local preparation.
- [x] 3.2 Pin/freeze Producer Index once and prepare Machine Facts incrementally for only newly discovered union Tasks.
- [x] 3.3 Prefetch/inject schedule evidence and reconcile one-hop once per union Task, preserving cache/offline/live provenance and existing failure semantics.
- [x] 3.4 Add counters and tests proving a shared Task is not re-fingerprinted, re-expanded, re-prefetched or re-reconciled for each root.
- [x] 3.5 Enforce union and per-root Task/edge/depth/round limits with deterministic partial boundaries and no unbounded discovery.
- [x] 3.6 Expose existing Machine Facts pre-analysis reuse counters without introducing a duplicate cache layer.
- [x] 3.7 Add one canonical raw one-hop cache file per Task, keyed internally by Task-local Input Pack/Machine Facts, schedule rows, terminal config, algorithm version and consumed Producer slice; keep global Input Pack identity and project overlays out of the cache.
- [x] 3.8 Add cold, hot, unrelated-Input-Pack-growth, relevant-producer, selective schedule invalidation and corrupt-entry tests proving only affected Tasks are recomputed and current provenance is retained.

## 4. One Root Traversal Kernel

- [x] 4.1 Extract a pure traversal kernel from existing multi-hop semantics without changing current public contracts.
- [x] 4.2 Make the legacy `reconcileMultiHop` path a one-root adapter over the kernel and pass all existing multi-hop fixtures unchanged.
- [x] 4.3 Add multi-root kernel output for stable local facts, root reachability/depth/status and root-scoped boundary occurrences.
- [x] 4.4 Add parity tests for primary-only recursion, schedule/data separation, producer roles, partition decisions, cycles, terminals, checkdbflag and limits.
- [x] 4.5 Fail closed on missing/conflicting Task-local facts; do not silently choose a stronger observation.

## 5. Direct Project Topology And Publication

- [x] 5.1 Project the multi-root kernel result into existing stable Task/dataset/relation records and root-scoped observations without consuming formal multi-hop files.
- [x] 5.2 Extend snapshot/source contracts and loaders with explicit `LEGACY_ARTIFACT_PAIRS` and `DIRECT_PROJECT_EVIDENCE` modes while retaining legacy snapshot readability.
- [x] 5.3 Publish direct snapshots through existing validated immutable staging/reuse behavior under the project graph output root only.
- [x] 5.4 Add an opt-in direct project CLI requiring explicit project key, roots, data root, output root, terminal config and hard limits.
- [x] 5.5 Prove direct mode writes no task-level artifacts and does not register itself as the default `lineage:all` path.

## 6. Query And Semantic Parity

- [x] 6.1 Keep `get_project_topology`, `trace_project_upstream` and `explain_topology_edge` envelopes compatible across both source modes.
- [x] 6.2 Add normalized root-view comparison covering nodes, relation observations, producer roles, min depth/status, boundaries, coverage, limits and truncation.
- [x] 6.3 Add negative parity gates proving a missing/reclassified boundary, source-root leak or stronger confirmed edge fails acceptance.
- [x] 6.4 Repeat direct publication and verify deterministic snapshot identity, byte-identical files and `REUSED` behavior.

## 7. Real Three-root Acceptance

- [ ] 7.1 Recheck that `176827`, `181058` and `209119` share the exact current Input Pack fingerprint, Producer Index content and terminal configuration before running.
- [ ] 7.2 Run the existing formal path and the direct project path against the same frozen local evidence without refreshing unrelated inputs.
- [ ] 7.3 Compare every root's normalized Task/table membership, read/write/producer/schedule observations, depth/status, boundary reason/scope, coverage and limits.
- [ ] 7.4 Record union occurrence versus stable entity counts and single-evaluation counters for shared Tasks.
- [ ] 7.5 Record bounded stage timings and file sizes for the sequential baseline and direct run without making an unmeasured performance claim.
- [ ] 7.6 Verify zero unexplained parity differences, no stronger confirmation, no input drift and byte-identical canonical task artifacts.

## 8. Regression And Scope Review

- [ ] 8.1 Run focused producer regressions through the source repository npm scripts and legacy-pair topology/real-artifact checks through the standalone data-graph project.
- [ ] 8.2 Run typecheck, build, focused formatting and `git diff --check`; separate pre-existing failures without weakening gates.
- [ ] 8.3 Audit imports to prove no Neo4j, historical KG, causal/business overlay, UI or new platform dependency entered the change.
- [ ] 8.4 Confirm field-lineage still consumes its existing inputs and no default task artifact has been removed or relocated.
- [ ] 8.5 Publish a bounded acceptance report and explicitly decide whether a later field-lineage adapter/legacy multi-hop retirement change is justified.
