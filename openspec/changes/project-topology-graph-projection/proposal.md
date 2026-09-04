## Why

The repository already publishes evidence-bounded one-hop and multi-hop lineage artifacts, but it has no project-scoped, deterministic graph projection for joining selected roots, navigating shared tasks and datasets, or replaying controlled topology queries. The first step should expose that existing value without changing the canonical lineage pipeline, importing the old knowledge-graph inference stack, or committing to Neo4j before the graph contract is proven.

## What Changes

- Establish the four-phase product roadmap while implementing only Phase 1 in this change:
  1. `PROJECT_TOPOLOGY`: read-only project topology projection and deterministic reference queries.
  2. `FIELD_EVIDENCE`: on-demand occurrence/write/binding-level field projections from existing canonical field artifacts.
  3. `QUERY_INDEX`: optional Neo4j projection with parity against reference queries.
  4. `TARGET_CAUSAL_OVERLAY` and `BUSINESS_SEMANTIC_OVERLAY`: target-scoped causal judgments and separately sourced business knowledge.
- Add a concrete `ProjectTopologySnapshotV1` contract that binds an explicit project key and root-task selection to validated one-hop/multi-hop artifact references and content identities.
- Add a concrete `ProjectTopologyProjectionV1` that emits deterministic node and edge JSONL plus a projection manifest under a project-graph-specific output root.
- Preserve task, physical dataset, schedule, read/write, producer-role, gap, terminal, blocked, and truncation semantics without recalculating lineage or filling missing evidence.
- Add deterministic, file-backed reference queries for project topology, upstream tracing, and topology-edge explanation.
- Keep the existing task artifact publication layout and every existing parser, Machine Facts, one-hop, multi-hop, field-lineage, causal, and cache contract unchanged.
- Explicitly exclude Neo4j, UI work, field expansion, causal projection, business semantics, remote collection, SQL reparsing, and old knowledge-graph fallback from Phase 1.

## Capabilities

### New Capabilities

- `project-topology-graph-projection`: Defines a read-only, deterministic, evidence-traceable project topology projection and its minimal reference-query behavior.

### Modified Capabilities

None. Existing task publication and lineage capabilities remain unchanged and are consumed only through their published artifact contracts.

## Impact

- Adds planning and, during implementation, isolated code under a project-graph module plus focused tests and fixtures.
- Adds project-scoped projection outputs outside `artifacts/tasks/<task-id>/`; it does not add a task-level manifest or public run directory.
- Reuses existing artifact validators and identifiers instead of changing canonical lineage artifacts or their IDs.
- Introduces no production database, external service, remote call, parser, or runtime dependency in Phase 1.
