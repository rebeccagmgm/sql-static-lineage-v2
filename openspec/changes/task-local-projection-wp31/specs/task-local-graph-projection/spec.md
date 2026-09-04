## ADDED Requirements

### Requirement: Schedule reference on projected and schedule-only tasks

When schedule-evidence cache context is available, the TASK node SHALL include a `scheduleReference` property with `role` equal to `SCHEDULE_REFERENCE_ONLY`, upstream and downstream task id lists, and cache provenance fields. Schedule task ids SHALL NOT appear as data-edge endpoints.

#### Scenario: PROJECTED task keeps schedule neighbors

- **WHEN** projecting a task that has Facts and a schedule-cache hit
- **THEN** coverage status is `PROJECTED`
- **AND** the TASK node includes `scheduleReference` with role `SCHEDULE_REFERENCE_ONLY`
- **AND** no data edge endpoint is a foreign `task:` node id listed in that reference

### Requirement: Partition predicate status on READS

Each READS edge SHALL include `partitionPredicateStatus` of `NONE`, `LITERAL`, or `NON_LITERAL_PRESENT`, distinguishing absent filters from non-literal filters while still listing extractable literal EQ/IN predicates.

#### Scenario: Non-literal filter is not silent empty

- **WHEN** a READ occurrence is wrapped by a FILTER whose atoms are not all literal EQ/IN
- **THEN** `partitionPredicateStatus` is `NON_LITERAL_PRESENT`
- **AND** any literal EQ/IN atoms still appear in `partitionPredicates`

### Requirement: Dataset controls attach to the owning write

`DATASET_CONTROL` edges SHALL target the `TARGET_WRITE` whose write statement matches the control's statement id.

#### Scenario: Multi-write task does not collapse controls onto one write

- **WHEN** projecting task 105387 with multiple TARGET_WRITE nodes
- **THEN** controls from distinct write statements attach to distinct TARGET_WRITE nodes
- **AND** no TARGET_WRITE receives every control solely by node-id sort order

## MODIFIED Requirements

### Requirement: Data edges must not reference upstream tasks

Data edges (`READS`, `WRITES`, `FIELD_DIRECT`, `FIELD_CONDITIONAL`, `DATASET_CONTROL`) SHALL NOT encode other task ids as graph endpoints.

Schedule task ids MAY appear only inside TASK node `scheduleReference` (and MUST NOT become edge endpoints). They SHALL NOT participate in field or dataset derivation.

#### Scenario: READS targets physical dataset only

- **WHEN** projecting READS edges
- **THEN** each edge connects TASK to PHYSICAL_DATASET
- **AND** no TASK-to-TASK data edge is emitted

#### Scenario: Schedule reference ids stay off data edges

- **WHEN** a TASK node lists foreign task ids under `scheduleReference`
- **THEN** validation fails if any data edge endpoint is `task:<that-id>`
