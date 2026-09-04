# field-evidence-v1-impact-query Specification

Query-time field impact projection for WP-11 Phase 2. Consumes `TASK_LOCAL_PROJECTION` ≥ 1.3.0 and `UNION_CONTINUATION_INDEX` without modifying either contract.

## ADDED Requirements

### Requirement: FieldEdgeIndex access layer

The system SHALL expose a `FieldEdgeIndex` that indexes field value edges by `(writeObservationId, outputColumn)` and by read-field key `(sourceReadOccurrenceId, column)` for RESOLVED edges. Index construction SHALL incorporate per-task Facts `relation-nodes.jsonl` and `relation-edges.jsonl` into a `RelationTreeIndex`. Impact query hot paths SHALL read edges only through `FieldEdgeIndex`, not by scanning `projection.edges` directly.

#### Scenario: Multiple edges per binding

- **WHEN** a write observation has multiple `FIELD_DIRECT` / `FIELD_CONDITIONAL` edges for the same `outputColumn` (e.g. setop branches)
- **THEN** `FieldEdgeIndex` returns all matching edges, each with distinct `sourceRelationId` and `expressionId`

### Requirement: resolveReadField four outcomes

The system SHALL implement `resolveReadField(consumerTaskId, readOccurrenceId, column)` against `UNION_CONTINUATION_INDEX` and producer `FieldEdgeIndex` with exactly these outcomes:

1. **Confirmed** — exactly one candidate with `l1Eligible === true`, and producer has ≥1 matching `FieldEdge` for `(writeObservationId, column)`.
2. **Candidate frontier** — zero candidates, multiple candidates, or single candidate with `l1Eligible === false`; INDEX `reasonCode` preserved on each candidate.
3. **No INDEX entry** — `entryForRead` undefined → gap `PRODUCER_NOT_PROJECTED`.
4. **No producer binding** — confirmed candidate but no matching producer `FieldEdge` → gap `PRODUCER_BINDING_NOT_FOUND`.

#### Scenario: Unique l1Eligible producer

- **WHEN** INDEX returns one candidate with `l1Eligible === true`
- **THEN** resolve returns confirmed with that `writeObservationId` and all producer field edges for the column

#### Scenario: Multi-writer frontier

- **WHEN** INDEX returns more than one candidate or `l1Eligible === false`
- **THEN** resolve returns candidate frontier with `reasonCode` from INDEX unchanged; default recursion does not continue

### Requirement: impactQuery contract version gate

`impactQuery` SHALL reject projections with `schemaVersion < 1.3.0` by returning a result whose `gaps[]` contains `CONTRACT_TOO_OLD` and empty `value` / `control` / `frontier` beyond the anchor check. It SHALL NOT downgrade or guess missing 1.3.0 attributes.

#### Scenario: Legacy 1.2.0 projection

- **WHEN** the anchor task projection is `1.2.0`
- **THEN** the result includes `CONTRACT_TOO_OLD` and does not emit value chains

### Requirement: impactQuery anchor value collection

For anchor `(taskId, writeObservationId, outputColumn)`, the system SHALL collect **all** field edges on that write observation and column into `value[]` at depth 0, without selecting only the first edge.

#### Scenario: Setop fan-in at anchor

- **WHEN** the anchor column has field edges from multiple setop branches with distinct `sourceRelationId`
- **THEN** `value[]` at depth 0 contains one entry per edge, not a single merged entry

### Requirement: Control scope via relation subtree

For each control edge on the anchor write observation, the system SHALL compute `scope` using `sourceRelationId` of each value edge and the control edge's `relationId`, `joinType`, `controlSide`, and `leftRelationId` / `rightRelationId`, via `subtreeContains` and `nearestSetopAncestor` on the task relation tree.

Rules:

- JOIN nullable side (LEFT right / RIGHT left / FULL either) + value `sourceRelationId` on nullable side → `FIELD_SCOPED`
- JOIN preserved side → `DATASET_SCOPED` with `grain`
- `joinType = INNER` → `DATASET_SCOPED` for all columns (never `SCOPE_DISJOINT`)
- FILTER / GROUP_BY → `DATASET_SCOPED`
- Provably different setop branches or disjoint CTE subtrees → `SCOPE_DISJOINT`
- `SCOPE_DISJOINT` SHALL NOT be emitted when scope cannot be proved (e.g. missing relation path)

#### Scenario: Same join different scopes

- **WHEN** two queries share the same JOIN `relationId` but value edges have `sourceRelationId` on nullable vs preserved side
- **THEN** control entries show `FIELD_SCOPED` vs `DATASET_SCOPED` respectively

### Requirement: Materialization gap passthrough

Before INDEX resolution on a hop, if the current task projection `gaps[]` contains `TASK_LOCAL_MATERIALIZATION_FIELD_BREAK` for `(taskId, physicalDataset)` and the hop source table equals `physicalDataset`, the system SHALL copy that gap into the result unchanged and SHALL NOT emit `PRODUCER_NOT_PROJECTED` for that hop.

#### Scenario: Temp table break on 181058

- **WHEN** querying an anchor column sourced from an unfolded temp table listed in `details.columns`
- **THEN** `gaps[]` includes `TASK_LOCAL_MATERIALIZATION_FIELD_BREAK` with non-empty `details.columns`

### Requirement: Non-RESOLVED value edge handling

When a value edge has `sourceReadOccurrenceStatus` other than `RESOLVED`, the system SHALL stop recursion on that branch and SHALL copy the corresponding Phase 1 read-occurrence gap from projection `gaps[]` into result `gaps[]`.

#### Scenario: Ambiguous read occurrence

- **WHEN** a value edge has `sourceReadOccurrenceStatus = AMBIGUOUS`
- **THEN** recursion stops on that branch and `gaps[]` includes the matching `FIELD_SOURCE_READ_OCCURRENCE_AMBIGUOUS` entry from the projection

### Requirement: Traversal budget

The system SHALL track `edgesVisited`, `frontier` count, and depth. When `maxEdges`, `maxFrontier`, or `maxDepth` is exceeded, it SHALL append `TRAVERSAL_BUDGET_EXCEEDED` with `{ which, at }` and SHALL NOT silently truncate.

#### Scenario: Edge budget exceeded

- **WHEN** traversal would visit more than `maxEdges` value or control records
- **THEN** the result includes `TRAVERSAL_BUDGET_EXCEEDED` with `which = maxEdges` and `budget.exhausted = true`

### Requirement: FIELD_IMPACT_RESULT output

Results SHALL validate as `artifactType: FIELD_IMPACT_RESULT`, `schemaVersion: 1.0.0`, with `value`, `control`, `frontier`, `gaps`, and `budget` sections per `docs/execution-plan-field-evidence-v1.md` §6.4. Impact results SHALL NOT be persisted or cached as closures.

#### Scenario: Valid result shape

- **WHEN** `impactQuery` completes for a 1.3.0 anchor
- **THEN** `validateFieldImpactResult` accepts the output and all four sections are present

### Requirement: Golden invariant tests

The project SHALL provide `npm run test:field-evidence` asserting invariant properties for cases A–E under `tests/fixtures/field-evidence-v1/<case>/expected.json`. Tests SHALL skip when sibling `sql-static-lineage-data/field-facts` is absent; `FIELD_EVIDENCE_GOLDEN_REQUIRED=1` SHALL fail closed.

#### Scenario: Missing data pack

- **WHEN** `field-facts` is not mounted and `FIELD_EVIDENCE_GOLDEN_REQUIRED` is unset
- **THEN** `test:field-evidence` skips golden cases without failing the suite

### Requirement: Stop-loss CLI

`npm run field-evidence:stop-loss` SHALL compute for ten Greek-class columns on task 176827: `confirmedTwoHopRatio`, `dominantGap`, and `decision` ∈ `{ GO_PHASE3, WAIT_WP8, BACKFILL_FACTS, FIX_PHASE1 }` per §9 thresholds without relaxation.

#### Scenario: Stop-loss emits decision

- **WHEN** 1.3.0 projection and INDEX are available for the Greek column batch
- **THEN** CLI stdout includes `confirmedTwoHopRatio`, `dominantGap`, and `decision`

### Requirement: No literal anchors in derivation code

Modules under `scripts/project-graph/field-evidence-v1/` used by impact query SHALL NOT contain task ids, schema names (`dm_rsk_n`, `pdata_n`), or column name literals used as anchors; enforced by the existing lint test scope extension.

#### Scenario: Lint covers impact modules

- **WHEN** `no-literal-anchors.test.ts` runs
- **THEN** it scans `field-edge-index.ts`, `resolve-read-field.ts`, `control-scope.ts`, `impact-query.ts`, and `impact-result-contract.ts`
