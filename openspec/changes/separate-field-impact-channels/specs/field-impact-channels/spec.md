## Purpose

把字段值影响与数据集控制拆成互不污染的两条通道，使 field-lineage 产物能回答「改哪列改值」而不把 JOIN/FILTER 复制进每个输出字段。

## ADDED Requirements

### Requirement: Dataset control is keyed once per relation and control field
系统 SHALL 将数据集控制存为独立通道 `DATASET_CONTROL`。每条控制的稳定键 MUST 为 `task + relation + 控制字段`，与受影响的输出字段数无关。系统 MUST NOT 按输出字段节点复制同一条控制，MUST NOT 产生 `affectedRootFields` 一类字段级控制断言。

#### Scenario: Same join is not copied onto every output field
- **WHEN** 一条语句有多个输出字段，且同一 JOIN 关系控制整张结果集
- **THEN** 该 JOIN 只作为一条 `DATASET_CONTROL` 出现，不按输出字段数重复

#### Scenario: Control annotations collapse toward distinct relations
- **WHEN** 209119 的 field-lineage 产物写盘
- **THEN** 控制注解条数与不同 `relationId` 同量级（比值接近每 relation 的控制字段数，约 1–3），且远小于输出字段数 × relation 数，而不是按字段复制后的数千条

### Requirement: Field channels use OpenLineage subtypes
字段值通道 SHALL 使用 `FIELD_DIRECT`；口径分支通道 SHALL 使用 `FIELD_CONDITIONAL`。`subtype` MUST 逐字采用 OpenLineage `ColumnLineageDatasetFacet` 词典：DIRECT 为 `IDENTITY | TRANSFORMATION | AGGREGATION`，INDIRECT 为 `JOIN | GROUP_BY | FILTER | SORT | WINDOW | CONDITIONAL`。`masking` SHALL 为布尔位。`FIELD_CONDITIONAL` MUST 仅在 `expression_roles` 命中 `BRANCH_SELECTION` 时产生。系统 MUST NOT 自造与该词典平行的通道名（包括 `rowDetermining`）。

#### Scenario: Zipper LEFT refs stay off the value channel
- **WHEN** 155015 根字段为 `internal_trade_id`
- **THEN** 其 `FIELD_DIRECT` 上游不含四张 LEFT JOIN 参考表（`d_ref_fx_forward` / `d_ref_fast_trs` / `d_ref_otc_option_deal` / `d_ref_trs`）

#### Scenario: Zipper refs appear as dataset join control
- **WHEN** 155015 在 Task 105387 的目标写入上收集 `DATASET_CONTROL`
- **THEN** 上述四张表以 `DATASET_CONTROL` 且 subtype `JOIN` 出现，并带 `grain`

### Requirement: Grain is a local coarse class only
`grain` SHALL 作为本地扩展，第一版只允许 `REDUCE`、`PRESERVE`、`EXPAND_RISK`、`UNKNOWN`。`GROUP BY` / `DISTINCT` MUST 记 `REDUCE`。只会丢行不会增行的算子（`FILTER`、`EXCEPT`、`INTERSECT`）MUST 记 `REDUCE`。可证明多对一或一对一的 JOIN MUST 记 `PRESERVE`。证不出基数的 JOIN（含 INNER）MUST 记 `EXPAND_RISK`，MUST NOT 记 `UNKNOWN`。一对多风险或证据不足的非 JOIN 算子（如 `WINDOW`）MUST 记 `EXPAND_RISK` 或 `UNKNOWN`。系统 MUST NOT 做唯一键证明，MUST NOT 估算行数。`grain` 不是 `PRESERVE` 时 MUST 带独立的非空 `grainReason`；该字段 MUST NOT 复用证据解析失败用的 `reasonCode`。

#### Scenario: Distinct reduces grain
- **WHEN** 控制算子是 `DISTINCT` 或 `GROUP BY`
- **THEN** 对应 `DATASET_CONTROL.grain` 为 `REDUCE`，且 `grainReason` 为 `GRAIN_GROUPING_REDUCES_ROWS`

#### Scenario: Filter reduces grain
- **WHEN** 控制算子是 `FILTER`
- **THEN** 对应 `DATASET_CONTROL.grain` 为 `REDUCE`，且 `grainReason` 为 `GRAIN_FILTER_MAY_DROP_ROWS`，MUST NOT 记 `UNKNOWN`

#### Scenario: Unproven join cardinality is expand risk
- **WHEN** JOIN 无法证明一对一或多对一
- **THEN** `grain` 为 `EXPAND_RISK`，不得标成 `PRESERVE` 或 `UNKNOWN`；可空侧带 `GRAIN_JOIN_NULLABLE_SIDE_MAY_EXPAND`，INNER / 未标可空侧带 `GRAIN_JOIN_CARDINALITY_UNPROVEN`

### Requirement: Artifact volume shrinks without dropping graph identity
系统 SHALL 在通道分离后降低控制注解体积，同时保持值流图身份。155015、176827、209119 的 `nodes` 与 `edges` 计数 MUST NOT 减少。209119 的 `field-lineage.json` MUST 降至 3 MB 以内；176827 MUST 降至 2 MB 以内。产物与页面 MUST 分列统计字段值流与数据集控制，不得合并成单一「影响表数」。

#### Scenario: 209119 volume gate
- **WHEN** 以现有 Input Pack / Facts 重跑 209119 field-lineage
- **THEN** `field-lineage.json` 小于 3 MB，且 `nodes` / `edges` 不少于改动前

#### Scenario: Renderer keeps two columns
- **WHEN** 打开 field-lineage HTML 或文本摘要
- **THEN** 字段值流与数据集控制分开计数和列表，不合成一个影响表总数
