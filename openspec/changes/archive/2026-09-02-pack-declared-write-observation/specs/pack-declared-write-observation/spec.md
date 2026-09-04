## Purpose

Make Pack-declared query-output writes an explicit, provenance-preserving and fail-closed Machine Facts contract.

## ADDED Requirements

### Requirement: Pack-declared query output has an explicit write observation

The system SHALL emit a `PACK_DECLARED_QUERY_OUTPUT` write observation when a task's Input Pack directly confirms a physical target, the SQL contains no explicit INSERT/CTAS write for that target, and exactly one deduplicated query producer has contiguous output ordinals. The observation MUST retain the target dataset identity, producer statement identity and `provenance: PLATFORM_TARGET`.

#### Scenario: One query producer and a direct Pack target

- **WHEN** a sparkIndex Pack has one directly resolved target and one enumerable query producer
- **THEN** Facts contains one `PACK_DECLARED_QUERY_OUTPUT` write observation and its output bindings use that same write-observation identity

#### Scenario: Multiple query outputs cannot be reduced to one producer

- **WHEN** the Pack target exists but zero or multiple distinct query producers remain after semantic deduplication
- **THEN** Facts emits `PLATFORM_TARGET_QUERY_BOUNDARY_NOT_PROVABLE`, emits no resolved Pack-declared output bindings and does not choose a producer by position or task name

### Requirement: Pack-declared observations preserve the original SQL hash

Every Pack-declared write observation and each derived output binding SHALL carry `source_sql_sha256`, a valid SHA-256 of the original Input Pack SQL source. For Input Pack bundles it MUST equal `manifest.inputs.input_pack.sql_sha256`; the analysis snapshot or combined SQL view MUST NOT replace this provenance hash.

#### Scenario: Analysis uses a derived multi-slot snapshot

- **WHEN** Facts analyzes a deterministic combined view of Pack SQL slots
- **THEN** the Pack-declared write still points to the selected original Pack SQL hash and the statement raw SQL/span remain unchanged in the canonical statement records

### Requirement: Evidence gates fail closed

The system SHALL not produce a resolved Pack-declared output binding unless target identity, query boundary, target Schema and partition evidence are sufficient. Missing or conflicting evidence MUST remain a typed `unknowns.jsonl` gap with the relevant reason code and uncovered producer ordinals.

#### Scenario: Target Schema is absent

- **WHEN** a Pack-declared query output has a proven producer but no valid target Table Pack Schema
- **THEN** Facts retains the write observation, emits `PLATFORM_TARGET_SCHEMA_NOT_PROVABLE` and emits no resolved output binding

#### Scenario: Partition evidence is incomplete or conflicting

- **WHEN** the target is partitioned and Pack partition status is not `COMPLETE`
- **THEN** Facts emits `PLATFORM_TARGET_PARTITION_NOT_PROVABLE` and does not bind output ordinals

### Requirement: CTAS boundary and explicit INSERT semantics remain distinct

The system SHALL keep `source_as_boundary.proven=false` for ordinary explicit INSERT/INSERT OVERWRITE writes that do not have a CTAS `AS SELECT` boundary. This flag MUST NOT by itself invalidate a valid explicit SQL write binding. Pack-declared query-output writes and CTAS writes require a proven query producer boundary.

#### Scenario: Explicit INSERT has no CTAS boundary

- **WHEN** an explicit INSERT has enumerable producer expressions and valid target/partition evidence
- **THEN** its SQL write binding may resolve while its `source_as_boundary.proven` remains false

### Requirement: Legacy platform-target Facts remain readable

Consumers SHALL accept existing `PLATFORM_TARGET_QUERY_OUTPUT` write/evidence kinds as a legacy alias. New Facts MUST use `PACK_DECLARED_QUERY_OUTPUT`; compatibility MUST NOT upgrade a legacy or incomplete record to a stronger evidence status.

#### Scenario: Existing bundle is loaded after the change

- **WHEN** a bundle contains the legacy platform-target kind and otherwise valid hashes/endpoints
- **THEN** validation and read-only consumers continue to load it without rewriting the bundle

### Requirement: Real Pack regression is deterministic and non-destructive

The focused acceptance test SHALL regenerate representative real Packs for tasks 132028, 155939 and 176827 into an isolated temporary Facts root, assert deterministic output and provenance/gate semantics, and leave the source Pack SQL and shared Facts roots unchanged.

#### Scenario: Representative real Packs are available

- **WHEN** the configured real data root contains all three task Packs and their target Table Packs
- **THEN** the focused test completes with the expected Pack-declared observations/bindings or typed fail-closed gaps and repeats with identical canonical output

#### Scenario: Real Pack root is unavailable

- **WHEN** no real data root is mounted and `WP6_REAL_PACK_REQUIRED` is not set
- **THEN** the focused test is visibly skipped rather than substituting synthetic SQL as the only acceptance evidence
