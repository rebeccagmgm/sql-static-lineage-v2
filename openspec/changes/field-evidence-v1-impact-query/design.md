## Context

Phase 1 (`field-evidence-v1`) is complete: `TASK_LOCAL_PROJECTION` 1.3.0, read-occurrence on field edges, path subtype, JOIN side via relation subtree, materialization gaps aggregated per `(taskId, physicalDataset)`. Full algorithm and golden invariants are in `docs/execution-plan-field-evidence-v1.md` §6–§9.

This change implements **query-time** impact only. It consumes 1.3.0 projections and WP-8 `UNION_CONTINUATION_INDEX` read-only.

## Goals / Non-Goals

**Goals:** `FIELD_IMPACT_RESULT` 1.0.0; `FieldEdgeIndex`; `resolveReadField` four states; relation-tree scope; budget fail-closed; golden A–E; stop-loss §9.

**Non-Goals:** Persist closures; field-level control edges; new node types; temp-table fold fixes; INDEX / Facts / Phase 1 changes; task-id or table/column literals in derivation code.

## Decisions

### D1. Relation tree for scope (§6.3)

1.3.0 projections carry field edges with `sourceRelationId` but **no** relation parent/child edges. **Convention:** when building `FieldEdgeIndex` for a task, also load that task's Facts `relation-nodes.jsonl` + `relation-edges.jsonl` (or equivalent bundle rows) and compile `RelationTreeIndex` via existing `relation-tree.ts`.

At query time, `control-scope.ts` uses `subtreeContains` and `nearestSetopAncestor` only — **never** table-name or suffix heuristics. `SCOPE_DISJOINT` is emitted only when setop branches differ or CTE subtrees are provably disjoint; **never** because a path was not found.

### D2. Multiple FieldEdges per outputColumn

After INDEX resolve to a producer write observation, collect **all** `FieldEdge` rows where `writeObservationId` and `outputColumn` match. Setop-sunk edges are distinguished by `sourceRelationId` and `expressionId`. **Forbidden:** take the first edge only.

### D3. Case E — materialization gap passthrough

Before INDEX lookup on a hop: if the current task's projection `gaps[]` already contains `TASK_LOCAL_MATERIALIZATION_FIELD_BREAK` for `(taskId, physicalDataset)` and the hop's source qualified table equals that `physicalDataset`, copy the gap into the result unchanged. Do **not** relabel as `PRODUCER_NOT_PROJECTED`. Unfolded temp read occurrences may still be `RESOLVED` (reading the temp table); recursion stops on materialization break, not solely on `sourceReadOccurrenceStatus ≠ RESOLVED`.

### D4. Non-RESOLVED value edges

Stop recursion on that branch; copy Phase 1 read-occurrence gaps from projection `gaps[]` into result `gaps[]`.

### D5. Control recursion

`FIELD_SCOPED` control columns enter value recursion; `DATASET_SCOPED` are recorded only. `INNER JOIN` → all columns `DATASET_SCOPED`, never `SCOPE_DISJOINT`. `CANDIDATE` default: no recursion; `expandCandidates=true` counts each candidate against budget with `evidenceStatus=CANDIDATE`.

### D6. Budget

Exceeding `maxEdges`, `maxFrontier`, or `maxDepth` → `TRAVERSAL_BUDGET_EXCEEDED` with `{ which, at }`; no silent truncation.

### D7. FieldEdgeIndex indirection

All hot-path edge reads go through `FieldEdgeIndex` (binding-key and read-field indexes). Direct scans of `projection.edges` in query code are forbidden.

### D8. INDEX consumption

Reuse `loadUnionContinuationCandidateSource` / `entryForRead` / `candidatesForRead` from `union-continuation-candidate-source.ts`. INDEX `reasonCode` values pass through unchanged. Impact query does not require INDEX `taskProjections` contentHash to match live 1.3.0 reprojection (hash drift after 1.3.0 bump is expected); it requires `schemaVersion >= 1.3.0` on loaded projections.

### D9. SETOP_BRANCH_UNRESOLVED

Reason code remains in the Phase 1 table; live Phase 1 emits `CTE_SCOPE_UNRESOLVED` for missing setop branches. Impact query does not change Phase 1 emission.

## Migration Plan

1. Land OpenSpec artifacts; `openspec validate field-evidence-v1-impact-query --strict`.
2. Implement FE-4 → FE-5 → run real queries → freeze FE-6 expected.json.
3. FE-7 stop-loss CLI; extend `no-literal-anchors` lint to new modules.
4. Doc one-line updates; phase table → Phase 1 done, Phase 2 in progress.

## Open Questions

- Shadow evaluation slice +2 setop/materialization gold cases: listed as tasks tail item; do not block A–E.
