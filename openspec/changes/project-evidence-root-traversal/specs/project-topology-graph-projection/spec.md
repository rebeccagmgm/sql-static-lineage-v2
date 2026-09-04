## MODIFIED Requirements

### Requirement: Explicit project snapshot selection

The system SHALL require a non-empty project key and an explicit non-empty set of root Task IDs. A caller SHALL explicitly select exactly one supported source mode: `LEGACY_ARTIFACT_PAIRS`, containing one validated formal one-hop/multi-hop pair per root, or `DIRECT_PROJECT_EVIDENCE`, containing one validated frozen project-evidence source descriptor plus its root overlays. The system MUST NOT infer project membership or silently mix source modes.

#### Scenario: Build a single-root project snapshot

- **WHEN** a caller selects one root using either supported source mode
- **THEN** the system constructs a project topology scoped only to that selected root

#### Scenario: Build a multi-root project snapshot

- **WHEN** a caller explicitly selects multiple roots using one coherent source mode
- **THEN** the system shares stable Task and physical dataset identities and preserves each root's separate reachability observations

#### Scenario: Build from legacy artifact pairs

- **WHEN** a caller supplies the legacy source mode and matching formal artifact pairs
- **THEN** the system constructs the accepted Phase 1 project snapshot without running evidence preparation

#### Scenario: Build directly from shared project evidence

- **WHEN** a caller supplies the direct source mode and one validated shared project-evidence result for the selected roots
- **THEN** the system constructs one project topology without requiring per-root formal multi-hop files

### Requirement: Publish deterministic immutable projection files

The system SHALL emit a snapshot document, node JSONL, edge JSONL and projection manifest in deterministic canonical order. The projection manifest MUST bind project key, sorted root Task IDs, projection version, source mode, source-mode-specific identities and hashes, output hashes, counts, coverage status and deterministic snapshot identity. Repeating projection with byte-identical logical inputs MUST reproduce identical canonical outputs and hashes. A direct-project snapshot and a legacy artifact-pair snapshot SHALL have distinct source descriptors even when their normalized topology facts are semantically equivalent.

#### Scenario: Repeat a direct project projection

- **WHEN** the same project key, roots, frozen project source, normalized local facts, overlays, limits and projection version are processed twice
- **THEN** the canonical files and snapshot identity are byte-identical and the immutable snapshot is reused

#### Scenario: Read an existing legacy snapshot

- **WHEN** a valid snapshot published before direct source mode is loaded
- **THEN** the loader and existing reference queries preserve its accepted behavior without migration or rewrite

#### Scenario: Source evidence changes

- **WHEN** a referenced legacy artifact hash or frozen direct-project source identity changes
- **THEN** the system creates a different snapshot identity and does not overwrite the prior immutable snapshot

### Requirement: Provide bounded deterministic reference queries

The system SHALL provide file-backed reference behavior for `get_project_topology`, `trace_project_upstream` and `explain_topology_edge` for both supported source modes. Query contracts, relation-layer selection, limit behavior, deterministic ordering, evidence boundaries and statuses MUST remain source-mode compatible. `trace_project_upstream` over a direct project snapshot MUST use the published graph and MUST NOT require or regenerate a task-level multi-hop artifact.

#### Scenario: Trace data-production upstream only

- **WHEN** a caller traces upstream with only the data-production relation layer selected
- **THEN** the result follows read/write/producer topology and does not traverse schedule-only edges

#### Scenario: Trace one root in a direct project snapshot

- **WHEN** a caller selects one project root and data-production relations
- **THEN** the query returns only that root's reachable published observations and excludes schedule-only traversal exactly as in the accepted reference contract

#### Scenario: Explain a projected edge

- **WHEN** a caller requests an existing topology edge by stable projected edge ID
- **THEN** the result returns its relation type, role or status, source roots/artifacts, evidence references and attached boundaries without recomputing the relation
