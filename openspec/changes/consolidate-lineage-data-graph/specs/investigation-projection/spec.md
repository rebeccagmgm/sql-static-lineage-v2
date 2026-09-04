## Purpose

Provide one deterministic, file-backed investigation projection over current canonical lineage artifacts so existing topology, field, and causal evidence remains queryable without becoming a second fact source or implementing next-stage business scenarios.

## ADDED Requirements

### Requirement: Investigation is a read-only projection

The investigation layer SHALL consume validated published lineage artifacts and SHALL NOT import lineage algorithms, mutate source artifacts, or write facts back into the lineage pipeline.

#### Scenario: Build from current artifacts

- **WHEN** the user supplies valid current topology inputs, field evidence, and target-causal artifacts
- **THEN** the investigation projection is built only from those published bytes
- **AND** the source artifacts remain unchanged

### Requirement: One investigation snapshot

The system SHALL publish one versioned investigation snapshot that can represent Task, physical dataset, physical field, read occurrence, target write, value-flow, rowset-control, and target-causal evidence together with certainty, gaps, and evidence references.

#### Scenario: Inspect a target write

- **WHEN** a target write has table, field, and causal evidence
- **THEN** one snapshot supports topology navigation, field drilldown, and causal explanation for that write
- **AND** the evidence status and gaps remain visible

### Requirement: File query and static view need no graph service

The snapshot SHALL support bounded local file queries and a static HTML view without Neo4j or another running database service.

#### Scenario: Open a published snapshot offline

- **WHEN** the user inspects a valid published snapshot on the local machine
- **THEN** topology, field evidence, causal evidence, and gaps can be queried and viewed without a network or database connection

### Requirement: Current contracts only

The projector SHALL accept only the current artifact versions declared by the consolidated repository and SHALL validate canonical hashes and identities before publishing a snapshot.

#### Scenario: Historical graph input is supplied

- **WHEN** an input uses an unsupported artifact version or invalid canonical hash
- **THEN** projection fails with a named contract error before publishing output

### Requirement: Schedule references do not become data lineage

Schedule relationships MAY be retained as display-only references, but SHALL NOT be emitted or queried as confirmed data-flow edges.

#### Scenario: Schedule neighbor has no data evidence

- **WHEN** a task is related only by scheduling metadata
- **THEN** the view may identify it as a schedule reference
- **AND** it is not returned as a confirmed upstream or downstream data path

### Requirement: No next-stage business interpretation

The investigation projection SHALL expose evidence and gaps but SHALL NOT classify indicator families, asset redundancy, caliber anomalies, or other V1/V2/V3 business outcomes.

#### Scenario: Similar outputs appear in the snapshot

- **WHEN** two outputs share sources or fields
- **THEN** the snapshot exposes the underlying evidence
- **AND** it does not label the outputs as redundant or merge their business caliber

### Requirement: Deterministic publication

With identical input bytes and contract versions, the projector SHALL emit identical identifiers, ordering, evidence references, and content hashes, excluding explicitly non-semantic timestamps.

#### Scenario: Repeat projection

- **WHEN** the same current artifacts are projected twice
- **THEN** the semantic snapshot and content hash match
