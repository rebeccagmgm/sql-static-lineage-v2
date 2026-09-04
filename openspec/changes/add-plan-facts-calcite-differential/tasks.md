## 1. Baseline and inventory

- [x] 1.1 Record the current Git state, Calcite 1.42.0 build/runtime commands, existing oracle imports, package scripts, fixtures, and canonical output consumers.
- [x] 1.2 Add frozen default-path regression fixtures for representative field-lineage and target-field causal-slice outputs with Calcite disabled.
- [x] 1.3 Add an operator/type coverage inventory from current Plan Facts fixtures and a bounded 209119 snapshot without modifying published artifacts.

## 2. Differential naming and protocol

- [x] 2.1 Create the external `E:\02_area\股衍数据-数据cookbook\scripts\Calcite\` sidecar with a versioned differential protocol and conservative reconciliation statuses.
- [x] 2.2 Add `RAW_SQL_V1` and `PLAN_FACTS_REL_V1` request kinds, response issues, mapping references, fingerprints, and hard resource limits.
- [ ] 2.3 Convert `scripts/calcite-oracle/` into deprecated compatibility exports/wrappers and migrate internal TypeScript callers to the differential naming.
- [x] 2.4 Add protocol validation tests for malformed input, version mismatch, unsupported request kinds, limits, and deterministic serialization.

## 3. Plan Facts relational projection

- [x] 3.1 Define the immutable `PlanFactsRelRequest` relation, expression, type, evidence, and mapping contracts without changing canonical Plan Facts types.
- [x] 3.2 Implement schema/type/nullability projection from existing schema and evidence facts with explicit unsupported issues for missing or ambiguous types.
- [x] 3.3 Implement stable relation graph projection for read, project, and filter while preserving Native relation occurrence ids, input/output ordinals, and evidence refs.
- [ ] 3.4 Implement typed expression and predicate projection for literals, field references, calls, casts, boolean/comparison operators, CASE, IF, and COALESCE.
- [x] 3.5 Add TypeScript projection tests for successful core graphs, duplicate table occurrences, missing types, unsupported functions, and no SQL-string fallback.

## 4. Calcite RelNode bridge foundation

- [x] 4.1 Create the independent `tools/calcite-rel-bridge/` Maven module pinned to Calcite 1.42.0 and a bounded UTF-8 JSONL process boundary.
- [x] 4.2 Implement request/schema/type loading and structured `SUCCESS`, `UNSUPPORTED`, and `FAILED` responses with protocol/build fingerprints.
- [x] 4.3 Implement unoptimized table scan, project, and filter RelNode construction plus typed RexNode conversion for the core expression subset.
- [x] 4.4 Implement Native-to-Calcite node/output mapping tables and emit table occurrence, expression lineage, and predicate observations with exact mapping refs.
- [x] 4.5 Add independent Java runtime fixtures for core success, missing type, unsupported function, malformed graph, output limit, and mapping round trip.

## 5. Join and aggregate core batch

- [ ] 5.1 Extend the TypeScript projection for INNER/LEFT/RIGHT/FULL/SEMI/ANTI/CROSS joins, join conditions, grouping sets, aggregate calls, DISTINCT, and COUNT(*).
- [ ] 5.2 Implement Calcite LogicalJoin and LogicalAggregate construction without requiring unique-key evidence for structural join dependency.
- [ ] 5.3 Emit and reconcile join predicate, unique-key, functional-dependency, grouping, and row-count/cardinality observations where Calcite evaluates them.
- [ ] 5.4 Add batch tests for join direction, duplicate occurrences, nullability, fanout metadata unknowns, COUNT(*), unsupported aggregate functions, and exact mapping.

## 6. Minimal differential runner and isolation

- [x] 6.1 Implement an explicitly invoked TypeScript runner that streams Plan Facts requests to the Java bridge and writes only staging/independent differential reports.
- [ ] 6.2 Reconcile only exact mapped observations into `NATIVE_CONFIRMED`, `CALCITE_CORROBORATED`, `NATIVE_ONLY`, `CALCITE_ONLY_UNMAPPABLE`, `NOT_EVALUATED`, or `SEMANTIC_ENGINE_CONFLICT`.
- [x] 6.3 Add core report summaries for projection coverage, operator/type unsupported counts, metadata mapping rate, conflicts, failures, and tool fingerprints.
- [ ] 6.4 Verify the runner never writes canonical field-lineage or causal-slice JSON/HTML, never generates `PROVEN_UNRELATED`, and is absent from the default pipeline dependency graph.

## 7. Early 209119 value gate

- [x] 7.1 Project the existing fingerprint-matched 209119 Plan Facts/evidence into staging without rerunning Input Pack collection or overwriting published artifacts.
- [x] 7.2 Compare raw-SQL and Plan-Facts lane success, projection coverage, exact mapping rate, metadata gain, conflicts, unmappable observations, and `NOT_EVALUATED` causes for the core operator batch.
- [ ] 7.3 Verify the current 209119 canonical JSON/HTML hashes and Native assessments remain unchanged after differential execution. Reopened: the latest v18 evidence does not include a complete four-file acceptance set; the observed external directory is not attributed to the differential run.
- [x] 7.4 Produce a documented go/no-go decision for broader operator implementation based on measurable metadata gain or meaningful Unknown reduction, 100% evidence mapping for compared observations, no default-path regression, performance, and operational cost.
- [x] 7.5 If the decision is no-go, pause implementation and update the OpenSpec scope instead of marking later expansion tasks complete or weakening fail-closed rules.

## 8. Conditional set operation, window, and Top-N expansion

- [ ] 8.1 After a recorded go decision, extend the TypeScript projection for UNION/INTERSECT/EXCEPT alignment, window value/partition/order/frame roles, and ORDER BY with offset/limit/fetch.
- [ ] 8.2 Implement the corresponding Calcite set-operation, RexOver/window, and LogicalSort nodes with fail-closed type and ordinal validation.
- [ ] 8.3 Add tests for UNION ALL versus DISTINCT, by-position alignment, window frame bounds, ordering-only versus Top-N, unsupported variants, and mapping preservation.
- [ ] 8.4 Re-run the differential value report and confirm the expansion adds mapped metadata rather than only increasing unsupported or unmappable output.

## 9. Explicit unsupported boundaries

- [ ] 9.1 Detect correlated subqueries, EXISTS/IN variants not yet projectable, lateral/UDTF/EXPLODE, dynamic identifiers, and unregistered Hive functions before Java execution.
- [ ] 9.2 Return relation/expression-scoped unsupported issues and prove they cannot be converted into agreement, conflict, or negative proof.
- [ ] 9.3 Add corpus tests demonstrating that unsupported and failed cases preserve Native conclusions and remain visible as `NOT_EVALUATED`.

## 10. Compatibility migration and documentation

- [ ] 10.1 Create deprecated Java/PowerShell compatibility entrypoints for existing `tools/calcite-oracle` commands and migrate repository-owned fixtures and docs to the new naming.
- [ ] 10.2 Document the two input lanes, default-off behavior, Java prerequisites, independent commands, status meanings, unsupported boundaries, value gate, and rollback procedure.
- [ ] 10.3 Add tests proving legacy protocol/command compatibility or an explicit actionable migration error for every intentionally unsupported legacy path.

## 11. Validation gates

- [ ] 11.1 Run TypeScript unit tests, typecheck, build, and formatting checks using project npm scripts with Java unavailable to the default commands.
- [ ] 11.2 Run frozen default CLI/artifact regressions and verify Calcite-disabled canonical outputs are contract-equivalent to the baseline.
- [ ] 11.3 Inspect the dependency graph and default pipeline to prove it does not import, build, start, or read the Calcite bridge.
- [ ] 11.4 Run the independent Maven/runtime suite and record exact Calcite version, test counts, unsupported cases, and any environment-specific limitations.

## 12. Review and handoff

- [ ] 12.1 Perform a focused code review for evidence fabrication, accidental canonical writes, type widening, identity drift, resource limits, and legacy compatibility.
- [ ] 12.2 Resolve review findings without weakening fail-closed tests and rerun all affected validation commands.
- [ ] 12.3 Update this checklist, validation evidence, changed-file inventory, and rollback instructions for coordinator acceptance.
