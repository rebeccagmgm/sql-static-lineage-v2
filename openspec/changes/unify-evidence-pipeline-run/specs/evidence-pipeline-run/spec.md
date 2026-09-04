## Purpose

Provide one supported command that prepares required evidence and publishes the current formal table-level and optional field-level lineage outputs for one or more Horae tasks.

## ADDED Requirements

### Requirement: One command runs the complete pipeline
The system SHALL accept one or more Task IDs through one command and orchestrate Input Pack completion, reusable evidence preparation, one-hop reconciliation, multi-hop reconciliation, optional field-lineage projection, and HTML rendering without requiring callers to select intermediate files manually.

#### Scenario: Run the four acceptance tasks
- **WHEN** the command receives Task IDs `155015`, `181058`, `176827`, and `209119`
- **THEN** it attempts the complete requested pipeline for each Task ID and reports the outcome of every task

### Requirement: Required Input Pack evidence is completed before formal derivation
The system SHALL detect and attempt to collect Task and Table Pack evidence required by the requested task traversal before producing formal lineage outputs. The Input Pack SHALL remain appendable between commands; unrelated later additions SHALL NOT retroactively invalidate a previously published task directory.

#### Scenario: Missing upstream Task Pack is collectable
- **WHEN** traversal discovers a required upstream Task Pack that is absent and collection succeeds
- **THEN** the system refreshes its reusable producer evidence and retries preparation before generating formal outputs

#### Scenario: Required evidence remains unavailable
- **WHEN** required Input Pack evidence cannot be collected within the bounded preparation attempt
- **THEN** that task fails without replacing its previously published formal directory

### Requirement: Producer Index remains internal
The system SHALL prepare or load Producer Index evidence internally and SHALL use one consistent loaded producer context for the formal one-hop and multi-hop outputs of a task publication attempt. Producer Index files SHALL NOT be published as a user-visible pipeline stage.

#### Scenario: Produce table lineage
- **WHEN** a task reaches formal one-hop and multi-hop generation
- **THEN** both outputs are derived through the producer context selected by the orchestrator and only the lineage JSON files are published

### Requirement: Formal outputs use fixed per-task paths
The system SHALL publish formal artifacts under `artifacts/tasks/<task-id>/` using fixed filenames: `one-hop.json`, `multi-hop.json`, optional `field-lineage.json`, `views/table-lineage.html`, and optional `views/field-lineage.html`. The system SHALL NOT add a public run directory or `manifest.json`.

#### Scenario: Table-only publication
- **WHEN** field lineage is not requested and table lineage succeeds
- **THEN** the formal task directory contains `one-hop.json`, `multi-hop.json`, and `views/table-lineage.html` and contains no stale field-lineage outputs from a previous publication

#### Scenario: Field publication
- **WHEN** field lineage is requested and succeeds
- **THEN** the formal task directory additionally contains `field-lineage.json` and `views/field-lineage.html`

### Requirement: Publication is isolated and validated per task
The system SHALL build requested artifacts in a task-specific staging directory, validate every requested JSON and HTML dependency, and replace the formal task directory only after validation succeeds. A failure for one task SHALL NOT prevent another successful task from publishing, and the command SHALL return a failing exit status when any requested task fails.

#### Scenario: One task fails in a batch
- **WHEN** one requested task fails and another requested task completes successfully
- **THEN** the successful task is published, the failing task's previous formal directory is preserved, every task result is reported, and the command exits non-zero

### Requirement: HTML renders existing JSON facts only
Table-level HTML SHALL be rendered from the staged `multi-hop.json`. Field-level HTML SHALL be rendered from the staged `field-lineage.json`. Renderers SHALL NOT re-parse SQL, query live lineage, or infer additional lineage edges.

#### Scenario: Render table HTML
- **WHEN** staged multi-hop JSON validates
- **THEN** the table renderer produces HTML from that JSON without reading canonical SQL

#### Scenario: Render field HTML
- **WHEN** staged field-lineage JSON validates
- **THEN** the field renderer produces HTML from that JSON without adding lineage facts

### Requirement: Field lineage is optional and defaults to all target columns
The system SHALL skip Machine Facts and field-lineage publication when field output is not requested. When field output is requested without an explicit field list, the system SHALL infer the canonical target table from the Task Pack and request all provable target columns.

#### Scenario: Request all fields
- **WHEN** field output is requested without a field filter
- **THEN** Machine Facts are prepared for the tasks required by the multi-hop projection and field lineage selects all target columns supported by current evidence

### Requirement: Existing commands and canonical inputs remain compatible
The system SHALL preserve existing standalone stage commands and their output contracts. The orchestrator SHALL NOT rewrite canonical SQL or move existing loose historical artifacts as part of this change.

#### Scenario: Continue using a standalone command
- **WHEN** a caller invokes an existing one-hop, multi-hop, Machine Facts, field-lineage, or visualization command
- **THEN** it retains its prior CLI behavior outside the new formal publication workflow

