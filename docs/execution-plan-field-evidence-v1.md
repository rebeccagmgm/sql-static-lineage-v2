# 字段证据链 V1：执行方案（WP-11 · Phase 1–3 · 不物化闭包）

配套（本文件不覆盖、不替代以下任何一份）：

| 文档                                        | 读什么                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `domain-asset-graph-architecture.md`        | 机器单位（写观察×读次）、影响三档、第二正交轴、`affectedRootFields` 停用理由 |
| `execution-plan-gold-case-investigation.md` | 四锚点并集图 GC-0…GC-5，本文件的原料来自它的产物                             |
| `execution-plan-task-local-projection.md`   | WP-3 纸条契约 1.2.0（本文件升到 1.3.0）                                      |
| `execution-plan-task-local-union.md`        | WP-5 并集 + WP-8 接续 INDEX（本文件的跨任务 resolve 只消费它，不改它）       |
| `execution-plan-rerun-shrink.md`            | 重跑三档（值必达 / 行决定 / 倍增风险）——CONTROL 的现有消费者                 |
| `graph-accuracy-architecture.md`            | WP-11 原登记项：`outputDerivationKind`、混合角色列、window 上下文列          |
| `graph-user-narrative.md`                   | L0–L3 对用户陈述                                                             |

本文件只解决一件事：

**把已经存在于任务局部投影里的字段事实（9,070 条值边、2,204 条控制边）从「静态解析结果」提升为「可跨任务、可解释、可诚实标注不确定性的证据链」，并用四锚点真数据验证一次 Impact Query——不新增节点类型、不物化任何闭包、不做算子全矩阵。**

### 修订记录

| 日期       | 修订                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04 | 首版：Phase 1–3 一体方案，OpenSpec change `field-evidence-v1` 含 44 任务                                                                                                                                                                                                                                                                                                                    |
| 2026-09-04 | **深扫修订**（扫 186 投影 + 344 Facts 任务后）：① OpenSpec change 裁为**纯 Phase 1**；② FE-1 物化折叠 leaf + setop 下沉；③ `sourceRelationId` = 物理 read relation；④ 路径 subtype；⑤ relation 子树侧别；⑥ 临时表 gap 按表聚合；⑦ READS 校验 `≥ 1.2.0`；⑧ baseline 三组 cohort：**锚点展开批 186 / shadow evaluation slice 158 / all 344**（非 gold/holdout 标注集）。见 §2.5–2.6、§5、§5.5 |

---

## 0. 一页摘要

### 要什么

对任一锚点写观察的任一输出列，回答两个问题并给出证据：

```text
问题 A  这个字段的值怎么来的？         → VALUE 链（IDENTITY / TRANSFORMATION / AGGREGATION）
问题 B  什么因素会让这个字段的结果变？  → VALUE 链 ∪ CONTROL（带该列的作用域 scope）
```

跨任务时经 WP-8 `UNION_CONTINUATION_INDEX` 解析到具体写观察；解析不唯一 → **CANDIDATE frontier，不再递归**；证不出 → 具名 gap。

### 三句话

1. **修粒度**：字段边补 `sourceReadOccurrenceId` + `sourceRelationId` + `expressionId`，让字段级回到「写观察 × 读次」单位，与 INDEX 可对接。
2. **补语义**：值边 `subtype` 从 100% `UNKNOWN` 落到三分类（硬规则，不扯皮）；控制边补 `joinType` + `controlSide`，让「侧别」可算。
3. **查询期投影**：Impact Query 在查询时把 CONTROL 按列标注 `FIELD_SCOPED / DATASET_SCOPED / SCOPE_DISJOINT`，**不落盘、不生成字段级控制边**。

### 当前阶段（2026-09-04）

| 项                                                                        | 状态                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 字段事实存在性（真数据实测）                                              | **已确认**（§2.1）                                                      |
| 两跳数据可达性（四锚点）                                                  | **已确认** 66/67、121/122、45/52、14/14（§2.2）                         |
| 简单子树读次算法实测                                                      | **已测** 63.29%（5,740/9,070）；181058 仅 11.56% ← 折叠丢上下文（§2.5） |
| SQL 结构全库分布（防过拟合）                                              | **已测** setop 40% / 同表多读 47% / LEFT 49% / 物化 10%（§2.6）         |
| OpenSpec change 裁为纯 Phase 1                                            | **已完成**（`field-evidence-v1`）                                       |
| 契约 1.3.0                                                                | **已完成**（FE-0 + FE-1 同 PR bump）                                    |
| Phase 1 派生（折叠 leaf + setop 下沉 + 路径 subtype + relation 子树侧别） | **已完成**（FE-1…FE-3 + FE-1′）                                         |
| Phase 1 baseline（三组 cohort）                                           | **已完成**（`phase1-baseline.json`）                                    |
| OpenSpec change `field-evidence-v1-impact-query`（Phase 2）               | **已完成**（FE-4…FE-8；金样 A–E + `test:field-evidence` + `field-evidence:query`） |
| OpenSpec change `field-evidence-schedule-preference`（Phase 2.5）         | **已完成**（frontier Horae 推荐排序；`FIELD_IMPACT_RESULT` 1.1.0）       |

### 立刻做什么（顺序）

```text
① 改 OpenSpec change 为纯 Phase 1（删 FE-4…FE-8 任务，钉死 §5 定义）
② FE-0  契约 1.3.0 一次升版；1.2.0 READS 校验不放松
③ FE-1  expandMaterializedField 带回 leaf expression/read relation；setop 按 ordinal 下沉；AMBIGUOUS 分原因码
④ FE-2  subtype 按物化路径组合
⑤ FE-3  joinType / controlSide 用 relation id 子树
⑥ FE-1′ 临时表 gap 按表聚合
⑦ 四项检查 + phase1-baseline.json（anchorExpansionBatch 186 / shadowEvaluationSlice 158 / all 344）
⑧ 按 §5.5 判据决定是否开 Phase 2 change
```

---

## 1. 问题与目标

### 1.1 解决什么

- 字段级与表级**单位不一致**：表级坚持「写观察 × 读次」，字段边却只有 `(表, 列)`，接不上 INDEX。
- 值边**没有语义**：`select a`、`sum(a)`、`coalesce(a,0)`、`a*b` 在图上同形。
- 控制**停留在写观察级**：JOIN/FILTER 事实齐全，但对某一列「为什么受影响」讲不出侧别。
- 多 writer 是常态（7～10 个），产品若只画确定线，上线即「看起来很空」；需要一个诚实的 CANDIDATE 呈现契约。

### 1.2 不解决什么

- 不做全列覆盖、不做 100% 跨任务 FIELD 闭合
- 不做算子全矩阵（CASE/CAST/COALESCE/WINDOW/ARITHMETIC 各成一类）
- 不新增节点类型（`FieldBinding` 不是节点，见 §3）
- 不恢复 `affectedRootFields`、不生成字段级控制边（`FIELD_IMPACT_EDGE` 一类）
- 不改 SQLLens / Plan Facts / Machine Facts 发布器
- 不改 WP-8 INDEX 契约（只消费）
- 不上 Neo4j、不做 HTML

---

## 2. 实测基线（2026-09-04，四锚点穿透批 · 186 PROJECTED + 28 SCHEDULE_ONLY）

### 2.1 字段事实规模

| 指标                      | 数值                                            |
| ------------------------- | ----------------------------------------------- |
| `FIELD_DIRECT`            | 9,070（subtype 100% `UNKNOWN`）                 |
| `FIELD_CONDITIONAL`       | 201                                             |
| `DATASET_CONTROL`         | 2,204（JOIN 873 / FILTER 1,211 / GROUP_BY 120） |
| `PHYSICAL_FIELD` 出现次数 | 7,691（去重 4,683，重复率 1.64）                |
| identity `CONFIRMED`      | 7,477（97%）                                    |
| 有字段边的任务            | 182 / 186                                       |
| 投影总大小                | 10.4 MB（214 文件）                             |
| INDEX                     | 535 条目，候选均值 1.33，最大 10；0.9 MB        |

### 2.2 两跳可达性（锚点输入字段 → 批内 producer 是否有同名输出列 binding）

| 锚点   | 输入字段 | 可接到 producer binding | 断点                                                                             |
| ------ | -------- | ----------------------- | -------------------------------------------------------------------------------- |
| 176827 | 67       | 66                      | `pdata_n.ref_cd_cvt_map` 未投影（终止表）                                        |
| 209119 | 122      | 121                     | 同上                                                                             |
| 181058 | 52       | 45                      | 7 个卡在 `dm_rsk_n.otc_opt_inr_comp_pal_sum_temp`（writer 在批内；Facts 有物化桥，1.2.0 投影未用全/字段链在 temp 仍断） |
| 155015 | 14       | 14                      | —                                                                                |

结论：**数据层面多跳骨架已在**。缺的不是事实，是粒度、语义、侧别与查询契约。

### 2.3 当前字段边的形状（问题所在）

```text
FIELD_DIRECT
  from  PHYSICAL_FIELD(qualifiedName, column)          ← 全局身份，无读次
  to    TARGET_WRITE(writeObservationId)
  properties { bindingId, outputColumn, subtype: "UNKNOWN" }

DATASET_CONTROL
  from  PHYSICAL_FIELD
  to    TARGET_WRITE
  properties { subtype: JOIN|FILTER|GROUP_BY, grain, grainReason, relationId, statementId, writeObservationId }
                                                       ← 无 joinType、无侧别
```

`field-expression-nodes.jsonl` 的 `input_fields[]` 只带 `(table, column, field_id)`，读次需经 `expression.relation_id` 沿 relation 树回推；`relation-nodes.jsonl` 的 join relation 已带 `join_type` 与 `left / right` relation id（176827：16 个 join，inner 6 / left 10）。**所需原料都在 Facts 里，不需要新解析。**

### 2.4 一个被当前形状抹平的结构：UNION 分支

176827 是 `setop.b0 UNION setop.b1`：b0 为 OTC 期权支（经 `pdata_nds.pos_eod_position_view` 等 LEFT JOIN 链），b1 为 `t98_sb_tit_day_hold_indx` 支（INNER JOIN）。输出列 `gamma` 的 7 个来源同时含 b0 的 `pos_eod_position_view.gamma` 与 b1 的 `t98_sb_tit_day_hold_indx.gamma`——当前按 `outputColumn` 合并，分支信息丢失。补 `sourceRelationId` 后可区分，且为 `SCOPE_DISJOINT` 提供**可证明**的判据（§6.3）。

### 2.5 简单子树算法的实测（写代码前先扫，决定 FE-1 形态）

对 186 个投影，用「`expression.relation_id` 子树内 `relation_type = read` 且物理表同名」这条最朴素规则跑一遍读次派生：

| 指标                    | 数值                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| RESOLVED                | **5,740 / 9,070 = 63.29%**                                                           |
| AMBIGUOUS               | 2,209（同表多读次无法归属）                                                          |
| UNRESOLVED              | 1,121（子树内无该表读）                                                              |
| 四锚点各自 RESOLVED     | 155015 100% · 176827 57.78% · **181058 11.56%** · 209119 92.13%                      |
| 181058 的 450 条值边    | **354 条经物化折叠**——折叠后 `expression.relation_id` 指向临时表写语句，丢了原上下文 |
| 176827 setop 顶层表达式 | 57 列都挂在 `setop` relation 上，两支同表读被视为多读次                              |
| 181058 临时表读边       | 42 条值边、6 个写观察、7 列                                                          |
| JOIN 控制边             | 355（LEFT 271 / INNER 50 / FULL 34）；按物理表后缀判侧时 76 条两侧皆不匹配           |

三条结论直接改写 §5：

1. **物化折叠必须带回 leaf 上下文**（leaf expression、leaf read relation、路径是否经聚合），否则 181058 一类多语句任务永远单位数。
2. **setop 顶层不能按输出列合并**：要按 ordinal 下沉到每一支的 `select` 表达式，逐支产 RESOLVED 边。
3. **侧别不能靠表名后缀**：要用 `left / right` relation id 的子树成员关系。

### 2.6 全库结构分布（344 Facts 任务，防过拟合）

| SQL 结构                 | 任务数 / 344 | 说明                                                         |
| ------------------------ | ------------ | ------------------------------------------------------------ |
| UNION / setop            | 137（40%）   | 最大 32 支；`setop` 是全库结构，不是 176827 特例             |
| 同表多读次（自连接等）   | 162（47%）   | 最多 64 次读                                                 |
| LEFT / RIGHT / FULL JOIN | 169（49%）   | 侧别问题是全库问题                                           |
| 任务内物化               | 35（10%）    | 最多 8 条；181058 属于这 10%，比例小但**没它 181058 单位数** |
| CTE                      | 53（15%）    |                                                              |
| Window                   | 37（11%）    |                                                              |

四锚点展开批（186）之外还有 **158 个任务构成 shadow evaluation slice**（344 − 186）：派生规则设计时未针对它们调参，baseline 必须同时在两组上跑，检查规则是否只服务于锚点形态——**这不是独立人工标注集，只是结构性泛化 sanity check**（§5.5）。

---

## 3. 概念模型：四原语 + 派生身份

### 3.1 Canonical（落盘，仅此四类事实）

```text
WriteObservation     TARGET_WRITE 节点，writeObservationId          已有
ReadOccurrence       READ_OCCURRENCE 节点，readOccurrenceId           已有
FieldEdge            FIELD_DIRECT / FIELD_CONDITIONAL 边（1.3.0 补属性）  改
DatasetControlFact   DATASET_CONTROL 边（1.3.0 补属性）                 改
```

### 3.2 派生身份（契约里写明，不是节点）

```text
FieldBinding  := (writeObservationId, outputColumn)
                 从现有 bindingId 可得；对外可展示为 <table>.<col>@<taskId>
ReadField     := (readOccurrenceId, column)
                 Impact Query 的 resolve 输入端
```

### 3.3 明确不加的东西

| 不加                              | 原因                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| `FieldBinding` 节点类型           | 派生即可；加节点 = 概念通胀起点                               |
| 字段级控制边（`控制列 → 输出列`） | 209119 实测 53.8 倍重复；四份文档硬约束；行集控制天然按写观察 |
| `Effect Graph` 作为存储图         | 它是查询期投影（§6），不是一层存储                            |
| 第四类 subtype                    | 三类之外一律 `UNKNOWN` + 原因码，宁失精度不开口子             |

---

## 4. 契约变更：`TASK_LOCAL_PROJECTION` 1.2.0 → 1.3.0（一次升版）

三项属性**同一次**进契约。任何一项单独 bump 都会让全量缓存多失效一次。

### 4.1 `FIELD_DIRECT` / `FIELD_CONDITIONAL` 新增属性

| 属性                         | 类型                                                   | 说明                                                                                                                               |
| ---------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sourceReadOccurrenceId`     | `string \| null`                                       | 该输入字段来自本任务哪一次物理读；派生失败为 `null`                                                                                |
| `sourceReadOccurrenceStatus` | `RESOLVED \| AMBIGUOUS \| UNRESOLVED`                  | `AMBIGUOUS`：同表多读次且无法唯一归属（自连接、分区 UNION）                                                                        |
| `sourceRelationId`           | `string \| null`                                       | **匹配到的物理 read relation id**（不是 `expression.relation_id`）；由它沿祖先链可判 setop 分支 / join 侧；未 RESOLVED 时为 `null` |
| `expressionId`               | `string`                                               | 回溯 `field-expression-nodes` 的证据锚点                                                                                           |
| `subtype`                    | `IDENTITY \| TRANSFORMATION \| AGGREGATION \| UNKNOWN` | 类型已在 `TaskLocalDirectSubtype`，1.3.0 起要求非 `UNKNOWN` 或附 `subtypeReason`                                                   |
| `subtypeReason`              | `string?`                                              | 仅 `UNKNOWN` 时必填（§5.2 码表）                                                                                                   |

`FIELD_CONDITIONAL` 的 `subtype` 保持 `CONDITIONAL`，其余新属性同样必填。

### 4.2 `DATASET_CONTROL` 新增属性

| 属性                                 | 类型                                             | 说明                                                      |
| ------------------------------------ | ------------------------------------------------ | --------------------------------------------------------- |
| `joinType`                           | `INNER \| LEFT \| RIGHT \| FULL \| CROSS \| N/A` | 仅 `subtype = JOIN` 时非 `N/A`；来自 `relation.join_type` |
| `controlSide`                        | `LEFT \| RIGHT \| BOTH \| N/A`                   | 该控制列位于 join 的哪一侧；FILTER/GROUP_BY 为 `N/A`      |
| `leftRelationId` / `rightRelationId` | `string?`                                        | 仅 JOIN；来自 `relation.left / right`                     |

### 4.3 `localClosure.localFieldPaths`

当前 176827 为空数组（1.2.0 未填）。1.3.0 不扩展其语义，但要求：有 `task-local-materializations` 桥接时必须填 `materializationBridgeIds`；无桥接而字段来源是任务内临时表时，产 gap（§5.4）。

### 4.4 校验规则（`validateTaskLocalProjection` 新增）

1. 1.3.0 的字段边缺任一新属性 → 校验失败
2. `subtype = UNKNOWN` 且无 `subtypeReason` → 失败
3. `subtype = JOIN` 且 `joinType = N/A` → 失败
4. 仍然拒绝：跨任务边、`affectedRootFields`、`rowsetControls`、任何 `控制列 → 输出列` 的字段级边
5. 1.2.0 投影继续可读（legacy），但 Impact Query 对 1.2.0 输入直接返回 `CONTRACT_TOO_OLD` gap，不降级猜测
6. **1.2.0 的 READS 边校验保持原样**：当前 `contract.ts` 用「`schemaVersion === TASK_LOCAL_PROJECTION_SCHEMA_VERSION`」判断是否要求 `readOccurrenceId`；升到 1.3.0 后必须改为 **`≥ 1.2.0`**，否则 1.2.0 投影会静默放松。需一条回归测试锁住。

### 4.5 成本声明

`projectionContentHash` 变化 → 已缓存投影**全部失效一次**。186 任务分钟级；全库 13.7k 任务小时级。这是排期项，不是技术风险；**所以只允许升一次版**。

### 4.6 FE-0 实施策略（契约先行，常量 bump 跟投影）

FE-0 **只落地契约层**，不扩到派生逻辑：

| 项                                          | FE-0             | FE-1 同 PR（投影发射） |
| ------------------------------------------- | ---------------- | ---------------------- |
| `contract.ts` 支持 1.3.0 类型与校验         | ✓                | —                      |
| `TASK_LOCAL_PROJECTION_SCHEMA_VERSION` 常量 | FE-0 暂留 `1.2.0`；**FE-1 同 PR bump 到 `1.3.0`**（已合入） | bump 到 `1.3.0`        |
| `project-task-local.ts` 发射 1.3.0          | ✗                | ✓                      |
| `fieldDirectEdgeSemanticKey` helper         | ✓                | 调用方写入 semanticKey |
| `gate-b-union` 等 consumer 接受 1.3.0       | ✗（登记）        | 1.3.0 投影上线前另改   |

校验分支：`schemaVersion >= 1.2.0` → READS 两跳 + `readOccurrenceId`；`schemaVersion === 1.3.0` → 字段边新属性、`gaps[]`、控制侧别。1.1.0 / 1.2.0 继续可读，不补 1.3.0 字段。

fail-closed：`sourceReadOccurrenceStatus ≠ RESOLVED` → 必填 `sourceReadOccurrenceReason`；`subtype = UNKNOWN` → 必填 `subtypeReason`；每条 `gaps[]` 条目必填 `gapId + reasonCode + details`。

---

## 5. Phase 1：三项派生 + 一个具名断链

### 5.1 FE-1 `sourceReadOccurrenceId` 派生

原料：`field-expression-nodes.input_fields[].(table, column)`、`expression.relation_id`、`relation-nodes` / `relation-edges`（relation 树）、`dataset-io.read_occurrences[]`（`relation_id → read_occurrence_id`）。

**两个前置改动**（§2.5 结论 1、2），没有它们朴素算法只到 63%：

```text
(a) 物化折叠带回 leaf 上下文
    project-task-local.ts 的 expandMaterializedField(...) 现在只返回 (table, column)；
    改为返回 { table, column, leafExpressionId, leafRelationId, pathHadAggregation }
    —— leafRelationId 是折叠链末端（真正读物理表的那条语句）的 expression.relation_id。
    读次派生一律用 leafRelationId，不用被折叠掉的顶层 relation_id。

(b) setop 按 ordinal 下沉
    若 E.relation_id 指向 relation_type = setop：
      对每一支 b_k，取 b_k 内 select list 第 ordinal(E) 位的表达式 E_k（按 output_column ordinal 对齐）
      对每个 E_k 独立执行下面的派生，各产一条边（sourceRelationId 因此天然区分分支）
    下沉找不到 E_k（列数不齐 / 分支非 select）→ AMBIGUOUS，reason SETOP_BRANCH_UNRESOLVED
```

核心派生：

```text
for each FieldEdge (leaf expression E, input field (T, C)):
  先 setop 按 ordinal 下沉（含嵌套 setop 递归到非 setop 叶）；下沉后仅保留
  该支表达式 input_fields 含 (T,C) 的配对——禁止顶层合入 sources × 各支的笛卡尔积。
  S0 := relation 子树(E.relation_id) 内所有 relation_type = read 且 physical table = T 的 relation
  S  := 按 Facts scope_id 过滤：表达式不在某 CTE body（`.(child)` scope）内时，丢弃该 CTE body 内的读
  R  := S 对应的 read_occurrence_id 集合
  |R| = 1  → RESOLVED
             sourceReadOccurrenceId = R[0]
             sourceRelationId       = S[0].relation_id          ← 物理 read relation，非 E.relation_id
  |R| > 1  → 用 qualifier 收窄（优先级）：
               1) input_fields.qualifier / alias
               2) expression_text 中 `alias.column`（对齐 legacy field-lineage）
               命中 binding / scope 末段 / relation path 段且唯一 → RESOLVED
             否则 AMBIGUOUS, sourceReadOccurrenceId = null, sourceRelationId = null
               reason  SELF_JOIN_NO_QUALIFIER   （同表多读、输入引用无别名）
               gap     FIELD_SOURCE_READ_OCCURRENCE_AMBIGUOUS
  |R| = 0  → UNRESOLVED
               reason  CTE_SCOPE_UNRESOLVED     （子树内无该表读，通常是 CTE/派生表作用域映射失败）
               gap     FIELD_SOURCE_READ_OCCURRENCE_UNRESOLVED
```

`sourceReadOccurrenceReason` 只在非 RESOLVED 时必填，码表：`SETOP_BRANCH_UNRESOLVED | SELF_JOIN_NO_QUALIFIER | CTE_SCOPE_UNRESOLVED | MATERIALIZATION_LEAF_MISSING`（最后一条：折叠链末端缺 leaf 上下文，指向 FE-1′）。

scope 过滤、qualifier 提取与 setop 支内 source 过滤对齐 Plan/Facts 结构，**不**按任务/表特例。**禁止**在 `|R| > 1` 时取第一个。**禁止**派生代码出现任务 id、表名、列名字面量（§5.5 有 lint 测试）。

Facts 层若将来在 `input_fields[]` 直接带 `source_relation_id`，FE-1 的子树搜索退化为查表——这是**独立的 Facts 增强 WP**，不在 Phase 1 内，Phase 1 不等它。

### 5.2 FE-2 `subtype` 三分类（硬规则）

| 判定             | 规则                                                                       | 例                                           |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| `IDENTITY`       | 表达式为**裸列引用**，允许别名、允许 `AS`                                  | `a.price`, `price AS pric`                   |
| `AGGREGATION`    | 表达式含聚合函数，或所在 relation 为 aggregate/GROUP BY 上下文             | `sum(price)`, `count(1)`, `max(dt)`          |
| `TRANSFORMATION` | 其余一切**有物理输入**的表达式：函数包裹、算术、CAST、COALESCE、字符串拼接 | `cast(a as decimal)`, `a*b`, `coalesce(a,0)` |
| `UNKNOWN`        | 仅当上述均判不出，**必附** `subtypeReason`                                 | 见下表                                       |

`subtypeReason` 码表：

| 码                              | 含义                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `EXPRESSION_TEXT_UNPARSEABLE`   | 表达式文本无法分类                                                                                               |
| `MIXED_ROLE_COLUMN`             | 同一输入列既在值表达式又在条件里，且无法拆分（WP-11 原登记项）                                                   |
| `WINDOW_CONTEXT_ONLY`           | 输入列仅出现在 `PARTITION BY / ORDER BY`，**不进值流**（此时应无 FIELD_DIRECT 边；若已有，标此码并在 FE-2 修掉） |
| `INPUT_DEPENDENCY_NOT_PHYSICAL` | `input_dependency_status ≠ PHYSICAL`                                                                             |

**物化路径组合**（§2.5 结论 1 的 subtype 侧）：经折叠的边不看单个表达式，看整条路径：

```text
subtype(path) :=
  路径上任一跳含聚合（pathHadAggregation）      → AGGREGATION
  否则路径上任一跳非裸列引用                    → TRANSFORMATION
  否则（每一跳都是裸列 / 别名）                 → IDENTITY
```

例：临时表 `t.amt := sum(x.amt)`，最终 `select t.amt` → `AGGREGATION`，不是 `IDENTITY`。路径上任一跳 `UNKNOWN` → 整条 `UNKNOWN`，`subtypeReason` 取该跳原因。

两条边界：

- **CONSTANT 不生源边**：`select 'Y' as flag` 无输入字段，不产生 `FIELD_DIRECT`；若历史投影有，1.3.0 删除。
- **CASE/IF 走 `FIELD_CONDITIONAL`**：分支选择列已在 201 条 `FIELD_CONDITIONAL` 里，值分支列按上表分类，不合并为一类。

完成定义附带一个**分布留档**：176827 的 57 列、四锚点全部输出列的 subtype 分布写入 `artifacts/…/field-subtype-distribution.json`。这不是 KPI，是让 §9 止损判定有数。

### 5.3 FE-3 `DATASET_CONTROL` 补 `joinType / controlSide`

原料：`relation-nodes` 中 `relation_type = join` 的 `join_type`、`left`、`right`；`dataset-io.read_occurrences[].relation_id`；控制列本身的 read relation（经 `condition_columns[].qualifier` 或 `dataset-controls.ts` 已有的列→读次映射）。

```text
for each DATASET_CONTROL(subtype = JOIN, relationId = J):
  joinType := upper(J.relation.join_type)
  Rc := 控制列所属的物理 read relation id（不是表名）
  controlSide :=
    Rc ∈ subtree(J.left)  且 Rc ∉ subtree(J.right) → LEFT
    Rc ∈ subtree(J.right) 且 Rc ∉ subtree(J.left)  → RIGHT
    Rc 无法唯一定位（自连接无别名 / 列→读次映射失败）→ BOTH, gap CONTROL_SIDE_UNRESOLVED
for FILTER / GROUP_BY: joinType = N/A, controlSide = N/A
```

**禁止按物理表名后缀判侧**：§2.5 实测 355 条 JOIN 控制边里 76 条用表名两侧都不匹配（同表两侧、别名、CTE），只有 relation id 子树成员关系可靠。`dataset-controls.ts` 的 `DatasetControlAnnotation` 因此要多带 `joinType / leftRelationId / rightRelationId / controlSide`。

`grain` 规则不变（`PRESERVE / REDUCE / EXPAND_RISK`）。

### 5.4 临时表断链具名

181058 读 `dm_rsk_n.otc_opt_inr_comp_pal_sum_temp`，实测 **42 条值边、6 个写观察、7 列**——writer 在批内；Facts 侧 `task-local-materializations` 有 RESOLVED 桥，但 1.2.0 投影折叠/字段链未串全，7 列 metadata 在 temp 上仍表现为未折叠读。Phase 1 **不修**，只让它可见（`TASK_LOCAL_MATERIALIZATION_FIELD_BREAK`）。

因为一张临时表对应多条读、多个写观察，gap **按 `(taskId, physicalDataset)` 聚合**，一个投影内每张临时表只产一条：

```text
gap TASK_LOCAL_MATERIALIZATION_FIELD_BREAK
  details {
    taskId, physicalDataset,
    columns[]              // 去重、排序
    affectedEdgeCount      // 42
    writeObservationIds[]  // 6 个，排序
    materializationRecords // task-local-materializations 里该表条目数，0 表示桥接缺失
  }
```

不放 `readOccurrenceId`（一对多，放了就得多条或任选一条）。出现在该任务的 `localClosure` gap 列表；Phase 2 Impact Query 原样透传到 `gaps[]`。修复归 WP-4/后续，不在本文件排期。

### 5.5 Phase 1 完成判据与 baseline 口径（可量化，不可放宽）

**分母固定**：`resolvedDirectRatio := RESOLVED 的 FIELD_DIRECT / 全部发出的 FIELD_DIRECT`。`FIELD_CONDITIONAL` 单独统计 `resolvedConditionalRatio`，不并入。

**三组 cohort 同时跑**（`artifacts/field-evidence-v1/phase1-baseline.json`）：

| cohort key              | 任务 | 含义                                                                |
| ----------------------- | ---- | ------------------------------------------------------------------- |
| `anchorExpansionBatch`  | 186  | 四锚点上游展开批；规则设计时深挖过的 design corpus                  |
| `shadowEvaluationSlice` | 158  | 344 − 186；派生代码未针对它调参；结构性泛化检查，**非标注 holdout** |
| `all`                   | 344  | Facts 全库                                                          |

每组产出：`resolvedDirectRatio`、`resolvedConditionalRatio`、`subtypeDistribution`、`ambiguousReasonCodes{}`、`unresolvedReasonCodes{}`、`joinSideDistribution`、`materializationBreakCount`、四锚点各自比例。

**完成判据**（全部满足才开 Phase 2 change）：

1. `anchorExpansionBatch.resolvedDirectRatio` 与 `shadowEvaluationSlice.resolvedDirectRatio` **同向上升**，且 shadow 提升幅度不低于 anchor 提升幅度的一半——否则疑似锚点特判，回修规则而不是开 Phase 2
2. 181058 的 RESOLVED 比例脱离单位数（11.56% → 至少与 anchor 批均值同量级）
3. 100% 的 `AMBIGUOUS / UNRESOLVED` 边有对应 gap；100% 的 `UNKNOWN` 有 `subtypeReason`
4. 176827 的全部 `DATASET_CONTROL` JOIN 边有 `joinType`（Facts 约 **16 个 join relation**；投影上 JOIN control 边更多，因按控制列展开）；`controlSide === BOTH` 的均有 `CONTROL_SIDE_UNRESOLVED` gap
5. 不写死目标比例（不承诺 80%）；把「简单子树 63.29%」作为对照线留档

**防过拟合硬约束**：

- 派生代码（`project-task-local.ts` 与新增模块）中**不得**出现任何任务 id、表名、列名字面量；加一条 lint 测试扫源码
- 金样断言写**不变量**（有 RESOLVED 就有非空 `sourceRelationId`；AMBIGUOUS 必有 gap；setop 各支各有边），不写具体边数
- 176827 / 181058 之外再从 shadow evaluation slice 随机抽 2 个含 setop 与物化的任务进 Phase 2 不变量金样（任务 id 只出现在 fixture 路径，不出现在代码）

---

## 6. Phase 2：Impact Query（查询期投影，不落盘）

### 6.1 签名

```text
impactQuery({
  unionRoot,                  // 并集投影目录（tasks/<id>/task-local-projection.json）
  indexPath,                  // union-continuation-index.json
  anchor: { taskId, writeObservationId, outputColumn },
  maxDepth = 3,
  budget: { maxEdges = 5000, maxFrontier = 200 },
  expandCandidates = false    // 默认 CANDIDATE 不递归
}) → ImpactResult
```

### 6.2 算法

```text
1. 起点  anchor 写观察上 outputColumn 的全部 FieldEdge → VALUE 层 0
2. 控制  anchor 写观察上的全部 DATASET_CONTROL（共享，不复制）→ 对每条按 §6.3 计算 scope
3. 递归（深度 d < maxDepth）
   对每条 VALUE 边（及 FIELD_SCOPED 控制列自身的值链）：
     key := (sourceReadOccurrenceId, column)
     若 sourceReadOccurrenceStatus 为 AMBIGUOUS / UNRESOLVED → 拷贝 Phase 1 读次 gap，停在此分支
     （未折叠 temp 读次可为 RESOLVED；materialization break 见下条，不单凭 status 停）
     若当前任务 gaps[] 含 TASK_LOCAL_MATERIALIZATION_FIELD_BREAK 且本跳 source 表 = physicalDataset
       → 原样拷入 gaps[]，停在此分支（禁止改标 PRODUCER_NOT_PROJECTED）
     entry := INDEX[consumerTaskId = 当前任务, readOccurrenceId = key.ro]
     若 entry 不存在                     → gap PRODUCER_NOT_PROJECTED（终止表/未采集）
     candidates := entry.candidates
       |candidates| = 1 且 l1Eligible   → CONFIRMED 接续：
           在 producer 投影里取 **全部** FieldEdge where writeObservationId = c.wo 且 outputColumn = key.column
           （setop 下沉后同列多支，用 sourceRelationId / expressionId 区分；禁止只取第一条）
           无 → gap PRODUCER_BINDING_NOT_FOUND
           有 → 每条作为下一层 VALUE，继续
       否则                               → CANDIDATE frontier：
           frontier += { readField: key, candidates[] (每个带 partitionMatchStatus, reasonCode) }
           不递归（除非 expandCandidates = true，且每个候选各自计入预算）
4. 预算  超 maxEdges / maxFrontier / maxDepth → gap TRAVERSAL_BUDGET_EXCEEDED{ which, at }
5. 输出  边集（DAG）+ frontier + gaps；不输出路径列表
```

`needed(hop) = 值列 ∪ 控制列` 的口径沿用架构文档「重跑溯源」节：`FIELD_SCOPED` 的控制列进入递归，`DATASET_SCOPED` 的控制列**只记录、不递归**（其值链属重跑三档的「行决定」消费者，不属本查询）。

#### 6.2.1 调度推荐 vs CONFIRMED 接续（Phase 2.5）

多 writer 时 `frontier[].candidates[]` 可附带 Horae depth-1 推荐字段（`scheduleRelation` / `schedulePreferred`），数据源与 one-hop / multi-hop 相同：`schedule-evidence/tasks/<taskId>/horae-relation-up-depth-1.json` 或 artifact `scheduleEdges`。

| 项 | 调度推荐 | CONFIRMED 接续 |
| -- | -------- | -------------- |
| 触发 | INDEX 多候选或 `l1Eligible=false` → frontier | INDEX 唯一候选且 `l1Eligible=true` + producer binding |
| Horae 作用 | 排序与 UI 标记（★） | **不参与** |
| `evidenceStatus` | 仍为 `CANDIDATE`（默认不递归） | `CONFIRMED` |
| 多 Horae 父 | 全部 `schedulePreferred=false` + gap `SCHEDULE_PARENT_AMBIGUOUS` | — |

**禁止**：因 Horae 有边而改 `l1Eligible`、自动 depth+1、把 frontier 标成 CONFIRMED，或向 `TASK_LOCAL_PROJECTION` 写入 TASK→TASK 数据边。

#### 6.2.2 Continuation rules pipeline（Phase 2.6）

INDEX 只枚举可能 writer；分区与调度解释统一经 `applyContinuationRules()`（`scripts/project-graph/field-evidence-v1/continuation/`）。

| 阶段 | 规则 | 能力 | 行为 |
| ---- | ---- | ---- | ---- |
| PRUNE | `PRUNE_DISJOINT` | PRUNE_ONLY | 丢弃 INDEX `DISJOINT` |
| REMATCH | `PARTITION_REMATCH` | MAY_MARK_ELIGIBLE | `matchProducersByReadScope` 重算 `partitionOverlap` |
| REMATCH | `SCHEDULE_TIEBREAK` | PRUNE_ONLY | 同表且 ≥2 条 `PROVEN_OVERLAP`/`POSSIBLE_OVERLAP`、且恰好一个 Horae `DIRECT_PARENT` 时只留该父；UNKNOWN 不参与破平、不被丢弃。Horae UNAVAILABLE 或剩余 ≤1 则跳过。Horae 永不把 `continuationEligible` 置 true |
| DECIDE | `reduce` | — | `pruneOn` 丢弃；`confirmOn` 且无 `SCHEDULE_PARENT_AMBIGUOUS` → `continuationEligible` |

`resolveReadField`：管道后 `|candidates|===1 && continuationEligible && producer FieldEdge` → CONFIRMED，否则 FRONTIER。INDEX `l1Eligible` 仅作初始值；管道后的 `continuationEligible` 为准。Harness 从 `PRODUCER_INDEX_PATH`（或默认 sibling `producer-index.json`）加载 PI；缺失时 rematch 跳过并记 `PRODUCER_INDEX_UNAVAILABLE`。两段 qualifiedName 仅当消费任务 `taskCategory` 为 `sparkIndex` / `hiveTask` / `hiveTask-2.0` 时默认 `platform=hive`、`dataSource=gfhive`；`hive2*` 与 `*2hive` 不同此默认。`readScopeFor` 用 Facts 谓词 + `resolveReadPartitionScope`；`*2hive` 且 PI 无写分区时记 `SOURCE_ENDPOINT_BOUNDARY`（源库边界）；其它 scope 不可得记 `READ_SCOPE_UNAVAILABLE`（【缺证据】），不伪造 scope。

未纳入本波：`DATE_PARTITION_DEFAULTED` 确认放宽、`overwrite-schedule` 规则。

### 6.3 scope 计算（第二正交轴，查询期）

**关系树来源**：`FieldEdgeIndex` 构建时编入同任务 Facts 的 `relation-nodes.jsonl` + `relation-edges.jsonl`；查询期用 `relation-tree.ts` 的 `subtreeContains` 与 setop 分支枚举（`setopBranches` + `subtreeContains`，非 `nearestSetopAncestor` 单父链）判定分支/侧别。禁止按表名/后缀判 scope。

输入：某条 VALUE 边 `v`（带 `sourceRelationId`）、同写观察的某条控制边 `c`（带 `subtype / joinType / controlSide / relationId / leftRelationId / rightRelationId`）。

| 情形                                                                                                                                                         | scope                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `c.subtype = JOIN`，`v.sourceRelationId` 位于 `c` 的**可空侧**子树（LEFT 的 right / RIGHT 的 left / FULL 任一侧）                                            | `FIELD_SCOPED` —— join 键决定该列取值或 NULL     |
| `c.subtype = JOIN`，`v.sourceRelationId` 位于**保留侧**                                                                                                      | `DATASET_SCOPED`，保留 `grain` 提示倍增风险      |
| `c.subtype = JOIN`，`joinType = INNER`                                                                                                                       | `DATASET_SCOPED`，**不得标无关**                 |
| `c.subtype = FILTER / GROUP_BY`                                                                                                                              | 默认 `DATASET_SCOPED`；若 `c.relationId` 与 `v.sourceRelationId` 可证处于不同 setop 分支 → `SCOPE_DISJOINT`（先于 subtype 默认） |
| `c.relationId` 与 `v.sourceRelationId` 处于**不同 setop 分支**（如 176827 的 `setop.b0` vs `setop.b1`），或 `c` 所在 CTE 子树与 `v` 子树无公共祖先直至写观察 | `SCOPE_DISJOINT`                                 |
| `controlSide = BOTH` 且无法判                                                                                                                                | `DATASET_SCOPED` + gap `CONTROL_SIDE_UNRESOLVED` |

硬规则：

- **判别式不是「控制列与该列 VALUE 闭包是否相交」**——交集为空不等于无影响。
- **`SCOPE_DISJOINT` 只能由可证明的作用域不相交产生，禁止由「没找到路径」产生。**
- `FIELD_SCOPED` 的控制条目类型仍是 CONTROL，不改标 VALUE。

### 6.4 输出契约（`FIELD_IMPACT_RESULT` 1.0.0）

```json
{
  "artifactType": "FIELD_IMPACT_RESULT",
  "schemaVersion": "1.0.0",
  "anchor": {
    "taskId": "176827",
    "writeObservationId": "write-observation:176827:platform-target:0",
    "outputColumn": "gamma_pct"
  },
  "value": [
    {
      "depth": 0,
      "taskId": "176827",
      "writeObservationId": "…",
      "outputColumn": "gamma_pct",
      "source": {
        "qualifiedName": "pdata_nds.pos_eod_position_view",
        "column": "gamma_pct",
        "readOccurrenceId": "task:176827:…:pepv.read.pos_eod_position_view"
      },
      "subtype": "IDENTITY",
      "evidenceStatus": "CONFIRMED",
      "expressionId": "…"
    }
  ],
  "control": [
    {
      "depth": 0,
      "subtype": "JOIN",
      "joinType": "LEFT",
      "controlSide": "RIGHT",
      "column": {
        "qualifiedName": "pdata_nds.pos_eod_position_view",
        "column": "key_instrument_id"
      },
      "scope": "FIELD_SCOPED",
      "grain": "EXPAND_RISK",
      "relationId": "task:176827:…:setop.b0.join.5"
    }
  ],
  "frontier": [
    {
      "depth": 1,
      "readField": { "readOccurrenceId": "…", "column": "fx_vola" },
      "candidates": [
        {
          "taskId": "…",
          "writeObservationId": "…",
          "partitionMatchStatus": "UNKNOWN",
          "reasonCode": "WRITER_PARTITION_UNKNOWN"
        }
      ],
      "reasonCode": "MULTI_WRITER_CANDIDATE_FRONTIER"
    }
  ],
  "gaps": [
    { "gapId": "…", "reasonCode": "PRODUCER_NOT_PROJECTED", "details": {} }
  ],
  "budget": { "maxDepth": 3, "edgesVisited": 0, "exhausted": false }
}
```

`value / control / frontier / gaps` 四栏就是 UI 的呈现契约：**不画一张箭头图，画 Confirmed / Candidate / Gap 三栏。**

### 6.5 gap 码表（本 WP 新增；INDEX 既有码原样透传）

| 码                                        | 层         | 含义                                                                                                       |
| ----------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `FIELD_SOURCE_READ_OCCURRENCE_AMBIGUOUS`  | Phase 1    | 同表多读次无法唯一归属；`details.reasonCode ∈ { SETOP_BRANCH_UNRESOLVED, SELF_JOIN_NO_QUALIFIER }`         |
| `FIELD_SOURCE_READ_OCCURRENCE_UNRESOLVED` | Phase 1    | relation 树内找不到该表的读；`details.reasonCode ∈ { CTE_SCOPE_UNRESOLVED, MATERIALIZATION_LEAF_MISSING }` |
| `FIELD_SUBTYPE_UNKNOWN`                   | Phase 1    | 附 `subtypeReason`                                                                                         |
| `CONTROL_SIDE_UNRESOLVED`                 | Phase 1    | 自连接等无法判侧                                                                                           |
| `TASK_LOCAL_MATERIALIZATION_FIELD_BREAK`  | Phase 1    | 任务内临时表字段链断；按 `(taskId, physicalDataset)` 聚合一条（§5.4）                                      |
| `PRODUCER_NOT_PROJECTED`                  | Phase 2    | INDEX 无条目：终止表 / 未采集 / SCHEDULE_ONLY                                                              |
| `SOURCE_ENDPOINT_BOUNDARY`                | Phase 2    | `*2hive` 读源库表且 PI 无 confirmed writer；平台边界，不再当 `READ_SCOPE_UNAVAILABLE`                      |
| `PRODUCER_BINDING_NOT_FOUND`              | Phase 2    | writer 在并集内但该列无 RESOLVED binding                                                                   |
| `MULTI_WRITER_CANDIDATE_FRONTIER`         | Phase 2    | 候选 > 1 或 `l1Eligible = false`，停止递归                                                                 |
| `WRITER_PARTITION_UNKNOWN` 等             | INDEX 透传 | 不改写                                                                                                     |
| `TRAVERSAL_BUDGET_EXCEEDED`               | Phase 2    | 深度/边数/frontier 超限                                                                                    |
| `CONTRACT_TOO_OLD`                        | Phase 2    | 输入投影 < 1.3.0                                                                                           |

---

## 7. 验收：五个真数据 case（FE-6 冻结为 golden）

期望值在 FE-1…FE-3 跑完真数据后冻结；本节写**不变量**，不写猜测的具体边数。全部取自 `176827`（`dm_rsk_n.otc_opt_greek_val_det_h`）与 `181058`。

### Case A 单源 IDENTITY + UNION 分支不相交

- 锚点：`176827.pric ← pdata_n.t98_sb_tit_day_hold_indx.pric`（位于 `setop.b1`，b1 内均为 INNER JOIN）
- 不变量：
  - `value[0].subtype = IDENTITY`，`sourceReadOccurrenceStatus = RESOLVED`
  - b1 的 FILTER（`m.filter`、`c.filter`、`rb.filter`）与两处 INNER JOIN 键 → `DATASET_SCOPED`
  - **b0 的全部控制边（LEFT 链 `join.3…join.12`、`ko_barrier.filter` 等）→ `SCOPE_DISJOINT`**，且必须由 setop 分支判据产生，不得由「无路径」产生
  - 两跳：`t98_sb_tit_day_hold_indx` 在批内有 2 个 writer → 除非 INDEX 唯一且 `l1Eligible`，否则进入 frontier

### Case B 高 fan-in 跨分支

- 锚点：`176827.gamma`（7 源：b0 `pos_eod_position_view.gamma` + 日期条件列；b1 `t98_sb_tit_day_hold_indx.gamma`）
- 不变量：
  - `value[]` 按 `sourceRelationId` 可区分 b0 / b1 两组
  - 日期类输入（`erly_trmt_date`、`end_prcg_date`、`trgr_date`、`trgr_line_date`、`src_busi_date`）出现在 `FIELD_CONDITIONAL` 或 `TRANSFORMATION`，**不得**被标 `IDENTITY`
  - 至少一条 `IDENTITY` 或 `TRANSFORMATION` 值边指向 `pos_eod_position_view.gamma`
  - `pos_eod_position_view` 单 writer → 若 INDEX `l1Eligible` 则出现 depth 1 的 CONFIRMED 接续

### Case C LEFT JOIN 侧别（同一 join 对两列结论不同）

- join：`task:176827:statement:0:relation:root.casttable.setop.b0.join.5`，`joinType = LEFT`，right = `pepv.project`（`pdata_nds.pos_eod_position_view`）
- 列 1：`gamma_pct ← pos_eod_position_view.gamma_pct`（可空侧）→ join.5 的键（`key_instrument_id`、`key_book_id`、`src_busi_date`、`t98_sb_otc_opt_sub_trd_prcg_indx.busi_date / src_prd_id`、`t98_sb_otc_opt_comp_info.book_agt_id`）对该列 **`FIELD_SCOPED`**
- 列 2：`nom ← pdata_n.t03_otc_opt_comp_sub_trd_info.prin`（保留侧，b0 基表）→ 同一批键对该列 **`DATASET_SCOPED`**，`grain = EXPAND_RISK`
- 不变量：同一 `relationId` 的控制条目在两个查询里 scope 不同；类型均为 CONTROL

### Case D vola 同表多 writer

- 锚点：`176827.vola ← pdata_n.t98_sb_otc_opt_sub_trd_prcg_indx.fx_vola`；INDEX 枚举同表多 writer
- 不变量：
  - 分区无法证明重叠时保持 `MULTI_WRITER_CANDIDATE_FRONTIER`（Horae 只破平，不单独 CONFIRMED）
  - 分区证明重叠且唯一 Horae `DIRECT_PARENT` 时，该读次可 CONFIRMED 到该父任务；`value[]` 中**不得**出现 depth ≥ 1 且 `source.column` 仍为消费列名的假递归
  - `expandCandidates = true` 仅在仍有 frontier 候选时把候选标 `CANDIDATE`

### Case E 临时表断链具名

- 锚点：`181058` 的 `gaps[].details.columns` 所列 7 列之一（值边 source 为该临时表；非任意输出列）
- 不变量：`gaps[]` 含 `TASK_LOCAL_MATERIALIZATION_FIELD_BREAK`，`details.columns` 非空；INDEX 查前原样透传，**禁止**改标 `PRODUCER_NOT_PROJECTED`；未折叠 temp 读次可为 `RESOLVED`

### 金样位置与运行

```text
tests/fixtures/field-evidence-v1/<case>/expected.json
npm run test:field-evidence          # 需 sibling sql-static-lineage-data/field-facts；缺则 skip
FIELD_EVIDENCE_GOLDEN_REQUIRED=1     # CI 挂载数据包时 fail closed，与 TASK_LOCAL_GOLDEN_REQUIRED 同规则
```

---

## 8. 存储与规模约束

### 8.1 物化边界（对表决策，不再逐案争论）

| 产物                         | 规模                                    | 物化                     |
| ---------------------------- | --------------------------------------- | ------------------------ |
| 任务局部投影                 | O(任务)                                 | 是                       |
| INDEX                        | O(读次 × 候选)，实测候选均值 1.33       | 是                       |
| `FIELD_DIRECT / CONDITIONAL` | O(表达式输入引用)，实测 49/任务         | 是                       |
| `DATASET_CONTROL`            | O(写观察 × 控制列)                      | 是                       |
| 字段级控制边                 | O(控制列 × 输出列) / 写观察 —— 笛卡尔积 | **否**                   |
| Impact Graph / 多跳闭包      | 传递闭包                                | **否**                   |
| 路径列表                     | 组合爆炸                                | **否**（呈现层按需展开） |

原则：**只物化线性规模、按单元可增量重建、内容哈希可缓存的投影；永不物化传递闭包或笛卡尔积。**

### 8.2 全库外推（13,740 任务 ≈ 64×）

| 产物                           | 现在    | 外推    |
| ------------------------------ | ------- | ------- |
| 投影                           | 10.4 MB | ~670 MB |
| `FIELD_DIRECT`                 | 9,070   | ~58 万  |
| `PHYSICAL_FIELD`（并集去重后） | 4,683   | ~30 万  |
| INDEX 条目                     | 535     | ~3.5 万 |

推论（全库前必做，非本 WP 排期）：并集不能单体 `JSON.parse` 合并；需按任务分片 + `(qualifiedName, column) → FieldEdge[]` 与 `bindingId → FieldEdge[]` 反向索引。本 WP 的 Impact Query 实现**必须通过一个 `FieldEdgeIndex` 接口读边**，不得直接遍历数组，以便后续替换存储而不改查询。

### 8.3 查询期爆炸控制

实测参数：fan-in 2～8 × 候选 ≤ 10 × 深度 3 → 无剪枝可达 ~2.5 万路径/列。控制手段即 §6.1 的 `budget`、§6.2 的「CANDIDATE 不递归」、§6.5 的 `TRAVERSAL_BUDGET_EXCEEDED`。**超限具名，不静默截断。**

---

## 9. 止损条件（反自嗨机制）

Phase 2 跑完后，对 176827 选定的高价值前 10 列（Greek 类：`gamma / delta / vega / theta / *_base / gamma_pct / npv_base / net_now_val / now_vall / vola`）统计：

```text
confirmedTwoHopRatio := 深度 1 存在 CONFIRMED 接续的列数 / 10
dominantGap          := frontier + gaps 中占比最高的 reasonCode
```

| 结果                                                                                     | 动作                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `confirmedTwoHopRatio ≥ 0.5`                                                             | 进入 Phase 3                                                                |
| `< 0.5` 且 `dominantGap ∈ { WRITER_PARTITION_UNKNOWN, MULTI_WRITER_CANDIDATE_FRONTIER }` | **冻结本 WP 一切概念工作，回修 WP-8 分区匹配**；本文件状态改为「等待 WP-8」 |
| `< 0.5` 且 `dominantGap = PRODUCER_NOT_PROJECTED`                                        | 是采集广度问题，回 GC-0 步骤 ③ 补采，不动模型                               |
| `< 0.5` 且 `dominantGap ∈ Phase 1 码`                                                    | 是派生质量问题，修 FE-1…FE-3，不加概念                                      |

没有可量化的失败判据，任何阶段都能被解释成「还差一点」。这条不可删。

---

## 10. Phase 3：CONTROL 的消费价值验证

已有一个肯定答案：`execution-plan-rerun-shrink.md` 的三档（值必达 / 行决定 / 倍增风险）是 CONTROL 的独立消费者，105387 拉链键 `Agt_Modifr` 是真实用例（值链零贡献，却决定下游读到哪些行）。

Phase 3 要验证的缩小为：**除重跑外，指标口径追因是否也需要 CONTROL 分轨。** 方法：拿 176827 一次真实的 Greek 值异常（或构造一次上游 `pos_eod_position_view` 分区缺失），看排查者是否用到了 `control[]` 中 `FIELD_SCOPED` 条目。

| 结果   | 动作                                                             |
| ------ | ---------------------------------------------------------------- |
| 用到   | 保留分轨；此时才允许对外使用「Effect」一类命名                   |
| 没用到 | CONTROL 保留在事实层（零成本），产品层降为内部分类，不宣称差异化 |

---

## 11. 工作包（拆成两个 OpenSpec change）

### 11.1 Change `field-evidence-v1`（纯 Phase 1，当前）

| 包                       | 内容                                                                                                                                                               | 完成定义                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **FE-0** 契约 1.3.0      | `contract.ts` 新属性 + 校验；1.2.0 READS 校验改 `≥ 1.2.0`（§4.4 第 6 条）；`ids.ts` 语义键含 `sourceReadOccurrenceId + expressionId`（非 RESOLVED 用 `null` 占位） | 契约测试绿；1.2.0 投影可读**且 READS 仍要求 `readOccurrenceId`**；1.3.0 缺属性拒绝                |
| **FE-1** 读次派生        | §5.1 三步：`expandMaterializedField` 带回 leaf 上下文 → setop 按 ordinal 下沉 → 子树匹配；四个 reasonCode                                                          | 非 RESOLVED 100% 有 gap；无「取第一个」；`sourceRelationId` 为物理 read relation                  |
| **FE-2** subtype 三分类  | §5.2 规则 + 码表 + **物化路径组合**；删 CONSTANT 源边；window 上下文列不进值流                                                                                     | `UNKNOWN` 100% 带 reason；折叠边经聚合者不得为 `IDENTITY`                                         |
| **FE-3** 控制侧别        | §5.3 relation id 子树判侧；`dataset-controls.ts` 注解加 `joinType / leftRelationId / rightRelationId / controlSide`                                                | 176827 16 个 join 全部有 `joinType`；`BOTH` 100% 有 gap；**不按表名后缀判**                       |
| **FE-1′** 临时表 gap     | §5.4 按 `(taskId, physicalDataset)` 聚合                                                                                                                           | 181058 恰好一条，`columns.length = 7`，`affectedEdgeCount = 42`，`writeObservationIds.length = 6` |
| **FE-B** baseline + 检查 | §5.5 三 cohort `phase1-baseline.json`；四项不变量检查；源码 lint（无任务 id / 表名 / 列名字面量）                                                                  | 满足 §5.5 五条完成判据；lint 绿                                                                   |
| **FE-D** 文档回写        | 在 `execution-plan-asset-graph.md` WP-11 行、`domain-asset-graph-architecture.md` WP 状态表**各改一行**指向本文件                                                  | 仅状态行，不改正文                                                                                |

领取顺序：FE-0 → FE-1 → FE-2 → FE-3 → FE-1′（派生逻辑可并行，但**同一 PR 合入**以满足一次升版）→ FE-B → 按 §5.5 决定是否开 11.2。

### 11.2 Change `field-evidence-v1-impact-query`（Phase 2，待 11.1 达标后开）

| 包                      | 内容                                                       | 完成定义                                                            |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| **FE-4** 跨任务 resolve | 只读 INDEX 的 `resolveReadField()`；`FieldEdgeIndex` 接口  | 单元测试覆盖：唯一 + l1Eligible / 多候选 / 无条目 / 无 binding 四态 |
| **FE-5** Impact Query   | §6 算法、scope、预算、输出契约                             | 五 case 跑通产出 `FIELD_IMPACT_RESULT`；预算超限具名                |
| **FE-6** 金样冻结       | §7 五 case `expected.json` + `npm run test:field-evidence` | 缺数据 skip；`FIELD_EVIDENCE_GOLDEN_REQUIRED=1` fail closed         |
| **FE-7** 止损判定       | §9 统计脚本 `npm run field-evidence:stop-loss`             | 输出 `confirmedTwoHopRatio / dominantGap / decision`                |
| **FE-8** 单锚点查询 CLI | `npm run field-evidence:query -- --task-id <id> --column <col>` | stdout 输出校验过的 `FIELD_IMPACT_RESULT` 1.1.0 JSON；默认锚定任务 `finalWrites[0]` |

Phase 2 的行为契约草稿即本文件 §6–§7；开 change 时以此为 spec 起点（首版 OpenSpec `specs/field-evidence-v1/spec.md` 已并入本文件，不再单独维护）。

### 11.3 登记、不排期

| 项                                        | 归属            | 说明                                     |
| ----------------------------------------- | --------------- | ---------------------------------------- |
| Facts `input_fields[].source_relation_id` | 发布器侧独立 WP | 有了它 FE-1 ③ 退化为查表；Phase 1 不等它 |
| 临时表断链修复                            | WP-4 / 后续     | Phase 1 只具名                           |
| 并集分片 + 反向索引                       | 全库前必做      | §8.2                                     |

---

## 12. 硬约束（与既有文档一致，本文件重申并新增）

1. 不新增 `TaskLocalNodeType`；`FieldBinding` / `ReadField` 只是派生键。
2. 不生成任何 `控制列 → 输出列` 字段级边；不恢复 `affectedRootFields` / `rowsetControls`。
3. `SCOPE_DISJOINT` 只能由可证明的作用域不相交产生，禁止由「没找到路径」产生。
4. INNER JOIN 对所有输出列 `DATASET_SCOPED`，不得标无关。
5. `sourceReadOccurrenceId` 多候选时禁止取第一个；标 `AMBIGUOUS`。
6. `subtype` 三类之外一律 `UNKNOWN` + reason；不开第四类。
7. CANDIDATE 默认不递归；递归须显式 `expandCandidates` 且计预算。
8. Impact Query 不落盘、不缓存闭包；只允许缓存 `FieldEdgeIndex`。
9. 契约只升一次版（1.3.0）；三项属性同 PR。
10. 不改 WP-8 INDEX 契约；INDEX 的 reasonCode 原样透传。
11. 不改 SQLLens / Plan Facts / Machine Facts 发布器；不动 legacy `field-lineage` 消费者。
12. §9 止损条件不可删、不可放宽；§5.5 Phase 1 完成判据同样不可放宽。
13. `sourceRelationId` 是**物理 read relation id**，不是 `expression.relation_id`；未 RESOLVED 时为 `null`。
14. 控制侧别只能由 relation id 子树成员关系判定；**禁止按表名 / 后缀判侧**。
15. 派生代码不得含任务 id、表名、列名字面量（lint 锁住）；金样断言只写不变量，不写具体边数。
16. baseline 必须同时给出 `anchorExpansionBatch` / `shadowEvaluationSlice` / `all` 三组；只在展开批上变好不算变好。
17. 升版 1.3.0 时，1.2.0 的 READS 校验不得放松（`≥ 1.2.0`，非 `=== 当前版本`）。

---

## 13. 明确不做

- 全列覆盖、全链路 100% 字段闭合
- 算子全矩阵（CASE / CAST / COALESCE / WINDOW / ARITHMETIC 各成一类）
- `Effect Graph` 作为存储层或对外命名（Phase 3 前）
- Neo4j / 图数据库、HTML 调查页（列级）
- 并集分片与反向索引的存储实现（记录为全库前必做，非本 WP）
- 临时表断链修复（只具名，不修）
- WP-10 legacy 闭包 KPI 对比
- Facts 层 `input_fields[].source_relation_id` 增强（登记为发布器侧独立 WP，Phase 1 不等它）
- 为某个锚点单独写特判（任何以任务 id / 表名为条件的分支都是过拟合）

---

## 14. 何时算解决

**Phase 1（change `field-evidence-v1`）解决**：§5.5 五条完成判据全部满足，`phase1-baseline.json` 三组 cohort 留档，`shadowEvaluationSlice` 与 `anchorExpansionBatch` 同向改善。

**整个 WP-11 解决**：

1. 1.3.0 投影在四锚点穿透批上重投成功，`RESOLVED` 读次比例与 subtype 分布已留档
2. 五个 case 的 `FIELD_IMPACT_RESULT` 与 `expected.json` 一致，且 Case A 的 `SCOPE_DISJOINT`、Case C 的同 join 双 scope、Case D 的 frontier 三个「诚实性」断言绿
3. `field-evidence:stop-loss` 给出明确 decision，并已按 §9 执行（进入 Phase 3 或回修 WP-8）
4. 任何评审者能只凭 `value / control / frontier / gaps` 四栏复述「这个字段怎么来的、什么会让它变、哪里我们不知道」——不需要看图
