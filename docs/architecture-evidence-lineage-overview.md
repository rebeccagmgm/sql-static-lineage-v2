# 整体架构：证据式血缘图（Evidence-based Lineage Graph）

本文件是**总览**：一页看清系统分几层、每层存什么、什么在构建期、什么在查询期、
边界在哪里。细则全部下沉到既有文档，本文件只做索引与约束汇总，不替代任何一份。

| 细则                           | 文档                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| 机器单位、影响三档、第二正交轴 | `domain-asset-graph-architecture.md`                                        |
| 四锚点并集图 P0                | `execution-plan-gold-case-investigation.md`                                 |
| WP-3 纸条契约                  | `execution-plan-task-local-projection.md`                                   |
| WP-5 并集 + WP-8 接续 INDEX    | `execution-plan-task-local-union.md`                                        |
| 字段证据链 V1（WP-11）         | `execution-plan-field-evidence-v1.md`、`openspec/changes/field-evidence-v1`、`openspec/changes/field-evidence-v1-impact-query` |
| 重跑三档                       | `execution-plan-rerun-shrink.md`                                            |
| 准确性冻结 WP-6…12             | `graph-accuracy-architecture.md`                                            |
| 对用户怎么讲 L0–L3             | `graph-user-narrative.md`                                                   |
| 输入边界                       | `l1-scope-and-architecture.md`、`input-pack.md`                             |

---

## 0. 一句话

**从 SQL 静态解析出「证据」，按任务落成局部事实，跨任务只靠「读次 × 写观察」接续；所有「答案」（表级地图、字段来源、影响面、重跑范围）在查询期投影，不物化闭包。**

它不是 `column → column` 的字段树，也不是 `task → task` 的调度图。节点是**一次语义出现**（写观察、读次、字段在某写观察下的 binding），边带类型与证据三态。

---

## 1. 分层总览

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ L5  呈现            四栏：Confirmed / Candidate / Gap + L0–L3 文案       │
│                     不画一张箭头图；HTML 可选                              │
├──────────────────────────────────────────────────────────────────────────┤
│ L4  查询期投影      表级 walk │ 字段 Impact Query │ 重跑反向切片          │
│     （不落盘）      CROSS_TASK_PAIR │ RESOLVE(读次→写观察) │ scope 标注   │
│                     预算 + frontier + 具名 gap                             │
├──────────────────────────────────────────────────────────────────────────┤
│ L3  接续索引        UNION_CONTINUATION_INDEX（data-graph）                │
│     （物化，线性）  (consumerTask, readOccurrence) → candidates[]          │
│                     partitionMatchStatus / l1Eligible / reasonCode         │
├──────────────────────────────────────────────────────────────────────────┤
│ L2  任务局部投影    TASK_LOCAL_PROJECTION 1.3.0，每任务一张「纸条」       │
│     （物化，线性）  TASK / PHYSICAL_DATASET / PHYSICAL_FIELD /             │
│                     TARGET_WRITE / READ_OCCURRENCE                         │
│                     READS / WRITES / FIELD_DIRECT / FIELD_CONDITIONAL /    │
│                     DATASET_CONTROL；localClosure；gaps                    │
│                     内容哈希缓存；不含任何跨任务边                          │
├──────────────────────────────────────────────────────────────────────────┤
│ L1  机器事实        Machine Facts（JSONL bundle）                          │
│     （物化，权威）  dataset-io / relation-nodes / relation-edges /          │
│                     field-expression-nodes / output-field-bindings /       │
│                     task-local-materializations / schema-refs / unknowns   │
├──────────────────────────────────────────────────────────────────────────┤
│ L0  输入边界        Input Pack（冻结、可校验）+ 调度证据缓存（只做归因） │
│                     SQLLens parse → semantic → Plan Facts                  │
└──────────────────────────────────────────────────────────────────────────┘
```

**规则一句话**：L0–L3 只存线性规模、按单元可增量重建、内容哈希可缓存的东西；L4 一切都是查询期算出来的；L5 只负责诚实地讲。

---

## 2. 四个原语与派生身份（Canonical 只此四类）

| 原语                   | 落点                                  | 身份键                                                                 |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| **WriteObservation**   | `TARGET_WRITE` 节点                   | `writeObservationId`                                                   |
| **ReadOccurrence**     | `READ_OCCURRENCE` 节点                | `readOccurrenceId`（含 relation，同表多读不合并）                      |
| **FieldEdge**          | `FIELD_DIRECT / FIELD_CONDITIONAL` 边 | `(sourceReadOccurrenceId, 源表, 源列, outputColumn, expressionId)`     |
| **DatasetControlFact** | `DATASET_CONTROL` 边                  | `(controlId)`，挂写观察，带 `subtype / grain / joinType / controlSide` |

派生身份（写在契约里、**不是节点**）：

```text
FieldBinding := (writeObservationId, outputColumn)          对外可显示为 table.col@task
ReadField    := (readOccurrenceId, column)                  跨任务 resolve 的输入端
```

`TASK` 是**归因**（谁跑的 SQL），不是数据边端点。`PHYSICAL_DATASET / PHYSICAL_FIELD` 是全局身份锚点，用于跨任务拼接，不承载关系。

---

## 3. 边词典（唯一权威，不平行发明）

### 3.1 落盘边（L2）

| 边                  | 端点                                      | 回答                | 关键属性                                                                                                                                     |
| ------------------- | ----------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `READS`             | TASK → READ_OCCURRENCE → PHYSICAL_DATASET | 读了谁、读了几次    | 分区谓词                                                                                                                                     |
| `WRITES`            | TASK → TARGET_WRITE → PHYSICAL_DATASET    | 写了谁              | `writeObservationId`                                                                                                                         |
| `FIELD_DIRECT`      | PHYSICAL_FIELD → TARGET_WRITE             | 值从哪来            | `outputColumn`、`subtype ∈ IDENTITY/TRANSFORMATION/AGGREGATION/UNKNOWN+reason`、`sourceReadOccurrenceId`、`sourceRelationId`、`expressionId` |
| `FIELD_CONDITIONAL` | PHYSICAL_FIELD → TARGET_WRITE             | 哪列选了分支        | 同上，`subtype=CONDITIONAL`                                                                                                                  |
| `DATASET_CONTROL`   | PHYSICAL_FIELD → TARGET_WRITE             | 哪列决定行存在/倍增 | `subtype ∈ JOIN/FILTER/GROUP_BY/…`、`grain`、`joinType`、`controlSide`                                                                       |

### 3.2 查询期派生（L4，不落盘）

| 派生                                                     | 由什么算                                                              | 回答                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `CROSS_TASK_PAIR`                                        | INDEX 条目                                                            | 表级：这个读次的 writer 是谁               |
| `RESOLVE(ReadField → FieldBinding)`                      | INDEX 唯一且 `l1Eligible` + producer 的 `FIELD_*` 边                  | 字段级：这列上一跳是谁的哪次写             |
| `scope ∈ FIELD_SCOPED / DATASET_SCOPED / SCOPE_DISJOINT` | 值边 `sourceRelationId` × 控制边 `joinType/controlSide` × relation 树 | 这条控制对**这一列**是决定取值还是只决定行 |

### 3.3 明确禁止的边

- `TASK → TASK` 数据边（调度 `upstreamTaskIds` 只做 L0 归因）
- `控制列 → 输出列` 字段级控制边（209119 实测 53.8 倍重复；`affectedRootFields` 已停用）
- 任何「预展开的多跳闭包」边

---

## 4. 三个问题、三个查询、同一份事实

| 问题                         | 查询（L4）   | 走什么                                            | 输出形状                            | 现状                              |
| ---------------------------- | ------------ | ------------------------------------------------- | ----------------------------------- | --------------------------------- |
| 这批任务长什么样、上游是谁   | 表级 walk    | `READS/WRITES` + INDEX                            | 并集图 + `CROSS_TASK_PAIR` + gaps   | **金样跑通**（186 任务）          |
| 这个字段怎么来、什么会让它变 | Impact Query | `FIELD_*` + `RESOLVE` + `DATASET_CONTROL` + scope | `value / control / frontier / gaps` | **Phase 2 进行中**（`field-evidence-v1-impact-query`） |
| 这张表要重跑，最小上游任务集 | 反向切片     | `needed(hop) = 值列 ∪ 行决定列`                   | 值必达 / 行决定 / 倍增风险 / 已剪除 | **已有** consumer；扩并集版已暂停 |

三者共用 L1–L3，**不共用遍历方式**。任何一个查询的 KPI 不能当另一个的验收。

---

## 5. 证据三态与诚实性红线

```text
CONFIRMED   本任务 SQL 或 INDEX 唯一接续能证明
CANDIDATE   有候选但不唯一 / 分区对不上 / 仅调度证据
UNKNOWN     证不出；必须带 reasonCode 成为 gap
```

红线（违反即产品错误）：

1. 不由「没找到路径」产生「无关」；`SCOPE_DISJOINT` 必须由 relation 树证明
2. 多候选 writer 不猜一个画实线；进 frontier
3. `AMBIGUOUS` 读次不取第一个
4. INNER JOIN 对所有输出列都是 `DATASET_SCOPED`，不得标无关
5. CONSTANT 不生源边；window 上下文列不进值流
6. 查询超预算具名 `TRAVERSAL_BUDGET_EXCEEDED`，不静默截断

---

## 6. 物化边界（对表决策）

| 产物                    | 规模                              | 物化       |
| ----------------------- | --------------------------------- | ---------- |
| Machine Facts           | O(SQL)                            | 是（权威） |
| 任务局部投影            | O(任务)                           | 是         |
| INDEX                   | O(读次 × 候选)，实测候选均值 1.33 | 是         |
| `FIELD_*` 边            | O(表达式输入引用)，实测 ~49/任务  | 是         |
| `DATASET_CONTROL`       | O(写观察 × 控制列)                | 是         |
| 字段级控制边            | 笛卡尔积                          | **否**     |
| 多跳闭包 / Impact Graph | 传递闭包                          | **否**     |
| 路径列表                | 组合爆炸                          | **否**     |

实测基线（214 任务）：投影 10.4 MB、INDEX 0.9 MB。全库 13.7k 任务外推 ~670 MB 投影、~58 万字段边——**不会爆，但并集不能单体合并**；全库前需按任务分片 + `(表,列)` 反向索引（`FieldEdgeIndex` 接口已为此预留）。

---

## 7. 两个仓库、目录映射

```text
sql-static-lineage（生产侧）
  scripts/input/            L0  Input Pack 采集与缓存
  scripts/plans/            L0  SQLLens → Plan Facts；read-occurrence-resolver
  scripts/machine-facts/    L1  Machine Facts 发布
  scripts/project-graph/
    task-local/             L2  TASK_LOCAL_PROJECTION 生产 + 批 + 缓存 + 锚点穿透
    field-evidence-v1/      L2 Phase 1 派生 + L4 Impact Query（`field-evidence-v1-impact-query`）
  scripts/gold-case/        L5  gaps / trace report
  scripts/reconcile/
    shared/dataset-controls L2  控制边来源（共用）
    consumer/…closure/      L4  重跑反向切片（既有）
    consumer/field-lineage/ 旧  LEGACY_COMPAT，不扩矩阵
  scripts/visualize/        L5  机器图 HTML（可选）

scripts/data-graph（消费侧，独立仓）
  task-local-union-*        L3  并集 merge + UNION_CONTINUATION_INDEX
  topology / query-index    L4  表级 walk、Neo4j（TASK_LOCAL_UNION 接入未做）
```

两侧只通过已发布产物契约交互（投影 envelope、INDEX JSON），不共享源码。

---

## 8. 状态与演进

| 工作包                                 | 层            | 状态                                                                                              |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| WP-3 纸条 1.2.0                        | L2            | 已验收                                                                                            |
| WP-5 并集 merge                        | L3            | 库完成                                                                                            |
| WP-8 / 8.1 INDEX                       | L3            | CLI 完成；分区匹配精度是当前主瓶颈（锚点 `l1Eligible` 22%～50%）                                  |
| GC-0 四锚点穿透                        | L2–L3         | 真数据跑通（186 任务、535 INDEX 条目）                                                            |
| GC-3 gaps / L0–L3                      | L5            | 首版产出                                                                                          |
| WP-11 字段证据链 V1 Phase 1            | L2 契约 1.3.0 | **已完成**（`field-evidence-v1`）；Phase 2 Impact Query → `field-evidence-v1-impact-query` |
| WP-10 闭包接并集                       | L4            | 暂停                                                                                              |
| data-graph 主管线接 `TASK_LOCAL_UNION` | L4            | 未做，非 P0                                                                                       |

**下一步唯一动作**：实施 `field-evidence-v1-impact-query`（`FieldEdgeIndex` + Impact Query + 金样 A–E + stop-loss），按 `execution-plan-field-evidence-v1.md` §9 止损判据决定 Phase 3 或回修 WP-8。

---

## 9. 明确不做（全局）

- 全库一次性并集、全列 100% 跨任务闭合
- 新节点类型（`FieldBinding` 节点、`Join` 节点、`Rule` 节点……）
- 算子全矩阵；`Effect Graph` 作为存储层或对外命名（Phase 3 前）
- 以调度 `targetTable` / `upstreamTaskIds` 升 CONFIRMED
- 以 WP-10 闭包 L1 计数、HTML 作为验收
- Neo4j 作为解决规模问题的手段（它解决不了单体合并与查询爆炸）

---

## 10. 评审口径

评审这套系统时不问「是不是业内标准」，问三件事：

1. **单位对不对**：每一层是否都守住「写观察 × 读次」；字段级是否带读次。
2. **答案有没有被提前算**：L2/L3 里是否混进了闭包、路径、字段级控制边。
3. **不知道的有没有说**：每个 UNKNOWN 是否有 reasonCode；CANDIDATE 是否画成了实线。

三问都过，架构就成立；任何一问不过，先修它，再谈新概念。
