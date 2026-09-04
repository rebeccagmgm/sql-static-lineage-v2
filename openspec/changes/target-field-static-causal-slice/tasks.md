## 1. Baseline and semantic contracts

- [x] 1.1 Freeze the unchanged field-lineage 1.1 VALUE_FLOW, ROWSET_CONTROL, default-Hive-schema, self-join occurrence, legacy artifact, and renderer as canonical golden fixtures; strip timestamps/temp paths and compare the complete stable projection.
- [x] 1.2 Add the operator semantic support matrix and representative fixtures for CASE/IF/COALESCE, filters, join types, aggregates, distinct/setop, windows, Top-N, subqueries, COUNT(*), EXISTS, CROSS JOIN, and literal-from-relation.
- [x] 1.3 Add the orthogonal semantic dependency contract covering subject/effect/operator/root-dependence/local-edge dimensions, PathCertainty, support status, proof refs, and stable canonical IDs.
- [x] 1.4 Close canonical Plan/Machine Facts gaps required by the independent consumer: raw expression bytes plus display text, stable read occurrence IDs, CASE/IF/COALESCE roles, Databricks `ISNULL` exclusion, HAVING/QUALIFY clause identity, window frame, Top-N, and source-located explicit Unknowns.

## 2. Shared physical resolution and expansion

- [x] 2.1 Extract a single physical-field resolver used by VALUE and all control dependencies, with qualified identity, Task default schema, unique catalog/Table Pack match, and task-local schema-backed resolution.
- [x] 2.2 Add resolver tests for bare tables, same-name tables in multiple schemas, missing schema evidence, task-local CTAS, and the 209119 default Hive database case.
- [x] 2.3 Harden the shared physical-field expander and expose it through a compatibility-safe evidence adapter: branch by read occurrence, validate the consumer READ exists and matches statement/table/scope, require occurrence-specific producer WRITE/output binding, and remove unsafe span fallback.
- [x] 2.4 Add regression tests for same-producer multi-occurrence reads, stale/fabricated occurrence IDs, conflicting write spans, control-field expansion, and continuous read/write evidence; old field-lineage golden output must remain unchanged.

## 3. Independent native dependency module

- [x] 3.1 Create `scripts/reconcile/consumer/target-field-causal-slice/` with an explicit canonical-evidence adapter, migrate the semantic contract/support matrix/normalizer into it, and keep old field-lineage free of causal assessment imports.
- [x] 3.2 Implement per-root expression-control normalization for real Plan Facts CASE, IF, and COALESCE records, separating branch selectors from value contributions and preventing unrelated expressions/measures from entering another root field.
- [x] 3.3 Implement rowset/window normalization for WHERE, HAVING, QUALIFY, all supported JOIN types, GROUP BY, DISTINCT, SETOP, WINDOW VALUE/PARTITION/ORDER/FRAME, and ORDER BY combined with LIMIT/TOP/FETCH.
- [x] 3.4 Implement relation-context normalization for COUNT(*), EXISTS, CROSS JOIN cardinality, literal-from-relation, physical READ leaf boundaries, and other supported fieldless row-existence dependencies.
- [x] 3.5 Validate every referenced relation/branch/subquery ID, allowlist expression/operator roles, emit operator-specific hard gaps for missing/unmodeled/structurally incomplete facts, and ensure those gaps block negative proof.

## 4. Per-target causal traversal

- [x] 4.1 Refactor traversal so every root target field owns independent visited, cycle, frontier, path-certainty, and decision state while sharing canonical evidence objects.
- [x] 4.2 Add first-class EXPRESSION/ROWSET/WINDOW/RELATION control frontiers that recursively expand physical fields and relation occurrences across confirmed producer bridges.
- [x] 4.3 Add independent value/control state and path budgets with a shared depth limit; control truncation must not lower a closed VALUE status.
- [x] 4.4 Preserve real local edge kinds along mixed paths while retaining the root dependence reason used to assess the target field.
- [x] 4.5 Add deterministic ordering, cycle termination, repeated-read isolation, and limit-specific gaps for all frontier kinds.

## 5. Candidate universe and evidence closure

- [x] 5.1 Project Candidate Universe from the matching table multi-hop artifact, including ROOT_WRITE, PHYSICAL_PRODUCER, SCHEDULE_ONLY, UNBOUND_READ, BLOCKED_READ, and coverage boundaries.
- [x] 5.2 Generate stable candidate branch IDs without producerRole and validate that every root-target-field × candidate-branch pair is represented exactly once.
- [x] 5.3 Implement positive evidence closure and `CONFIRMED_RELATED / CONDITIONAL_RELATED / UNKNOWN` assessments with mandatory proof/gap references.
- [x] 5.4 Implement negative proof and known-cut propagation for `PROVEN_UNRELATED`, restricted to fully observed and already enumerated candidate subtrees.
- [x] 5.5 Generate the minimum confirmed rerun set and conservative safety rerun set with target-field, candidate-branch, proof, and gap references.

## 6. Independent artifact, CLI, summary, and HTML

- [x] 6.1 Publish `TARGET_FIELD_CAUSAL_SLICE` contract/schema with definitions/applications/control edges, Candidate Universe, assessments, proofs, separate limits, metrics, rerun sets, canonical input fingerprints, and optional legacy VALUE evidence refs.
- [x] 6.2 Validate assessment-pair completeness, Unknown gaps, confirmed proof continuity, negative-proof obligations, non-vacuous closure metrics, NOT_EVALUATED Precision/Recall, deterministic ordering, content hash, and artifact-type isolation.
- [x] 6.3 Add `reconcile-target-field-causal-slice` CLI that verifies existing Input Pack/Machine Facts/producer-index/table-artifact fingerprints, reports the exact stale layer, and never triggers full collection, old field-lineage rebuild, or producer-index rebuild.
- [x] 6.4 Add a deterministic causal-slice text formatter for per-field classifications, proofs/gaps, operator support, limits, and both rerun sets from the independent canonical artifact only.
- [x] 6.5 Add `target-field-causal-slice-visualize.ts` as a pure renderer of the independent artifact; display value/control/relation paths, candidate coverage, assessments, limits, and rerun sets without importing traversal logic or modifying the old field-lineage renderer.
- [x] 6.6 Add isolated output publication for `target-field-causal-slice.json/.txt/.html`; publishing or failing the new outputs must leave existing `field-lineage.json` and HTML byte-identical.

## 7. Calcite differential oracle

- [x] 7.1 Add a separately invoked Java tool pinned to Calcite 1.42.0 with deterministic JSONL stdin/stdout, version fingerprints, bounded inputs, and explicit unsupported/failed results.
- [x] 7.2 Implement Calcite extraction for expression lineage, predicates, unique keys, functional dependencies, table occurrences, and row-count/cardinality metadata on the supported fixture subset.
- [x] 7.3 Add a TypeScript differential reconciler that reports AGREED, NATIVE_ONLY, CALCITE_ONLY_UNMAPPABLE, NOT_EVALUATED, and CONFLICT without modifying canonical artifacts.
- [x] 7.4 Add an independent Calcite build/test command and ensure default `npm test`, production CLI, and field-only reconciliation neither build nor start Java.
- [x] 7.5 Integrate Calcite mapping and differential fixtures into every Native operator batch; require an explicit `NOT_EVALUATED` reason for unsupported dialect/operator cases and preserve both observations on conflicts.
- [x] 7.6 Add explicit `--semantic-oracle calcite` shadow validation that emits a separate versioned differential report and optional non-decisional artifact validation summary without changing canonical dependencies, assessments, or rerun sets.
- [x] 7.7 Add differential release gates for occurrence/field/operator/source-evidence mapping, deterministic conflict-to-Unknown behavior, supported-corpus agreement, and 209119 shadow A/B sidecar go/no-go evidence.

## 8. Verification and bounded rollout

- [x] 8.1 Run focused canonical-facts, per-operator Native/Calcite differential, shared-evidence, traversal, candidate-universe, assessment, artifact, summary, HTML, legacy field-lineage compatibility, shadow-mode, and Calcite differential tests.
- [x] 8.2 Run repository typecheck, default tests, build, and format checks; separately repair or classify the current task-inspection fixture drift and pre-existing formatting failures.
- [x] 8.3 Reconcile Task 209119 from existing matching immutable inputs, generate only causal-slice JSON/summary/HTML, and prove no full Task collection, old field-lineage rebuild, or producer-index rebuild occurred.
- [x] 8.4 Inspect 209119 minimum/safety rerun sets, proof continuity, Unknown gaps, candidate-pair coverage, limits, new HTML parity, old artifact byte stability, and Native-vs-Calcite shadow A/B; record production-sidecar go/no-go evidence without enabling Calcite as a decision engine.
