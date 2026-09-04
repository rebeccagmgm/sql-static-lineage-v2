## 1. Freeze Phase 2 Inputs and Acceptance Cases

- [x] 1.1 Record the Task 176827 preflight contract facts, exact Phase 1/field artifact hashes, root write/target identity, Task/dataset/topology coverage and the selected `delta` slice baseline without modifying canonical artifacts.
- [x] 1.2 Add small frozen Phase 1 plus field-lineage fixtures covering an aligned singleton-write slice, absent topology dataset, same-name/different-source fields, source `PARTIAL`, controls, candidates, gaps and a confirmed cross-Task edge with exact occurrence/write evidence.
- [x] 1.3 Add invalid fixtures for multiple root writes, wrong write/field/target/root, missing project Task, non-primary cross-Task pair, broken field content hash, ambiguous precision evidence and bounded truncation.

## 2. Contracts, Identity and Source Alignment

- [x] 2.1 Add isolated Phase 2 snapshot, artifact-reference, node/edge, manifest, coverage, precision-boundary and query-response contracts under `scripts/project-graph/field-evidence/`.
- [x] 2.2 Implement deterministic path-safe snapshot IDs plus stable target-write, physical-field, binding-state, expression, occurrence, producer-write, control, candidate, gap and boundary IDs while reusing Phase 1 Task/dataset IDs.
- [x] 2.3 Implement a bounded source loader that validates the Phase 1 directory, reads the field artifact once, computes its exact SHA-256, invokes the existing field artifact validator and verifies its declared content hash.
- [x] 2.4 Implement exact root alignment for project root membership, singleton caller-supplied Write Observation, one physical target identity and unique selected root fields; reject fuzzy or ordinal fallback.
- [x] 2.5 Implement selected-slice coherence checks requiring every reachable Task in Phase 1 and every selected confirmed cross-Task edge to match a Phase 1 `PRIMARY` producer pair, while treating dataset absence as coverage rather than incoherence.

## 3. Pure On-demand Field Evidence Projection

- [x] 3.1 Implement deterministic reverse reachability from selected root nodes over incoming canonical `VALUE_FLOW` edges with cycle handling and explicit node/edge/path limits.
- [x] 3.2 Project the exact root Task, physical target, singleton target write and selected root binding-state anchors without adding a write edge to Phase 1.
- [x] 3.3 Project reachable Task references, dataset anchors, physical fields, binding states, expressions and canonical value edges with source IDs, statuses, mappings and evidence refs preserved.
- [x] 3.4 Merge multiple explicitly selected root-field slices deterministically and retain separate root-state membership without loading unselected root-field branches.
- [x] 3.5 Compute conservative source/slice coverage and deterministic limit boundaries without upgrading `PARTIAL`/`BLOCKED`, truncation, unresolved or provisional evidence.

## 4. Precision Evidence and Non-value Annotations

- [x] 4.1 Match canonical consumer-read evidence refs only against exact structured Phase 1 primary-bridge occurrences and emit typed `READ_OCCURRENCE` records only on one unique match.
- [x] 4.2 Match producer-write evidence refs using exact producer Task and upstream binding prefix/suffix guards and emit typed `WRITE_OBSERVATION` records only on one unique non-empty ID.
- [x] 4.3 Preserve valid `VALUE_FLOW` plus opaque refs and add `EVIDENCE_PRECISION_UNAVAILABLE` when occurrence/write precision is absent or ambiguous; never split arbitrary colon-delimited IDs.
- [x] 4.4 Project reachable-node rowset controls as non-traversed annotations and preserve exact control fields, source text, reason, status and evidence.
- [x] 4.5 Project directly scoped gaps and conservatively relevant field/task candidates; keep node-less evidence task/field scoped and never attach it to an arbitrary binding.
- [x] 4.6 Mark each field dataset `PRESENT` or `NOT_IN_PROJECT_TOPOLOGY`, preserving root platform targets, task-local/non-Hive boundaries and same-name/different-source identities without changing Phase 1.

## 5. Deterministic Immutable Publication and CLI

- [x] 5.1 Serialize canonical `snapshot.json`, sorted field-evidence node/edge JSONL and `projection-manifest.json` with source/output hashes, counts, selections, limits, coverage and projection version.
- [x] 5.2 Publish through validated sibling staging into `<projectGraphRoot>/projects/<projectKey>/field-evidence/<fieldEvidenceSnapshotId>/`, reuse byte-identical snapshots, reject immutable conflicts and clean interrupted staging.
- [x] 5.3 Add a narrow package CLI requiring explicit Phase 1 directory, field artifact, write observation, selected fields, output root and hard limits; do not add data/cache discovery or external calls.

## 6. File-backed Reference Queries

- [x] 6.1 Add a field-evidence directory loader that validates the manifest, hashes, counts, ordering and endpoint integrity before querying.
- [x] 6.2 Implement `get_field_evidence` with deterministic filters/pagination, source/slice coverage, selected roots, diagnostics and `ok`/`partial` status.
- [x] 6.3 Implement `trace_field_value_path` as bounded reverse traversal over incoming `VALUE_FLOW` only, returning controls and boundaries as annotations rather than traversed dependencies.
- [x] 6.4 Implement `explain_field_evidence_record` for nodes and edges with endpoints, source artifacts, binding/expression identities, exact occurrence/write proof, opaque refs and attached controls/gaps/boundaries.

## 7. Behavioral and Real-artifact Acceptance

- [x] 7.1 Add focused contract/alignment tests for exact roots/writes/fields, hash failures, missing Tasks, primary-pair coherence, physical identity separation and permitted topology-absent datasets.
- [x] 7.2 Add projector tests for reverse slicing, unselected-branch exclusion, deterministic multi-field merge, controls/candidates/gaps, precision success/failure and conservative coverage/limits.
- [x] 7.3 Add publication/query tests for deterministic replay, changed source/selection identity, immutable conflict, interrupted publication, manifest tamper, relation isolation, limits, not-found/ambiguous and complete explanations.
- [x] 7.4 Run read-only Task 176827 `delta` acceptance, verify the selected source slice, Task/field/value counts, exact cross-Task occurrence/write proofs, topology-presence boundaries and public coverage.
- [x] 7.5 Repeat Task 176827 publication and verify `REUSED`, byte-identical output hashes, zero external calls and unchanged Phase 1 plus canonical task artifact hashes.

## 8. Scope and Repository Validation

- [x] 8.1 Run focused Phase 2 tests, `npm run typecheck`, `npm run build`, focused formatting, repository `npm run format:check`, full `npm test` and `git diff --check`, separating unrelated baseline failures exactly.
- [x] 8.2 Review the final diff/import graph to prove Phase 2 does not modify Phase 1 outputs/contracts, field-lineage generation, Machine Facts, one-hop/multi-hop, caches, parsers, pipeline/UI, existing dirty work or add Neo4j/external dependencies.
- [x] 8.3 Record Phase 2 acceptance evidence, known source-contract limitations and the explicit Phase 3 Neo4j entry criteria without implementing Phase 3 artifacts.
