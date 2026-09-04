## 1. FE-0 契约 1.3.0（契约先行，不改投影发射）

- [x] 1.1 `contract.ts`：导出 `TASK_LOCAL_PROJECTION_FIELD_EVIDENCE_SCHEMA_VERSION = "1.3.0"`；FE-1 同 PR 将 `TASK_LOCAL_PROJECTION_SCHEMA_VERSION` bump 到 `"1.3.0"`；类型 `TaskLocalSourceReadOccurrenceStatus/Reason`、`TaskLocalSubtypeReason`、`TaskLocalJoinType`、`TaskLocalControlSide`、`TaskLocalProjectionGap`；`TaskLocalProjection.gaps`（1.3.0 必填）；`taskLocalSchemaVersionAtLeast()`。
- [x] 1.2 `validateTaskLocalProjection`：`>= 1.2.0` → READS 两跳 + `readOccurrenceId`；`=== 1.3.0` → 字段边新属性、UNKNOWN/subtypeReason、JOIN joinType、**gaps[] 每条 gapId+reasonCode+details**、非 RESOLVED 必填 sourceReadOccurrenceReason。保留跨任务边 / affectedRootFields / 字段级控制边拒绝。
- [x] 1.3 `ids.ts`：`fieldDirectEdgeSemanticKey({ outputColumn, sourceColumn, sourceTable, sourceReadOccurrenceId, expressionId })`；`fieldConditionalEdgeSemanticKey` 同理。**不在 FE-0 改 project-task-local.ts**。
- [x] 1.4 `contract.test.ts`：合成 1.3.0 fixture 通过/拒绝；1.2.0 仍通过且 READS 缺 readOccurrenceId 在 `>= 1.2.0` 规则下拒绝（模拟常量升版后 legacy 不放松）。

## 2. FE-1 读次派生（与常量 bump、投影发射同 PR）

- [x] 2.1 `relation-tree.ts` + `source-read-occurrence.ts`（§5.1 三步）。
- [x] 2.2 `expandMaterializedField` leaf 上下文；setop ordinal 下沉；`sourceRelationId` = 物理 read relation。
- [x] 2.3 `project-task-local.ts`：bump `TASK_LOCAL_PROJECTION_SCHEMA_VERSION` 到 `1.3.0`；字段边用 `fieldDirectEdgeSemanticKey`；非 RESOLVED 100% 产 gap。
- [x] 2.4 `source-read-occurrence.test.ts`。

## 3. FE-2 subtype + 路径组合

- [x] 3.1 `subtype-classifier.ts` + `composePathSubtype`。
- [x] 3.2 投影发射集成 + `subtype-classifier.test.ts`。

## 4. FE-3 控制侧别（relation 子树）

- [x] 4.1 `dataset-controls.ts` + `dataset-controls.test.ts`。
- [x] 4.2 投影 `DATASET_CONTROL` 写入；`BOTH` → gap。

## 5. FE-1′ 临时表 gap（按表聚合）

- [x] 5.1–5.2 `materialization.test.ts` 181058 形态。

## 6. FE-B baseline

- [x] 6.1 `phase1-baseline-cli.ts`：cohort 键 `anchorExpansionBatch` / `shadowEvaluationSlice` / `all`。
- [x] 6.2 `no-literal-anchors.test.ts`。
- [x] 6.3 重投锚点展开批 + baseline + `openspec validate` + `npm test`（含 `phase1-acceptance.test.ts`）。

## 7. 登记（1.3.0 投影上线前，非 FE-0）

- [x] 7.1 `union-v2-field-value-provider.ts`、`union-continuation-candidate-source.ts`：接受 `>= 1.2.0`（含 `1.3.0`）。`gate-b-union.ts` 读取 `TARGET_TABLE_UPSTREAM_CAUSAL_CLOSURE`（非 task-local），无需改动。

## 不在本 change（Phase 2：`field-evidence-v1-impact-query`）

FE-4…FE-7：见 `execution-plan-field-evidence-v1.md` §6–§9。
