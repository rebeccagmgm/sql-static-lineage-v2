## Why

当前 `field-lineage` 把 JOIN/FILTER 等数据集控制按 `node.nodeId` 复制到每个输出字段。209119 因此出现 11,783 条控制注解（仅 219 个不同 relationId，53.8 倍）和 `affectedRootFields` 假阳性；155015 的 `internal_trade_id` 值链也会沾上四张 LEFT JOIN 拉链表。P0 重跑收缩已过，通道语义已经在 `target-table-upstream-causal-closure` 里立住；现在要把同一套分类落到 field-lineage 产物，去掉笛卡尔积，而不是再发明一套词。

## What Changes

- 控制证据改为按 `task + relation + 控制字段` 存一次，不再挂到字段节点。
- `RowsetControlAnnotation` 换成 `DatasetControlAnnotation`；产物与页面把字段值流和数据集控制分列展示。
- `subtype` 与 `masking` 逐字采用 OpenLineage `ColumnLineageDatasetFacet`（spec v1.52.0）词典；`grain` 作为本地扩展，只做可证明的粗档。
- **BREAKING**（仅 field-lineage artifact / HTML）：去掉 `rowsetControls[].nodeId` 驱动的逐字段复制，以及 `affectedRootFields` 一类字段级控制断言。
- 不改 SQLLens、Plan/Machine Facts、因果闭包播种规则、`joinSideChannels()`，也不做 WP-2 注释采集或 WP-3 任务局部投影。

## Capabilities

### New Capabilities

- `field-impact-channels`: 把字段值影响（`FIELD_DIRECT` / `FIELD_CONDITIONAL`）与数据集控制（`DATASET_CONTROL` + `grain`）拆成互不污染的通道，并给出金样与体积门槛。

### Modified Capabilities

- `field-multi-hop-lineage`: 主树仍只含 `VALUE_FLOW`；行集/JOIN 控制不得再作为字段节点注解或值来源，改为独立的数据集通道。

## Impact

- `scripts/reconcile/consumer/field-lineage/`（`field-lineage.ts`、`field-lineage-contract.ts`、`format-field-lineage.ts`）与 `scripts/visualize/field-lineage-visualize.ts`。
- field-lineage 测试与 155015 / 176827 / 209119 产物体积。`nodes` / `edges` 计数不得减少。
- 因果闭包 consumer 与已发布的 10 份 data-graph `LEGACY_ARTIFACT_PAIRS` 快照不在本 change 范围内。
- 通道词典沿用闭包的 `FIELD_VALUE` / `ROW_MEMBERSHIP` / `MULTIPLICITY` / `EXPRESSION_CONTROL`；WP-1 只做 OpenLineage 投影，不得平行发明 `rowDetermining`。
