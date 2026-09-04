## Why

WP-1 separated value flow from dataset controls in field-lineage, but Phase 1 project topology still loads per-root one-hop/multi-hop closures (`LEGACY_ARTIFACT_PAIRS`, `maxRoots=32`). Full-corpus asset graph projection requires each task to publish a self-contained local graph from Machine Facts only, without upstream task ids on data edges.

## What Changes

- Add `TASK_LOCAL_PROJECTION` per task under a project-graph output root (not `artifacts/tasks/<task-id>/`).
- Project nodes/edges from Machine Facts + schedule cache: `TASK`, `PHYSICAL_DATASET`, `PHYSICAL_FIELD`, `TARGET_WRITE`, `READS`, `WRITES`, `FIELD_DIRECT`, `FIELD_CONDITIONAL`, `DATASET_CONTROL`.
- Copy data-graph identity algorithms into `scripts/project-graph/task-local/ids.ts` and freeze vectors against data-graph.
- Reuse WP-1 `datasetControlsForStatement` collection (extract shared module in TL-2); map `summarizeTaskRelations()` channels without running multi-hop or producer-index during projection.
- Batch CLI for `DM_RSK_N` plus golden tasks `105387`, `119044`, `176827`; content-hash cache keyed by task + pack + facts manifest + projection version.
- Explicit coverage states: `PROJECTED`, `SCHEDULE_ONLY`, `COLLECTION_FAILED`.

## Capabilities

### New Capabilities

- `task-local-graph-projection`: Per-task local graph projection contract, identity alignment, projection kernel, batch CLI, and golden-sample gates.

### Modified Capabilities

None at the Machine Facts / one-hop / multi-hop / field-lineage production layer. Field-lineage may share extracted control-collection helper only.

## Impact

- New code under `scripts/project-graph/task-local/` and focused tests.
- No changes to SQLLens, Plan Facts production, causal-closure seeding, or published root artifact pairs.
- WP-4 (`processingKind`) and WP-5 (union loader / query traversal) explicitly out of scope.
