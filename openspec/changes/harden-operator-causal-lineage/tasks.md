## 1. Baseline and failing occurrence tests

- [x] 1.1 Re-run the existing causal-slice, Plan adapter, and legacy field-lineage focused suites and record the unchanged baseline without modifying the two pre-existing dirty physical-expander files. Baseline: causal-slice 127/127, Plan adapter 39/39, field-lineage 82 passed/1 todo.
- [x] 1.2 Add failing contract tests proving that two root criteria for the same physical field but different `write_observation_id` values receive distinct canonical identities. RED: the focused suite failed because the new write-scoped module did not yet exist.
- [x] 1.3 Add failing orchestration tests for sibling statements writing the same target field from different source fields/predicates and for two output expressions in one statement; assert cross-write and cross-expression leakage before implementing the fix. RED was captured at the missing write-scoped adapter boundary; focused write/binding and real-SQL statement gates now pass.
- [x] 1.4 Add fail-closed tests for missing, contradictory, and multiply mapped write/statement/relation/expression/output-binding evidence. RED: the focused suite failed at module resolution before implementation.

## 2. Canonical write-scoped plan inputs

- [x] 2.1 Extract or reuse one read-only target-write evidence resolver so both causal consumers resolve write observation, SQL source, statement, root relation, expression, binding, ordinal, and evidence refs from canonical Machine Facts without name-based fallback. Shared resolver accepts only current bundles or the exact active 1.3 publisher contract and rejects contradictory write targets.
- [x] 2.2 Add `write-scoped-plan-inputs.ts` to create stable `RootCriterion` records per selected write and target field, including deterministic IDs and blocking scope gaps. Focused verification: 13/13 passed.
- [x] 2.3 Replace target-table/field-only `outputRoots` selection with exact output bindings filtered by selected write observation, statement, root relation, expression, and target field.
- [x] 2.4 Restrict `buildPlanInputs` to the proven SQL statement, pass its canonical `statement_index` to `buildPlanFacts`, and fail closed when rebuilt Plan Facts do not match Machine Facts scope. Focused immutable-snapshot/Plan verification: 10/10 passed.
- [x] 2.5 Make an explicit multi-write request return separate root criteria and Plan inputs rather than one field-name-deduplicated root.

## 3. Scoped semantic contract and artifact 2.0

- [x] 3.1 Add `SemanticOccurrenceScope` to semantic definitions/applications/edges/gaps and root-criterion references to applications, edges, gaps, proof paths, and their canonical ID inputs; keep definitions root-criterion-neutral but local-occurrence-scoped.
- [x] 3.2 Require `normalizeSemanticDependencies` to receive one proven root criterion/local scope and propagate statement, relation, expression, binding, and write evidence without heuristic fallback. Focused strict-normalizer verification: 30/30 passed.
- [x] 3.3 Add tests proving identical operator/field semantics in sibling writes cannot deduplicate application, edge, or gap IDs and incomplete scope cannot emit a confirmed edge. Focused occurrence-scope verification is included in the 30/30 strict-normalizer result.
- [x] 3.4 Upgrade `TARGET_FIELD_CAUSAL_SLICE` from schema `1.0.0` to `2.0.0`, serialize root criteria and semantic scopes, and reject stale 1.0 artifacts as occurrence-unsafe without rewriting them.
- [ ] 3.5 Extend artifact validation and pure renderers so every application, edge, gap, path, assessment, and rerun trigger has a continuous valid root/scope chain.

## 4. Scoped traversal, upstream writes, and assessment

- [x] 4.1 Add failing traversal and assessment tests for two roots sharing a physical field but using different writes, including independent visited state, paths, gaps, and final assessments.
- [x] 4.2 Project exact producer write/statement/expression scopes from the strict causal adapter's validated `producerBindings`; split only complete scopes and emit a hard ambiguity gap otherwise, without changing legacy producer selection. Table-level bridges additionally require exactly one complete producer WRITE occurrence for the physical table.
- [x] 4.3 Include root criterion and local write/scope identity in semantic edge-loader requests, edge indexes, lazy-load caches, traversal state, active/cycle keys, path IDs, and gap IDs.
- [x] 4.4 Key candidate pairing, causal assessment, proof closure, and rerun triggers by root criterion rather than `rootTargetFieldId` alone; verify ROOT_WRITE branches match their write observation.
- [x] 4.5 Prove cross-write leakage is zero for root and upstream producer writes and that any scope discontinuity blocks confirmed and negative proof.

## 5. Real SQL semantic gold

- [x] 5.1 Add a production-parser fixture for two `INSERT` statements writing the same target field from different sources and `WHERE` predicates, with schema and canonical write/output-binding evidence.
- [x] 5.2 Build the fixture only through `SqlSession`, `buildPlanFacts`, the write-scope resolver, and `normalizeSemanticDependencies`; do not construct Plan Facts by hand.
- [x] 5.3 Freeze a compact semantic gold projection for each selected write covering exact VALUE and WHERE `ROWSET_CONTROL` dependencies, occurrence scope, proof refs/spans, sibling-dependency absence, and expected gaps; label fixtures as `development` or `holdout`.
- [x] 5.4 Add one real-SQL unsupported/incomplete case whose gold requires a source-located hard gap, so an omitted edge with no gap fails the suite.
- [x] 5.5 Replay each gold input twice and require byte-identical stable projections after excluding explicitly non-semantic runtime metadata; prohibit case-ID branches and automatic snapshot updates in the runner. Development and holdout projections replay byte-identically through the production parser/build path.

## 6. Compatibility, verification, and review

- [ ] 6.1 Run `npm run test:causal-slice`, `npm run test:engine`, the new occurrence/gold tests, and legacy field-lineage golden tests; fix implementation defects without weakening the gates.
- [ ] 6.2 Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check`, preserving exact failures that are demonstrably pre-existing and unrelated.
- [ ] 6.3 Verify the operator support matrix, Plan/Machine Facts contracts, legacy field-lineage stable projection, default Calcite path, and pre-existing dirty files have no unintended behavioral changes.
- [ ] 6.4 Run focused code review for occurrence leakage, fail-open behavior, identity collisions, schema migration, deterministic output, and missing negative tests; resolve all blocking findings.
- [ ] 6.5 Validate the OpenSpec change strictly and record the bounded result without claiming production precision/recall or expanding operator support.

## Bounded closeout note (2026-08-31)

Per the explicit user-directed stop-loss closeout, tasks 3.5 and 6.1–6.5 are moved out of this closeout scope and remain unchecked. They are not claimed as completed; this closeout does not provide full artifact validation, full-suite/format verification, broad support-matrix review, code review, or strict OpenSpec validation.
