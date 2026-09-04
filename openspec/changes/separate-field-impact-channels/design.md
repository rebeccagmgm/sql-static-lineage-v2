## Context

See `proposal.md` Why。现状：`field-lineage.ts` 的 `rowsetControlsFor()` 以字段节点 `node.nodeId` 为键，沿 `expression.relation_id` 的 relation 祖先收集控制；单 SELECT 里所有输出字段共享同一 root relation，祖先集无区分度，于是每个字段都挂上全部 JOIN/FILTER。这是 OpenLineage 文档里的 legacy cartesian product。

P0 已在 `target-table-upstream-causal-closure` 把 `FIELD_VALUE` / `ROW_MEMBERSHIP` / `MULTIPLICITY` / `EXPRESSION_CONTROL` 立住，155015 拉链四张表是档二正例。本 change 不重做闭包播种，只改 field-lineage 消费投影与展示。关联范围第二轴（`FIELD_SCOPED` / `DATASET_SCOPED` / `SCOPE_DISJOINT`）明确不并入 WP-1。

权威执行说明：`docs/execution-plan-asset-graph.md` WP-1；架构：`docs/domain-asset-graph-architecture.md`「影响分类三档」。

## Goals / Non-Goals

**Goals:**

- 控制证据按 relation 收集一次，artifact 用 `DATASET_CONTROL` 承载。
- 字段通道与数据集通道分列；155015 / 体积门槛可机械核对。
- schema / canonicalize / validate / HTML 同步，旧 `rowsetControls + nodeId` 不再是合法主形态。

**Non-Goals:**

- 不改 SQLLens、Plan Facts、Machine Facts。
- 不改因果闭包 `joinSideChannels()`、拉链 `existenceCaseSelections()`、不勾闭包 2.3。
- 不做 WP-2 注释采集、WP-3 任务局部投影、WP-4 加工识别。
- 不做唯一键证明、行数估算、关联范围第二轴。
- 不把 zipper CASE 的 `EXPRESSION_CONTROL` 改标成 `FIELD_CONDITIONAL`；后者只对应 `BRANCH_SELECTION`。

## Decisions

### 1. 收集点从字段节点改到 relation，而不是事后去重

主循环对每个输出字段调用 `rowsetControlsFor(node)` 是体积和假阳性的同一根因。改为每个 statement/relation 收集一次 `DatasetControlAnnotation`，字段循环只写 `VALUE_FLOW` 节点/边。

替代方案是保留逐字段收集再按 `relationId` 去重。那仍会先构造笛卡尔积，也更容易把 `nodeId` 漏回契约，因此不采用。

### 2. 契约改名并升 schema，不做双写兼容层

`RowsetControlAnnotation` → `DatasetControlAnnotation`：去掉 `nodeId`，键改为 `task + relation + 控制字段`，增加 OpenLineage `subtype`、`masking`、本地 `grain`。`FIELD_LINEAGE_SCHEMA_VERSION` 从 `1.1.0` 升高。counts / canonicalize / validate 同步。

替代方案是保留 `rowsetControls` 字段名只改语义。旧产物和测试会把「还在字段节点上」读成合法，验收会漂，因此不采用。

### 3. OpenLineage 词典做投影，不另起通道名

| 本地（闭包已有） | field-lineage 投影 |
| --- | --- |
| `FIELD_VALUE` CONFIRMED | `FIELD_DIRECT` |
| `EXPRESSION_CONTROL` 且 `BRANCH_SELECTION` | `FIELD_CONDITIONAL`（INDIRECT/`CONDITIONAL`） |
| JOIN / FILTER / GROUP BY / SORT / WINDOW | `DATASET_CONTROL` + 对应 INDIRECT subtype |
| 拉链 IS NOT NULL CASE | 仍不是 `FIELD_CONDITIONAL`；行决定留在闭包 `ROW_MEMBERSHIP` |

`grain`：`GROUP BY`/`DISTINCT`/`FILTER`/`EXCEPT`/`INTERSECT` → `REDUCE`；能证明多对一或一对一 JOIN → `PRESERVE`；证不出基数的 JOIN（含 INNER）→ `EXPAND_RISK`。第一版不做唯一键证明，因此 JOIN 不会发 `PRESERVE`，也不把 INNER 落成 `UNKNOWN`。`grain !== "PRESERVE"` 时必须另写 `grainReason`（大写下划线常量，按分支一一对应），不得复用证据解析失败的 `reasonCode`，也不得把 `UNKNOWN` 当无原因兜底。`WINDOW` 仍是 `UNKNOWN`。

现有 `controlType` 对词典的落点（借鉴 OpenLineage Spark 生产者与 ScopeLineage，不自造 `SETOP`）：

| 现有 | subtype | grain | 依据 |
| --- | --- | --- | --- |
| `join` | `JOIN` | `EXPAND_RISK`（第一版证不出 `PRESERVE`） | OpenLineage INDIRECT；可空侧与 INNER 用 `grainReason` 区分，不把 INNER 落成 `UNKNOWN` |
| `filter` | `FILTER` | `REDUCE` | OpenLineage INDIRECT；过滤只会丢行不会增行，与 `EXCEPT`/`INTERSECT` 同档 |
| `aggregate` | `GROUP_BY` | `REDUCE` | OpenLineage INDIRECT；值聚合仍走 `FIELD_DIRECT`/`AGGREGATION` |
| `window` | `WINDOW` | `UNKNOWN` | OpenLineage INDIRECT |
| `distinct` | `GROUP_BY` | `REDUCE` | OpenLineage Spark 把 `Distinct` 收成 `GROUP_BY`（issue 3084） |
| `setop` + `UNION ALL` | 不发 `DATASET_CONTROL` | — | ScopeLineage 把 UNION 放在 `scope_graph` 不进 `logic_blocks`；OL Spark 的 Union 只做分支值流 |
| `setop` + `UNION`（去重） | `GROUP_BY` | `REDUCE` | Spark 把 `UNION` 编成 `Distinct`/`Aggregate` + `Union`，Distinct 仍走 `GROUP_BY` |
| `setop` + `EXCEPT`/`INTERSECT` | `FILTER` | `REDUCE` | 词典无集合差/交；语义是决定行是否留下，落最近的 `FILTER` |

`sourceText` 仍写 `UNION` / `UNION ALL` / `EXCEPT` / `INTERSECT`，需要算子原文时看这里，不另开 subtype。

替代方案是在 field-lineage 里再造 `rowDetermining` 或 `SETOP`。与共享不变量第 10 条冲突，因此不采用。

### 4. 金样断言钉在 155015，体积钉在 176827 / 209119

回归不得回退：`112715 → 114026 → 155015` 与 `71698 → 105387 → 155015`。新增：`internal_trade_id` 的 `FIELD_DIRECT` 不含四张拉链 ref；四张表在 105387 目标写入上以 `DATASET_CONTROL / JOIN` 出现并带 `grain`。体积：209119 `< 3 MB`、176827 `< 2 MB`，`nodes`/`edges` 不降。

测试入口：`npm run test:field-lineage`。不把因果闭包 176827 档位测试改成本 change 的完成条件。

本 worktree 用现有 Input Pack / Facts、`--no-prepare-facts`，并对齐旧产物的 `maxDepth` / `maxStates` / `maxPaths` 重跑后的实测：

| 任务 | 控制条数 | distinct relationId | 控制/relation | nodes | edges | 文件 |
| --- | --- | --- | --- | --- | --- | --- |
| 155015 | 78 → 38 | 25 → 21 | 3.12 → 1.81 | 91 → 91 | 77 → 77 | 272,006 → 199,366 B |
| 176827 | 4,376 → 502 | 202 → 210 | 21.7 → 2.39 | 538 → 538 | 441 → 441 | 10,828,563 → 1,440,236 B（1.37 MB < 2 MB） |
| 209119 | 11,783 → 711 | 219 → 339 | 53.8 → 2.10 | 951 → 1,048 | 814 → 911 | 23,290,979 → 2,822,962 B（2.69 MB < 3 MB） |

209119 的 `relationId` 从 219 增到 339，不是笛卡尔积回潮。收集点从「每个输出字段的 relation 祖先集」改成「每个 statement 整句」后，原先没落进某字段祖先路径的 JOIN/FILTER 也会被收进来。这是收集范围变化。

排除「还在按字段复制」的证据：711 / 339 ≈ 2.10，接近每 relation 的控制字段数；若仍按 137 个输出字段复制，量级会接近 137 × 339 ≈ 46,443，而不是 711。旧形态 11,783 / 219 = 53.8 才是逐字段复制。nodes / edges 增加 97 条，全部是已可达任务上多出来的 VALUE_FLOW 绑定（0 条旧节点被删），规格禁止减少、允许增加。

`grain` 不是 `PRESERVE` 时必须带独立的 `grainReason`（不复用证据解析失败用的 `reasonCode`）。209119 的 711 条全部有原因码，实测分布：`FILTER`/`REDUCE` 354、`JOIN`/`EXPAND_RISK` 334、`GROUP_BY`/`REDUCE` 23。JOIN 不再出现 `UNKNOWN`（334 = 原先 287 条可空侧 + 47 条 INNER）；`WINDOW` 才允许 `UNKNOWN`，这三个任务里没有窗口控制。

### 5. HTML / 摘要分列，不合并「影响表数」

`format-field-lineage.ts` 与 `field-lineage-visualize.ts` 分别统计值流节点/边与 `DATASET_CONTROL` 条数。页面不得把 JOIN 表算进字段上游表数。

## Risks / Trade-offs

- [旧 field-lineage JSON / 外部脚本读 `rowsetControls[].nodeId`] → schema 升高；validator 拒绝旧键。本仓库内测试与 formatter 一起改。不承诺对外双写。
- [把拉链 CASE 标成 `FIELD_CONDITIONAL` 会弄乱 P0] → spec 限定 `BRANCH_SELECTION`；拉链仍走闭包 `existenceCaseSelections()`。
- [grain 标太猛把 LEFT 可空 JOIN 写成 `PRESERVE`] → 证据不足一律 `EXPAND_RISK`/`UNKNOWN`。
- [体积门槛达不到是因为节点/边本身变大] → 完成定义禁止减 `nodes`/`edges`；若仍超 3 MB 先查是否还在按字段复制控制，不靠删图过门。
- [误改因果闭包] → 任务清单明确排除该目录；`npm run test:target-table-causal-closure` 作回归，不作为本包实现面。

## Migration Plan

1. 升 schema，改 contract / canonicalize / validate。
2. 改收集循环与注解类型；补 155015 通道断言。
3. 改摘要与 HTML 分列。
4. 用现有 Input Pack 重跑 155015 / 176827 / 209119，核体积与 `nodes`/`edges`。
5. 不写 `artifacts/tasks/*` 进 git；不重建 Facts。

回滚：还原 schema 与 `rowsetControlsFor` 调用点。无数据迁移。

## Open Questions

无。关联范围第二轴与 WP-3 投影留给后续 change。
