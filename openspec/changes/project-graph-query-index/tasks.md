## 1. Source Contract And Safety Baseline

- [x] 1.1 Record a Phase 3 preflight for the accepted Task 176827 topology and `delta` field-evidence directories, including exact source snapshot IDs, manifest/file hashes, counts and pre-run immutability hashes.
- [x] 1.2 Add query-index schema/version constants and typed contracts for source descriptors, deterministic build identity, staged/current states, indexed record keys, audit manifests, parity reports and typed availability errors.
- [x] 1.3 Add failing fixture tests for deterministic source ordering/build identity, changed-source invalidation, cross-project field rejection, duplicate/conflicting field snapshots and corrupt source files.
- [x] 1.4 Implement the read-only source loader using the existing Phase 1/2 validated directory loaders and require every field snapshot to reference the selected topology snapshot/project.
- [x] 1.5 Prove through an import audit and tests that source loading has no dependency on OpenCLI, caches, parser, Machine Facts construction, reconciliation, causal execution or the historical KG pipeline.

## 2. Store Boundary And Staging Model

- [x] 2.1 Define a narrow `QueryIndexStore` boundary for schema setup, staged-build metadata, batched node/edge writes, validation reads, parity reads, current-pointer resolution/activation, status and exact-build cleanup.
- [x] 2.2 Implement an in-memory store fixture that preserves projection-scoped record identity and can simulate interrupted imports, stale pointers, count conflicts and transaction failures.
- [x] 2.3 Add failing store-contract tests proving staging invisibility, previous-current preservation, exact-build reuse, unrelated-project isolation and scoped cleanup.
- [x] 2.4 Add the official Neo4j JavaScript driver dependency and lazy connection factory without importing or initializing it from existing pipeline, projection or file-query entry points.
- [x] 2.5 Implement fixed allowlisted labels/relationship types, minimum constraints/indexes and parameterized schema setup under the dedicated `SLQueryIndex*` namespace.
- [x] 2.6 Implement idempotent batched import of projection-scoped node records and canonical payloads into a non-current build namespace.
- [x] 2.7 Implement endpoint-checked batched edge import using the fixed `SL_INDEX_EDGE` relationship type and projection/build keys.
- [x] 2.8 Implement staged-build validation for descriptor equality, node/edge counts, unique record keys, endpoint closure and canonical payload hashes.
- [x] 2.9 Implement one-transaction READY/current-pointer activation and tests proving activation failure leaves the prior pointer unchanged.
- [x] 2.10 Implement exact-build status and cleanup operations that cannot issue global or project-wide deletion and cannot touch old KG labels or another project/build.
- [x] 2.11 Implement secret-safe connection configuration and bounded/redacted driver errors; reject direct password CLI values and exclude URI/credentials/password-file paths from canonical manifests.

## 3. Index Build And Audit Publication

- [x] 3.1 Add failing builder tests for successful staging, import failure, validation failure, parity failure, second-build reuse and changed-source build identity.
- [x] 3.2 Implement the query-index builder from validated source descriptor through staging/import/validation while keeping activation as a distinct final gate.
- [x] 3.3 Implement deterministic local `query-index-manifest.json` and `parity-report.json` contracts under the dedicated query-index build directory.
- [x] 3.4 Implement sibling staging, content validation, atomic local installation, byte-identical reuse and immutable-conflict failure for audit files.
- [x] 3.5 Verify a failed build writes no successful audit state, never modifies Phase 1/2 directories and never changes the current database pointer.

## 4. Topology Query Adapter

- [x] 4.1 Add failing parity tests for `get_project_topology` covering filters, offsets/limits, partial source coverage, boundaries and deterministic ordering.
- [x] 4.2 Implement current-build/source preflight plus Neo4j-backed `get_project_topology` with the existing response contract.
- [x] 4.3 Add failing parity tests for `trace_project_upstream` covering relation-layer selection, direction rules, max hops/nodes/edges/paths, explored paths, truncation and missing start nodes.
- [x] 4.4 Implement deterministic bounded topology traversal against indexed adjacency and match the reference envelope exactly.
- [x] 4.5 Add failing parity tests for `explain_topology_edge` covering endpoints, source artifacts, attached boundaries and missing edges.
- [x] 4.6 Implement indexed topology-edge explanation without reading or merging field/historical KG records.

## 5. Field-Evidence Query Adapter

- [x] 5.1 Add failing parity tests for `get_field_evidence` covering snapshot selection, filters, offsets/limits, source/slice coverage, diagnostics and boundaries.
- [x] 5.2 Implement current-build/source/snapshot preflight plus Neo4j-backed `get_field_evidence` with the existing response contract.
- [x] 5.3 Add failing parity tests for `trace_field_value_path` covering root selection, incoming `VALUE_FLOW`, controls/boundaries as annotations, all limits, truncation and missing roots.
- [x] 5.4 Implement deterministic bounded field-value traversal without traversing controls, candidates, schedule or topology edges.
- [x] 5.5 Add failing parity tests for `explain_field_evidence_record` covering node/edge lookup, endpoints, bindings, expressions, exact occurrence/write proof, annotations and missing records.
- [x] 5.6 Implement indexed field-record explanation scoped to one explicit field-evidence snapshot.

## 6. Parity And Staleness Gates

- [x] 6.1 Implement canonical full-envelope comparison, deterministic case/result hashes and a bounded structural diff that does not dump unrestricted records or secrets.
- [x] 6.2 Define required fixture parity cases for all six query families, including normal, partial, bounded/truncated and `not_found` outcomes.
- [x] 6.3 Make staged parity success a required builder input before READY/current activation and prove one mismatched case blocks activation.
- [x] 6.4 Add missing, STAGING, failed, non-current, stale-descriptor and absent-field-snapshot probes returning typed availability errors with no transparent file fallback.
- [x] 6.5 Verify parity and stale checks remain scoped to one exact project/build/snapshot when unrelated indexed and historical KG data coexist.

## 7. Explicit Commands And Offline Compatibility

- [x] 7.1 Add explicit Phase 3 CLI/package commands for build, status, indexed query and parity without registering them in `lineage:all`, Phase 1/2 publication or existing file-query commands.
- [x] 7.2 Validate all CLI paths, project keys, snapshot selections, limits, database names and credential-source options before opening a driver connection.
- [x] 7.3 Add command tests proving help/argument failures and normal Phase 1/2/file-query imports do not initialize Neo4j or require database configuration.
- [x] 7.4 Document the opt-in environment/password-file contract, staging/current states, stale errors, rollback boundary and prohibition on database/project-wide clearing.

## 8. Regression And Live Acceptance

- [x] 8.1 Run all Phase 3 unit/contract/parity tests with the in-memory store and confirm deterministic repeated output.
- [x] 8.2 Run existing Phase 1 and Phase 2 focused suites and verify their public query outputs and accepted hashes remain unchanged.
- [x] 8.3 Run typecheck, build, focused formatting, OpenSpec strict validation and `git diff --check`; record unrelated baseline failures separately without weakening Phase 3 gates.
- [x] 8.4 Audit Phase 3 production imports for forbidden acquisition/parser/reconciliation/causal/old-KG dependencies and audit all Cypher construction for parameterization/allowlists.
- [x] 8.5 Recheck Task 176827 source hashes immediately before live import and select an explicitly configured isolated Neo4j acceptance namespace without clearing existing data.
- [x] 8.6 Execute the real Neo4j staging import, count/endpoint validation and atomic activation for the accepted 176827 topology plus `delta` field-evidence snapshot.
- [x] 8.7 Run required live parity cases for all six query families and record canonical reference/index result hashes, statuses, warnings and limits.
- [x] 8.8 Repeat the same build to prove deterministic reuse, then probe a deliberately mismatched expected descriptor to prove `QUERY_INDEX_STALE` without moving the current pointer.
- [x] 8.9 Verify all source projection files, canonical Task 176827 artifacts and the two unrelated pre-existing dirty files remain byte-identical/unmodified.
- [x] 8.10 Publish a bounded acceptance report with source/build identities, indexed counts, parity outcomes, driver/server capability evidence, timings, rollback target and any remaining live limitation; do not mark Phase 3 complete without the live gate.
