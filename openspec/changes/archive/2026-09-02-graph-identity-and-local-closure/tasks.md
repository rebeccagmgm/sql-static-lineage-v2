## 1. Change and contract

- [x] 1.1 Add the WP-7 change artifacts and freeze the 1.2.0/1.1.0 compatibility rule.
- [x] 1.2 Extend task-local node/edge types, identity properties, read-occurrence IDs and
      local closure summary types.
- [x] 1.3 Validate occurrence edge shape and closure references without reintroducing
      cross-task data edges.

## 2. Projection

- [x] 2.1 Implement evidence-bounded table identity using catalog exact matches and
      `inferTaskDefaultSchema` evidence only.
- [x] 2.2 Emit `READ_OCCURRENCE` nodes, self-read disposition and per-occurrence predicates.
- [x] 2.3 Consume `task-local-materializations.jsonl` for RESOLVED field folding; preserve
      unresolved boundaries.
- [x] 2.4 Populate finalWrites/externalReads/localFieldPaths from the same task's records.

## 3. Verification and release

- [x] 3.1 Update task-local focused tests and real Facts goldens for identity, occurrence,
      materialization and self-read behavior.
- [x] 3.2 Run focused tests, build/typecheck and scoped diff checks; record pre-existing failures.
- [x] 3.3 Archive this change, commit only WP-7 files, push the feature branch, merge and push
      main.

## Verification note

- `npm run test:task-local-projection` passed (10 files, 38 tests).
- `npm run test:machine-facts`, `npm run test:field-lineage`,
  `npm run test:target-table-causal-closure`, and `npm run build` passed.
- `npm run typecheck` still reports only the pre-existing union narrowing errors in
  `tests/hive-ddl-from-log-cache.test.ts`.
- The data-graph UNION loader remains WP-8 scope; this change only publishes and validates
  the 1.2.0 task-local producer with 1.1.0 read compatibility.
