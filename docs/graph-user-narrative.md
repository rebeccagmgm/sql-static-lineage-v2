# 建图对用户陈述规范（Never-Wrong UX）

配套：`docs/domain-asset-graph-architecture.md`、`docs/l1-scope-and-architecture.md`、
`docs/execution-plan-task-local-union.md`、`docs/graph-accuracy-architecture.md`（L1–L3 的内容由后者的
写观察 / 读次 / 分区三档接续提供）。

本文件规定：**构建或展示资产图时，必须把「准 / 不准 / 为什么」整理成用户可理解的逻辑层**，
不得只抛裸节点边 JSON。陈述规则与机器证据三态同源；UI、报告、API envelope 共用同一套分层。

资产图大架构可并行推进或暂缓；**本规范不暂缓**——任何对外给出的图视图都应遵守。

---

## 1. 一句话

> **准就显式准；不准就显式不准；没有证据等级的边，不得当结论展示。**

对齐 SQLLens / L1：完整证据下必须闭合；证据不足时只能是 `UNKNOWN` /
`CANDIDATE` / 具名 gap / 边界节点，禁止用猜测互相掩盖。

---

## 2. 对用户的四层陈述（固定顺序）

建图完成（或查询返回）时，面向用户的主叙事必须按下列顺序组织。
机器内部可以多文件存储，但对用户呈现时不得打散成无结构的边列表。

### L0 — 覆盖（这张图装了什么）

告诉用户本批/本视图的材料边界，而不是假装「全库真相」。

必给字段：

| 字段 | 含义 |
|------|------|
| `projected` | 有 Task Pack + 可投影 SQL 边的任务数 |
| `scheduleOnly` | 仅调度上下文、无数据边的任务数 |
| `collectionFailed` | 采集/Facts 失败、仅边界存在的任务数 |
| `byFailureReason` | 失败原因计数（若有） |
| `batchRef` | manifest / contentHash，可复核 |

用户文案口径示例：

- 「本图包含 65 个任务：6 个有 SQL 投影，59 个仅调度边界。」
- 不允许写成：「已覆盖 DM_RSK_N 全域血缘。」

### L1 — 确定血缘（CONFIRMED）

仅当同时满足时，才允许进入「确定」层并向用户标为确定：

1. 边来自 WP-3 `PROJECTED` 局部投影，或可由并集内 `WRITES`/`READS` 在同一
   `PHYSICAL_DATASET` 上对接；
2. 物理表身份无 `DATASET_IDENTITY_DIVERGENT`；
3. 证据状态为 `CONFIRMED`（不得把调度或并集外 index 线索升格）。

用户可见：表级上游/下游、任务写读关系。  
**这是默认高亮层。**

### L2 — 候选 / 未知（CANDIDATE / UNKNOWN）

必须与 L1 **视觉与文案分离**（不同样式、不同列表、不同默认折叠策略）。

典型来源：

| 来源 | 用户说法 | 禁止说法 |
|------|----------|----------|
| producer-index 并集外 writer | 「索引提示可能还有写者 …」 | 「上游是 …」 |
| `scheduleReference.targetTable` | 「调度登记目标表（候选）」 | 「SQL 证实写入 …」 |
| `partitionPredicateStatus = NON_LITERAL_PRESENT` | 「读侧谓词含非字面量，无法唯一剪枝」 | 「唯一上游任务是 …」 |
| 字段 `subtype = UNKNOWN` | 「字段有关，变换类型未定」 | 「恒等拷贝 / 已认定加工种类」 |

`SCHEDULE_DEPENDS_ON`、可关闭的 `PRODUCER_BRIDGE` 派生边 **只属于 L2（或参考层）**，
永不并入 L1。

### L3 — 不合与缺口（gaps / boundaries）

具名、可定位、可复核。每条至少包含：

- `reasonCode`（稳定枚举，如 `DATASET_IDENTITY_DIVERGENT`、`UNION_EDGE_CONFLICT`、
  `WRITER_NOT_IN_UNION`、`NO_KNOWN_WRITER`、`PARTITION_NO_MATCH`、
  `READ_PREDICATE_NON_LITERAL`、`WRITER_PARTITION_UNKNOWN`）
- 人话 `message`
- 关联 `taskId` / `dataset` / `edgeId`（能给尽给）
- 是否阻塞 L1 结论（是/否）

用户文案口径：系统在这里 **拒绝装准**，需要人补 Facts、修 catalog 身份或接受扇入。

---

## 3. 图上属性与报告的对应

| 用户层 | 图上最少要带的标记 | 报告/API 区块名（建议） |
|--------|--------------------|-------------------------|
| L0 | 任务节点 `coverageStatus` | `coverage` |
| L1 | 边 `evidenceStatus=CONFIRMED`，`derived=false` | `confirmedLineage` |
| L2 | `evidenceStatus=CANDIDATE\|UNKNOWN` 或 `derived=true` + provenance | `candidates` |
| L3 | 不静默删节点；gap 列表 + 边界任务节点 | `gaps` / `boundaries` |

同一条逻辑边不得在 L1 与 L2 重复冒充两套结论；若既有投影边又有派生桥，
展示时派生桥只能出现在 L2，并注明 provenance。

---

## 4. 红线（违反即视为产品错误）

1. **不得**把 `scheduleReference` / 调度边当成确定表级或字段级血缘。
2. **不得**在 `NON_LITERAL` / 写侧分区未知时，静默选出「唯一」writer。
3. **不得**为了链通而合并不同 `physicalDatasetNodeId` 的同名表。
4. **不得**把 `COLLECTION_FAILED` / `SCHEDULE_ONLY` 升级展示为 `PROJECTED`。
5. **不得**在 UI 默认视图里只渲染边、把 coverage 与 gaps 藏进调试 JSON。
6. **不得**用「相似 / 可能 / 模型推断」补 L1；要补只能进 L2/L3 且标明非 SQLLens 证据。
7. Fail closed：manifest / envelope / producer-index 指纹不一致时，**整图构建失败**，
   而不是降级成「大概对的图」。

---

## 5. 推荐的用户交付物形状

每次成功建图，除节点边文件外，应同时给出一份 **Build Narrative**（JSON 可机器读，
Markdown/HTML 可人读），最小骨架：

```text
Build Narrative
  coverage          L0
  confirmedLineage  L1  summary counts + 关键路径样例
  candidates        L2  按原因分组
  gaps              L3  按 reasonCode 分组
  identity          使用的 manifest / projection / producer-index contentHash
  limits            本批任务数、是否关闭派生层、是否导出调度展示边
```

查询单次表级上游时，返回 envelope 同样带这四层的**局部切片**
（只与该 dataset 相关的 confirmed / candidate / gaps），避免用户只看到一个 taskId 列表。

---

## 6. 与现有实现的落点

| 能力 | 现状 | 本规范要求 |
|------|------|------------|
| WP-3 `coverageStatus` / `failureReasonCode` | 已有 | 必须进 L0 用户陈述 |
| WP-5 并集 merge gaps | 已有枚举 | 必须进 L3，不得仅日志 |
| WP-5 `traceUnionUpstream` | 返回 writers + gaps + derived | 对外 API/UI 按 L1/L2/L3 拆开 |
| WP-5 `exportScheduleDependsOnEdges` | 可选派生 | 仅 L2 |
| data-graph 地图 / query-index | 尚未接 UNION | 接入时必须以本规范为展示合同 |
| WP-3.2 `scheduleReference.targetTable` | 已拍板未做 | 落地后只进 L2 CANDIDATE |

实现顺序建议（准确性优先，可暂缓扩图）：

1. 冻结本规范 + 给 `traceUnionUpstream` / 并集构建增加 `BuildNarrative` 结构化输出；
2. 金样三任务生成人读 Markdown 报告（L0–L3）作回归；
3. 再接到 query-index / 地图时复用同一 narrative，而不是另发明文案层。

---

## 7. 验收口径

算遵守本规范：

- 任意对外图视图能指出：哪些是确定、哪些是候选、哪些是缺口；
- 金样路径上 L1 不断言调度边；L2/L3 在 NON_LITERAL 与并集外 writer 场景可演示；
- 关闭派生层后 L1 结论不变。

不算遵守：

- 只有 nodes/edges 文件，用户要自己猜哪些边可信；
- 把候选 writer 画成与确定 WRITES 无差别的主路径；
- 用「图很全」掩盖大量 `SCHEDULE_ONLY`。

---

## 8. 非目标

- 不在本规范内实现 WP-4 加工种类精化（那是提高 L1 字段断言上限，不是展示分层）。
- 不要求立刻上 Neo4j；文件报告满足陈述合同即可。
- 不把 LLM 叙述当作证据源；LLM 若用于说明，只能复述 L0–L3 已有字段。
