## Purpose

Define a coherent shared project-evidence run that evaluates Task-local evidence once, preserves root-relative traversal semantics and publishes a directly queryable project topology without requiring formal per-root multi-hop artifacts.

## ADDED Requirements

### Requirement: Project membership and source identity are explicit

The system SHALL require a non-empty project key, an explicit non-empty root Task set, one complete Input Pack root and explicit hard limits. It SHALL freeze one Input Pack fingerprint, Producer Index identity, terminal configuration identity and algorithm version for the run. It MUST NOT infer business-project membership from overlap, prior runs or schedule adjacency.

#### Scenario: Start a coherent multi-root run

- **WHEN** a caller supplies project key, roots `176827`, `181058` and `209119`, one valid Input Pack and limits
- **THEN** the system records one sorted root selection and one frozen source descriptor shared by all roots

#### Scenario: Input changes during construction

- **WHEN** the Input Pack fingerprint differs at final publication validation
- **THEN** the system fails closed and exposes no new project snapshot

### Requirement: Task-local evidence is evaluated once per frozen project run

For a given frozen source identity, the system SHALL validate and materialize each discovered Task's Machine Facts, schedule evidence and one-hop result at most once. Multiple roots reaching the same Task SHALL share that local evidence while retaining separate root membership. Delta discovery MAY add Tasks, but already completed Task-local work MUST NOT be repeated.

The system MAY reuse Task-local evidence from an earlier run only when the
complete content identity and artifact contract validate. Machine Facts reuse
SHALL retain its existing SQL/schema/config/dialect and bundle-integrity gates.
Raw one-hop reuse SHALL bind the current Task's Input Pack content, validated
Machine Facts manifest, Task schedule-row identity, terminal configuration,
algorithm version and the Producer evidence slice consumed by that Task. It
MUST NOT invalidate a Task solely because an unrelated Input Pack or Producer
Index entry was added. Corrupt, missing or locally mismatched entries SHALL be
treated as cache misses and MUST NOT be used as evidence.

#### Scenario: Three roots share one upstream Task

- **WHEN** the same upstream Task is reached from all selected roots
- **THEN** one Task-local evidence record is constructed and three root traversal observations may reference it

#### Scenario: A later frontier discovers a new primary Task

- **WHEN** root traversal exposes a primary upstream Task not yet in the union workset and its valid local pack is available
- **THEN** only the new Task is prepared and prior Task-local facts remain unchanged

#### Scenario: A second project run has identical Task-local inputs

- **WHEN** validated Machine Facts and raw one-hop entries match the complete current content identities
- **THEN** the system loads those entries before computation and reports them as cache hits

#### Scenario: The Input Pack gains an unrelated Task

- **WHEN** the global Input Pack and Producer Index identities change only because an unrelated Task/table producer was added
- **THEN** an existing Task whose local Machine Facts, schedule, terminal rules and consumed Producer slice are unchanged remains a raw one-hop cache hit

#### Scenario: A relevant producer is added

- **WHEN** a producer is added for a physical table directly read by the cached Task
- **THEN** that Task's consumed Producer slice changes and only that Task is recomputed

#### Scenario: A raw one-hop cache entry is corrupt or stale

- **WHEN** its JSON, contract, content hash or input identity fails validation
- **THEN** the system recomputes only that Task's raw one-hop result and atomically replaces the invalid entry

#### Scenario: Project overlays differ across runs

- **WHEN** checkdbflag or root-membership overlays differ while raw Task-local inputs remain equal
- **THEN** the system may reuse raw one-hop but recomputes the overlays for the current union workset

### Requirement: Root traversal uses one shared semantic kernel

The direct project path and existing single-root multi-hop compatibility path SHALL use the same root traversal kernel. The kernel SHALL preserve primary-only recursion, schedule/data separation, producer roles, partition-aware decisions, terminal rules, cycle handling, checkdbflag exclusion, limits and observed-evidence boundaries. The implementation MUST NOT maintain divergent direct-project and legacy traversal rule sets.

#### Scenario: Run the kernel for one root

- **WHEN** the kernel receives one root and the same frozen Task-local inputs used by the legacy multi-hop path
- **THEN** the compatibility result is semantically equivalent in Task/table membership, relations, depth, boundaries, coverage and limits

#### Scenario: Run the kernel for multiple roots

- **WHEN** two roots reach one Task at different minimum depths
- **THEN** the output retains one stable Task and distinct root-scoped depth observations

### Requirement: Stable facts and root observations remain separate

The system SHALL deduplicate stable Task, physical dataset and equal relation identities across roots. Root-relative depth, expansion state, traversal path, already-discovered state, budget/truncation state and boundary occurrence SHALL remain keyed by root. Schedule relations MUST NOT become data-production relations, and `UNKNOWN`, `ADDITIONAL` or `CANDIDATE` observations MUST NOT be upgraded to `PRIMARY`.

#### Scenario: Shared producer bridge has different root observations

- **WHEN** an equal Task/dataset producer bridge is observed under multiple roots
- **THEN** one stable bridge retains all sorted root observations and their original roles/evidence

#### Scenario: One root reaches a limit

- **WHEN** one root reaches its declared traversal limit while another completes
- **THEN** only the first root receives the corresponding partial/truncation boundary and the project coverage reports the conservative aggregate

### Requirement: Direct project publication does not depend on formal multi-hop artifacts

The direct project builder SHALL construct and publish project topology from the frozen project source, shared Task-local facts and root overlays. It MUST NOT read an existing `multi-hop.json`, write a task-level `multi-hop.json`, or require a prior `lineage:all` run. Existing task artifact directories MUST remain byte-for-byte unchanged.

#### Scenario: Build in a clean project-output root

- **WHEN** valid Input Pack evidence and injected/offline schedule evidence are available but no formal task artifacts exist
- **THEN** direct project publication and `trace_project_upstream` complete without creating files under `artifacts/tasks`

### Requirement: Acquisition provenance remains explicit and bounded

The direct project run MAY use the existing schedule-evidence read-through cache and existing bounded collection policies. Cache hits, live misses, offline injected rows and failures SHALL remain distinguishable. OpenCLI failure MUST NOT be converted to empty evidence, and deterministic tests MUST execute with injected local evidence and zero remote calls.

#### Scenario: Schedule cache hit

- **WHEN** a valid Task schedule cache entry exists
- **THEN** the Task-local evidence records a cache hit and no live schedule request is made

#### Scenario: Schedule retrieval fails

- **WHEN** neither valid local evidence nor a successful bounded retrieval is available
- **THEN** the affected Task/root remains failed or partial according to the existing evidence contract and no false empty relation is created

### Requirement: Real-root parity gates migration

Before any consumer switch, the system SHALL compare direct project root views for `176827`, `181058` and `209119` against formal multi-hop artifacts built from the same frozen source identity. It SHALL compare normalized Task/table membership, all relation observations, producer roles, root depth/status, boundary scope/reason, coverage, limits and truncation. Any unexplained difference or stronger confirmed relation SHALL fail acceptance.

#### Scenario: Three-root parity succeeds

- **WHEN** every normalized per-root result matches and no direct path strengthens uncertainty
- **THEN** the direct project evidence core is accepted for opt-in use and the report records source identities plus stage counters/timings

#### Scenario: A boundary differs

- **WHEN** a root boundary is missing, reclassified or attached to a different scope without an approved contract change
- **THEN** acceptance fails and legacy consumers remain unchanged

### Requirement: Scope remains compatibility-first

This change MUST retain current `lineage:all` defaults, formal task artifact publication, field-lineage input behavior and legacy artifact-pair project projection. It MUST NOT add Neo4j, UI, causal/business overlays or automatic legacy retirement.

#### Scenario: Direct project mode is not selected

- **WHEN** callers use existing task pipeline and Phase 1/2 commands
- **THEN** their public contracts and output locations behave as before
