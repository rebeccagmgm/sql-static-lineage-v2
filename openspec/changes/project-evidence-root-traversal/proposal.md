## Why

`lineage:all --task-ids` accepts multiple roots, but it still executes `runTask` sequentially and repeats root closure, Machine Facts orchestration, schedule prefetch, one-hop reconciliation, multi-hop materialization and rendering for every root. Phase 1 then reads the separately published multi-hop artifacts and merges them after the duplication has already happened.

The accepted real project set `176827`, `181058` and `209119` demonstrates that this is material rather than theoretical: 203 root-scoped Task occurrences collapse to 108 stable Tasks, and 273 dataset occurrences collapse to 144 physical datasets. The project should therefore prepare shared evidence once and treat multi-hop as a root-scoped traversal projection instead of a mandatory per-Task source artifact.

## What Changes

- Add an opt-in direct project-evidence run for an explicit project key and explicit root Task set.
- Freeze one Input Pack fingerprint, Producer Index identity and terminal-table configuration for the complete project run.
- Build a shared bounded Task workset and evaluate each Task's Machine Facts, schedule evidence and one-hop facts at most once per frozen project run, while retaining separate root membership.
- Reuse validated Machine Facts registry entries and one canonical raw one-hop cache file per Task across project runs when that Task's local evidence identity matches; unrelated Input Pack growth must not invalidate the Task, while corrupt or relevantly changed entries degrade to a cache miss.
- Extract one root-traversal kernel used by both the existing single-root multi-hop compatibility path and the new multi-root project path, so parity does not depend on two independently maintained traversal implementations.
- Publish a deterministic project topology directly from shared Task-local facts plus root-scoped reachability and boundary overlays, without reading or writing formal per-root `multi-hop.json` as a project-build prerequisite.
- Keep the existing topology node/edge identities and `trace_project_upstream` query envelope stable; add an explicit source mode and source descriptor for direct project-evidence snapshots.
- Add fixture parity and a real three-root acceptance comparing Task/table membership, relation observations, depth, boundaries, coverage and truncation against the current multi-hop artifacts.
- Keep existing task artifacts, the artifact-pair Phase 1 CLI and field-lineage consumption unchanged during this change.
- Pause the optional Neo4j query-index work until this lower shared-evidence layer is accepted.

## Capabilities

### New Capabilities

- `project-evidence-root-traversal`: Defines shared project evidence preparation, root-scoped traversal overlays and direct deterministic project-topology publication without mandatory per-root multi-hop artifacts.

### Modified Capabilities

- `project-topology-graph-projection`: Adds an explicit direct-project-evidence source mode while preserving the accepted legacy artifact-pair source mode and reference-query contracts.

## Impact

- The standalone consumer implementation lives under `E:\02_area\股衍数据-数据cookbook\scripts\data-graph\`; its shipped topology entry consumes validated legacy one-hop/multi-hop artifact pairs.
- Extracts a pure root traversal seam from current multi-hop logic; the existing public single-root result remains a compatibility adapter and must pass unchanged regression fixtures.
- Adds a narrow opt-in CLI/package entry for direct multi-root project builds. It does not replace `lineage:all` in this change.
- Writes only immutable project-graph snapshots under the configured project-graph output root and does not add files to `artifacts/tasks/<task-id>/`.
- Adds no Neo4j, UI, business-semantic, causal or new remote-platform dependency.

## Current extraction boundary

The source-side shared project-evidence orchestration and cache are not part of
the shipped standalone consumer because this extraction has no safe producer-
boundary caller for them. The external consumer currently exposes only
`LEGACY_ARTIFACT_PAIRS` through
`E:\02_area\股衍数据-数据cookbook\scripts\data-graph\src\project-graph\topology\project-topology-cli.ts`.
The direct orchestration path described by the historical requirements remains
deferred and is not a shipped source-repository entry.
