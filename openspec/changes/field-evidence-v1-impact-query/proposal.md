## Why

Phase 1 (`field-evidence-v1`) raised `TASK_LOCAL_PROJECTION` to 1.3.0 with read-occurrence identity, path subtype, and JOIN control side — but consumers still cannot answer cross-task field impact questions. Field facts exist on the projection; WP-8 `UNION_CONTINUATION_INDEX` exists for continuation. Phase 2 adds a **query-time** `FIELD_IMPACT_RESULT` projection (value / control / frontier / gaps) without materializing closures or new node types.

## What Changes

- **FE-4** `FieldEdgeIndex` + `resolveReadField()` — four outcomes: unique + `l1Eligible`, multi-candidate, no INDEX entry, producer missing matching `FieldEdge`.
- **FE-5** `impactQuery()` — §6 algorithm, relation-tree scope (§6.3), traversal budget, `FIELD_IMPACT_RESULT` 1.0.0 output; no persistence.
- **FE-6** Five golden cases A–E (`tests/fixtures/field-evidence-v1/<case>/expected.json`) + `npm run test:field-evidence`.
- **FE-7** `npm run field-evidence:stop-loss` — ten Greek columns on task 176827; outputs `confirmedTwoHopRatio`, `dominantGap`, `decision`.
- Input projection `schemaVersion < 1.3.0` → `CONTRACT_TOO_OLD` (no downgrade).
- `TASK_LOCAL_MATERIALIZATION_FIELD_BREAK` gaps from Phase 1 are forwarded before INDEX lookup (Case E).
- One `outputColumn` may yield multiple `FieldEdge` rows (setop ordinal); all enter VALUE, distinguished by `sourceRelationId` / `expressionId`.

## Capabilities

### New Capabilities

- `field-evidence-v1-impact-query`: Query-time field impact projection (`FIELD_IMPACT_RESULT` 1.0.0), `FieldEdgeIndex`, `resolveReadField`, control scope via relation tree, golden invariants A–E, stop-loss CLI.

### Modified Capabilities

（无。Phase 1 契约与派生逻辑只读，本 change 不修改 `task-local-graph-projection` 需求。）

## Impact

- New modules under `scripts/project-graph/field-evidence-v1/` (`field-edge-index.ts`, `resolve-read-field.ts`, `control-scope.ts`, `impact-query.ts`, `impact-result-contract.ts`, `stop-loss-cli.ts`).
- New tests under `tests/project-graph/field-evidence-v1/` and `tests/fixtures/field-evidence-v1/`.
- `package.json` scripts: `test:field-evidence`, `field-evidence:stop-loss`.
- Minimal doc patches: `execution-plan-field-evidence-v1.md` §6–§7, phase table; one-line pointers in `architecture-evidence-lineage-overview.md` and `execution-plan-asset-graph.md`.
- No changes to INDEX contract, Facts publisher, Phase 1 derivation, or WP-8 consumers.
