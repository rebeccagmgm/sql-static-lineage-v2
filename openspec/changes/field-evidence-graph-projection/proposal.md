## Why

Phase 1 can navigate project Task and dataset topology, while the existing `FIELD_MULTI_HOP_RECONCILIATION` artifact already contains precise field bindings, expressions, value-flow edges, controls, candidates and gaps. They are not yet connected by a deterministic, on-demand projection: notably, Task 176827 has a canonical root `write_observation_id`, but its platform-target write is not a Phase 1 multi-hop `WRITES` edge, so a consumer must not guess the join from table name or array position.

## What Changes

- Add Phase 2 `FIELD_EVIDENCE`, an isolated read-only projection over one validated Phase 1 project-topology snapshot and one validated field-lineage artifact.
- Require an explicit root Task, exact physical target, singleton root Write Observation and selected root fields; reject ambiguous or incoherent inputs instead of selecting by tail name, ordinal or timestamp.
- Project only each selected field's upstream-reachable evidence slice, including stable Task/dataset/physical-field references, target writes, field binding/state nodes, expressions, `VALUE_FLOW`, exact read-occurrence and producer-write references when proven, rowset controls, candidates, gaps and coverage boundaries.
- Treat physical datasets absent from Phase 1 topology as explicit field-evidence anchors with `NOT_IN_PROJECT_TOPOLOGY` coverage, rather than modifying Phase 1 or discarding the field evidence.
- Publish deterministic immutable field-evidence JSONL snapshots under the dedicated project-graph output root and add bounded file-backed queries for slice retrieval, value-path tracing and evidence explanation.
- Keep the canonical field-lineage generator, Machine Facts, one-hop/multi-hop, Phase 1 snapshots and task artifact publication unchanged.
- Explicitly exclude whole-project field expansion, Neo4j, UI work, causal assessment, business semantics, SQL parsing, evidence collection and old-KG fallback.

## Capabilities

### New Capabilities

- `field-evidence-graph-projection`: Defines exact source alignment, on-demand field-evidence slicing, occurrence/write/binding preservation, immutable publication and bounded reference-query behavior for Phase 2.

### Modified Capabilities

None.

## Impact

- Adds isolated code under `scripts/project-graph/field-evidence/` and focused fixtures/tests.
- Adds a narrow CLI/package entry that accepts explicit local project-topology and field-lineage artifacts; it performs no discovery or remote calls.
- Adds immutable outputs under `<projectGraphRoot>/projects/<projectKey>/field-evidence/<fieldEvidenceSnapshotId>/` without writing inside the immutable Phase 1 snapshot or `artifacts/tasks/<task-id>/`.
- Introduces no external runtime dependency or graph database.
