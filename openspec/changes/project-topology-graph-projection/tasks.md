## 1. Freeze Phase 1 Inputs and Fixtures

- [x] 1.1 Record the exact current one-hop and multi-hop source-contract fields used by the projector, including the one-hop absence of a top-level artifact discriminator/content hash and the multi-hop declared content hash, without changing either source contract.
- [x] 1.2 Add small frozen fixtures for a valid complete root pair, a valid partial/truncated root pair, invalid or mismatched pairs, schedule-only relations, unresolved producer roles, multiple write observations, and two roots that share a Task at different depths.
- [x] 1.3 Define the read-only Task 176827 acceptance inputs and pre-run hashes for existing formal task artifacts so the real acceptance does not copy or modify large canonical files.

## 2. Concrete V1 Contracts and Validation

- [x] 2.1 Add `ProjectTopologySnapshotV1`, node/edge record, `ProjectTopologyProjectionV1`, projection-manifest, boundary, artifact-reference, and reference-query response contracts under an isolated project-graph module.
- [x] 2.2 Implement deterministic IDs for project snapshots, Tasks, physical datasets, root-scoped observations, boundaries, and typed edges using canonical values rather than absolute paths or timestamps.
- [x] 2.3 Implement a source-pair loader that reads each file once, computes the exact file SHA-256, validates current one-hop structure and multi-hop through its existing validator, and rejects root, producer identity, schema, discriminator, declared-hash, or read-drift mismatches.
- [x] 2.4 Implement projection validation for schema, deterministic ordering, endpoint existence, duplicate/conflicting identity, counts, coverage, limits, source references, file hashes, and snapshot identity.

## 3. Pure Project Topology Projection

- [x] 3.1 Project stable Task and physical dataset nodes from validated multi-hop facts while preserving unresolved physical identity instead of resolving by tail name.
- [x] 3.2 Project distinct project-entry, root-reachability, data-read, data-write, producer-bridge, and schedule-dependency relations with source roots, artifact refs, evidence refs, roles, statement/write refs, and relation-layer semantics.
- [x] 3.3 Project terminals and traversal stops as snapshot-scoped boundaries, retain source coverage/limits/issues as diagnostics, and avoid inventing typed gaps that the source artifact does not provide.
- [x] 3.4 Merge multiple explicitly selected roots deterministically, deduplicate only equal stable identities, retain separate root-relative depth/status observations, and fail closed or preserve separate observations when source facts conflict.
- [x] 3.5 Ensure task/table producer bridges never become exact read-occurrence-to-write-observation edges unless that exact binding is present in canonical source evidence.

## 4. Deterministic Immutable Publication

- [x] 4.1 Write canonical `snapshot.json`, sorted node JSONL, sorted edge JSONL, and `projection-manifest.json` with source/output hashes, counts, coverage, limits, projection version, and no volatile identity fields.
- [x] 4.2 Publish through a validated sibling staging directory into `<projectGraphRoot>/projects/<projectKey>/snapshots/<snapshotId>/`, reuse byte-identical snapshots, reject same-ID byte conflicts, and leave existing task artifacts untouched.
- [x] 4.3 Add a narrow CLI/package entry that accepts explicit project key, root-to-artifact pairs, output root, and hard limits; it must not discover a data root, cache root, OpenCLI adapter, parser, or old knowledge-graph input.

## 5. File-backed Reference Queries

- [x] 5.1 Add a projection loader that verifies the manifest and file hashes before building bounded in-memory indexes.
- [x] 5.2 Implement `get_project_topology` with deterministic ordering, coverage/boundary reporting, filters, pagination or result limits, and `ok`/`partial` status.
- [x] 5.3 Implement `trace_project_upstream` with explicit data-production versus schedule relation-layer selection and hard hop/node/edge/path limits.
- [x] 5.4 Implement `explain_topology_edge` to return the projected relation, source roots/artifacts, evidence refs, producer role or uncertainty, occurrence/write refs, and attached boundaries without recomputation.

## 6. Behavioral and Real-artifact Acceptance

- [x] 6.1 Add contract and projector tests covering valid partial evidence, fail-closed mismatches, same-name/different-source datasets, role preservation, schedule/data separation, exact-write non-inference, boundaries, and source endpoint integrity.
- [x] 6.2 Add deterministic replay and publication tests proving identical inputs produce byte-identical outputs, changed source hashes produce a new snapshot ID, immutable conflicts fail, and interrupted publication cannot expose a partial snapshot.
- [x] 6.3 Add query tests for deterministic responses, relation-layer isolation, limits, partial status, not-found behavior, and complete evidence explanation.
- [x] 6.4 Run the read-only Task 176827 single-root acceptance and verify source/output counts, producer roles, terminal/reference-config/truncation semantics, deterministic second-run hashes, zero external calls, and unchanged canonical task artifact hashes.
- [x] 6.5 Run the frozen multi-root fixture, or an explicitly approved real business project root set, and verify shared stable identities plus distinct root-scoped reachability observations; do not group previously tested tasks implicitly.

## 7. Scope and Repository Validation

- [x] 7.1 Run the focused project-topology tests through repository npm scripts, then run `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check`, preserving exact pre-existing failures separately.
- [x] 7.2 Review the final diff and dependency graph to prove Phase 1 does not modify canonical task artifacts/contracts, field-lineage or causal behavior, schedule cache behavior, parser/collector paths, existing dirty work, UI code, or add Neo4j/external runtime dependencies.
- [x] 7.3 Record Phase 1 acceptance evidence and the explicit Phase 2/3/4 entry criteria without creating their implementation artifacts in this change.
