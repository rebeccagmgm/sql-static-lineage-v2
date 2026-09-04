## REMOVED Requirements

### Requirement: Identity parity with data-graph

**Reason**: `data-graph` is no longer an independent authority. Keeping cross-repository parity as the contract caused duplicated identity code and artifact-version drift.

**Migration**: Move the frozen identity vectors into the repository-owned canonical contract tests and make all lineage and investigation modules import that one implementation.

## ADDED Requirements

### Requirement: Repository-owned canonical identity

Task, physical dataset, physical field, read occurrence, and target write identities SHALL be produced by one canonical repository-owned contract. Task-local projection and every downstream lineage consumer SHALL use the same implementation.

#### Scenario: Frozen identity vectors

- **WHEN** computing identities for the existing frozen task, dataset, write observation, read occurrence, and field vectors
- **THEN** task-local projection and downstream analysis produce the same expected identifiers
- **AND** no copied consumer implementation is used

### Requirement: Current task-local version only

The repository SHALL emit and consume only the current `TASK_LOCAL_PROJECTION` schema version. It SHALL NOT include legacy readers or version-coercion paths in the new mainline.

#### Scenario: Current projection is consumed

- **WHEN** a valid current-version task-local projection is supplied
- **THEN** downstream continuation and target-causal modules validate and consume it

#### Scenario: Historical projection is supplied

- **WHEN** a historical task-local projection version is supplied
- **THEN** validation fails with a named unsupported-version error
- **AND** the historical artifact is not rewritten or upgraded in place
