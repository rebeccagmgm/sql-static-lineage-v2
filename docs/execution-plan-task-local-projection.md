# WP-3 任务局部投影：执行方案

配套：`docs/domain-asset-graph-architecture.md`（契约）、`docs/execution-plan-asset-graph.md`（总地图）。
WP-1 已合入（`cdc187a` / PR #10）。本文件只解决一件事：

**每个任务交一份只含自己 SQL 能证明之事的投影，不往上游走、不写上游 taskId。**

领取：`openspec new change "task-local-graph-projection"`，再补 proposal / specs / design / tasks。
代码落在 `scripts/project-graph/task-local/`。不写入 `artifacts/tasks/<task-id>/`。
不改 SQLLens、Plan Facts、Machine Facts、one-hop / multi-hop / field-lineage 生产、因果闭包播种。

金样：**176827**（终点，97 列）、**119044**（中间跳，15 个 LEFT JOIN + 15 条 `SRC_TBL` 谓词）、**105387**（拉链 + 分区谓词）。
三份纸条正好是 105387 → 119044 → 176827 一条链上的三段，但本 WP 只验每段自己。
105387 属于 `EDW_AGT`、119044 写 `pdata_n`，都不保证在 `DM_RSK_N` 63 个调度任务里，必须**额外点名投影**，不能指望首批域名单把它们带出来。
不用 155015：它自己不读拉链表，任何「不含四张 ref」的断言对它都是空断言。

---

## 1. 它产出什么、不产出什么

每任务一份 `TASK_LOCAL_PROJECTION`，落在图投影根下（与 data-graph 的 project-graph 输出根同类，不进 task artifact 目录）。

```text
176827 纸条
  TASK 176827
  WRITES  → TARGET_WRITE(write-observation:176827:platform-target:0)
           → PHYSICAL_DATASET dm_rsk_n.otc_opt_greek_val_det_h
  READS   → READ_OCCURRENCE → PHYSICAL_DATASET t98_sb_otc_opt_comp_info
  FIELD_DIRECT  本任务输出列 → 本任务 SQL 读到的物理列
  DATASET_CONTROL  JOIN/FILTER 控制列 → 本任务 TARGET_WRITE
  没有「上游是 119044」
```

任务之间以后对得上，靠**同一张物理表的身份**，不是靠纸条上的上游任务号：

```text
176827 READS  t98_sb_otc_opt_comp_info
119044 WRITES t98_sb_otc_opt_comp_info     ← 119044 自己的纸条，WP-3 投影 119044 时才有
查询时（WP-5 / 查询核）查 producer-index：谁 WRITE 了这张表
```

本 WP **禁止**：读 producer-index 去填边、跑 multi-hop、把 `PRODUCER_BRIDGE` 写进局部投影、为金样去「递归展开到四张 ref 的上游任务」。
四张拉链 ref 出现在 **105387 自己的** `DATASET_CONTROL` 上，不出现在 176827 的纸条上。

`processingKind` 是 WP-4。本 WP 的 TASK 节点可以没有该字段，或显式 `null`。不要在这里实现加工/通道识别。

## WP-7 增量（2026-09-02，已合入 main）

WP-3 的 1.1.0 是历史兼容格式；当前 `projectTaskLocal` 生产 `TASK_LOCAL_PROJECTION`
1.2.0。1.2.0 将每个 `read_occurrence` 投影为 `READ_OCCURRENCE` 节点，读取路径为
`TASK → READ_OCCURRENCE → PHYSICAL_DATASET`，分区谓词仍只挂在对应读次上。

身份由 catalog exact match 与 `inferTaskDefaultSchema` 佐证决定：不使用 catalog tail
或任务名正则补全裸名；`TASK_NAME` 只有 `ASSUMED` qualification。临时库/临时后缀的
写读在没有 materialization 证据时保持 `CANDIDATE_DATASET`；字段只按当前读表达式的
`read_expression_ids`（其次 `read_statement_id`）唯一匹配 `RESOLVED` 行后折叠，未解决
或冲突行保留边界。投影还提供任务内 `finalWrites` / `externalReads` / `localFieldPaths`
摘要，供 WP-8 使用。
旧 1.1.0 缓存和夹具仍可由 validator 读取，缓存 key 随 1.2.0 自然失效。

**落地验收金样**（`tests/project-graph/task-local/golden-samples.test.ts` WP-7 case；
另有 `identity.test.ts` 覆盖裸名 ASSUMED vs TASK_TARGET）：

| 能力 | 任务 | 断言要点 |
| --- | --- | --- |
| `READ_OCCURRENCE` + `SELF_READ` + 折叠 | 103928 | schema 1.2.0；有自读 disposition；`localFieldPaths` / `materializationFolded` |
| materialization UNRESOLVED 边界 | 105380 | mid 表读次保留 `MATERIALIZATION_NOT_RESOLVED`，不折成 LOCAL |
| 无 materialization 的 temp | 158641 | `temp_n.*` 写表 `identityStatus=CANDIDATE_DATASET` / `TEMP_MATERIALIZATION_MISSING` |
| 多跳本地折叠 | 181058 | `localFieldPaths` 与折叠 `FIELD_DIRECT` |

`graph-accuracy-architecture.md` 调查期候选（103234 / 103230 / 100513 / 100629 / 100815）
未绑本包回归；105387 仍以 WP-3 金样覆盖拉链/控制边，不重复充当 WP-7 temp 清单。

---

## 2. 原料

不是 one-hop / multi-hop。每任务只读自己的 Facts 与调度缓存条目。

| 输入 | 用来干什么 |
| --- | --- |
| `dataset-io.jsonl` | `READS` / `WRITES` / `TARGET_WRITE`（`write_observation_id`） |
| `relation-nodes.jsonl` + `relation-edges.jsonl` + `statements.jsonl` | 交给已有 `summarizeTaskRelations()` |
| `output-field-bindings.jsonl` + `field-expression-nodes.jsonl` + `column-lineage-edges.jsonl` | 本任务内 `FIELD_DIRECT` / `FIELD_CONDITIONAL` |
| `schema-refs.jsonl` | 物理字段身份（platform / dataSource / 表 / 列） |
| 调度缓存（`topicName` / `taskCategory` / `taskName`） | TASK 节点展示属性；无 Pack 时走 `SCHEDULE_ONLY` |
| Input Pack fingerprint + `task-fact-index.jsonl` 的 `sql_sha256` + `manifest_sha256` | 增量缓存键 |

通道映射只准这一张表，不平行发明 `rowDetermining`：

| 图边 | 来自 |
| --- | --- |
| `FIELD_DIRECT` | 本任务 `FIELD_VALUE` 能证明的输出列 ← 输入物理列。**今天的 Facts 与 field-lineage 都没有给值边打 IDENTITY / TRANSFORMATION / AGGREGATION**（WP-1 只给 `DATASET_CONTROL` 加了 subtype；契约里的 `OpenLineageDirectSubtype` 是空声明）。本 WP 的 `subtype` 允许 `UNKNOWN`；要落真值必须在 TL-1 里从 `field-expression-nodes` 新推导并加测试，不得假设已有 |
| `FIELD_CONDITIONAL` | `EXPRESSION_CONTROL` 且 `expression_roles` 含 `BRANCH_SELECTION`；拉链 `IS NOT NULL` CASE 不得进这里 |
| `DATASET_CONTROL` subtype `JOIN`/`FILTER`/`GROUP_BY`/… | 控制列 → 本任务 `TARGET_WRITE`；**复用 WP-1** 的收集与 `grain`，不要重写一份 |
| `grain` | 与 WP-1 相同：FILTER/GROUP BY → `REDUCE`；证不出基数的 JOIN → `EXPAND_RISK`；JOIN 不得 `UNKNOWN` |

`summarizeTaskRelations()` 告诉「哪次 READ 走哪条通道」。落边时用它过滤，不要再实现 JOIN 侧别。
`datasetControlsForStatement` 今天是 field-lineage 内部函数：本 WP 先把它抽到两边都能 import 的小模块，再投影到图边。禁止复制一份 grain 规则。

调度缓存里的 `querySql` / `prepareSql` 仍然不是事实来源。

---

## 3. 身份（必须与 data-graph 同一套算法）

两仓不共享源码。把算法**抄**到 `scripts/project-graph/task-local/ids.ts`，用冻结向量对齐，不 import `scripts/data-graph`。

来源：

- `taskNodeId` / `physicalDatasetNodeId`：`scripts/data-graph/src/project-graph/contracts/project-topology-contract.ts`
- `fieldEvidencePhysicalFieldNodeId` / `targetWriteNodeId`：`scripts/data-graph/src/project-graph/field-evidence/field-evidence-contract.ts`

规则：

- 物理表：`platform | dataSource | qualifiedName` 小写后 `stableId("dataset", …)`
- 物理字段：data-graph 的 `normalizedPhysicalField` 要五元组 `platform | dataSource | stableTableId | qualifiedName | column`，**少 `stableTableId` 就对不上**；列名小写；**一份身份**，不按路径、不按输出字段复制
- `TARGET_WRITE`：`taskId + datasetNodeId + write_observation_id`
- 1.1.0 的 `READS` 边携带 `read_occurrence_id`；1.2.0 将 occurrence 单独成节点，物理表仍是唯一 dataset 身份

同一 `hive|gfhive|dm_rsk_n.otc_opt_greek_val_det_h` 在 176827 纸条和以后的并集图里必须是同一个 `nodeId`。

---

## 4. 覆盖状态

缺证据必须显式存在，禁止静默跳过。

```text
PROJECTED          有 Input Pack 且投影成功
SCHEDULE_ONLY     调度缓存里有这个任务，没有可用 SQL Facts
                  只有 TASK 节点（可带 scheduleUpstreamTaskIds 属性）；不写任何边
COLLECTION_FAILED 有 Pack 或 Facts 但投影失败；产物里写原因码
```

首批按调度缓存枚举 `DM_RSK_N`（约 63 个）。域只排批次，**不写入投影契约的 scope**。
批次里没有的任务（如 105387）不会以 `SCHEDULE_ONLY` 自动出现在这份批次清单里——这不是切断血缘：176827 的 occurrence 仍指向物理表 `t98_sb_otc_opt_comp_info`；等 119044 被投影后，WRITES 对上同一张表。

---

## 5. 增量

缓存键：`taskId + Input Pack content hash + facts manifest_sha256`（沿用 `task-fact-index.jsonl`）。
命中则跳过投影，输出字节与上次相同（忽略 `generatedAt`）。
Facts 未变、Pack 未变而投影代码变了：必须有 schema/投影版本进入缓存键，避免 silently 复用旧边。

二次全批：未变任务全部命中。变了的只重跑自己，不级联重跑下游。

---

## 6. 硬约束

违反其一即失败。

1. 不改事实生产。不够就 typed gap，不猜。
2. 不引入新解析器。
3. 投影过程不读 producer-index、不读其它任务的投影、不跑 one-hop/multi-hop。
4. **数据边**（`READS` / `WRITES` / `FIELD_*` / `DATASET_CONTROL`）里不得出现其它 `taskId`：1.2.0 的 `READS` 只连接当前 TASK、`READ_OCCURRENCE` 与物理表，不连接上游 TASK。调度缓存里的上下游任务号是**另一类事实**，若要保留只能作为 TASK 节点上的 `scheduleUpstreamTaskIds` 属性，不得变成图边、不得参与任何字段/数据集推导。`SCHEDULE_ONLY` 任务也遵守这条：只有 TASK 节点 + 该属性。
5. `DATASET_CONTROL` 不得挂到输出字段节点，不得产生 `affectedRootFields`。
6. 通道词典不平行发明。权威仍是 `FIELD_VALUE` / `ROW_MEMBERSHIP` / `MULTIPLICITY` / `EXPRESSION_CONTROL`。
7. 证据三态不升级。
8. 已发布 10 份 root 产物与 `LEGACY_ARTIFACT_PAIRS` 行为不变。
9. 不把 WP-4、WP-5、查询期闭包引擎做进本 WP。
10. 对比忽略 `generatedAt`。不要写「contentHash 逐字节含时间戳不变」。

---

## 7. 工作包

```text
TL-0  契约 + 身份函数冻结向量
TL-1  单任务投影核（读 Facts，落节点/边）
TL-2  抽出 WP-1 控制收集，供投影复用
TL-3  覆盖状态 + 失败原因
TL-4  内容哈希缓存
TL-5  批次 CLI（DM_RSK_N + 点名金样）
TL-6  金样断言（176827 / 119044 / 105387）
TL-7  partitionPredicates
TL-8  成本留档
```

### TL-0 契约与身份

**目标**：JSON schema + TypeScript 类型 + 与 data-graph 对齐的 `nodeId`。

**改动**：`scripts/project-graph/task-local/` 契约文件；`ids.ts` 抄算法；测试里冻结至少：

- `task:176827`
- `dm_rsk_n.otc_opt_greek_val_det_h` 的 dataset id
- `write-observation:176827:platform-target:0` 的 target-write id
- `odata_n_tit.d_ref_trs.key_otc_trade_id` 的 physical-field id

向量生成：用同一输入在 data-graph 侧跑一次函数，把结果写进夹具。之后只在 sql-static-lineage 里回归。

**完成定义**：身份测试绿；schema 拒绝跨任务边、拒绝 `affectedRootFields`、拒绝 `rowsetControls`。

### TL-1 单任务投影核

**前置**：TL-0。

**目标**：`projectTaskLocal(taskId)` 只加载该任务 Facts，产出一份投影。

**落边顺序**：

1. TASK、TARGET_WRITE、WRITES
2. 每次 READ → `READ_OCCURRENCE` → PHYSICAL_DATASET + `READS`
3. 每个 RESOLVED output binding → 本任务内 `FIELD_DIRECT`（证不出 subtype 则 `UNKNOWN` + gap，不猜 IDENTITY）
4. `summarizeTaskRelations` 的 READ 通道 ∩ WP-1 控制收集 → `DATASET_CONTROL`
5. `FIELD_CONDITIONAL` 仅 `BRANCH_SELECTION`

**完成定义**：合成夹具（可沿用 WP-1 拉链形状的 demo 表）投影后：值边不含四张 ref；四张 ref 在 `DATASET_CONTROL / JOIN`；控制条数不随输出列数倍增。

### TL-2 复用 WP-1 控制收集

**前置**：TL-1 可先用临时调用；合入前必须抽公共模块。

把 `datasetControlsForStatement`（及 grain）从 `field-lineage.ts` 挪到两边都能用的文件。field-lineage 行为字节级不改（回归 `npm run test:field-lineage`）。

**完成定义**：field-lineage 测试仍绿；任务局部投影的 JOIN `grain` 与同一 Facts 上 WP-1 控制一致。

### TL-3 覆盖状态

无 Facts：`SCHEDULE_ONLY`。投影 throw：`COLLECTION_FAILED` + 原因码（`FACTS_UNAVAILABLE` / `NO_RESOLVED_WRITE` / `SCHEMA_UNRESOLVED` / …）。批次汇总计数。

**完成定义**：人为抽掉某个任务 Facts 再跑批，该任务出现在失败/仅调度列表，其它任务仍 `PROJECTED`。

### TL-4 缓存

命中条件见第 5 节。投影版本号进入键。

**完成定义**：同一批跑两次，第二次全部 cache hit；故意改一任务 SQL hash，只该任务 miss。

### TL-5 批次 CLI

```text
npm run project-task-local -- \
  --data-root <data-root> \
  --facts-root <facts-root> \
  --schedule-cache <schedule-evidence> \
  --topic DM_RSK_N \
  --also-task-ids 105387,119044 \
  --output-root <project-graph-root> \
  --no-prepare-facts
```

`--topic` 只过滤调度缓存里的任务列表。`--also-task-ids` 强制投影金样（105387、119044）。
默认不准备 Facts。缺包的任务走 TL-3。

**完成定义**：DM_RSK_N 名单上每个缓存任务都有一份投影文件或状态记录。105387 / 119044 即使不在该 topic 也被写出。

### TL-6 金样（主门槛）

用现有 Input Pack / Facts，`--no-prepare-facts`。不要为金样重建 field-lineage。

**176827（主）**

1. 一个 `TARGET_WRITE`：`write-observation:176827:platform-target:0` → `dm_rsk_n.otc_opt_greek_val_det_h`。
2. `FIELD_DIRECT` 按输出列存在；`DATASET_CONTROL` 条数不随 97 列倍增（量级跟 relation×控制列走，允许与 WP-1 单任务控制数对照，允许因「只含本任务」而少于 field-lineage 的 502——502 含上游任务控制）。
3. 本任务投影的节点里 **不得出现** 其它 taskId。
4. `READS` 恰好 11 个物理表（`pdata_n` 7 张、`pdata_nds.pos_eod_position_view`、`pdata_news_n` 3 张）。`pdata_news_n.t02_pub_covt_const`、`pdata_n.ref_cd_cvt_map` 等只在本任务 SQL 的 JOIN/FILTER 里出现的表，只能以 `DATASET_CONTROL` 出现，不能成为 97 列的 `FIELD_DIRECT` 起点（除非某列值真的来自该表，须点名列，不得整表广播）。断言用的表名以 176827 自己的 `dataset-io.jsonl` READ 清单为准，不得写 119044 读的表（`t03_agt_rela_h` 是 119044 的读表，不是 176827 的）。
5. 四张拉链 ref 与 `t03_agt_*`、`t01_pty_*` **不得**作为 176827 纸条上的 `READS` 目标——它们不是 176827 的 SQL 读表。

**119044（中间跳，控制边不扩散）**

Facts 基线（`pdata_n`，写 `t98_sb_otc_opt_comp_info`，79 列全 RESOLVED）：读 14 张表，15 个 JOIN 全为 LEFT，16 个 FILTER，其中 15 个带 `SRC_TBL` 字面量。

1. 一个 `TARGET_WRITE`：`write-observation:119044:0` → `pdata_n.t98_sb_otc_opt_comp_info`。`READS` 恰好 14 个物理表，且都是本任务 `dataset-io.jsonl` 里的 READ；不得出现 176827 的 `otc_opt_greek_val_det_h`，也不得出现 105387 的四张 ref。
2. **值边不扩散**：`FIELD_DIRECT` 的起点按表统计要与 `column-lineage-edges.jsonl` 一致，量级冻结在测试里：`t03_otc_opt_comp_info` 约 26 列（主表）、`t01_pty_name` 6 列、`t03_agt_stati_info_h` 2 列（`inr_ord_id`、`book_bel_dept`）、`t03_agt_rela_h` 2 列（`book_agt_id`、`book_agt_modifr`）、`ref_dw_cd_val` / `t03_agt_stat_h` / `t03_agt_clas_h` / `t01_pty_rat` / `t01_pty_clas_h` / `t01_pty_cutp` / `t03_agt_name_h` 各 1 列。任何一张 LEFT 维表不得成为 79 列的整表 `FIELD_DIRECT` 起点。
3. **控制边**：15 个 LEFT JOIN 各自的 ON 列与 15 条 `SRC_TBL` FILTER 列全部以 `DATASET_CONTROL` 挂到 `TARGET_WRITE`；JOIN `grain` 不得 `UNKNOWN`（LEFT 证不出基数 → `EXPAND_RISK`）；FILTER → `REDUCE`。控制条数量级 = relation × 控制列，**不得**乘 79。
4. 本任务纸条里不得出现 105387 / 176827 或任何其它 `taskId`。`t98_sb_otc_opt_comp_info` 被 176827 读、`t03_agt_stati_info_h` 被 105387 写（本任务读它两次，`SRC_TBL` 字面量各异），这两条对接留给 WP-5 用物理表身份去做。`t03_otc_opt_comp_info` 的 writer 不在三金样内。

**105387（强制点名）**

1. `Stati_Cont_Desc`（或实际 binding 列名）的 `FIELD_DIRECT` 只到 `D_TRD_OTC_TRADE.INTERNAL_TRADE_ID`（及本任务内等价拷贝），不含四张 ref。
2. 四张 ref 以 `DATASET_CONTROL / JOIN` 出现，带 `grain`（预期 `EXPAND_RISK` + 可空侧 reason），各允许伴随 `FILTER/REDUCE`。
3. `existenceCaseSelections` 用到的拉链列（`Agt_Modifr` 等）走控制/条件通道，不把四张 ref 标成值来源。
4. **不要**在本 WP 断言「递归后可达四张 ref 的上游任务号」。那是查询期。

### TL-7 `partitionPredicates`

从本任务 FILTER 中抽出**字面量**谓词：列 + 值集合。只认常量，不解析跨表子查询。

**粒度按 READ（`read_occurrence_id`），不按任务合并。** 119044 的 15 条 `SRC_TBL` 里同时有 `ODATA_N_TIT.D_REF_OTC_OPTION_DEAL` 和 `ODATA_N_TIT.D_TRD_OTC_TRADE`，分别挂在不同 relation 上；合并成任务级 `{SRC_TBL: [两值]}` 会让查询侧剪多写入方时剪错。产物形状：1.1.0 为每条 `READS` 边，1.2.0 为 occurrence → dataset 的 `READS` 边，各自带一组 `partitionPredicates`，任务级只做汇总视图（可省）。

105387 完成定义：`D_TRD_OTC_TRADE` 那次读的谓词含 `SRC_TBL = ODATA_N_TIT.D_TRD_OTC_TRADE`（大小写与 Facts 里的字面量一致，测试里规范化后再比）。

119044 完成定义：`t03_agt_stat_h` 那次读带 `SRC_TBL = ODATA_N_TIT.D_REF_OTC_OPTION_DEAL`，`t03_agt_stati_info_h` 那次读带 `SRC_TBL = ODATA_N_TIT.D_TRD_OTC_TRADE`（具体读—值对照以 Facts `relation-nodes.jsonl` 的 FILTER `source_text` 为准，测试从 Facts 生成期望，不手抄）；同一任务两种 `SRC_TBL` 值不得混到同一条 `READS` 上。

176827 若 SQL 带 `SRC_TBL` 字面量，同样落下；没有则产物里该数组为空，不算失败。

查询侧用谓词剪多写入方是 WP-5 / 查询核，本 WP 只落数组。

### TL-8 成本留档

首批（63 + 105387 + 119044）记下：单任务 p50/p95、全批墙钟、cache hit 第二次全批。写入本 change 的 `cost-dm-rsk-n.md`，不写进 task artifact。

---

## 8. 完成时看起来怎样

给后续 WP-5 的是 N 份互不引用 taskId 的文件 + 一份批次清单（taskId、覆盖状态、投影 sha256、Pack fingerprint）。

用 105387 + 119044 + 176827 三份文件**人工**能对上拉链故事：105387 写 `pdata_n.t03_agt_stati_info_h` 并 JOIN 四张 ref；119044 主读 `t03_otc_opt_comp_info`、两次读 `t03_agt_stati_info_h`、LEFT JOIN 13 张维表、写 `t98_sb_otc_opt_comp_info`；176827 读 `t98`。三份纸条互不引用对方 taskId，程序在本 WP **不必**把它们拼成一条路径。

二次运行未变任务 cache hit。`npm run test` 里聚焦新测试 + `test:field-lineage` + `test:target-table-causal-closure` 仍绿。

---

## 9. 明确不做

- 不实现 `TASK_LOCAL_UNION` loader（WP-5）。
- 不实现 `processingKind`（WP-4）。
- 不跑 209119 当语义金样（体积点检可附在 TL-8，不是主门槛）。
- 不把 field-lineage 的跨任务节点抄进局部投影。
- 不开放 Calcite / 新解析器。
- 不改 `joinSideChannels()`、不改闭包播种。
- 不把「并集图上从 176827 走到四张 ref」写成 WP-3 完成定义。

---

## 10. 领取顺序

| 包 | 领取 |
| --- | --- |
| TL-0 | 立即 |
| TL-1 | TL-0 后 |
| TL-2 | 可与 TL-1 并行起步，合入前必须接上 |
| TL-3 / TL-4 | TL-1 后可并行 |
| TL-5 | TL-3 + TL-4 |
| TL-6 | TL-5；主门槛 |
| TL-7 | 可与 TL-6 并行；105387 / 119044 金样在 TL-6 收紧谓词 |
| TL-8 | TL-5 之后 |

每个包合入前：`npm run typecheck`；涉及 field-lineage 抽取时加 `npm run test:field-lineage`；不改闭包也要 `npm run test:target-table-causal-closure` 作回归。

---

## 11. 何时算解决

DM_RSK_N 缓存任务全部有状态；105387 / 119044 被点名投影；176827 / 119044 / 105387 的**本任务**断言通过；控制边不随输出列倍增；`partitionPredicates` 按 READ 落；身份与 data-graph 冻结向量一致（含 `stableTableId`）；未写 `artifacts/tasks/*`；闭包与 field-lineage 回归绿。

**不算解决**：数据边里出现上游 taskId；为了对上拉链去读 producer-index；把 105387 → 119044 → 176827 跨任务链当成 WP-3 测试；控制边按 97 / 79 列复制；`FIELD_DIRECT` 在没有推导代码的情况下写死 `IDENTITY`；用 155015 之类自己不读拉链表的任务做「不含 ref」断言。
