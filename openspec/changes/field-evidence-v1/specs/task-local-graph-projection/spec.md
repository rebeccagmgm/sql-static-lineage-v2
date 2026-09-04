## ADDED Requirements

### Requirement: Field edges carry read-occurrence and expression provenance

Starting at `TASK_LOCAL_PROJECTION` schema 1.3.0, every `FIELD_DIRECT` and `FIELD_CONDITIONAL` edge SHALL carry `sourceReadOccurrenceId` (string or null), `sourceReadOccurrenceStatus` (`RESOLVED | AMBIGUOUS | UNRESOLVED`), optional `sourceReadOccurrenceReason` when not `RESOLVED`, `sourceRelationId` (the matched **physical read relation id**, or null when not `RESOLVED`), and `expressionId`. When more than one read occurrence of the same physical table lies under the resolution subtree and the reference cannot be narrowed by qualifier, the edge SHALL be `AMBIGUOUS` with null ids and a projection gap; the system SHALL NOT select the first candidate.

Materialized-field folding SHALL preserve leaf expression context (`leafExpressionId`, `leafRelationId`, `pathHadAggregation`) and resolve read occurrences from the leaf relation, not the folded-away top-level relation.

When the expression's relation is a setop, the projector SHALL descend into each branch by output ordinal and emit one edge per branch with `sourceRelationId` in that branch's subtree; it SHALL NOT merge branches into a single ambiguous edge.

#### Scenario: Single read of the source table under the leaf expression

- **WHEN** exactly one read occurrence of the input field's table lies under the leaf expression's relation subtree
- **THEN** the edge has `sourceReadOccurrenceStatus = RESOLVED`, `sourceReadOccurrenceId` equal to that occurrence, and `sourceRelationId` equal to that read relation's id

#### Scenario: Self-join without resolvable qualifier

- **WHEN** two read occurrences of the same table lie under the subtree and the input reference carries no qualifier that uniquely matches one of them
- **THEN** the edge has `sourceReadOccurrenceStatus = AMBIGUOUS`, null ids, `sourceReadOccurrenceReason = SELF_JOIN_NO_QUALIFIER`, and gap `FIELD_SOURCE_READ_OCCURRENCE_AMBIGUOUS`

#### Scenario: UNION branches emit separate edges

- **WHEN** an output column is produced from a setop with two branches each reading the same physical table
- **THEN** two `FIELD_DIRECT` edges are emitted (one per branch), each `RESOLVED` with distinct `sourceRelationId` values in the respective branch subtrees

#### Scenario: Edge identity distinguishes read occurrences

- **WHEN** the same `(sourceTable, sourceColumn, outputColumn)` is reached through two different resolved read occurrences
- **THEN** two distinct `FIELD_DIRECT` edges are emitted, not one

### Requirement: Value edge subtype is classified or explained

Starting at schema 1.3.0, `FIELD_DIRECT.subtype` SHALL be `IDENTITY` for a bare column reference (alias permitted), `AGGREGATION` when the expression contains an aggregate function or its relation is an aggregate context, `TRANSFORMATION` for every other expression with physical input, and `UNKNOWN` only with a non-empty `subtypeReason`. For edges produced through materialization folding, subtype SHALL be composed along the fold path: any hop with aggregation → `AGGREGATION`; else any non-identity hop → `TRANSFORMATION`; else `IDENTITY`. Constant expressions SHALL NOT produce field edges. Columns appearing only in window `PARTITION BY` / `ORDER BY` SHALL NOT produce `FIELD_DIRECT` edges.

#### Scenario: Cast is a transformation

- **WHEN** the output expression is `cast(a.price as decimal(18,6))`
- **THEN** the edge subtype is `TRANSFORMATION`

#### Scenario: Folded aggregation path

- **WHEN** a temp table column is `sum(price)` and the final select is `select t.amt`
- **THEN** the folded field edge subtype is `AGGREGATION`, not `IDENTITY`

#### Scenario: Constant produces no source edge

- **WHEN** the output expression is `'Y' as flag`
- **THEN** no `FIELD_DIRECT` edge is emitted for `flag`

#### Scenario: Unknown must be explained

- **WHEN** validating a 1.3.0 edge with `subtype = UNKNOWN` and no `subtypeReason`
- **THEN** validation fails with a typed contract error

### Requirement: Dataset control edges carry join type and control side

Starting at schema 1.3.0, every `DATASET_CONTROL` edge with `subtype = JOIN` SHALL carry `joinType`, `controlSide`, `leftRelationId` and `rightRelationId`. `controlSide` SHALL be derived from whether the control column's physical read relation lies in the join's left or right relation subtree (not from physical table name suffix matching). Non-JOIN controls SHALL carry `joinType = N/A` and `controlSide = N/A`. When the control column cannot be attributed to one side, `controlSide` SHALL be `BOTH` and gap `CONTROL_SIDE_UNRESOLVED` SHALL be recorded.

#### Scenario: LEFT JOIN key on the right subtree

- **WHEN** a join has `join_type = left` and the control column's read relation lies only under the join's right child subtree
- **THEN** the edge has `joinType = LEFT` and `controlSide = RIGHT`

#### Scenario: JOIN without join type is rejected

- **WHEN** validating a 1.3.0 `DATASET_CONTROL` edge with `subtype = JOIN` and `joinType = N/A`
- **THEN** validation fails with a typed contract error

### Requirement: Task-local materialization field breaks are named per physical dataset

When an input field's table is a task-local materialization written by the same task and no resolved materialization bridge connects it to an output binding, the projection SHALL record one gap `TASK_LOCAL_MATERIALIZATION_FIELD_BREAK` per `(taskId, physicalDataset)` with aggregated `columns[]`, `affectedEdgeCount`, and `writeObservationIds[]`, and SHALL NOT report the table as an external producer gap.

#### Scenario: Temp table read by its own task

- **WHEN** task 181058 reads `dm_rsk_n.otc_opt_inr_comp_pal_sum_temp` and bindings have no bridge to that read
- **THEN** exactly one projection gap lists all seven affected columns and multiple write observation ids

### Requirement: Schema 1.3.0 is a single version bump with legacy read compatibility

The contract SHALL move from 1.2.0 to 1.3.0 in one release carrying all field-edge and control-edge additions together. Readers SHALL continue to accept 1.2.0 and 1.1.0 artifacts. Validation of READS edges for `readOccurrenceId` SHALL apply to all schema versions `>= 1.2.0`, not only the current schema version constant. The 1.3.0 validator SHALL reject a 1.3.0 artifact missing any newly required property.

#### Scenario: Legacy 1.2.0 artifact still validates READS

- **WHEN** loading a 1.2.0 projection whose READS edges lack `readOccurrenceId`
- **THEN** validation fails even though the artifact is not 1.3.0

#### Scenario: Incomplete 1.3.0 artifact is rejected

- **WHEN** a 1.3.0 `FIELD_DIRECT` edge lacks `sourceReadOccurrenceStatus`
- **THEN** validation fails with a typed contract error

### Requirement: Phase 1 baseline proves generalization across cohorts

After reprojection, the project SHALL emit `phase1-baseline.json` with metrics for cohorts `anchorExpansionBatch` (186 tasks from the four-anchor upstream expansion), `shadowEvaluationSlice` (remaining 344 − 186 Facts tasks — a structural generalization check, not an independently labeled holdout set), and `all` (344), including `resolvedDirectRatio` with denominator equal to all emitted `FIELD_DIRECT` edges. Phase 1 SHALL be considered complete only when shadow slice improvement is not materially worse than anchor expansion batch improvement per `docs/execution-plan-field-evidence-v1.md` §5.5.

#### Scenario: Shadow slice does not improve with anchor batch

- **WHEN** `anchorExpansionBatch.resolvedDirectRatio` rises but `shadowEvaluationSlice` does not improve by at least half of the anchor batch's gain
- **THEN** Phase 2 work SHALL NOT begin until derivation rules are revised
