# task-local-graph-projection Specification

## Purpose

Publish a deterministic per-task graph projection (`TASK_LOCAL_PROJECTION`) derived only from that task's Machine Facts and schedule metadata, aligned with data-graph node identities, without cross-task data edges.

## Requirements

### Requirement: Self-contained task projection artifact

The system SHALL emit one `TASK_LOCAL_PROJECTION` document per requested task under the project-graph output root, outside `artifacts/tasks/<task-id>/`.

Each artifact SHALL include schema version, task id, coverage status, content hash, nodes, and edges provably limited to that task's SQL evidence.

#### Scenario: Successful projection for a task with Facts

- **WHEN** a task has a valid Input Pack and Machine Facts bundle
- **THEN** the artifact coverage status is `PROJECTED`
- **AND** the artifact contains exactly one TASK node for that task id

#### Scenario: Schedule-only task without Facts

- **WHEN** a task appears in schedule cache but has no usable Facts
- **THEN** the artifact coverage status is `SCHEDULE_ONLY`
- **AND** the artifact contains a TASK node and no data edges

### Requirement: Data edges must not reference upstream tasks

Data edges (`READS`, `WRITES`, `FIELD_DIRECT`, `FIELD_CONDITIONAL`, `DATASET_CONTROL`) SHALL NOT encode other task ids as graph endpoints.

Schedule upstream task ids MAY appear only as TASK node properties (e.g. `scheduleUpstreamTaskIds`), not as edge endpoints.

#### Scenario: READS targets physical dataset only

- **WHEN** projecting READS edges
- **THEN** each edge connects TASK to PHYSICAL_DATASET
- **AND** no TASK-to-TASK data edge is emitted

### Requirement: Identity parity with data-graph

Node id functions SHALL match data-graph algorithms for task, physical dataset, physical field, and target write identities.

#### Scenario: Frozen golden vectors

- **WHEN** computing ids for task `176827`, dataset `dm_rsk_n.otc_opt_greek_val_det_h`, write `write-observation:176827:platform-target:0`, and field `odata_n_tit.d_ref_trs.key_otc_trade_id`
- **THEN** the resulting node ids equal the frozen vectors captured from data-graph reference runs

### Requirement: WP-1 control channel separation preserved

`DATASET_CONTROL` edges SHALL attach to TARGET_WRITE, not to field nodes, and SHALL NOT include `affectedRootFields` or legacy `rowsetControls`.

#### Scenario: Reject legacy field-attached controls in artifact validation

- **WHEN** validating a projection artifact containing `affectedRootFields` or `rowsetControls`
- **THEN** validation fails with a typed contract error

### Requirement: Golden sample gates

For tasks 176827, 119044, and 105387 using existing Facts without regeneration, projection tests SHALL assert task-local counts and forbidden cross-task references per `docs/execution-plan-task-local-projection.md` TL-6.

#### Scenario: 176827 reads only its own SQL tables

- **WHEN** projecting task 176827
- **THEN** READS lists exactly the eleven physical tables from its `dataset-io.jsonl`
- **AND** zipper ref tables are absent from READS (may appear only on DATASET_CONTROL for other tasks' goldens)

### Requirement: Incremental batch cache

Batch projection SHALL skip unchanged tasks when pack hash, facts manifest hash, and projection schema version match a prior successful run.

#### Scenario: Cache hit on second batch

- **WHEN** running the same batch twice with unchanged inputs
- **THEN** all unchanged tasks report cache hit
- **AND** projected bytes match prior output ignoring `generatedAt`
