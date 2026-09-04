## Context

See `proposal.md` for motivation and the capability spec for observable behavior. Phase 1 and Phase 2 currently have separate immutable publication/loaders and six separate file-backed query functions. Their accepted Task 176827 snapshots are small enough for deterministic parity but already expose the important asymmetries: field records may reference topology-stable identities while retaining projection-specific payloads, and field datasets can be absent from topology without being invalid.

The historical knowledge-graph implementation proves that JSONL import, Neo4j project namespaces and controlled query services are useful. It also shows two patterns Phase 3 must not copy: clearing/replacing a project before a new build is validated, and mapping current precise evidence into the historical coarse labels and inferred relationships.

## Goals / Non-Goals

**Goals:**

- Make one topology snapshot and an explicit set of field-evidence snapshots queryable through Neo4j without changing their contracts.
- Keep an old current build available until a complete staged build passes import and parity gates.
- Make stale-index detection a mandatory pre-query operation.
- Prove all existing query envelopes against the file implementations on fixtures and accepted real snapshots.
- Keep the database integration isolated enough that normal tests and lineage execution remain offline.

**Non-Goals:**

- Refactoring Phase 1/2 publication into a generic graph framework.
- Building a generic cross-projection query language or joining topology and field records into new facts.
- Reusing old KG nodes, labels, confidence rules, SQLGlot results or database contents.
- Automatically starting, provisioning, clearing or upgrading Neo4j.
- Adding UI, causal overlays, business semantics or cross-project search.

## Decisions

### Add an isolated query-index module instead of changing projections

Add a sibling module shaped approximately as:

```text
scripts/project-graph/query-index/
  query-index-contract.ts
  query-index-source.ts
  query-index-store.ts
  neo4j-query-index-store.ts
  query-index-builder.ts
  topology-index-query.ts
  field-index-query.ts
  query-index-parity.ts
  query-index-cli.ts
```

It imports the existing validated directory loaders and query contracts. It does not import acquisition, parser, Machine Facts, reconciliation or causal execution code. The Neo4j driver is loaded only by an explicit Phase 3 command.

Alternative: register Neo4j publication inside the Phase 1/2 CLIs. Rejected because database availability would then affect immutable file publication and rollback.

### Use one topology snapshot and an explicit field-snapshot set

An index source descriptor contains:

```text
projectKey
topology snapshot ID + projection manifest/file hashes
sorted field-evidence snapshot IDs + projection manifest/file hashes
query-index schema and algorithm versions
```

The descriptor is constructed only after both existing loaders validate all bytes. Absolute source paths remain runtime locators and do not enter canonical identity. Field snapshots must reference the selected topology snapshot and project key; overlapping field slices are allowed.

`indexBuildId` is the SHA-256 of canonical descriptor content. Repeating the same descriptor is a verification/reuse operation, not a mutable update.

### Keep projection records lossless and projection-scoped

Phase 3 does not redesign the graph model. Each indexed node is keyed within one build by:

```text
(indexBuildId, projectionKind, projectionSnapshotId, canonicalNodeId)
```

and stores indexed scalar fields plus the canonical source record JSON. Each indexed edge connects the corresponding projection-scoped nodes and stores the canonical edge JSON. Stable Task/Dataset IDs remain visible as canonical IDs for lookup, but records from different projections are not merged merely because those IDs match.

This intentionally duplicates small projection representations inside an index build. It avoids losing Phase-specific payloads or inventing a universal node schema before a third projection exists.

Alternative: merge all matching canonical IDs into one Neo4j node. Rejected because topology Task records and field `TASK_REF` records have different contracts, and property reconciliation would create new semantics not present in either snapshot.

### Use a fixed Phase 3 database schema

Use dedicated labels and one fixed relationship type, for example:

```text
(:SLQueryIndexProject {projectKey})
(:SLQueryIndexBuild {indexBuildId, state, sourceDescriptorHash, ...})
(:SLIndexedNode {indexBuildId, projectionKind, projectionSnapshotId, canonicalNodeId, ...})

(Project)-[:SL_CURRENT_INDEX]->(Build)
(Build)-[:SL_HAS_INDEXED_NODE]->(IndexedNode)
(IndexedNode)-[:SL_INDEX_EDGE {canonicalEdgeId, edgeType, relationLayer, recordJson, ...}]->(IndexedNode)
```

Composite uniqueness applies to build identity and indexed-node keys. All domain variability remains in validated properties; no caller-controlled label or relationship type is interpolated into Cypher. This fixed schema is intentionally separate from old `KGNode`, `ScheduleTask`, `Dataset` and `Column` labels.

### Stage by build identity and switch one pointer transactionally

Import flow:

```text
validate all source files
  -> derive source descriptor and indexBuildId
  -> create/verify STAGING build metadata
  -> batch import projection-scoped nodes and edges
  -> validate counts, canonical IDs, endpoint closure and source descriptor
  -> run staged parity suite
  -> mark READY and replace SL_CURRENT_INDEX in one write transaction
  -> publish local audit manifest atomically
```

Batch import may leave a failed staging namespace, but indexed queries resolve only the current pointer and require `READY`. Cleanup is an explicit build-scoped maintenance operation; it never uses `MATCH (n) DETACH DELETE n` or project-wide deletion.

Alternative: delete the prior project index then import. Rejected because a transient driver, parity or batch failure would remove the last known-good index.

### Publish a local audit manifest outside immutable projections

Use a sibling location:

```text
<projectGraphRoot>/projects/<projectKey>/query-index/<indexBuildId>/
  query-index-manifest.json
  parity-report.json
```

The manifest records descriptor/hash, source counts, staged/imported counts, database state, activation result and parity case hashes. It does not become evidence authority and is never written inside Phase 1/2 snapshot directories. Publication is atomic and an existing same-ID directory with different canonical bytes is an integrity error.

Database URI, username, password, password-file path and absolute source paths are excluded from canonical files. A non-secret target alias may be recorded only as runtime diagnostics outside hash identity.

### Add an injected store boundary and one real Neo4j implementation

The builder and query adapters depend on a narrow typed store interface covering schema setup, staging writes, validation reads, current-pointer resolution and bounded adjacency queries. Unit tests use an in-memory fake store; the production implementation uses the official Neo4j JavaScript driver with parameterized Cypher and explicit transactions.

The driver is not imported by file-backed query/publication modules. Connection settings are accepted only by explicit Phase 3 entry points, with the password supplied via an environment variable or password file rather than a CLI value.

Alternative: generate a large `.cypher` script only. Rejected because it cannot prove transaction boundaries, current-pointer state, stale detection or query parity through the actual driver.

### Mirror the six query contracts without creating a generic query framework

Phase 3 adds topology- and field-specific adapters. Each adapter first resolves the exact current build/source descriptor, then executes bounded database reads and assembles the existing envelope type. Traversals use deterministic queue/frontier ordering and the same directional edge rules and limits as the reference implementation.

Small projection-specific pure helpers may be extracted from an existing query module only when its public signature and canonical fixture/real output remain byte-identical. Phase 3 does not introduce a cross-projection generic query kernel or refactor publication code.

Parity compares complete canonical envelopes, not only node/edge sets. It therefore catches differences in ordering, warnings, statuses, reached depth, explored paths, attachments and truncation.

### Treat expected source identity as a query precondition

An indexed query request identifies the project and expected source descriptor hash; field queries also identify one indexed field-evidence snapshot. The adapter resolves `SL_CURRENT_INDEX`, requires `READY`, compares descriptor hashes and confirms snapshot membership before reading records.

There is no transparent fallback. A higher-level caller may separately choose the file query after receiving `QUERY_INDEX_UNAVAILABLE` or `QUERY_INDEX_STALE`, but the database response itself never mixes backends.

### Make live acceptance explicit and isolated

Default tests remain offline. An opt-in integration suite uses an explicitly configured Neo4j target and a unique Phase 3 acceptance project key/namespace. It imports the accepted 176827 topology and `delta` field snapshot, runs all six query families and stale/reuse probes, and verifies source hashes before and after.

No test auto-starts Neo4j, modifies old KG project pointers or clears unrelated records. If no target is configured, the live gate remains visibly pending rather than being replaced by fake-store success.

## Risks / Trade-offs

- [Projection-scoped Neo4j nodes duplicate stable Task/Dataset representations] -> Preserve lossless contracts now; consider shared identity nodes only when a cross-projection query has a concrete requirement.
- [Exact parity makes traversal implementation stricter than ordinary graph equivalence] -> Compare full envelopes on bounded fixtures first, then accepted real snapshots before activation.
- [Batch failure leaves staging records] -> Current-pointer isolation prevents exposure; provide explicit build-scoped cleanup and status reporting.
- [A local manifest says active while the database pointer changed externally] -> Treat database current metadata as runtime truth and require descriptor/parity checks; the manifest is audit evidence, not authority.
- [Neo4j driver or server version differences affect schema commands] -> Detect supported version/capabilities up front and use only the minimum supported constraint/index surface documented by the chosen driver/server baseline.
- [Small 176827 snapshots do not prove a latency gain] -> Record bounded timing as diagnostic evidence without claiming performance improvement; Phase 3 acceptance proves correctness and replaceability first.
- [Query code grows because six adapters remain explicit] -> Accept the bounded duplication; extract only projection-specific pure seams justified by parity, not a speculative generic framework.

## Migration Plan

1. Add contracts, source descriptor validation and deterministic fixtures with no database dependency.
2. Add the injected store, in-memory behavior tests and concrete Neo4j staging/current-pointer implementation.
3. Add topology adapters, field adapters and parity cases for normal, partial, bounded and not-found results.
4. Add explicit build/status/query/parity CLIs and local audit publication.
5. Run the opt-in Task 176827 live gate in an isolated namespace, including second-build reuse and stale-source rejection.
6. Keep indexed-query usage opt-in. Rollback disables the Phase 3 entry points and removes only the exact Phase 3 build namespace; immutable projections and canonical task artifacts require no rollback.
