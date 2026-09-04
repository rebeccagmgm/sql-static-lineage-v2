## Purpose

Defines a project-scoped, deterministic topology projection over existing validated lineage artifacts so downstream users can navigate shared tasks and physical datasets without changing or recomputing canonical evidence.

## ADDED Requirements

### Requirement: Explicit project snapshot selection

The system SHALL require a non-empty project key, an explicit non-empty set of root Task IDs, and one validated formal one-hop/multi-hop artifact pair for each selected root. The system MUST NOT infer project membership merely because tasks were previously analyzed together.

#### Scenario: Build a single-root project snapshot

- **WHEN** a caller supplies one project key, one root Task ID, and the matching formal artifact pair
- **THEN** the system constructs a project topology snapshot scoped only to that selected root

#### Scenario: Build a multi-root project snapshot

- **WHEN** a caller explicitly supplies multiple root Task IDs with matching formal artifact pairs
- **THEN** the system constructs one project snapshot, shares stable Task and physical dataset identities, and preserves each root's separate reachability observations

### Requirement: Validate every source artifact before projection

The system SHALL validate artifact schema and structure, any discriminator supplied by the source contract, independently computed file content identity, root Task ID, and pair coherence before projecting any topology. A valid source artifact with partial evidence SHALL remain projectable with its partial coverage and boundaries preserved; an invalid, mismatched, or changed source artifact MUST fail closed.

#### Scenario: Accept valid partial evidence

- **WHEN** every source artifact validates but a multi-hop artifact reports `PARTIAL_EVIDENCE` or truncation
- **THEN** the system publishes a valid partial projection carrying the original coverage and boundary information

#### Scenario: Reject mismatched source artifacts

- **WHEN** a one-hop/multi-hop pair refers to different roots, inconsistent producer snapshots, an invalid content hash, or an unsupported schema
- **THEN** the system reports the exact failed artifact obligation and publishes no replacement project snapshot

### Requirement: Projection is read-only and evidence preserving

The system SHALL derive Phase 1 topology only from the supplied validated artifacts. Projection MUST NOT call OpenCLI, read or refresh the live schedule-evidence cache, collect Horae or SZData evidence, parse SQL, rebuild Machine Facts or Producer Index, invoke the old knowledge-graph inference pipeline, or fill missing evidence.

#### Scenario: Project from a warm or cold local environment

- **WHEN** valid artifact files are supplied and no external service is available
- **THEN** projection and reference queries complete using only those files and produce no remote call or canonical artifact mutation

### Requirement: Preserve topology relation layers and uncertainty

The projection SHALL keep data reads, data writes, producer bridges, schedule dependencies, project-entry membership, root reachability, and boundaries as distinct relation or entity types. `PRIMARY`, `ADDITIONAL`, `UNKNOWN`, and `CANDIDATE` producer roles and terminal, blocked, cycle, reference-config, and truncation reasons MUST remain distinguishable. Schedule dependencies MUST NOT be promoted to data-production relationships.

#### Scenario: Project a schedule-only parent

- **WHEN** a source artifact contains a schedule edge without confirmed data-production evidence
- **THEN** the projection exposes only the schedule relation and does not create a confirmed producer bridge or write relationship

#### Scenario: Project an unresolved producer bridge

- **WHEN** a source producer bridge is `UNKNOWN` or `CANDIDATE`
- **THEN** the projected bridge retains that role and is not queryable as a confirmed primary producer

### Requirement: Keep stable identities separate from root-scoped observations

Task identity SHALL be based on the canonical Task ID. Physical dataset identity SHALL use platform, data source, and exact qualified name, preserving identity status. Root-relative depth, expansion status, evidence, and coverage MUST be represented as root-scoped observations rather than overwritten on a shared Task or dataset entity.

#### Scenario: Shared task has different root-relative depths

- **WHEN** the same Task appears under two selected roots at different minimum depths
- **THEN** the projection contains one stable Task identity and two distinct root-scoped reachability observations

#### Scenario: Same qualified name has different physical sources

- **WHEN** two table observations share a qualified name but differ by platform or data source
- **THEN** the projection keeps them as distinct physical datasets

### Requirement: Do not invent occurrence-to-write precision

The projection SHALL retain read-occurrence and write-observation references exactly when supplied by canonical artifacts. It MUST NOT infer an exact write observation for a producer bridge when the source artifact proves only task/table-level production, and MUST NOT convert source issues into stronger structured conclusions.

#### Scenario: Producer task has multiple write observations

- **WHEN** a producer bridge identifies a task and table but does not uniquely bind one of multiple write observations
- **THEN** the projection retains the task/table bridge and available write references without creating an exact occurrence-to-write edge

### Requirement: Publish deterministic immutable projection files

The system SHALL emit a snapshot document, node JSONL, edge JSONL, and projection manifest in deterministic canonical order. The projection manifest MUST bind project key, sorted root Task IDs, projection version, source artifact references and hashes, output hashes, counts, coverage status, and a deterministic snapshot identity. Repeating projection with byte-identical logical inputs MUST reproduce identical canonical outputs and hashes.

#### Scenario: Repeat the same projection

- **WHEN** the same project key, selected roots, source artifact contents, and projection version are processed twice
- **THEN** the canonical snapshot, JSONL outputs, snapshot identity, and content hashes are identical

#### Scenario: Source evidence changes

- **WHEN** any referenced source artifact content hash changes
- **THEN** the system creates a different snapshot identity and does not overwrite the prior immutable snapshot

### Requirement: Provide bounded deterministic reference queries

The system SHALL provide file-backed reference behavior for `get_project_topology`, `trace_project_upstream`, and `explain_topology_edge`. Queries MUST validate the projection manifest before use, distinguish data-production and schedule layers, preserve partial status and boundaries, apply explicit result/path limits, and return deterministic ordering.

#### Scenario: Trace data-production upstream only

- **WHEN** a caller traces upstream with the data-production relation layer selected
- **THEN** the result follows read/write/producer topology and does not traverse schedule-only edges

#### Scenario: Explain a projected edge

- **WHEN** a caller requests an existing topology edge by stable projected edge ID
- **THEN** the result returns its relation type, role or status, source root and artifact references, evidence references, and attached boundary information without recomputing the relation

### Requirement: Keep Phase 1 isolated from existing publication and databases

Project topology snapshots SHALL be published under a dedicated project-graph output root and MUST NOT add files to or alter `artifacts/tasks/<task-id>/`. Phase 1 MUST run without Neo4j or another graph database and MUST NOT introduce a mandatory production service or UI.

#### Scenario: Publish a project snapshot

- **WHEN** a validated project topology projection is written successfully
- **THEN** existing task artifacts remain byte-for-byte unchanged and the new files exist only under the configured project-graph output root
