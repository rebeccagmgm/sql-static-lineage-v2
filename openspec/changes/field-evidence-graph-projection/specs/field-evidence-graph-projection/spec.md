## Purpose

Defines a deterministic, read-only Phase 2 projection that connects an exact target write and selected fields to upstream binding-level evidence while preserving source uncertainty, topology coverage boundaries and independently verifiable provenance.

## ADDED Requirements

### Requirement: Projection requires explicit validated source alignment

The system SHALL require one validated immutable project-topology snapshot, one validated `FIELD_MULTI_HOP_RECONCILIATION` artifact, an explicit root Task ID, exact root Write Observation ID and one or more exact root fields. It SHALL hash the exact source bytes consumed and MUST fail closed when schema, declared content hash, project key, project snapshot identity, root Task, root target or source endpoint obligations do not align.

#### Scenario: Aligned project and field artifacts

- **WHEN** the field artifact root Task is an explicitly selected project root, all selected field nodes are valid source endpoints and every selected cross-Task confirmed value edge has a matching Phase 1 `PRIMARY` producer relation
- **THEN** the system accepts the pair and records both source identities and exact file hashes

#### Scenario: Cross-snapshot Task or producer mismatch

- **WHEN** a selected field path contains a Task absent from the project topology or a confirmed cross-Task value edge whose consumer/producer pair is not a matching Phase 1 `PRIMARY` producer relation
- **THEN** the system reports the exact coherence obligation and publishes no field-evidence snapshot

### Requirement: Root write and field selection are exact and unambiguous

The system SHALL require the supplied root Write Observation ID to be the field artifact's single root Write Observation and SHALL resolve each requested field to exactly one root node with the same physical target identity. It MUST NOT select a write or field by array ordinal, tail table name, fuzzy field match, timestamp or strongest available evidence.

#### Scenario: Singleton platform-target write

- **WHEN** the field artifact declares exactly one root Write Observation and the caller supplies that exact ID and an exact root field
- **THEN** the projection creates one target-write anchor and one selected root field state

#### Scenario: Artifact contains multiple root writes

- **WHEN** the field artifact declares multiple root Write Observation IDs without binding each root node to one exact write
- **THEN** the system rejects Phase 2 projection as ambiguous and does not merge the writes

#### Scenario: Root field cannot be uniquely selected

- **WHEN** a requested field is absent, duplicated under the exact root target, or resolves only by name outside the root target identity
- **THEN** the system reports the field-selection failure and publishes no snapshot

### Requirement: Projection contains only upstream-reachable field evidence

For each selected root field, the system SHALL traverse the canonical field artifact against the direction of incoming `VALUE_FLOW` edges and project only the union of upstream-reachable field states and value edges. Traversal SHALL be deterministic, cycle-safe and subject to explicit node, edge, control, candidate, gap and path limits.

#### Scenario: Select one field from an all-fields artifact

- **WHEN** a field artifact contains many root fields but the caller selects one
- **THEN** the output contains only that field's upstream-reachable value-flow subgraph plus evidence records scoped to the selected subgraph

#### Scenario: Projection limit is reached

- **WHEN** an explicit projection limit is reached before the selected subgraph is exhausted
- **THEN** the system publishes a deterministic `PARTIAL` snapshot with the exact limit boundary and does not silently omit evidence

### Requirement: Binding, expression, occurrence and write precision is evidence bounded

The projection SHALL preserve every selected source node's Task, physical field, binding ID, expression ID/text and evidence status without renaming canonical identities. It SHALL represent a typed read occurrence or producer Write Observation only when the field edge's canonical evidence references and the corresponding Phase 1/source identities identify exactly one occurrence or write. It MUST NOT parse an ambiguous reference into a stronger typed fact.

#### Scenario: Exact cross-Task bridge evidence is present

- **WHEN** a confirmed cross-Task value edge uniquely matches a Phase 1 primary producer bridge's read occurrence and a canonical producer-write reference bound to the upstream binding
- **THEN** the projection exposes the exact occurrence, Write Observation and binding-level explanation for that value edge

#### Scenario: Exact occurrence or producer write cannot be proven

- **WHEN** a value edge remains valid but its evidence references do not uniquely prove one occurrence or Write Observation
- **THEN** the projection preserves the canonical `VALUE_FLOW` edge and opaque evidence references, adds an evidence-precision boundary, and does not invent the missing typed identity

### Requirement: Physical identity and topology presence remain distinct

Task identity SHALL reuse the Phase 1 canonical Task ID. Dataset identity SHALL use platform, data source and exact qualified name; physical-field identity SHALL additionally preserve stable table ID and normalized column. A physical dataset proved by field evidence but absent from the Phase 1 topology SHALL remain a valid field-evidence anchor marked `NOT_IN_PROJECT_TOPOLOGY`; absence MUST NOT be interpreted as a missing table or used to mutate Phase 1.

#### Scenario: Root platform target is absent from multi-hop topology

- **WHEN** the field artifact proves a root platform-target write but the target dataset has no Phase 1 topology node
- **THEN** Phase 2 creates the exact target-write and dataset anchors with `NOT_IN_PROJECT_TOPOLOGY` coverage and retains the Phase 1 snapshot unchanged

#### Scenario: Same qualified name has different data sources

- **WHEN** selected physical fields share a qualified table name but have different platform or data-source identities
- **THEN** the projection keeps distinct dataset and physical-field identities

### Requirement: Controls, candidates, gaps and source status are not value flow

The projection SHALL retain selected-node rowset controls, directly scoped gaps and relevant field/task-scoped candidates as separate record types. It MUST NOT traverse them as `VALUE_FLOW`, convert them into causal conclusions or discard them merely because a selected value path is confirmed. Source overall status, slice coverage, truncation and candidate counts SHALL remain separately visible.

#### Scenario: Rowset controls apply to a selected binding state

- **WHEN** the source artifact attaches filter, join, aggregate, set operation, window or distinct control evidence to a selected reachable node
- **THEN** the projection attaches the control as an annotation relation without treating its fields as value producers

#### Scenario: Candidate lacks a node-level anchor

- **WHEN** a canonical candidate is relevant to a reachable Task or exact physical field but has no source node ID
- **THEN** the projection retains it as task- or field-scoped candidate evidence and does not attach it to an arbitrary binding

### Requirement: Field-evidence snapshots are deterministic and immutable

The system SHALL publish a canonical snapshot document, sorted field-evidence node JSONL, sorted field-evidence edge JSONL and projection manifest under `<projectGraphRoot>/projects/<projectKey>/field-evidence/<fieldEvidenceSnapshotId>/`. Snapshot identity SHALL bind the Phase 1 snapshot, exact field artifact identity, explicit write/field selection, limits and projection version while excluding wall-clock time and absolute runtime paths. Publication SHALL use validated staging, reuse byte-identical snapshots and reject same-ID byte conflicts.

#### Scenario: Repeat identical field projection

- **WHEN** identical project and field artifact bytes, write/field selection, limits and projection version are processed again
- **THEN** the system reproduces the same snapshot ID and byte-identical canonical files and reports reuse

#### Scenario: Field artifact or selected fields change

- **WHEN** the field artifact bytes or explicit selected-field set changes
- **THEN** the system creates a different immutable snapshot and does not overwrite the prior result

### Requirement: File-backed reference queries are bounded and explainable

The system SHALL provide deterministic file-backed behavior for `get_field_evidence`, `trace_field_value_path` and `explain_field_evidence_record`. Queries SHALL validate the manifest and file hashes, use explicit pagination or hop/node/edge/path limits, return `ok`, `partial`, `not_found` or `ambiguous`, and expose source artifacts, evidence references and attached boundaries without recomputing lineage.

#### Scenario: Trace one selected field upstream

- **WHEN** a caller traces a selected root field
- **THEN** the query follows only incoming `VALUE_FLOW` toward upstream states and returns expressions, exact occurrence/write references, controls and boundaries as non-traversed evidence

#### Scenario: Explain a field value edge

- **WHEN** a caller explains an existing projected `VALUE_FLOW` edge
- **THEN** the response includes both endpoint states, binding/expression identities, source artifact references, canonical evidence refs, precision status and any attached gaps or boundaries

### Requirement: Phase 2 remains an isolated read-only consumer

Phase 2 MUST NOT invoke OpenCLI, discover a data/cache root, parse SQL, rebuild Machine Facts or lineage, mutate the Phase 1 snapshot, write inside canonical task artifacts, read the historical knowledge graph, require Neo4j, calculate causal status or assign business semantics.

#### Scenario: Run with no network or graph database

- **WHEN** valid local Phase 1 and field-lineage artifacts are supplied in an offline environment
- **THEN** projection and reference queries complete using only those files and the dedicated project-graph output root
