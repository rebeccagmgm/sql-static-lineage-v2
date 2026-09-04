## Purpose

Provide a rebuildable Neo4j query index over immutable project topology and field-evidence projections while preserving file-backed queries as the evidence authority and proving result parity before index activation.

## ADDED Requirements

### Requirement: Index builds consume only validated immutable projections

The system SHALL construct a query-index build from exactly one validated `PROJECT_TOPOLOGY` snapshot and zero or more validated `FIELD_EVIDENCE` snapshots belonging to the same project key. It MUST validate every supplied projection manifest, file hash, record count, ordering rule and edge endpoint before changing index state, and MUST NOT collect evidence, parse SQL, run reconciliation or read acquisition caches.

#### Scenario: Valid topology and field snapshots are selected

- **WHEN** a caller supplies one valid topology directory and an explicit set of valid field-evidence directories for the same project key
- **THEN** the system accepts their exact snapshot IDs and manifest/file hashes as the complete source descriptor for one index build

#### Scenario: A source projection is corrupt or incoherent

- **WHEN** any supplied manifest, file hash, count, endpoint or project key fails validation
- **THEN** the system rejects the build before creating or activating index records and leaves the current index unchanged

### Requirement: Index build identity is deterministic and auditable

The system SHALL derive an immutable index-build identity from the query-index schema/algorithm version, project key, topology snapshot identity and sorted field-evidence source identities. It SHALL publish a local audit manifest containing the source identities and hashes, indexed counts, database publication state and parity evidence hashes while excluding credentials, connection secrets and machine-specific absolute source paths from canonical identity.

#### Scenario: The same source set is rebuilt

- **WHEN** the same logical project, projection versions and exact source bytes are selected again
- **THEN** the system derives the same index-build identity and either verifies and reuses the existing complete build or reports an integrity conflict

#### Scenario: One source snapshot changes

- **WHEN** a topology or field-evidence snapshot ID, manifest hash or indexed file hash changes
- **THEN** the system derives a different index-build identity and does not treat the prior build as current for the new source descriptor

### Requirement: Database publication is staging-first and atomically activated

The system SHALL write every build into an isolated build namespace that is not visible as the project's current query index. It MUST validate staged metadata, node/edge counts, record identities and endpoint resolution before changing the current pointer in one database transaction. A failed or interrupted staging build MUST NOT replace or mutate the previously active build.

#### Scenario: A staged build passes all gates

- **WHEN** source validation, database import validation and required parity checks all succeed
- **THEN** the system atomically changes the project current-index pointer to the completed build

#### Scenario: Import or parity validation fails

- **WHEN** a batch import, count check, endpoint check or required parity case fails
- **THEN** the staged build remains non-current, the previous current pointer is preserved and the failure is recorded without exposing partial results

#### Scenario: Unrelated graph data shares the database

- **WHEN** the configured database contains historical KG data or query-index builds for other projects
- **THEN** build, activation and cleanup operations affect only records carrying the exact Phase 3 index namespace and selected build identity and never clear the database or an unrelated project

### Requirement: Indexed records preserve projection contracts losslessly

The system SHALL retain each source record's projection kind, projection snapshot ID, canonical node or edge ID, record type and canonical serialized payload. Query-index metadata MUST remain distinguishable from source graph properties, and the index MUST NOT rename, merge, strengthen or infer domain records from different projections.

#### Scenario: Topology and field records share a canonical entity ID

- **WHEN** two projection snapshots contain records that refer to the same stable Task or physical dataset identity
- **THEN** the index preserves each projection record and its membership without treating differing projection payloads as a conflict or inventing a new domain fact

#### Scenario: An edge endpoint cannot be resolved inside its projection snapshot

- **WHEN** an indexed edge does not resolve to both source nodes in the same projection snapshot
- **THEN** staging validation fails and that build cannot become current

### Requirement: Neo4j adapters implement the existing controlled query surface

The system SHALL provide Neo4j-backed implementations of `get_project_topology`, `trace_project_upstream`, `explain_topology_edge`, `get_field_evidence`, `trace_field_value_path` and `explain_field_evidence_record`. Inputs, output envelopes, statuses, warnings, limits, ordering, relation-layer behavior, boundary attachment and truncation semantics MUST remain compatible with the corresponding file-backed reference query.

#### Scenario: A supported query is executed against a current index

- **WHEN** the caller supplies a current source descriptor and valid query options
- **THEN** the Neo4j adapter returns a deterministic envelope in the same contract as the file-backed query

#### Scenario: Query limits are reached

- **WHEN** a traversal or retrieval reaches its declared node, edge, path, hop or result limit
- **THEN** the adapter returns the same partial status, warning and deterministic bounded result semantics as the reference query

#### Scenario: A requested record is absent

- **WHEN** the requested start node, field state or record ID is not present in the selected indexed projection
- **THEN** the adapter returns the corresponding deterministic `not_found` envelope rather than fabricating a match from another projection or build

### Requirement: Missing and stale indexes fail closed

Before every indexed query, the system SHALL resolve the current build for the exact project key and compare its source descriptor with the caller's expected immutable projection identities. Missing, non-ready, non-current or mismatched builds MUST return a typed index availability error and MUST NOT silently query an older build or combine Neo4j records with file records.

#### Scenario: The current build matches expected sources

- **WHEN** the current index source descriptor exactly equals the caller's expected topology and field-evidence identities
- **THEN** the adapter executes the query within that build and selected projection snapshot only

#### Scenario: The database contains an older build

- **WHEN** a current pointer exists but any expected snapshot or manifest/file hash differs
- **THEN** the adapter reports `QUERY_INDEX_STALE` and returns no graph query envelope

#### Scenario: No current pointer exists

- **WHEN** no ready current build exists for the project key
- **THEN** the adapter reports `QUERY_INDEX_UNAVAILABLE` and does not present historical KG or staging records as a fallback

### Requirement: Parity is a publication gate

The system SHALL execute declared parity cases through both the validated file reference implementation and the staged Neo4j adapter, canonicalize the complete response envelopes and compare their hashes and values. Required parity cases MUST pass before activation; differences MUST identify the query case and a bounded structural mismatch without leaking credentials or unrestricted record contents.

#### Scenario: All required parity cases match

- **WHEN** every declared topology and field query case returns byte-equivalent canonical envelopes from both backends
- **THEN** parity validation succeeds and records deterministic case/result hashes in the audit manifest

#### Scenario: One query case differs

- **WHEN** status, warning, limit, ordering, record, boundary, path or truncation output differs for any required case
- **THEN** activation is refused and the parity report identifies that case as failed

### Requirement: Database access is explicit, bounded and secret-safe

Neo4j access SHALL occur only through an explicit Phase 3 build, status, parity or indexed-query command. Credentials MUST be supplied through a secret-safe runtime mechanism, all Cypher values MUST be parameterized, dynamic labels or relationship types MUST be selected only from fixed internal allowlists, and logs/manifests/errors MUST NOT expose passwords, tokens or complete connection strings.

#### Scenario: Normal lineage or file queries run without Neo4j

- **WHEN** callers run the existing pipeline, Phase 1/2 publication or file-backed query commands
- **THEN** no Neo4j driver is initialized and no database connection is attempted

#### Scenario: Invalid connection or secret input is supplied

- **WHEN** an explicit Phase 3 command cannot authenticate or connect
- **THEN** it returns a typed bounded error, writes no successful audit state and does not echo the secret value

### Requirement: Live acceptance uses isolated current project evidence

Phase 3 acceptance SHALL index the accepted Task 176827 Phase 1 topology snapshot and its accepted `delta` field-evidence snapshot into an explicitly configured isolated Neo4j namespace, run all six parity query families including partial, bounded and not-found cases, and verify that the source projection files and canonical task artifacts remain byte-identical.

#### Scenario: Task 176827 live acceptance completes

- **WHEN** the designated Neo4j test target is available and the accepted immutable source directories are supplied
- **THEN** the import, activation, six query families, stale-index probe, second-build reuse and source immutability checks all pass with recorded evidence

#### Scenario: No designated Neo4j target is available

- **WHEN** implementation tests pass but no explicitly configured Neo4j target can be reached
- **THEN** the change remains pending live acceptance and MUST NOT be reported as a fully completed Phase 3 deployment
