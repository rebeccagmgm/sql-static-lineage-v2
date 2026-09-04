## Context

See `proposal.md` for motivation. Phase 1 publishes immutable project topology from one-hop/multi-hop, while `FIELD_MULTI_HOP_RECONCILIATION` 1.1.0 already publishes deterministic field nodes, `VALUE_FLOW`, rowset controls, candidates, gaps, limits and a declared content hash.

The Task 176827 preflight establishes the actual join boundary:

- the field artifact declares singleton root write `write-observation:176827:platform-target:0` and 95 root fields;
- all 31 Tasks used by field nodes exist in the Phase 1 topology;
- all 142 confirmed cross-Task field edges match a Phase 1 `PRIMARY` producer pair;
- the root target and seven other field datasets are absent from Phase 1 topology, so topology presence cannot be a prerequisite for valid physical field evidence;
- some global `ADDITIONAL` table edges are not topology bridges, but they are candidates rather than traversed confirmed value flow;
- selecting `delta` yields a bounded real slice of 31 source nodes, 30 value edges and 10 Tasks. This was rechecked against exact field bytes with both the Phase 2 loader and an independent incoming-edge traversal; the earlier 32/31/11 preflight count was off by one and is not used as an acceptance target.

The source field contract carries structured node/binding/expression identities, but occurrence and producer-write precision appears inside canonical evidence-reference strings. Phase 2 must validate these against known topology/binding identities rather than split arbitrary strings.

## Goals / Non-Goals

**Goals:**

- Prove exact source alignment before projecting any field evidence.
- Project one or more explicitly selected root fields without rerunning field lineage.
- Preserve source identities and add only evidence-proven occurrence/write structure.
- Make root platform-target writes navigable even when Phase 1 has no corresponding multi-hop write edge.
- Provide deterministic files and reference queries suitable for later UI or Neo4j parity work.

**Non-Goals:**

- Replacing or refactoring the field-lineage engine.
- Backfilling missing Phase 1 topology datasets or write edges.
- Defining a generic graph framework before the second concrete projection is accepted.
- Loading every project field, inferring semantic summary edges, or implementing Phase 3/4.

## Decisions

### Consume immutable artifacts through a separate field-evidence module

Add a sibling module under `scripts/project-graph/field-evidence/` with contracts, source alignment, projector, publication, query and CLI boundaries. It may reuse Phase 1 stable Task/dataset ID helpers and its validated topology directory loader, but it does not import reconciliation execution, Machine Facts readers, physical-field expansion, parser or pipeline code.

Alternative: add field projection to `lineage:all` or `field-lineage.ts`. Rejected because that would couple navigation to evidence construction and make an on-demand query capable of rebuilding canonical artifacts.

### Anchor Phase 2 to exact source bytes and semantic coherence

The source descriptor records:

```text
project topology snapshot ID + manifest/file hashes
field artifact exact SHA-256 + declared contentHash
root Task + exact target physical identity
singleton root write_observation_id
sorted selected root fields
projection limits + projection version
```

The loader validates the Phase 1 directory, validates the field artifact through its current validator, checks root Task membership, derives one exact target identity from selected root nodes, and checks source endpoints/counts. For each selected cross-Task edge, it requires a Phase 1 primary producer pair. Missing dataset presence is coverage, not source incoherence.

Alternative: compare file timestamps or assume files in one task directory were built together. Rejected because neither is a semantic snapshot identity.

### Require one root Write Observation in V1

The caller supplies `--write-observation-id`, and the source artifact must declare exactly that singleton ID. Existing field artifacts can select multiple root writes but do not bind each root node back to one selected write; Phase 2 cannot split them safely.

Alternative: create a write set or choose the first write. Rejected because downstream explanations would falsely claim write-level precision.

### Slice the existing graph by reverse reachability

The projector selects the exact root node for each requested field, indexes canonical `VALUE_FLOW` by `toNodeId`, and walks incoming edges toward upstream `fromNodeId`. It unions multiple selected slices, preserves original edge direction, sorts every frontier and applies hard limits. It never follows controls, candidates, table edges or schedule edges as value flow.

This uses the already reconciled field artifact as evidence. It does not call the physical field expander or recompute source mappings.

### Keep source field states as the primary precision unit

Each selected canonical field node becomes a `FIELD_BINDING_STATE` record retaining source node ID, Task, depth, complete physical field, binding ID, expression ID/text, dependency status and evidence status. Stable supporting entities are projected only where they improve navigation:

```text
TASK_REF
PHYSICAL_DATASET
PHYSICAL_FIELD
TARGET_WRITE
EXPRESSION
READ_OCCURRENCE
WRITE_OBSERVATION
ROWSET_CONTROL
CANDIDATE
GAP
BOUNDARY
```

This avoids prematurely redesigning existing output/input bindings into a new universal model. A later shared graph abstraction can be extracted only after Phase 2 behavior is accepted.

Stable IDs use canonical source identities:

```text
TaskRef             = Phase 1 task:<taskId>
Dataset             = Phase 1 hash(platform, dataSource, qualifiedName)
PhysicalField       = hash(platform, dataSource, stableTableId, qualifiedName, column)
TargetWrite         = hash(taskId, Dataset, writeObservationId)
BindingState        = hash(fieldArtifactContentHash, canonical source nodeId)
Expression          = hash(taskId, expressionId)
ReadOccurrence      = hash(consumerTaskId, occurrenceId, readRelationId)
WriteObservation    = hash(producerTaskId, writeObservationId)
```

Binding-state identity includes the field artifact content hash because source node semantics belong to that immutable evidence snapshot; stable PhysicalField and Task/Dataset identities remain cross-snapshot.

### Add typed occurrence/write nodes only through exact reference matching

For a confirmed cross-Task value edge:

1. identify the exact consumer/producer and downstream physical dataset;
2. find Phase 1 `PRIMARY` producer bridges for that pair/dataset;
3. construct the canonical consumer-read evidence reference from each supplied structured occurrence and require exactly one reference match;
4. use the known producer Task and upstream binding ID as exact prefix/suffix guards for the canonical producer-write evidence reference and require one non-empty middle Write Observation ID;
5. emit typed occurrence/write nodes only when both obligations are unique.

The reference string is not split on arbitrary colon positions. Any absent or multiple match retains the original `VALUE_FLOW` plus opaque refs and adds `EVIDENCE_PRECISION_UNAVAILABLE`; it does not invalidate the canonical field edge.

### Represent topology absence as coverage

Every field dataset receives `topologyPresence: PRESENT | NOT_IN_PROJECT_TOPOLOGY`. The dataset keeps exact field-source identity in either case. The root target write may therefore connect Task 176827 to its target dataset and output field states without changing the Phase 1 snapshot.

Task absence is different: every selected field Task must exist in topology, because a field projection attached to a project cannot silently expand project membership.

### Scope controls, gaps and candidates conservatively

- include rowset controls whose `nodeId` is reachable;
- include gaps whose `nodeId` is reachable;
- include node-less gaps only as Task-scoped boundaries when their Task is reachable;
- include candidates when the consumer Task is reachable and their physical field is null or exactly equals a reachable PhysicalField;
- never attach a node-less candidate/gap to a binding state.

The projection records source `overallStatus` separately from selected-slice diagnostics. Public coverage is the conservative worst status: it is never stronger than the source artifact, and truncation or precision boundaries make it `PARTIAL`.

### Publish a sibling immutable overlay

Use:

```text
<projectGraphRoot>/projects/<projectKey>/field-evidence/<fieldEvidenceSnapshotId>/
  snapshot.json
  field-evidence.nodes.jsonl
  field-evidence.edges.jsonl
  projection-manifest.json
```

Do not add children inside the immutable Phase 1 snapshot directory. Publication mirrors Phase 1's validated sibling-staging, atomic install, byte-identical reuse and immutable-conflict behavior without introducing a generic framework refactor in this change.

### Provide three file-backed reference queries

- `get_field_evidence`: bounded records, selected roots, coverage, diagnostics and filters.
- `trace_field_value_path`: reverse traversal from one selected root state through incoming `VALUE_FLOW`; controls and boundaries are returned as annotations, not traversed edges.
- `explain_field_evidence_record`: one node/edge plus endpoints, source refs, binding/expression, exact occurrence/write proof and attached controls/gaps/boundaries.

Responses retain deterministic ordering and validate all published hashes before reading records.

## Risks / Trade-offs

- [Evidence-reference formats are strings, not a separately versioned structured contract] → Match only exact references constructed from known topology occurrence and binding identities; fail precision closed and keep opaque refs on drift.
- [A valid selected field uses a Task outside the Phase 1 root closure] → Reject source coherence rather than silently extend project membership.
- [Phase 1 omits platform-target and non-Hive datasets] → Project exact dataset anchors with explicit topology-presence coverage, not inferred topology edges.
- [One field may carry many rowset controls] → Select only reachable-node controls and enforce independent control/result limits.
- [Source overall status is partial because of unrelated root fields] → Report source status and slice diagnostics separately but keep public coverage conservatively no stronger than the source.
- [Projection duplicates some Phase 1 reference records in files] → Reuse identical stable IDs and mark them as references; no database identity is created in Phase 2.

## Migration Plan

1. Add frozen source-alignment fixtures, including absent target dataset, multiple root writes and occurrence/write precision failures.
2. Implement contracts, validator and source loader without changing Phase 1 or field-lineage contracts.
3. Implement reverse-reachable projection, immutable publication and three reference queries.
4. Validate Task 176827 field `delta` against its current immutable Phase 1 and field artifacts; verify exact source/output hashes and second-run reuse.
5. Confirm existing canonical task artifacts, Phase 1 snapshot and unrelated dirty files remain byte-identical.

Rollback removes the optional Phase 2 CLI/module and dedicated field-evidence output directory. No canonical artifact or database migration is required.
