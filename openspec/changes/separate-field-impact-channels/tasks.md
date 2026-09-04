## 1. Contract

- [x] 1.1 将 `RowsetControlAnnotation` 换成 `DatasetControlAnnotation`：去掉 `nodeId`，键为 `task + relation + 控制字段`，增加 OpenLineage `subtype`、`masking` 与本地 `grain`。
- [x] 1.2 升高 `FIELD_LINEAGE_SCHEMA_VERSION`；canonicalize / counts / validate 同步拒绝旧 `rowsetControls[].nodeId` 与 `affectedRootFields`。
- [x] 1.3 映射现有 `controlType` 到 OpenLineage INDIRECT 词典（`JOIN | GROUP_BY | FILTER | SORT | WINDOW | CONDITIONAL`），不自造通道名。

## 2. Collection

- [x] 2.1 删除按 `node.nodeId` 调用的 `rowsetControlsFor`；改为每个 statement/relation 收集一次 `DATASET_CONTROL`。
- [x] 2.2 字段主循环只写 `VALUE_FLOW` 节点/边；`FIELD_CONDITIONAL` 仅在 `expression_roles` 含 `BRANCH_SELECTION` 时产生。
- [x] 2.3 实现 `grain` 粗档：`GROUP BY`/`DISTINCT`/`FILTER` → `REDUCE`；可证明一对一或多对一 JOIN → `PRESERVE`；证不出基数的 JOIN（含 INNER）→ `EXPAND_RISK`。LEFT 可空侧不得标 `PRESERVE`。JOIN 不得落 `UNKNOWN`。
- [x] 2.4 确认拉链 IS NOT NULL CASE 不进入 `FIELD_CONDITIONAL`；不改 `joinSideChannels()`、不改因果闭包播种。

## 3. Presentation

- [x] 3.1 `format-field-lineage.ts` 分列输出字段值流与 `DATASET_CONTROL`，不再把 JOIN 表算进字段上游表数。
- [x] 3.2 `field-lineage-visualize.ts` 同样分列统计与展示，不合并成单一「影响表数」。

## 4. Tests and gates

- [x] 4.1 夹具：155015 `internal_trade_id` 的 `FIELD_DIRECT` 不含四张 LEFT JOIN 参考表。
- [x] 4.2 夹具：这四张表在 Task 105387 目标写入上以 `DATASET_CONTROL / JOIN` 出现，并带 `grain`。
- [x] 4.3 夹具：`112715 → 114026 → 155015` 与 `71698 → 105387 → 155015` 值流不回退。
- [x] 4.4 用现有 Input Pack 重跑 155015 / 176827 / 209119：`nodes`/`edges` 不减少；209119 `field-lineage.json` < 3 MB；176827 < 2 MB。
- [x] 4.5 `npm run test:field-lineage`、`npm run typecheck`、`npm run build`、`npm run format:check` 全绿。
- [x] 4.6 `npm run test:target-table-causal-closure` 仍绿（回归，本 change 不得改闭包实现）。
