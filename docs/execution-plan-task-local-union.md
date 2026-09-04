# WP-5 任务局部并集：执行方案

> **实现状态（2026-09-03）**：data-graph 仓 `src/project-graph/topology/task-local-union/`  
> TU-0～TU-7 主项已落地（loader、merge、表级接续、WP-8 v2、`union-continuation-index` CLI）。  
> **未做**：`TASK_LOCAL_UNION` 接入 `project-topology-cli` / 地图主管线；TU-7.2b nodeId 留档；TU-8 成本文档。  
> **产品主路径**见 `docs/execution-plan-gold-case-investigation.md`（金样调查页 V0，不依赖全库并集发布）。

配套：`docs/domain-asset-graph-architecture.md`（架构）、`docs/execution-plan-asset-graph.md`（总地图）、`docs/execution-plan-task-local-projection.md`（WP-3 上游产物）。
WP-3 已验收（`TASK_LOCAL_PROJECTION` schema **1.2.0** + WP-3.1；兼容读 1.1.0）。本文件只解决一件事：

**把 N 份任务局部投影并成一张可查询的图；跨任务依赖在并集图上靠同一物理表节点的 READS/WRITES 对接，并集外的 writer 用 producer-index 补边界；不在构建期跑 multi-hop 闭包。**

领取：在 **`scripts/data-graph`** 仓库 `openspec new change "task-local-union-source"`，再补 proposal / specs / design / tasks。
代码落在 data-graph 的 project-graph source loader / 快照契约 / 查询入口。**不**改 sql-static-lineage 的 Facts 生产与 WP-3 投影器；若需 WP-3 补字段（见 §6.2），另开 WP-3.2 小 change，不在本 WP 内顺手改。

金样（并集图上的链，不是单任务纸条）：

```text
105387  WRITES pdata_n.t03_agt_stati_info_h（拉链 ref 在本任务 DATASET_CONTROL）
119044  READS  pdata_n.t03_agt_stati_info_h（两次 READ，SRC_TBL 谓词不同）
        READS  pdata_n.t03_otc_opt_comp_info（主表；其 writer 不在三金样内）
        WRITES pdata_n.t98_sb_otc_opt_comp_info
176827  READS  pdata_n.t98_sb_otc_opt_comp_info
        WRITES dm_rsk_n.otc_opt_greek_val_det_h
```

并集验的是：**同一张物理表在图上只有一个 `PHYSICAL_DATASET` 节点**；从 176827 的 READ 走到 119044 的 WRITES、从 119044 的 READ 走到 105387 的 WRITES，**不靠 taskId 数据边**，靠表节点 +（一表多写时）谓词与 writer 分区对照。
以 Facts / Task Pack 为准生成期望，不手抄表名；上面的链形状以 WP-3 金样测试（`tests/project-graph/task-local/golden-samples.test.ts`）为准。

---

## 1. 它产出什么、不产出什么

### 1.1 产出

在 data-graph 内新增 **一种** 快照来源 `TASK_LOCAL_UNION`。data-graph 现已有 `LEGACY_ARTIFACT_PAIRS` 与 `DIRECT_PROJECT_EVIDENCE` 两种 mode（后者来自 `project-evidence-root-traversal`）；本 WP 是第三种，**与前两种互斥、不混用、不改前两种行为**。

```text
ProjectTopologySnapshotV1
  sourceMode: TASK_LOCAL_UNION
  taskSources[]     每任务一条：taskId、投影 contentHash、packContentHash、factsManifestSha256、coverageStatus
  producerIndex     contentHash + inputFingerprint（沿用现有校验）
  batchManifestRef  sql-static-lineage 侧 batch-manifest.json 的路径 + contentHash（建议命名）
  nodes / edges     并集后的拓扑记录（去重后）
  无 rootTaskIds    并集图没有 root 语义
```

并集后的图可被现有 **topology 投影、字段证据叠加、文件查询、Neo4j 索引** 管线消费（M3 里程碑）。

### 1.2 不产出

- 不替代 `LEGACY_ARTIFACT_PAIRS` / `DIRECT_PROJECT_EVIDENCE`（已发布 root 快照、六个参考查询、快照 ID 算法保持不变）
- 不提高 `loadProjectTopologySources` 的 `maxRoots = 32`
- 不在 loader 里跑 multi-hop / field-lineage 闭包去「补全」局部投影
- 不把 WP-4 `processingKind` 做进本 WP
- 不把 `target-table-upstream-causal-closure` 重跑引擎搬进 loader
- 不把 `scheduleReference` 当数据血缘参与字段/表推导（§6）

---

## 2. 原料（全部来自 sql-static-lineage 已发布产物）

| 输入                   | 路径（典型）                                                 | 用途                                                                    |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `batch-manifest.json`  | `<project-graph-root>/batch-manifest.json`                   | 任务列表、覆盖汇总、每任务 `contentHash` / `cacheKey` / `path`          |
| 投影 **envelope**      | `<project-graph-root>/tasks/<id>/task-local-projection.json` | 见 §2.2；内含 `projection`（schema **1.1.0 或 1.2.0**；WP-8 INDEX 要求 1.2.0） |
| `TABLE_PRODUCER_INDEX` | data-root 侧 producer-index 产物                             | 并集外 writer 边界；writer 分区（`ProducerWriteObservation.partition`） |
| 调度缓存               | schedule-evidence cache                                      | 仅 `SCHEDULE_ONLY` CANDIDATE writer（§5.3）与展示                       |

WP-5 **不读** `field-lineage.json`、one-hop / multi-hop 闭包文件来构建并集图。

### 2.1 manifest 字段（WP-3 `TASK_LOCAL_BATCH_MANIFEST` 1.0.0）

```text
schemaVersion, artifactType, generatedAt
topic, alsoTaskIds[], topicTaskIds[], taskIds[]
summary { total, projected, scheduleOnly, collectionFailed, byFailureReason }
cache   { hits, misses }
tasks[] { taskId, coverageStatus, failureReasonCode, contentHash, cacheHit, cacheKey, path }
```

`tasks[].contentHash` 是 **投影本体** 的 contentHash（忽略 `generatedAt`），loader 用它校验文件未被改动。

### 2.2 磁盘文件是 envelope，不是裸投影

```text
{
  cacheKey,
  cacheKeyParts { taskId, packContentHash, factsManifestSha256, schemaVersion },
  projectionContentHash,
  projection { schemaVersion:"1.2.0", artifactType:"TASK_LOCAL_PROJECTION", coverageStatus, nodes, edges, contentHash, localClosure?, ... }
}
```

loader 必须：解 envelope → 校验 `projectionContentHash === projection.contentHash === manifest.tasks[].contentHash` → 校验 `projection.schemaVersion` 在支持集合内 → 才并入。`cacheKeyParts.packContentHash` 直接进 `taskSources[]`，不必重读 Task Pack。

1.1.0 仍可被 loader 读取；`union-continuation-index` 预检要求批内全部 `PROJECTED` 为 **1.2.0**。

### 2.3 上游契约要点（WP-3 1.2.0）

| 字段 / 结构                                              | WP-5 用法                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `READ_OCCURRENCE` 节点 + 两跳 `READS`                    | WP-8 v2 接续键；并集 merge 按 `edgeId` 去重                                                                                                        |
| `coverageStatus`                                         | `PROJECTED` 并入完整边；`SCHEDULE_ONLY` 仅 TASK + `scheduleReference`；`COLLECTION_FAILED` 仅 TASK + `failureReasonCode`（作显式边界，不进数据边） |
| `scheduleReference.role`                                 | 必须为 `SCHEDULE_REFERENCE_ONLY`；不得参与 §5 拼接                                                                                                 |
| `READS.partitionPredicates` + `partitionPredicateStatus` | `LITERAL` / `NON_LITERAL_PRESENT` / `NONE`，一表多写剪枝的读侧输入                                                                                 |
| `WRITES` 两跳                                            | `TASK→TARGET_WRITE` 与 `TARGET_WRITE→PHYSICAL_DATASET` 同 edgeType，靠端点类型区分（TU-3 决定并集侧表达）                                          |
| `DATASET_CONTROL.writeObservationId`                     | 多 WRITE 任务上控制边归属                                                                                                                          |
| `PHYSICAL_FIELD` 五元组                                  | 并集去重键，与 field-evidence 图同 ID 空间                                                                                                         |

---

## 3. 与现有两种 mode 的关系

```text
LEGACY_ARTIFACT_PAIRS     root → one-hop + multi-hop 文件对 → per-root 快照     maxRoots=32
DIRECT_PROJECT_EVIDENCE   root → 冻结 project-evidence + 根 overlay             仍 root 驱动
TASK_LOCAL_UNION（本 WP） 每任务局部投影 → 并集快照 → 查询期展开             无 root
```

硬性要求：

1. `sourceMode` 枚举新增 `TASK_LOCAL_UNION`；**不**改另两种的校验逻辑、默认值、快照 ID 算法。
2. 三种 mode **不得**出现在同一份快照。
3. legacy 路径 `tests/real-artifact-closed-loop.test.ts`（或其当前等价）与六个参考查询 **逐字节回归**。
4. 节点 ID 算法与 WP-3 / 已发布 root 快照 **同一套**（`taskNodeId`、`physicalDatasetNodeId`、`fieldEvidencePhysicalFieldNodeId`、`targetWriteNodeId`）。
5. 边类型词汇 **复用 data-graph 现有** `READS` / `WRITES` / `PRODUCER_BRIDGE` / `SCHEDULE_DEPENDS_ON`；不新造同义词。若并集需要新类型（如 TU-3 的 `MATERIALIZES`），必须在 spec 中登记并说明与现有词汇的关系。

---

## 4. 并集合并规则（构建期）

### 4.1 节点

| nodeType           | 合并键                             | 策略                                                                     |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| `TASK`             | `taskNodeId(taskId)`               | 每任务恰一份投影，天然唯一；保留 `scheduleReference` 与 `coverageStatus` |
| `PHYSICAL_DATASET` | `physicalDatasetNodeId`            | 同 nodeId 合并；见 §4.2 身份分歧                                         |
| `PHYSICAL_FIELD`   | `fieldEvidencePhysicalFieldNodeId` | 全局唯一，不按任务复制                                                   |
| `TARGET_WRITE`     | `targetWriteNodeId`                | 含 taskId，**不得跨任务合并**                                            |

### 4.2 物理表身份分歧（必须显式）

WP-3 投影器在 catalog 无唯一匹配时用 fallback（`pack.target` 的 platform/dataSource，或 `hive/unknown`）算 `physicalDatasetNodeId`。因此 **同一 qualifiedName 可能在两个任务里得到不同 nodeId**。

TU-2 必须：

- 按 `normalizeName(qualifiedName)` 聚合，检出一名多 id 的情况，输出 `DATASET_IDENTITY_DIVERGENT` gap（建议命名），列出各任务的 platform/dataSource 取值；
- **不**自动合并成一个节点（那会伪造接续）；
- 金样 TU-7 要求三金样涉及的表零分歧。

### 4.3 边

- 并集键 = WP-3 `edgeId`；同 `edgeId` 属性不一致 → `UNION_EDGE_CONFLICT` gap（建议命名），不静默覆盖。
- 保留 WP-3 五类边；`PRODUCER_BRIDGE` **不**来自 WP-3（WP-3 禁止写它），只能是 §5 的派生层。
- `SCHEDULE_ONLY` / `COLLECTION_FAILED` 任务：仅 `TASK` 节点，**无数据边**，显式存在于图上。

---

## 5. 跨任务接续（核心）

WP-3 故意不在局部纸条上写「上游是 119044」。接续分两层（**另有 WP-8 读次级 v2**，见下）。

### 5.0 WP-8 读次×写观察接续（已实现，data-graph）

与 §5.1 表级 `traceUnionUpstream` 并存：

| 组件 | 路径 |
| --- | --- |
| v2 内核 | `task-local-union-continuation-v2.ts` |
| 批索引 | `union-continuation-index.ts` + CLI `npm run union-continuation-index` |
| 消费（闭包，暂停） | sql-static-lineage `union-continuation-candidate-source.ts` |

金样调查页 **推荐**消费 `UNION_CONTINUATION_INDEX` + 批内纸条（见 `docs/execution-plan-gold-case-investigation.md` §2）；`visualize-task-local-machine-graph` 仅可选人读。

### 5.1 第一层：并集图内部对接（不需要 producer-index）

```text
消费者任务 T 的 READS → PHYSICAL_DATASET D
在并集图中找所有 TARGET_WRITE →WRITES→ D，回到各自 TASK W
```

只要 writer 已 `PROJECTED`，它的 WRITES 边就在并集图里，**表级 upstream 直接可走**。这是 M3 的主路径；六个参考查询里的 upstream tracing 应能在此路径上工作。

### 5.2 第二层：并集外 writer（producer-index 补边界）

对 D，取 producer-index `confirmedProducerEdges` 中写 D 的任务集合 P。对 `P − 并集内 writer`：

- 该 writer 任务有 Task Pack 但未在本批投影 → 输出边界 `WRITER_NOT_IN_UNION`（建议命名），可选派生 `PRODUCER_BRIDGE(W→D, provenance=PRODUCER_INDEX)`；
- 派生边 **单独落**（例如 `union.derived-edges.jsonl` 或带 `derived=true` 标记），不混入 WP-3 局部边，构建期可做，但必须能一键关闭以验证 §5.1 单独成立。

### 5.3 第三层：`SCHEDULE_ONLY` writer（仅 CANDIDATE）

`SCHEDULE_ONLY` 任务没有 Task Pack，**不在 producer-index 里**。唯一线索是调度缓存的 `targetTable`。

- 若调度缓存 `targetTable` 归一化后等于 D → 输出 `CANDIDATE` writer（证据状态 `CANDIDATE`，不得升 `CONFIRMED`）；
- WP-3 1.1.0 的 `scheduleReference` **不含 targetTable**。两种取法：(a) WP-5 loader 自己读调度缓存；(b) 开 **WP-3.2** 在 `scheduleReference` 增加 `targetTable`（推荐，保持单一入口）。TU-0 前决定并记入 design。

### 5.4 一表多写剪枝

**读侧**：READ 边 `partitionPredicates` + `partitionPredicateStatus`。
**写侧**：writer 的分区来自 producer-index `ProducerWriteObservation.partition`（`PartitionAssignment[]`，附 `partitionStatus` / `partitionReasonCodes`），其源头是 Task Pack `partition`。并集图 WRITES 边本身不带分区，TU-4 需从 producer-index 或 Task Pack 取。

| 读侧状态              | 写侧分区                  | 结果                                                                  |
| --------------------- | ------------------------- | --------------------------------------------------------------------- |
| `LITERAL`             | 有确定分区赋值            | 保留分区值匹配的 writer；无匹配 → 全部保留 + `PARTITION_NO_MATCH` gap |
| `LITERAL`             | `LEGACY_UNKNOWN` / 无分区 | 不剪，标 `WRITER_PARTITION_UNKNOWN`                                   |
| `NON_LITERAL_PRESENT` | 任意                      | 不剪，标 `READ_PREDICATE_NON_LITERAL`                                 |
| `NONE`                | 任意                      | 表级扇入，全部 writer                                                 |

分区字段名与谓词列名按 `normalizeName` 匹配；只比对等值/IN 字面量。**禁止**用 `scheduleReference` 替代任何一格。

### 5.5 字段级接续

`FIELD_DIRECT` 在 WP-3 为 `PHYSICAL_FIELD → TARGET_WRITE`。跨任务字段 walk：并集图上的物理字段节点 + writer 任务的 `TARGET_WRITE` 子图；不引入新的跨 task 边类型。`subtype = UNKNOWN` 不阻塞表级接续（精化属 WP-4）。

---

## 6. 调度参考（`scheduleReference`）

### 6.1 处理

| 层级               | 做法                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 并集属性           | 原样保留在每个 TASK 节点上                                                                                                  |
| 可选展示边（TU-5） | 从属性生成全局 `SCHEDULE_DEPENDS_ON`（data-graph 已有该边类型）；**不参与** §5                                              |
| 校验               | `scheduleReference` 中的 taskId 不得出现在 `READS`/`WRITES`/`FIELD_*`/`DATASET_CONTROL` 端点（WP-3 已验，并集不引入新违规） |

### 6.2 对 WP-3 的一个小需求（WP-3.2，非本 WP）

为支撑 §5.3，建议 `scheduleReference` 增加 `targetTable: string | null`（来自调度缓存），role 不变。若不做，WP-5 自行读调度缓存并在 design 里记录双入口的风险。

---

## 7. 硬约束

违反其一即失败。

1. 不改 sql-static-lineage 的 Facts / Plan / SQLLens 生产；不改 WP-3 投影器（需要字段走 WP-3.2）。
2. 不修改 `LEGACY_ARTIFACT_PAIRS` / `DIRECT_PROJECT_EVIDENCE` 路径行为、快照 ID、`maxRoots`。
3. loader **不**调用 multi-hop / field-lineage 生产闭包。
4. WP-3 局部边与派生边（`PRODUCER_BRIDGE` 等）**物理分开**并带 provenance；关闭派生层时 §5.1 仍可独立走通。
5. `DATASET_CONTROL` 不得挂到字段节点；不得恢复 `affectedRootFields`。
6. 证据三态不升级：`SCHEDULE_ONLY` 的 targetTable 线索只能是 `CANDIDATE`；`COLLECTION_FAILED` 不得伪装为 `PROJECTED`。
7. `scheduleReference` 不得参与字段/表级推导与一表多写剪枝。
8. 同一输入（manifest contentHash + 各投影 contentHash + producer-index `contentHash`）两次构建，nodes/edges/gaps 集合一致（忽略 `generatedAt`）。
9. 物理表身份分歧只报不合；不得为「让链通」手动归并 nodeId。
10. 不把 WP-4、指标目录、运行时交付做进本 WP。

---

## 8. 工作包

```text
TU-0  TASK_LOCAL_UNION 快照契约 + 校验器（含 envelope 解包）
TU-1  从 batch-manifest + envelope 加载并校验 contentHash 三方一致
TU-2  节点/边并集合并；身份分歧与边冲突 gap；边界节点
TU-3  边语义冻结（WRITES 两跳 vs MATERIALIZES；PRODUCER_BRIDGE 派生层格式）
TU-4  接续核：并集内 WRITES 对接 + producer-index 边界 + 一表多写剪枝
TU-5  可选：scheduleReference → SCHEDULE_DEPENDS_ON 展示边
TU-6  legacy / direct 回归（六个参考查询、real-artifact closed-loop、快照 ID）
TU-7  金样：105387 → 119044 → 176827 并集链 + 与已发布 root 快照 nodeId 比对
TU-8  成本与查询延迟留档
```

### TU-0 快照契约

**目标**：`ProjectTopologySnapshotV1` 支持 `sourceMode: TASK_LOCAL_UNION`；`taskSources[]` 条目类型（§1.1）；与另两种 mode 互斥校验；envelope 解包与三方 contentHash 校验函数。
**同时决定**：§5.3 取 targetTable 的路径（WP-3.2 还是自读调度缓存）。

**完成定义**：契约 + validate；拒绝混 mode、空 taskSources、producer-index 指纹不匹配、envelope hash 不一致、不支持的 `projection.schemaVersion`。

### TU-1 Loader 内核

**目标**：`loadTaskLocalUnionSources({ manifestPath, projectGraphRoot, producerIndexPath })`：读 manifest → 逐任务读 envelope → 校验 → 产出待合并集合。

**完成定义**：合成 manifest + 3 份 envelope 夹具（1 PROJECTED / 1 SCHEDULE_ONLY / 1 COLLECTION_FAILED）loader 绿；任一 contentHash 不一致 fail closed；`COLLECTION_FAILED` 只产 TASK 边界节点。

### TU-2 并集合并

**目标**：按 §4 合并；输出 snapshot body + 合并报告（去重计数、`DATASET_IDENTITY_DIVERGENT`、`UNION_EDGE_CONFLICT`）。

**完成定义**：夹具中同一表在两任务里出现 → 一个节点；人为构造 fallback 身份分歧 → 报 gap 不合并；`SCHEDULE_ONLY` 无数据边。

### TU-3 边语义冻结

**目标**：决定并集 topology 记录里 WP-3 `WRITES` 两跳的表达；决定 `PRODUCER_BRIDGE` 派生层的文件与 provenance 字段；与 Neo4j label 对齐。

**完成定义**：spec 登记边类型枚举；测试锁定；文档同步到本文件与 WP-3 文档（只读引用，不改 WP-3 产物）。

### TU-4 接续核（主门槛）

**目标**：实现 §5.1–5.4，供 file-query / 地图 API 调用。

**完成定义**（真 Facts）：

- 176827 READ `pdata_n.t98_sb_otc_opt_comp_info` → 并集内 writer 含 119044（§5.1，不用 producer-index）
- 119044 READ `pdata_n.t03_agt_stati_info_h` → 并集内 writer 含 105387
- 119044 READ `pdata_n.t03_otc_opt_comp_info` → 三金样并集内无 writer → 走 §5.2 边界（producer-index 有则 `WRITER_NOT_IN_UNION`，无则 `NO_KNOWN_WRITER`）
- 119044 两次读 `t03_agt_stati_info_h` 的 `SRC_TBL` 字面量分别与 writer 分区对照，期望从 105387 Task Pack `partition` 生成，不手抄
- `NON_LITERAL_PRESENT` 返回 gap，不返回假唯一 writer
- 关闭派生层后以上 §5.1 断言仍成立
- 单测锁死：`scheduleReference` 不进入剪枝输入

### TU-5 调度展示边（可选）

**完成定义**：并集图可选导出 `SCHEDULE_DEPENDS_ON`；TU-4 结果不因 TU-5 开关而变。

### TU-6 回归

**完成定义**：`tests/real-artifact-closed-loop.test.ts`（或当前等价）绿；六个参考查询在 legacy / direct 快照上逐字节不变；新增 TU 测试不破坏现有 CI job。

### TU-7 金样（发布门槛）

**原料**：WP-3 已产出的 105387 / 119044 / 176827 envelope + producer-index（`--no-prepare-facts`）。

1. `pdata_n.t98_sb_otc_opt_comp_info`、`pdata_n.t03_agt_stati_info_h` 各仅一个 `PHYSICAL_DATASET` 节点；三金样涉及的表零 `DATASET_IDENTITY_DIVERGENT`。
2. TU-4 从 176827 走到 119044，再从 119044 走到 105387（经 `t03_agt_stati_info_h`）。
3. 并集图 WP-3 局部边中 **无** `TASK→TASK` 边；派生层若有 `PRODUCER_BRIDGE` / `SCHEDULE_DEPENDS_ON` 必须类型可区分、带 provenance。
4. 与已发布 root 快照：相同 task / dataset / field 的 nodeId 交叉比对留档；允许边集合差异，nodeId 不得系统性漂移。
5. 105387 四张 ref 仅在 105387 子图 `DATASET_CONTROL`，不出现在 176827 子图 `READS`。

### TU-8 成本留档

**目标**：`DM_RSK_N` manifest（~65 任务）并集构建墙钟 / p95；TU-4 单次表级接续 p50 / p95；与 WP-3 `cost-dm-rsk-n.md` 对照。

**完成定义**：写入 change 的 `cost-task-local-union.md`；不写进 task artifact。

---

## 9. 完成时看起来怎样

1. data-graph 可选择 `TASK_LOCAL_UNION` 构建项目拓扑快照，无需 rootTaskIds。
2. 地图 / 文件查询 / Neo4j 索引与另两种 mode **共用**下游管线，仅 source loader 不同。
3. 从 176827 查上游：看到 **并集内 SQL writer**（119044）、**并集外 writer 边界**（producer-index）、**调度邻居**（`scheduleReference`，可与前两者不一致并显式标注）。
4. 一表多写：读侧字面量 + 写侧分区都有时可剪；任一侧缺 → 表级扇入 + 具名 gap，不假装唯一。
5. legacy / direct 路径任何人跑结果与 WP-5 合并前完全一致。

---

## 10. 明确不做

- 不实现 WP-4 `processingKind`。
- 不把 field-lineage / multi-hop 闭包塞进并集 loader。
- 不用调度边替代 SQL 表级接续。
- 不在本 WP 做全库 13,740 任务生产化（TU-8 后扩批，非完成定义）。
- 不修改 sql-static-lineage 的 `project-task-local` CLI 与投影器（字段需求走 WP-3.2）。
- 不把 `target-table-upstream-causal-closure` 引擎替换为并集图遍历。
- 不为「让金样链通」手工归并 nodeId 或伸手改 catalog。

---

## 11. 领取顺序

| 包   | 领取                                        |
| ---- | ------------------------------------------- |
| TU-0 | 立即（阻塞一切；含 §5.3 取数路径决策）      |
| TU-1 | TU-0 后                                     |
| TU-2 | TU-1 后                                     |
| TU-3 | 与 TU-2 并行起步，**并集导出前**必须冻结    |
| TU-4 | TU-2 后；主门槛                             |
| TU-5 | 可选；与 TU-4 并行                          |
| TU-6 | 每个 TU 合入前跑                            |
| TU-7 | TU-4 + TU-2；发布门槛                       |
| TU-8 | TU-2 后（loader 成本）；TU-4 后（查询成本） |

派单 WP-5 时必须同时给出：本文件、`docs/execution-plan-task-local-projection.md`（WP-3 契约）、`docs/domain-asset-graph-architecture.md`（共享不变量）、data-graph 现有 `project-evidence-root-traversal` 的 design（避免与 `DIRECT_PROJECT_EVIDENCE` 重复造轮子）。

每个包合入前（data-graph 仓）：`npm run typecheck` / `build` / `test` / `format:check` 全绿；**且** legacy / direct 快照测试绿。

---

## 12. 何时算解决

**算解决**：

- `TASK_LOCAL_UNION` loader 从 WP-3 manifest + envelope 构建并集快照，三方 contentHash 校验 fail closed；
- TU-7 金样链在 TU-4 上走通，且关闭派生层后 §5.1 部分仍成立；
- 一表多写按 §5.4 表格行为，读写两侧缺一即具名 gap；
- 身份分歧只报不合；
- legacy / direct 零回归；nodeId 与 root 快照交叉比对留档；
- `scheduleReference` 仅参考（单测 + 文档）。

**不算解决**：

- 构建期用 multi-hop 补边；
- 把 producer-index 当并集内 writer 的**唯一**来源（并集内应先用 WRITES 边）；
- 用 `scheduleReference.upstreamTaskIds` 或调度 `targetTable` 当 `CONFIRMED` writer；
- 一表多写静默选一个 writer；
- 为让链通合并不同 nodeId 的同名表；
- 改动 `maxRoots` 或 legacy / direct 快照 ID 算法；
- `SCHEDULE_ONLY` / `COLLECTION_FAILED` 任务从图上消失；
- 把「并集图 walk 到四张 ref」写成 WP-5 完成定义（ref 只在 105387 局部子图）。
