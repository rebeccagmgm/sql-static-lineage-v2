## 1. TL-0 Contract and identity

- [x] 1.1 Add `scripts/project-graph/task-local/contract.ts` with `TASK_LOCAL_PROJECTION` types, schema version, and validator (reject cross-task data edges, `affectedRootFields`, `rowsetControls`).
- [x] 1.2 Add `scripts/project-graph/task-local/ids.ts` copied from data-graph identity algorithms.
- [x] 1.3 Add frozen vector tests for `176827`, `dm_rsk_n.otc_opt_greek_val_det_h`, `write-observation:176827:platform-target:0`, `odata_n_tit.d_ref_trs.key_otc_trade_id`.
- [x] 1.4 Wire `npm run test:task-local-projection` and keep `npm run typecheck` green.

## 2. TL-1 Single-task projection kernel

- [x] 2.1 Implement `projectTaskLocal(taskId)` loading Facts only.
- [x] 2.2 Emit TASK / TARGET_WRITE / WRITES / READS / FIELD_DIRECT / DATASET_CONTROL / FIELD_CONDITIONAL in documented order.
- [x] 2.3 Allow `FIELD_DIRECT.subtype = UNKNOWN` with typed gaps when subtype cannot be derived.

## 3. TL-2 Shared control collection

- [x] 3.1 Extract `datasetControlsForStatement` (+ grain) to a shared module importable by field-lineage and task-local projection.
- [x] 3.2 Keep `npm run test:field-lineage` byte-level behavior unchanged.

## 4. TL-3 Coverage states

- [x] 4.1 Implement `PROJECTED`, `SCHEDULE_ONLY`, `COLLECTION_FAILED` with reason codes.
- [x] 4.2 Batch summary counts per status.

## 5. TL-4 Content-hash cache

- [x] 5.1 Cache key: taskId + pack hash + facts manifest + projection schema version.
- [x] 5.2 Second batch all cache hit; single changed SQL hash only misses that task.

## 6. TL-5 Batch CLI

- [x] 6.1 `npm run project-task-local --` with `--topic DM_RSK_N`, `--also-task-ids 105387,119044`, `--no-prepare-facts`.
- [x] 6.2 Output under project-graph root, not task artifacts.

## 7. TL-6 Golden samples

- [x] 7.1 Assertions for 176827, 119044, 105387 per execution plan TL-6.
- [x] 7.2 Control edges must not scale with output column count.

## 8. TL-7 partitionPredicates

- [x] 8.1 Literal FILTER predicates per READ occurrence (not task-merged).
- [x] 8.2 Golden checks for 105387 and 119044 SRC_TBL placement.

## 9. TL-8 Cost record

- [x] 9.1 Document p50/p95 and wall clock for DM_RSK_N + goldens in change notes.

## Archive notes (post-audit)

- **调度为 `scheduleReference`，非数据血缘**（WP-3.1）：TASK 属性 `role: SCHEDULE_REFERENCE_ONLY`；不得变成 TASK→TASK 数据边。见 `task-local-projection-wp31`。
- Golden tests need sibling `sql-static-lineage-data/field-facts` (or `TASK_LOCAL_GOLDEN_DATA_ROOT` / `TASK_LOCAL_GOLDEN_FACTS_ROOT`). Without Facts they `describe.skip`; set `TASK_LOCAL_GOLDEN_REQUIRED=1` to fail closed when CI has the data pack.
- `DATASET_CONTROL` is statement-scoped via `datasetControlsForStatement` (TL-6 frozen); WP-3.1 attaches controls to the owning `write_observation_id`. Intersecting with `summarizeTaskRelations()` READ channels remains optional hardening.
- FIELD_DIRECT table column freezes follow current Facts (e.g. 119044 `t01_pty_name` = 3), not older prose “约 6”.
- Schema **1.1.0** adds `scheduleReference` and `partitionPredicateStatus` (`NONE` | `LITERAL` | `NON_LITERAL_PRESENT`).
