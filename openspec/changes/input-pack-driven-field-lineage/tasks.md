## 1. Contracts and Test Fixtures

- [x] 1.1 Add the versioned `FIELD_MULTI_HOP_RECONCILIATION` JSON Schema and TypeScript types for physical field identities, evidence states, traversal paths, rowset annotations, gaps, limits, and overall status.
- [x] 1.2 Add minimal synthetic Input Pack fixtures covering SQL explicit writes, platform-target query outputs, missing Schema fields, excluded tasks, primary/additional/unknown producers, branching, and cycles without committing real internal SQL or DDL.
- [x] 1.3 Add schema and contract tests that reject guessed physical identities, invalid status combinations, non-deterministic ordering, and `COMPLETE` results containing legacy or unresolved paths.

## 2. Input Pack to Machine Facts Preparation

- [x] 2.1 Implement a snapshot-safe Input Pack loader that resolves Task Pack, SQL slots, target Table Pack and DDL from one data root, records provenance/content hashes, and fails closed if inputs change during preparation.
- [x] 2.2 Implement deterministic lineage SQL selection with `query` preference, stable Task/slot/statement identities, ambiguity reporting, and canonical SQL preservation.
- [x] 2.3 Reuse the existing DDL Schema loader and Machine Facts publisher to generate task facts without a caller-supplied profile or Schema snapshot.
- [x] 2.4 Extend output-binding evidence to distinguish `SQL_EXPLICIT_WRITE` from fully proven `PLATFORM_TARGET_QUERY_OUTPUT`, including fail-closed ordinal and partition checks.
- [x] 2.5 Build a Schema-backed physical-field bridge index using platform, dataSource, stable Table ID or validated qualified name, and normalized column; mark Contract 1.3 facts as `PROVISIONAL_LEGACY`.
- [x] 2.6 Add an Input Pack-driven Machine Facts CLI/npm entry point and tests for deterministic replay, legacy policy metadata, malformed/missing packs, and input fingerprint changes.

## 3. Cross-Task Field Traversal

- [x] 3.1 Implement root Task/table/field validation and create deterministic traversal states from explicit Schema-backed root fields.
- [x] 3.2 Implement per-layer producer bridging that recurses only through one-hop `finalUpstreamTaskIds.primary`, records `additional` as candidates, stops on `unknown`, and rejects physical-identity mismatches.
- [x] 3.3 Implement task-internal `VALUE_FLOW` backtracking from output bindings to physical source fields, including multiple source branches and exact upstream output-field continuation.
- [x] 3.4 Attach provable Join/filter/control evidence as `ROWSET_CONTROL` annotations and emit `ROWSET_SCOPE_UNRESOLVED` when Contract 1.3 relation scope is insufficient.
- [x] 3.5 Implement Task/field state deduplication, active-path cycle detection, max-depth/max-state/max-path limits, stable frontier ordering, and `COMPLETE`/`PARTIAL`/`BLOCKED` aggregation.
- [x] 3.6 Add traversal tests proving omitted table-level producers do not enter the value tree, candidates never recurse, excluded/missing Task Packs stop explicitly, and legacy facts cannot yield `COMPLETE`.

## 4. Canonical Output and CLI

- [x] 4.1 Implement canonical artifact serialization and validation with stable node, edge, path, candidate, control, and gap ordering.
- [x] 4.2 Implement a pure formatter that renders request/policy, full table upstream tree, field-specific Task tree, per-Task field mappings, rowset controls, candidates, gaps, and limits from the canonical artifact only.
- [x] 4.3 Add the `reconcile-field-lineage` CLI with root identifiers/fields, data and evidence paths, facts policy, safety limits, JSON output, and optional summary output; default facts policy to `current-only`.
- [x] 4.4 Document the Input Pack → Machine Facts → field reconciliation workflow, evidence statuses, command examples, and the distinction between static lineage and runtime/business correctness.

## 5. Verification and 155015 Acceptance

- [x] 5.1 Run focused Machine Facts, consumer, field-lineage schema/CLI tests plus repository typecheck/build, preserving exact evidence for any pre-existing Windows/Vitest worker exit.
- [x] 5.2 Run the external 155015 case with explicit root fields and `allow-legacy-partial`; verify the value Task projection contains only the proven 114026/112715 and 105387/71698 routes while rowset-only tasks remain annotations or omissions.
- [x] 5.3 Verify the current excluded 112715 state produces an `UNRESOLVED` stop and overall `PARTIAL` without reading the excluded root; record the rerun command and expected upgrade behavior after normal Input Pack recollection.
- [x] 5.4 Validate the OpenSpec change in strict mode and review the final diff for accidental edits to existing user changes or inclusion of real Input Pack/generated artifacts.
