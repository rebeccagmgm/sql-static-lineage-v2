## Purpose

为已有 Input Pack 的 PARTIAL 任务提供可审计的逐项证据修复流程，在证据不足时明确保留 UNKNOWN/PARTIAL，避免通过任务名、模糊 datasource 或不完整目录猜造物理身份。

## ADDED Requirements

### Requirement: Current partial inventory is evidence-based

The repair workflow SHALL build its worklist from the current task status document and current schedule-evidence cache after the relevant cache writers have stopped changing. Each work item SHALL retain the task ID, task category, current status, observed gap reasons, available local evidence, and a repair outcome.

#### Scenario: Historical summaries disagree with current status

- **WHEN** an old summary reports different SUCCESS/PARTIAL counts from the current status document
- **THEN** the workflow SHALL use the current status and SHALL label the old summary as historical rather than mixing the counts

#### Scenario: Relation cache contains a task neighbor

- **WHEN** a relation cache row exists but no task SQL, table metadata, or table DDL evidence exists
- **THEN** the workflow SHALL NOT use the relation row as SQL or physical table evidence

### Requirement: Evidence repair is local-first and fail-closed

The workflow SHALL check existing valid Table Packs, local SQL/log caches, local restored metadata/DDL catalogs, and local datasource evidence before using online backup queries. Online backup SHALL be explicit, serial or bounded, and SHALL write provenance, observation time, and content hashes. Missing, duplicate, conflicting, unauthorized, or rate-limited evidence SHALL remain an explicit unresolved outcome and SHALL NOT be converted to object absence.

#### Scenario: Local evidence uniquely identifies a table

- **WHEN** local metadata and DDL identify one physical platform, qualified name, and dataSource
- **THEN** the workflow SHALL reuse or write that Table Pack without an online query

#### Scenario: Online table lookup returns multiple physical objects

- **WHEN** an exact table lookup returns more than one candidate after the supplied platform/dataSource constraints
- **THEN** the workflow SHALL write no replacement evidence and SHALL retain an ambiguity reason

#### Scenario: Online service returns a permission or rate-limit failure

- **WHEN** an online backup returns 403, 429, timeout, or an adapter failure
- **THEN** the workflow SHALL preserve that failure class in the repair manifest and SHALL not classify the table as missing

### Requirement: SQL and log evidence can be retried without weakening slot semantics

The workflow SHALL recognize `runScript`, `runScript-2.0`, and `sparkScript` as log-SQL task categories. A forced retry SHALL retry only an existing unavailable SQL cache and SHALL preserve an existing available cache. A task-sql fallback SHALL fill only an absent query slot when the returned SQL is valid; it SHALL NOT use create SQL as a physical table DDL or fabricate a target identity.

#### Scenario: A runScript task has a cached execution log

- **WHEN** the log contains a recognized executable SQL block for a `runScript` task
- **THEN** the workflow SHALL write `run-script.sql` with the log provenance and make the SQL available to the cache assembler

#### Scenario: An unavailable SQL cache is retried

- **WHEN** `--force` is supplied and the existing SQL cache is `UNAVAILABLE`
- **THEN** the workflow SHALL attempt the configured local or bounded backup evidence route, while an existing `AVAILABLE` cache SHALL remain unchanged

#### Scenario: Task SQL has no usable query

- **WHEN** the task-sql response has no non-empty query and no recognized log SQL exists
- **THEN** the task SHALL remain PARTIAL/UNKNOWN with an explicit SQL evidence gap

### Requirement: Datasource and table identity require unique physical evidence

The workflow SHALL treat an exact known Horae server tag as a datasource label only when the datasource evidence is non-conflicting. A datasource service or display name alone SHALL NOT be expanded into a physical dataSource by naming convention. A repaired Table Pack SHALL require matching qualified name, platform, and dataSource evidence plus non-empty DDL.

#### Scenario: A source value is an exact datasource label

- **WHEN** a non-`*2hive` task source exactly matches one non-conflicting Horae server tag
- **THEN** the source value SHALL be excluded from physical table candidates while SQL table references remain candidates

#### Scenario: A source value is not in datasource evidence

- **WHEN** a source string is not an exact known datasource label
- **THEN** the workflow SHALL retain it under the existing table-candidate rules and SHALL not silently drop it

#### Scenario: Same table name maps to multiple instances

- **WHEN** the available core or DDL evidence maps one qualified name to multiple physical dataSources
- **THEN** the workflow SHALL retain `AMBIGUOUS`/`UNKNOWN` unless an exact unique endpoint identity resolves it

### Requirement: Repaired evidence is followed by targeted Input Pack verification

The workflow SHALL rerun only tasks whose SQL, log, datasource, or table evidence changed, using the existing Input Pack writer and force safeguards. It SHALL verify task/table content hashes, status transitions, and the final unresolved inventory. Documentation SHALL report historical counts separately from the stabilized current result and SHALL list unresolved reasons and evidence boundaries.

#### Scenario: Evidence repair changes a PARTIAL task

- **WHEN** a repair manifest records new valid SQL or Table evidence for a task
- **THEN** that task SHALL be included in the targeted from-cache rerun and its resulting status/hash SHALL be recorded

#### Scenario: No valid evidence was added

- **WHEN** all candidate evidence routes miss, conflict, or fail closed
- **THEN** the task SHALL not be force-rewritten merely to change its label, and the documentation SHALL record why it remains PARTIAL/UNKNOWN
