## Context

The canonical pipeline already publishes self-validating one-hop and multi-hop task artifacts. The in-progress evidence-pipeline contract intentionally keeps `artifacts/tasks/<task-id>/` free of a public run manifest, while target causal work already separates target identity from analysis snapshot hashes. Phase 1 must therefore add a separate project-graph consumer rather than widening either existing change.

The historical knowledge-graph project demonstrates useful product patterns—multi-root project organization, JSONL facts, controlled queries, optional Neo4j import, and whole-project replacement—but its collectors, SQLGlot lineage, coarse table/column identities, and inferred data relationships are not canonical inputs for this change.

## Goals / Non-Goals

**Goals:**

- Produce one deterministic project topology snapshot from explicitly selected, already published one-hop/multi-hop artifact pairs.
- Merge shared stable Task and physical dataset identities without losing root-relative observations or evidence boundaries.
- Preserve exact source semantics and provenance in queryable JSONL.
- Establish a small reference-query baseline against which a later Neo4j adapter can be compared.
- Keep all implementation isolated behind artifact readers and validators.

**Non-Goals:**

- Reorganizing the repository into packages or changing the canonical pipeline.
- Defining a generic framework for every future graph projection.
- Generating field bindings, field summary edges, causal assessments, business concepts, UI views, or Neo4j data.
- Reading the live schedule cache or invoking any remote/internal platform.
- Assigning unrelated analyzed tasks to one business project without an explicit root selection.

## Decisions

### Use a separate read-only project-graph module

Phase 1 adds an isolated module shaped approximately as:

```text
scripts/project-graph/
  topology/
  query/
  contracts/
```

It imports existing artifact contracts and validators but does not import parser, collection, Machine Facts construction, reconciliation execution, field expansion, or causal traversal internals. Inputs are artifact files supplied by the caller; the module has no data-root or cache-root discovery behavior.

Alternative considered: add project merging directly to `lineage:all` or multi-hop. Rejected because it couples project navigation to canonical task publication, makes remote acquisition easier to trigger accidentally, and conflicts with the existing fixed task-output contract.

### Define concrete V1 contracts before extracting a generic projection framework

Phase 1 defines only:

```text
ProjectTopologySnapshotV1
ProjectTopologyProjectionV1
ProjectTopologyProjectionManifestV1
```

A common `GraphProjection` abstraction will be considered only after a real field projection exists and shared behavior can be extracted from two implementations.

Alternative considered: define the full topology/field/causal/business graph model now. Rejected as speculative scope that would force current code to conform to untested future needs.

### Bind formal artifact pairs, not the acquisition cache

Each selected root is represented by validated references similar to:

```ts
type TopologyRootArtifactRef = {
  rootTaskId: string;
  oneHop: {
    contract: "OneHopReconciliationResult";
    schemaVersion: string;
    contentSha256: string;
    logicalLocator: string;
  };
  multiHop: {
    artifactType: "TABLE_MULTI_HOP_RECONCILIATION";
    schemaVersion: string;
    contentSha256: string;
    declaredContentHash: string;
    logicalLocator: string;
  };
};
```

Local absolute paths are runtime locators and are excluded from snapshot identity. The live schedule-evidence cache path, cache HIT/MISS state, and current cache contents are not project-snapshot inputs. Acquisition provenance already carried by canonical artifacts remains explainable but is not upgraded into an independent graph fact.

The current one-hop contract has no top-level `artifactType` or `contentHash`; the project snapshot therefore labels the expected contract in its own reference and hashes the exact validated file bytes. Multi-hop retains its existing discriminator and declared `contentHash`, and the projector also records the exact file hash it consumed. Phase 1 does not change either source contract merely to make the references symmetrical.

The one-hop/multi-hop pair is validated for matching root and compatible producer input identity. Valid `PARTIAL_EVIDENCE` is accepted. Contract, hash, root, or producer-snapshot mismatch aborts publication.

### Keep stable entities separate from root-scoped observations

Stable entity IDs use canonical semantics:

```text
TaskId              = task:<canonical task id>
PhysicalDatasetId   = hash(platform, dataSource, exactQualifiedName)
ProjectSnapshotId   = hash(projectKey, sorted roots, source hashes, projection version)
```

Platform or data source may be null only when the source artifact already reports unresolved identity; that unresolved identity status is preserved and never upgraded by name matching.

`minDepth`, expansion status, evidence, and root coverage are not properties of a globally stable Task. They are represented by deterministic root-scoped reachability observations, for example `ROOT_REACHES_TASK`, keyed by `(snapshotId, rootTaskId, taskId)`.

When two roots contain the same semantic read, write, producer, or schedule relation, the projection may deduplicate its stable relation identity while retaining a sorted list of source roots and artifact references. Conflicting observations are retained separately or reported as a projection conflict; the projector never selects the stronger observation silently.

Alternative considered: prefix every physical asset with project and snapshot. Rejected because it duplicates shared assets and prevents later cross-project navigation. Snapshot-specific occurrences, boundaries, and observations remain snapshot-scoped instead.

### Map only semantics already present in multi-hop

The Phase 1 mapping is intentionally direct:

| Source multi-hop fact                        | Project topology projection                                      |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `taskNodes`                                  | stable Task plus root-scoped reachability observation            |
| `tableNodes`                                 | PhysicalDataset with identity status                             |
| `readEdges`                                  | typed data-read relation with statement and evidence refs        |
| `writeEdges`                                 | typed data-write relation with supplied write-observation refs   |
| `producerBridges`                            | typed producer bridge with role and supplied read-occurrence ref |
| `scheduleEdges`                              | separate schedule-dependency relation                            |
| `terminals`                                  | snapshot-scoped Boundary entity attached to its exact scope      |
| `coverage`, `limits`, `issues`, `boundaries` | snapshot/projection coverage and source diagnostics              |

An exact `ReadOccurrence -> WriteObservation` bridge is emitted only if the canonical source already supplies that exact binding. A task/table producer bridge is not promoted merely because a matching write observation exists elsewhere in the same artifact. Free-form source issues remain source diagnostics; Phase 1 does not invent typed Gap objects where no canonical gap identity exists.

### Use deterministic immutable JSONL snapshots

The configured project-graph output root contains immutable, content-identified snapshots:

```text
<projectGraphRoot>/projects/<projectKey>/snapshots/<snapshotId>/
  snapshot.json
  topology.nodes.jsonl
  topology.edges.jsonl
  projection-manifest.json
```

Canonical records and arrays are sorted by stable IDs. `snapshotId` and output hashes exclude wall-clock build timestamps and machine-specific absolute paths. The manifest records logical source locators, source hashes, counts, coverage, limits, projection version, and hashes of all output files.

Publication writes to a sibling staging directory, validates all references, counts, endpoint existence, ordering, and hashes, then atomically installs the immutable snapshot directory. An existing identical snapshot is reused; an existing directory with different bytes is an integrity failure. Phase 1 does not maintain or switch a mutable `currentSnapshotId` pointer.

Alternative considered: write a mutable `project.json` or update Neo4j incrementally. Rejected because partial writes and stale optional records would make replay and parity testing unreliable.

### Start with three bounded reference queries

The reference query layer reads and validates projection files directly:

- `get_project_topology`: returns bounded nodes, typed relations, coverage, and boundaries.
- `trace_project_upstream`: traverses explicitly selected relation layers with hard hop/node/edge/result limits.
- `explain_topology_edge`: resolves one edge to its source roots, source artifacts, evidence refs, role/status, and boundaries.

All responses use deterministic ordering and distinguish `ok`, `partial`, `not_found`, `ambiguous`, and `error`. Evidence insufficiency is `partial`, not a runtime error. A later Neo4j adapter must normalize its results to the same contracts and pass parity fixtures before it can be used as an index.

### Freeze the four-phase roadmap without pulling later phases into Phase 1

The roadmap is:

1. `PROJECT_TOPOLOGY` — this change.
2. `FIELD_EVIDENCE` — on-demand target-write/field projection; preserve occurrence, write, binding, VALUE_FLOW, ROWSET_CONTROL, and gaps.
3. `QUERY_INDEX` — optional Neo4j import and query adapter after reference-query value and graph identity are proven.
4. `TARGET_CAUSAL_OVERLAY` plus `BUSINESS_SEMANTIC_OVERLAY` — target-scoped judgments and separately sourced business semantics.

Each later phase requires a separate change and may revise its own projection contract without changing Phase 1 canonical task artifacts.

## Risks / Trade-offs

- [Root-relative data is accidentally flattened during multi-root merge] → Keep explicit root-scoped reachability/observation identities and add conflicting-depth fixtures.
- [A source artifact changes between validation and read] → Hash the exact bytes consumed and recheck before atomic publication; fail closed on drift.
- [File paths make snapshots machine-specific] → Use logical locators and content hashes in canonical identity; keep absolute paths as non-canonical runtime diagnostics only.
- [Historical KG semantics leak into confirmed data relationships] → Do not import old graph facts or fallback inference; map only validated current artifacts.
- [JSONL reference queries are eventually too slow] → Keep stable IDs and normalized query contracts so Neo4j can be added as a replaceable index in Phase 3.
- [Phase 1 becomes a hidden field/causal framework] → Enforce the explicit non-goals and require separate OpenSpec changes for later projection types.

## Migration Plan

1. Add the V1 contracts, pure projector, validators, and reference queries without registering them in the canonical task pipeline.
2. Validate a single-root projection with Task 176827, checking counts, roles, terminals, partial status, deterministic hashes, and zero external calls.
3. Add a synthetic or explicitly approved multi-root fixture to prove shared identity and root-scoped observations; do not assume previously tested tasks form one business project.
4. Publish only to a dedicated project-graph test/output root. Existing task artifacts remain unchanged.
5. Rollback consists of disabling/removing the optional project-graph command and its dedicated outputs; no canonical artifact or database migration is required.
