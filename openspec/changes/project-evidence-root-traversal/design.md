## Context

Phase 1 currently projects one immutable project topology from explicit one-hop/multi-hop pairs. Phase 2 consumes that topology and a field-lineage artifact. Both are valid evidence-preserving products, but the construction order still reflects the original single-Task pipeline:

```text
root A -> multi-hop A --\
root B -> multi-hop B ----> merge PROJECT_TOPOLOGY
root C -> multi-hop C --/
```

The desired construction order is:

```text
explicit roots + one frozen Input Pack
  -> shared Task-local evidence
  -> stable project facts
  -> root-scoped traversal overlays
  -> PROJECT_TOPOLOGY + trace_project_upstream(root)
```

The real accepted roots `176827`, `181058` and `209119` now share the same Input Pack fingerprint and Producer Index content identity. Their accepted topology demonstrates substantial overlap and provides a concrete parity baseline.

## Goals / Non-Goals

**Goals:**

- Evaluate shared Task-local evidence once per frozen project run.
- Make root traversal a projection over shared facts rather than a mandatory persisted source artifact.
- Reuse one traversal kernel for direct project builds and legacy single-root multi-hop compatibility.
- Preserve every accepted Task/dataset identity, relation role, root-relative depth, boundary, coverage and limit semantic.
- Prove the design against the three real roots before changing any consumer.

**Non-Goals:**

- Removing `multi-hop.json`, changing `lineage:all` defaults or migrating field-lineage in this change.
- Loading every field into a project graph or changing field-evidence contracts.
- Adding Neo4j, a UI, causal/business overlays or historical-KG facts.
- Defining arbitrary business-project membership from discovered overlap.
- Claiming runtime or business correctness from static evidence.

## Decisions

### Add a direct project run; do not widen the existing batch loop first

The originally proposed direct entry point was shaped approximately as:

```text
E:\02_area\股衍数据-数据cookbook\scripts\data-graph\
  src/project-graph/topology/project-topology-source.ts
  src/project-graph/topology/project-topology-projector.ts
  src/project-graph/topology/project-topology-publication.ts
  src/project-graph/project-topology-cli.ts
  tests/project-topology.test.ts
  tests/real-artifact-closed-loop.test.ts
```

It accepts a project key, explicit root Task IDs, data root, output root, terminal config and hard limits. Existing `lineage:all` remains unchanged until parity and measured value are established.

The shipped entry is the standalone legacy artifact-pair consumer; the direct
project-evidence orchestration and cache are deferred because this extraction
has no safe producer-boundary caller for them.

Alternative: optimize the `for (const taskId)` loop in place. Rejected for the first slice because it mixes task artifact publication, field generation and project evidence construction before the shared contract is proven.

### Freeze one coherent project source boundary

At start, compute and bind:

```text
project key
sorted explicit roots
Input Pack fingerprint
Producer Index content hash
terminal-table configuration hash
Machine Facts contract/version
schedule evidence identities used by each Task
project-evidence algorithm version and hard limits
```

Recheck the Input Pack fingerprint immediately before publication. Any drift fails closed with no project snapshot publication. All roots must use the same frozen Producer Index/Input Pack identity.

The run may use the existing schedule-evidence read-through cache. A valid cache hit remains labeled as cached evidence; a miss may use the existing bounded OpenCLI path. Acquisition state is provenance, not project identity by itself. Tests and deterministic parity runs inject offline evidence and make no remote calls.

### Share Task-local work, retain root-scoped frontier state

The project workset carries root-membership sets. A Task's local pack validation, Machine Facts, schedule evidence and one-hop reconciliation are evaluated at most once for the frozen source identity. Newly discovered primary Tasks extend only the delta workset and are not re-evaluated.

Traversal state remains keyed by `(rootTaskId, taskId)` because minimum depth, expansion state, path, already-discovered status, limits and boundary occurrence are root relative. Stable Task, dataset and relation identities are not root-prefixed.

This separates:

```text
TaskLocalFacts            stable within the frozen source
StableTopologyRelations   deduplicated across roots
RootTraversalObservation  root-relative depth/status/path
BoundaryOccurrence        root-relative stop evidence
```

Alternative: run one global BFS and assign one depth to each Task. Rejected because it destroys accepted different-depth and root-boundary semantics.

### Reuse validated Task-local facts across runs

The project path reuses the existing Machine Facts registry, whose pre-analysis
gate validates SQL, schema-bundle, analysis-config, dialect, manifest and bundle
hashes before returning `REUSED`. The project orchestrator reports those hits
instead of adding a second Machine Facts cache.

Raw one-hop results use one canonical replaceable file per Task under
`<one-hop-cache-root>/tasks/<taskId>/one-hop.json`. The file binds the current
Task Input Pack content, validated Machine Facts manifest, normalized schedule
rows, terminal configuration, raw-one-hop algorithm version and only the
Producer Index slice actually consumed by that Task's direct-read tables and
schedule parents. It deliberately does not bind the global Input Pack
fingerprint or full Producer Index hash: adding an unrelated Task must remain a
cache hit, while adding a producer for a table read by the Task must invalidate
that Task. Current global Producer Index identity and schedule acquisition
metadata are rebound as provenance after a hit.

Cache acquisition timestamps, cache paths and HIT/MISS state are not identity
material. Invalid JSON, contract violations, content-hash mismatches or local
identity mismatches are treated as misses and replaced atomically after a
successful recomputation. Published task artifacts remain separate from this
deletable cache.

Only raw one-hop is cached. Project-relative transforms such as checkdbflag
parent exclusion remain overlays computed from the current union workset and
MUST NOT enter a reusable Task-local cache.

The persisted Input Pack and immutable Producer Index snapshots remain reusable,
but full source validation is not bypassed. A prior path or snapshot ID alone is
not sufficient evidence that externally mutable Input Pack files are unchanged.

### Extract one traversal kernel rather than reimplementing multi-hop

Extract a pure kernel from current multi-hop behavior. Inputs include one frozen Producer Index identity, Task-local one-hop snapshots, explicit roots, terminal config and hard limits. Outputs include stable local facts plus root observations and boundary occurrences.

The existing `reconcileMultiHop(rootTaskId, ...)` becomes a one-root compatibility adapter over that kernel and must reproduce its existing contract. The direct project path invokes the same kernel with multiple roots and projects the normalized result directly.

No parity exception may be resolved by weakening a test, silently dropping a source fact or maintaining a second traversal rule set.

### Keep project-topology query records stable and version the source descriptor

Direct mode publishes the existing canonical files:

```text
<projectGraphRoot>/projects/<projectKey>/snapshots/<snapshotId>/
  snapshot.json
  topology.nodes.jsonl
  topology.edges.jsonl
  projection-manifest.json
```

Node and edge record contracts remain compatible. `snapshot.json` gains an explicit source mode:

```text
LEGACY_ARTIFACT_PAIRS
DIRECT_PROJECT_EVIDENCE
```

Direct source identity binds frozen project inputs and normalized Task-local evidence hashes rather than formal multi-hop file hashes. Snapshot IDs remain deterministic and source-mode specific. Legacy snapshots remain readable and immutable.

`trace_project_upstream` continues to traverse the published project records. It is the public multi-hop view for one selected root; it must not require or reconstruct a task-level `multi-hop.json`.

### Treat parity as an entry gate, not an approximate comparison

Fixture and real-root parity compares per root:

- Task and physical dataset membership;
- `READS`, `WRITES`, `PRODUCER_BRIDGE` and `SCHEDULE_DEPENDS_ON` observations;
- producer role and uncertainty;
- root-relative minimum depth and expansion status;
- boundary reason/scope and coverage/limit status;
- truncation and remaining frontier;
- absence of any newly confirmed relationship.

Canonical IDs may differ only where source-mode identity intentionally scopes snapshot/boundary records. Comparisons normalize those IDs and compare semantic payloads. Any unexplained difference blocks migration.

### Keep the first acceptance narrow

The first real acceptance uses only `176827`, `181058` and `209119`, their current shared frozen Input Pack and existing schedule cache. It records baseline and direct-run stage timings, but correctness and single-evaluation counters are gates; an arbitrary percentage speedup is not.

The change does not switch field-lineage or stop writing legacy artifacts. A later change may add a root-view adapter for field-lineage and retire default multi-hop publication only after this acceptance passes.

## Risks / Trade-offs

- [The direct project builder becomes a second lineage engine] -> Extract and share the root traversal kernel; legacy and direct paths must use it.
- [Union preparation expands more Tasks than any selected root needs] -> Preserve per-root frontier membership, terminal rules and hard union/root limits; report union-only work explicitly.
- [A Task-local fact differs by root] -> Treat that as a contract violation or retain separate observations; never select one silently.
- [Input changes during a long multi-root run] -> Fingerprint before construction and immediately before atomic publication; fail closed on drift.
- [A stale Task-local cache hides changed evidence] -> Bind complete logical input hashes, validate cached contracts and content hashes, and treat every mismatch as a miss.
- [Root overlays reproduce facts but not exact old IDs] -> Compare normalized semantics and keep source-mode/snapshot-scoped IDs explicitly distinct.
- [Field-lineage still requires multi-hop] -> Accept this temporary compatibility boundary; do not claim artifact retirement in this change.
- [The optional Neo4j change optimizes the old layer] -> Keep it paused until direct project evidence is accepted and source contracts are revised deliberately.

## Migration Plan

1. Freeze fixture and real three-root baselines without changing canonical artifacts.
2. Extract the pure root traversal seam and prove the existing single-root multi-hop adapter unchanged.
3. Add shared project workset preparation and direct project-topology construction.
4. Add source-mode-aware immutable publication and existing query compatibility.
5. Run offline fixtures and the real three-root parity/performance acceptance.
6. Leave usage opt-in. A separate approved change may migrate field-lineage and retire default task-level multi-hop publication.

Rollback disables the direct project CLI and removes only its dedicated immutable project snapshots. Existing task artifacts and legacy project snapshots require no rollback.
