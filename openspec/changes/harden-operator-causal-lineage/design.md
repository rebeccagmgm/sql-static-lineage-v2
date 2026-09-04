## Context

See `proposal.md` for motivation and `specs/occurrence-scoped-operator-lineage/spec.md` for the behavioral contract. The current causal consumer selects requested write observations during preflight, but `outputRoots` subsequently filters bindings only by task and target table, `buildPlanInputs` iterates every SQL statement, and semantic applications, edges, traversal caches, and assessments are primarily keyed by task and physical field. This can merge sibling writes before the already-strict physical producer bridge is reached.

Canonical Machine Facts already contain the required identity chain: `write_observation_id`, write/statement IDs, output expression IDs, relation IDs, statement ordinals, and evidence references. The target-table causal consumer also has a fail-closed target-write resolver. The hardening should reuse that evidence instead of deriving scope from SQL text or table names.

## Goals / Non-Goals

**Goals:**

- Make a write-scoped root criterion, rather than a physical field alone, the identity carried through normalization, traversal, assessment, and artifact validation.
- Preserve the exact local statement/relation/expression occurrence for each semantic dependency and for every upstream producer write reached during traversal.
- Prove one production-shaped SQL path end to end and make the harness reusable for later operator corpus growth.
- Fail closed on stale, ambiguous, or discontinuous occurrence evidence.

**Non-Goals:**

- Add operator variants, improve cardinality inference, or implement outer-join null extension, DISTINCT reachability, window frames, set-op `BY NAME`, UDTF/lateral, or dynamic SQL.
- Change parser, Plan Facts, Machine Facts, producer selection, legacy field-lineage, or runtime rerun semantics.
- Enable Calcite or OpenLineage in the canonical/default path.
- Claim production precision/recall from the initial gold fixture.

## Decisions

### 1. Resolve a canonical RootCriterion before building semantic inputs

Add a write-scoped plan-input adapter that resolves each requested target output from Machine Facts before parsing or normalizing any statement. Its stable identity contains at least:

```text
rootCriterionId
rootTaskId
targetTableKey
rootTargetFieldId
rootWriteObservationId
sqlSourceId
statementId / statementIndex
queryProducerStatementId
rootRelationId
outputExpressionId
outputBindingId
evidenceRefs
```

The adapter will reuse a shared extraction of the existing fail-closed target-write resolver. `outputRoots` will filter exact output bindings by write observation, statement, relation, and target field. `buildPlanFacts` will run only for the selected statement and will receive its real statement index. A mismatch between rebuilt Plan Facts and Machine Facts creates a blocking scope gap.

Alternative: keep parsing every statement and filter normalized edges afterward. Rejected because already-merged dependency IDs and proof refs cannot be safely separated after normalization.

### 2. Separate root criterion identity from local semantic occurrence scope

Introduce two orthogonal identities:

- `RootCriterion`: the selected root write plus one target physical field. Two writes to the same field have different root criterion IDs.
- `SemanticOccurrenceScope`: the local task/write/statement/root relation and optional owning relation/expression for a dependency. Upstream producer writes therefore retain their own local write scope while remaining part of the original root criterion.

Definitions are local occurrence observations because they carry occurrence proof refs, so their identity includes `semanticScopeId` while remaining independent of the root criterion. Applications, traversable edges, gaps, paths, and assessments reference `rootCriterionId`; applications, edges, and gaps also reference `semanticScopeId`. Canonical definition/application/edge/gap/path IDs include the applicable references, preventing sibling occurrences from deduplicating into one record while still allowing one local definition to serve several root criteria in the same write.

Alternative: add only `writeObservationId` to applications. Rejected because traversal and cache keys could still merge two statements or upstream producer writes with the same task/field identity.

### 3. Carry local producer write scope through physical expansion and traversal

The strict causal adapter will project validated producer output bindings into explicit producer write scopes. A confirmed producer frontier must identify one producer write, statement, and output expression; multiple valid scopes create separate frontiers only when each is evidence-complete, otherwise a hard ambiguity gap.

Traversal roots, states, active/cycle keys, semantic-edge loader requests, edge indexes, and lazy-load caches include `rootCriterionId` and the current `semanticScopeId` or local write observation. The current task-plus-field cache key is insufficient and will not remain authoritative.

Alternative: keep traversal unchanged because the root invocation selected a write. Rejected because upstream lazy semantic loading can encounter a task that writes the same field more than once.

### 4. Version the causal artifact instead of accepting mixed identity strength

`TARGET_FIELD_CAUSAL_SLICE` moves from schema `1.0.0` to `2.0.0` because root, path, assessment, and canonical ID semantics change incompatibly. Version 2.0 serializes root criteria and semantic occurrence scopes, and validators require complete scope references for every application, traversable edge, gap, path, assessment, and rerun trigger. Version 1.0 artifacts remain untouched on disk but are stale inputs for the hardened consumer and must be regenerated; there is no inference-based migration.

Legacy field-lineage schema and files do not change. Compatibility tests compare its stable projection before and after hardening.

Alternative: make scope fields optional in 1.0. Rejected because an optional identity cannot establish the zero-cross-write invariant.

### 5. Establish a semantic gold projection from production parser output

The initial gold harness uses real SQL and schema inputs and invokes the production `SqlSession`, `buildPlanFacts`, target-write scope resolver, and `normalizeSemanticDependencies`. It never constructs `PlanFacts` objects by hand. The stable gold tuple is:

```text
rootCriterionId
rootWriteObservationId
rootTargetFieldId
semanticScopeId
subject occurrence or physical field
operatorKind / operatorVariant / operatorRole
effectKind / localEdgeKind / rootDependenceKind
pathCertainty
proof refs
gap reason and source location
```

The first adversarial fixture contains two statements writing the same target field from different sources and predicates. Each selected write is asserted independently for its VALUE and WHERE `ROWSET_CONTROL` dependencies, absence of the sibling source/predicate, zero unexpected gaps, and deterministic replay. A separate unsupported fixture requires an explicit gap so the harness detects silent omission as well as wrong positive edges. Fixtures declare `development` or `holdout` partition metadata; the runner contains no case-specific branches and snapshots cannot be auto-updated.

Alternative: snapshot complete Plan Facts or causal artifacts. Rejected because large structural snapshots are brittle and can pass while semantic meaning or scope continuity regresses.

### 6. Keep the support matrix frozen during identity hardening

The change may update tests to express existing supported behavior through real SQL, but it does not turn an existing `UNKNOWN`/`UNSUPPORTED` cell into a confirmed rule. New operator behavior requires a later change after the occurrence spine and gold harness pass.

## Risks / Trade-offs

- [Artifact and ID churn affects many causal modules] → Introduce root/scope contracts and failing tests first, migrate one stage at a time, and bump only the causal artifact schema.
- [Machine Facts and rebuilt Plan Facts disagree on statement/relation identity] → Treat disagreement as a source-located hard gap; never fall back to ordinal or name matching without canonical evidence.
- [Physical expansion exposes several producer write bindings] → Preserve separate proven scopes or stop at ambiguity; never select the first binding.
- [Gold expectations are derived from the implementation under test] → Store independently reviewed semantic tuples, include negative sibling assertions, and replay the fixture twice for determinism.
- [The first gold case is too small to support accuracy claims] → Label precision/recall `NOT_EVALUATED`; this change proves the harness and no-leak invariant, not corpus coverage.
- [Concurrent user edits overlap shared field expansion] → Avoid modifying legacy expansion behavior; make causal-only scope projection additive and preserve pre-existing worktree changes.

## Migration Plan

1. Add failing contract and multi-write tests for root criteria, semantic scopes, scoped IDs, and schema 2.0 validation.
2. Resolve write-scoped plan inputs from canonical Machine Facts and restrict normalization to the selected statement/root/output expression.
3. Propagate scope through normalizer, traversal loaders/state/cache, assessment, rerun outputs, and artifact validation.
4. Add the real-SQL supported and unsupported gold fixtures and deterministic stable projection.
5. Run causal-slice, engine, legacy field-lineage, typecheck, build, and format checks; inspect the diff for accidental support-matrix or legacy artifact changes.
6. Regenerate hardened causal artifacts only through an explicit caller request; rollback is disabling the 2.0 consumer and leaving existing 1.0/legacy artifacts unchanged.
