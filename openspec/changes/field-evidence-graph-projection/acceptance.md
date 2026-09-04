## Phase 2 acceptance evidence

### Frozen fixture and contract acceptance

- Focused test suite: 13 tests passed.
- Covered exact root/write/target/field alignment, source hashes, missing project Tasks, non-primary producer pairs, same-name/different-source identity, topology-absent datasets, reverse-only slicing, deterministic multi-field merge, controls/candidates/gaps, shared producer writes across bindings, precision success/failure, conservative coverage, publication reuse/conflict/interruption/tamper and all three queries.
- TypeScript typecheck passed after the real-artifact regression fix.

### Task 176827 `delta`

Published immutable snapshot:

- snapshot ID: `field-evidence-d9524404b5d761fe8e09ba456c8c298c1ba2e36ec7196729650221bb6099366b`
- snapshot content hash: `d77cdfb1ff0b90391dcada8043f803d719cd80515bef2755fe1c68990537be12`
- public coverage: `COMPLETE`
- publication counts: 272 nodes, 317 edges, 0 boundaries
- selected slice: 31 source states, 30 value edges, 10 Tasks
- exact cross-Task precision: 12 edges
- precision-unavailable boundaries: 0
- selected controls/candidates/gaps: 161 / 4 / 0
- field datasets: 14 total, 11 present in Phase 1, 3 `NOT_IN_PROJECT_TOPOLOGY`
- absent datasets are the root Hive target and two Oracle reference datasets; they remain field-evidence anchors and do not mutate Phase 1.

Typed precision records are deduplicated by identity:

- 9 read occurrences
- 9 producer Write Observations
- one Write Observation may be linked from multiple field bindings; the binding membership lives on relations, not on the write node.

Published file hashes:

- `snapshot.json`: `08fe2282193e0606e491db45b3461cc54a3ecc07cec79a41d39449163353fb6e`
- `field-evidence.nodes.jsonl`: `8e6a9da3522e3b893b8bb15b918c8ec28f1c6604b43273490f86303768f66235`
- `field-evidence.edges.jsonl`: `f2cd83748dd377553d86e3511edd6cdf6d8955703c78d1da9a34084f060caab0`
- `projection-manifest.json`: `65a50a5d30e7b90b75ac1c5112401dd23df0f250af6f09e50680ac98c65a7582`

Query acceptance:

- `get_field_evidence` with `FIELD_BINDING_STATE` filter: `ok`, 31 nodes, 0 unrelated edges.
- `trace_field_value_path(delta)`: `ok`, 31 states, 30 traversed value edges, no truncation; annotations were returned but not traversed.
- `explain_field_evidence_record` on an exact cross-Task edge: `ok`, two endpoint bindings, expression context, one read occurrence, one Write Observation and both source descriptors.

### Replay and non-mutation

- First publication: `CREATED`.
- Identical second publication: `REUSED` with the same snapshot ID and file hashes.
- Runtime source contract and import audit show zero external calls; the CLI accepts only explicit local paths and has no discovery, OpenCLI, SQL parser, reconciliation or graph-database dependency.
- Post-run Phase 1 hashes equal the preflight hashes.
- Post-run one-hop, multi-hop and field-lineage hashes equal the preflight hashes.
- The Phase 2 overlay is a sibling of Phase 1 snapshots and writes nothing into canonical task artifacts or the immutable Phase 1 snapshot directory.

### Repository validation and scope audit

Passed:

- `npm run test:field-evidence-graph`: 13/13 tests
- `npm run test:project-topology`: 14/14 tests
- `npm run typecheck`
- `npm run build`
- focused Prettier check for all Phase 2 implementation, fixture, test and OpenSpec files
- `openspec validate field-evidence-graph-projection --strict`
- `git diff --check`

Known unrelated repository baselines, preserved rather than modified:

- full `npm test`: 25/26 test files passed; 392 tests passed, 6 failed, 3 skipped and 1 todo. All six failures remain in `tests/task-inspection.test.ts` because its generated fixture does not declare or provide `task-local-materializations.jsonl`.
- repository `npm run format:check`: the same 12 existing Markdown files fail Prettier (`README.md`, ten files under `docs/`, and `tests/gold/README.md`). All Phase 2 files pass focused formatting.

The final import/diff audit found:

- production Phase 2 imports only Node file/path APIs, canonical hash helpers, the existing field-lineage contract/validator, Phase 1 stable identity helpers and the validated Phase 1 directory loader;
- no import or call to OpenCLI, reconciliation execution, physical-field expansion, SQL parsing, pipeline/UI, causal modules, historical KG or Neo4j;
- no dependency or lockfile change;
- no modification to the two pre-existing dirty files in physical-field expansion;
- the only shared package change is additive scripts/test registration for Phase 1 and Phase 2.

### Known V1 source-contract limits

- Typed occurrence/write precision depends on current canonical evidence-reference strings because those references do not yet have a separately versioned structured source contract.
- V1 requires exactly one root Write Observation because current root states are not individually bound to multiple root writes.
- Source `PARTIAL` or `BLOCKED` is never upgraded even if one selected branch looks complete.
- Missing Phase 1 dataset presence is coverage, while a missing Task or non-primary selected cross-Task pair is source incoherence.

### Explicit Phase 3 Neo4j entry criteria

Neo4j remains out of Phase 2. Phase 3 may start only when:

1. Phase 1 and Phase 2 file contracts and stable IDs are accepted as the source of truth.
2. A concrete cross-project query or interactive latency requirement cannot be met reasonably by bounded file-backed queries.
3. Loader parity tests prove Neo4j is a rebuildable index with counts, IDs, evidence refs and boundaries identical to immutable files.
4. Rebuild, rollback and stale-index detection are specified without making Neo4j the evidence authority.
5. No causal or business-semantic edge is introduced merely as part of loading technical evidence.
