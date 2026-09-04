# 图谱准确性架构（Accuracy-first，基于全量语料）

配套：`docs/graph-user-narrative.md`（对用户怎么讲准/不准）、`docs/execution-plan-asset-graph.md`（WP 总地图）、
`docs/l1-scope-and-architecture.md`（Facts 边界）、`docs/execution-plan-task-local-union.md`（WP-5 并集内核）。

依据：2026-09-02 对 **Input Pack 14,113 / Facts 344 / producer-index 2,666 边 / 调度缓存 41,844 目录** 的三份独立量化调查，
以及对 field-lineage / one-hop / multi-hop / causal-closure 的代码审计。三金样只作回归样例，不再作设计依据。
状态：**冻结版（2026-09-02 晚）**；WP-6 / WP-7 已合入 `main`（验收样例以 §8.2 落地行为准）。
WP-8～WP-12 按 §8 分阶段领取。

---

## 0. 两类事实，只有第一类进设计

**结构性事实（不随采集补齐而变，是设计依据）**

| # | 事实 | 数据 | 对图的含义 |
|---|------|------|-----------|
| S1 | hiveTask 类 writer 常态是多次 `INSERT OVERWRITE` 同表 + 自读拉链 + temp 链 | INSERT 任务中 35.8%（1,290）同表写 ≥2 次；自读 1,776 任务；temp 链 1,413 任务，中位 2 张，95% 建后即读 | 生产单位必须是**写观察**，temp 折叠与自读识别是一等能力 |
| S2 | sparkIndex 类 writer 的 query slot 是 pack `target` 的写体，SQL 里没有 INSERT | 3,045 中 2,999 是 SELECT 体 + pack `target/partition` | 写观察由 **Pack 声明**构造（现有 `PLATFORM_TARGET_QUERY_OUTPUT` 路径）；分区值来自 pack 配置 |
| S3 | 传输类任务没有 INSERT 也没有列映射字段 | `*2hive` / `hive2*` 约 6,000；`source` 多为数据源 id，物理源表只在 `FROM` | 是**第二种图**：表级来自 target+FROM，列级只能 SELECT 列表对 DDL |
| S4 | 裸表名几乎总能由目标库补出 | 引用 9.8% 裸名；1,759/1,762 任务可由 `target` schema / 任务名补出 | 补库是确定性规则；**target 佐证可 CONFIRMED，仅任务名最多 ASSUMED** |
| S5 | 写侧分区约一半静态不可判 | INSERT 分区 48.7% 动态 `PARTITION(col)`；producer-index 47.8% 写全是运行时表达式 | 分区匹配需独立状态维度；不能用日期默认把它变成 PROVEN |
| S6 | 读侧分区谓词按列混合 | `src_tbl` 字面量 2.2 万次、`busi_date` 模板 2.7 万次常在同一 WHERE | 谓词状态必须**按列** |
| S7 | 字段证据分层不齐 | 46% 输出是 STAR_EXPANSION；`SQL_SYNTAX_NO_SCHEMA` 440 条含 125 条 `sysdate` 幻影字段；`expression_roles` 只在 1.4% 节点 | 字段边等级跟 `resolution_provenance` / `input_dependency_status` 走 |
| S8 | 调度关系不是数据血缘且不完整 | down 边 28.6% 指向未采集任务；up/down 采集日相差可达 3 天；10,097 目录无身份 | 调度只作参考层；要有“邻居未采集”一档；任何 SCHEDULE_FALLBACK 当 producer 都是错的 |
| S9 | 现有消费者核心判定多为启发式 | 见 §6：temp 名正则、任务名推表、`POSSIBLE_OVERLAP`→PRIMARY、闭包 fan-out 不做分区测试、LEGACY_COMPAT | 图**不复用**这些判定路径，只复用 Facts 与少数纯函数 |
| S10 | 写观察 query boundary 只对 CTAS / 平台目标置 proven | 344 Facts 中 223 个平台目标写 100% proven；189 个 INSERT_OVERWRITE / CREATE_TABLE 写全部 unproven（`hasCtasBoundary`） | 这是契约语义缺口，进 L3 观察，不影响 sparkIndex 路径 |

**覆盖性事实（会随补齐而变，只进 L0，不改结构）**

Facts 344 vs Pack 14,113；hiveTask-2.0 38% 无 SQL；hive2* 60% 无 query；Hive DDL miss / RDBMS 歧义导致的 PARTIAL；13,851 有 SQL 未建包。
图对它们只做两件事：**原样透传状态码到 L0/L3**；**按 contentHash 增量**吃新到的 Pack/Facts，不级联重算。

---

## 1. 原则

1. 图 = Facts + producer-index 的忠实投影。不重新解析 SQL；不在图侧写 adaptor；不修改或伪装原始 SQL；Facts 缺什么 → typed gap。
2. **生产单位 = 写观察，消费单位 = 读次**，分区是两者的属性。任务是归属，不是端点。
3. 身份规则单一来源：与 producer-index 相同（catalog `RESOLVED` 且 `dataSource != default`）+ 确定性补库规则（S4）。
   禁止：catalog tail 唯一匹配、任务名正则推表、`hive/unknown` 冒充正式身份。
4. 任务内先闭合，再跨任务。
5. 跨任务三档递进（表 → 表×分区 → 写观察），**不塌回 taskId**，不为让链通升等级。
6. **状态词汇按维度分开，不做全局共用枚举**：

   | 维度 | 取值 | 说明 |
   |------|------|------|
   | `identityStatus`（物理表/字段身份） | `CONFIRMED \| CANDIDATE \| UNRESOLVED` | 候选身份是身份维度 |
   | `qualificationStatus`（裸名补库） | `CONFIRMED(TASK_TARGET) \| ASSUMED(TASK_NAME_ONLY) \| UNRESOLVED` | 与 `inferTaskDefaultSchema.evidenceSources` 一一对应 |
   | `partitionMatchStatus`（读次×写观察） | `CONFIRMED \| ASSUMED \| UNKNOWN \| DISJOINT` | `ASSUMED` 专门收纳运行时模板相等 / 日期默认；现被标 PROVEN 是最严重的静默升级 |
   | `edgeEvidence`（列级值流） | `CONFIRMED \| CANDIDATE \| UNKNOWN` | 由 Facts `resolution_provenance` / `input_dependency_status` 决定 |
   | `scheduleNeighborStatus` | `COLLECTED \| NOT_COLLECTED` | 参考层专用 |

7. 对用户按 `graph-user-narrative.md` L0–L3 输出；L1 只收各维度为 `CONFIRMED` 的断言。

---

## 2. 写观察的三种构造（S1/S2/S3）

| 形态 | 判定 | 写观察来源 | 分区值来源 | 列绑定 |
|------|------|-----------|-----------|--------|
| A `SQL_EXPLICIT_WRITE` | SQL 有 INSERT/CTAS（hiveTask*、部分 hive2*） | 每条 INSERT 一个 `write_observation_id`（Facts 已有） | `PARTITION(...)` 字面量/模板 → 可判；动态 → `DYNAMIC`，仅当 SELECT 对应列是常量表达式时可证出 | Facts `output-field-bindings` |
| B `PACK_DECLARED_QUERY_OUTPUT` | 运行契约为“query 输出写入 Pack target”（sparkIndex 等），SQL 无 INSERT | 由已确认的 pack `target`、`partition` 与**唯一** query producer 构造（现有 `PLATFORM_TARGET_QUERY_OUTPUT`，`machine-facts.ts` 平台目标分支）；目标/查询边界/Schema/分区证据不足 → fail closed（`output-field-bindings.ts` 已有 `PLATFORM_TARGET_QUERY_BOUNDARY_NOT_PROVABLE` / `PARTITION_NOT_PROVABLE`） | pack `partition`（字面量 / `${…}` 模板） | 同一 `output-field-bindings` 路径 |
| C `TRANSFER` | 传输类，无 INSERT、无列映射 | 一个写观察 = pack `target`；读次 = `FROM` 表（不是 `source` 数据源 id） | pack `partition` 或无 | 仅当 target Table Pack 有 DDL 且 SELECT 列表可对齐 → 列边 `CONFIRMED`；`SELECT *` 或无 DDL → 表级 + gap |

**关于“合成 INSERT”**：不写入架构。当前语料与代码都支持结构化的 B 路径；只有在用当前版本重新生成一批 sparkIndex Facts 后、证明结构化路径仍无法完成关键绑定时，才单独开 synthetic-SQL spike。
即便那时需要 wrapper，也只能是独立 `derivedSql`（带 provenance 与原 SQL hash），不得覆盖原 SQL / 原 span，不得冒充 `SQL_EXPLICIT_WRITE`。

共享不变量 1 增补（总地图同步）：
> 对运行契约明确为“query 输出写入 Pack target”的任务，Facts 生产侧允许从已确认的 Pack target、partition 和唯一 query producer 构造 `PACK_DECLARED_QUERY_OUTPUT` 写观察；不得修改或伪装原始 SQL，必须保留 provenance、原 SQL hash，并在目标、查询边界、Schema 或分区证据不足时 fail closed。

---

## 3. 身份与任务内闭合（S1/S4）

**身份**（`PHYSICAL_DATASET` nodeId）：

```text
1. catalog RESOLVED 且 dataSource != default                                   → identityStatus=CONFIRMED
2. 裸名 + inferTaskDefaultSchema 含 TASK_TARGET 佐证（或 target schema 唯一）     → CONFIRMED, qualificationStatus=CONFIRMED(TASK_TARGET)
3. 裸名 + 仅 TASK_NAME 得出 schema（无 target 佐证、无平台默认库契约）          → CANDIDATE_DATASET, qualificationStatus=ASSUMED(TASK_NAME_ONLY)
4. 裸名且 taskName/target 冲突或均无                                              → CANDIDATE_DATASET, qualificationStatus=UNRESOLVED + TABLE_QUALIFICATION_UNRESOLVED
5. catalog 0 或多匹配                                                             → CANDIDATE_DATASET + TABLE_IDENTITY_AMBIGUOUS | TABLE_PACK_MISSING
```

规则 3 可升为 CONFIRMED 的唯一途径：另有平台契约证明该库即任务默认库（需登记为证据来源，不是代码默认）。
Facts 目前把裸名读标 `RESOLVED` 且 `dataset_id=dataset:hive-gfhive:<bare>`（54 任务/105 行）——图投影按上表重算 nodeId，边上保留原 `dataset_id`。**不**用 catalog tail 唯一匹配。

**temp 折叠**：仅以 `task-local-materializations.jsonl` 为据：`RESOLVED` → 折叠（列级桥接）；`UNRESOLVED`（现 68 行）→ 保留边界 + gap；
名字像 temp 但无 materializations 行 → **不折叠**，`identityStatus=CANDIDATE`。producer-index `intermediateMaterializations` 作交叉校验。`lineage-scope.ts` 名字规则不进图。

**自读**：读次目标 == 本任务某 finalWrite 的表 → `SELF_READ`，不产生上游任务；保留分区谓词供档 B 使用。80 个平台目标自读不在 materializations 范围，按此规则处理。

任务内闭合产物：`finalWrites[]`、`externalReads[]`、`localFieldPaths[]`（穿过 temp 的列路径）。跨任务只用前两者。

---

## 4. 跨任务接续：三档（S5/S6/S8）

对消费者读次 r（表 D，按列分区谓词 P_r），候选写观察 W = 并集内写 D 的 finalWrites ∪ producer-index `confirmedProducerEdges.writes[]`：

| 档 | 判定输入 | 输出 | 状态规则 |
|----|---------|------|---------|
| A 表级 | D 身份 `CONFIRMED` 且相同 | W | 并集内 → 表级 `CONFIRMED`；仅 producer-index → `WRITER_NOT_IN_UNION` 边界（表级 `CONFIRMED`、无列级） |
| B 分区级 | P_r 各列 × w.partition 各列 | 逐写观察 `partitionMatchStatus` | 任一相关列字面量不等 → `DISJOINT`（剪除）；全部相关列字面量相等 → `CONFIRMED`；含运行时模板相等 / 日期默认 → `ASSUMED`；写侧 `DYNAMIC`/`LEGACY_UNKNOWN` 或读侧列 `NON_LITERAL` → `UNKNOWN`（保留） |
| C 写观察级 | B 后仍多写 | 列出每个写观察 + 状态 | 不选唯一；L1 文案“多写扇入，已按分区收窄至 n（CONFIRMED n1 / ASSUMED n2 / UNKNOWN n3）” |

分区四态由 WP-8（data-graph）按已冻结契约实现：`partitionMatchStatus ∈ CONFIRMED|ASSUMED|UNKNOWN|DISJOINT`。
语义对齐历史上 PIQ 的字面量相等 / `PROVEN_DISJOINT`，以及把 `DATE_PARTITION_DEFAULTED` / `POSSIBLE_OVERLAP` 收成 `ASSUMED`（永不进 L1）；
**不是**闭包或索引侧直接调用 / 复用 `producer-index-query` 代码。闭包侧不新增匹配逻辑，也不重新解释分区状态。
**禁止**：调度父节点作 producer 或打破多写平局；任务名正则推表。
`scheduleReference` / `SCHEDULE_DEPENDS_ON` 只在参考层，带 `scheduleNeighborStatus`。

**闭包接并集图**：`causal-closure.ts` 传播机制可复用；替换其输入：候选分支由本节三档生成，`enrichProducerWriteBridges` 的“全部写 fan-out 记 resolved”改为按档 B 结果、`ambiguous` 真计数；`field-value-provider` 的 pair-level 回退与“最多引用胜出”不复用。

---

## 5. 字段层（S7）

**列级值流边 `edgeEvidence`**（由 Facts 字段决定）：

| Facts 信号 | 等级 |
|-----------|------|
| `resolution_provenance=SCHEMA_BOUND` 且 `input_dependency_status=PHYSICAL` | `CONFIRMED` |
| `input_dependency_status=PARTIAL \| SQL_CANDIDATE \| DERIVED_OUTPUT` | `CANDIDATE` |
| `resolution_provenance=SQL_SYNTAX_NO_SCHEMA`（含 `sysdate` 幻影） | `UNKNOWN`，reason `FIELD_NOT_IN_SCHEMA` |
| `output_name_status=STAR_EXPANSION` | 等级不降；边带 `viaStarExpansion=true` 与 `schema_bundle_sha256` |

**输出派生类型 `outputDerivationKind`**（正交于 `FIELD_DIRECT.subtype`，从 IR 角色与表达式结构推，不用文本正则）：

| 判据（本写观察内） | `outputDerivationKind` | 对边的影响 |
|-------------------|------------------------|-----------|
| 单一列引用、无函数 | `IDENTITY` | `FIELD_DIRECT.subtype=IDENTITY` |
| 常量表达式，无物理输入 | `CONSTANT` | **不生成 `FIELD_DIRECT` 边**；只是输出属性 |
| 含聚合函数 / `AGGREGATE_MEASURE` 角色 | `AGGREGATION` | `subtype=AGGREGATION` |
| `window_spec` 存在 | `WINDOW` | 值参数按 `TRANSFORMATION/AGGREGATION` 形成值流；`PARTITION BY / ORDER BY / FRAME` 列走 `DATASET_CONTROL` 的 `WINDOW` indirect subtype（`WINDOW_CONTEXT`），**不进值流** |
| `expression_roles` 含 CASE/IF/COALESCE | `TRANSFORMATION` | 值流取 `VALUE_CONTRIBUTION` ∪ **剩余非角色输入**（修复审计“混合角色丢列”）；`BRANCH_SELECTION` 进 `FIELD_CONDITIONAL`，不再用 `IS NOT NULL` 正则排除拉链 |
| 其他有函数/运算 | `TRANSFORMATION` | `subtype=TRANSFORMATION` |
| 表达式缺失 / STAR 未展开 / 绑定 gap | `UNKNOWN` | `subtype=UNKNOWN` + 现有 reason 码 |

`FIELD_DIRECT.subtype` 保持 OpenLineage 枚举 `IDENTITY | TRANSFORMATION | AGGREGATION`（+ `UNKNOWN`），不扩成私有混合词典。
`DATASET_CONTROL` 沿用 WP-1 的 `datasetControlsForStatement` + grain。任务级 `processingKind`（WP-4）由 finalWrites 的 `outputDerivationKind` 分布 + 控制类型 + externalReads 数计算。

---

## 6. 现有消费者复用裁决（来自审计）

| 组件 | 裁决 | 原因 |
|------|------|------|
| Machine Facts 记录（bindings / expression_nodes + IR roles / dataset-io / relation / materializations） | 复用 | 证据承载体，角色来自 IR |
| `machine-facts.ts` 平台目标写观察 + `output-field-bindings.ts` fail-closed 门 | 复用 | 即形态 B 的结构化路径 |
| WP-8 四态 `partitionMatchStatus`（语义对齐 PIQ 字面量/`PROVEN_DISJOINT`；`DATE_PARTITION_DEFAULTED`/`POSSIBLE_OVERLAP`→`ASSUMED`） | **契约权威，只读** | 内核自实现；非代码复用 PIQ；闭包/索引不重算 |
| `producer-index-query` 运行时调用 | 不复用为分区判定入口 | 避免「语义对齐」与「代码复用」混淆 |
| `datasetControlsForStatement` + grain、`causal-closure.ts` 传播、`task-relation-summary` JOIN 侧别 | 复用 | 结构字段驱动、自检 |
| `task-relation-summary` 的 project/aggregate 文本正则 | 替换为 IR | 文本启发式 |
| `field-lineage.ts` 遍历骨架 | 带守卫复用 | 修 548-552 混合角色；去拉链正则；仅 STRICT_CAUSAL |
| `physical-field-expander` LEGACY_COMPAT 路径 | 不复用 | 现生产 `field-lineage.json` 即此模式产物 |
| one-hop 读次判定与汇总（`POSSIBLE_OVERLAP` usable、调度平局、`SCHEDULE_FALLBACK`、任务名推表） | 不复用为 PRIMARY | 只取候选列表与 `PROVEN_DISJOINT` 剪除 |
| multi-hop bridges / writeEdges | 带守卫复用 | 骨架可用；`producerRole` 仅参考；temp 终止改用 Facts |
| `enrichProducerWriteBridges`、`field-value-provider` | 不复用 | fan-out 记 resolved、pair 级回退 |
| `lineage-scope.ts` 名字规则 | 不复用 | 用 materializations 与 taskCategory 事实 |

---

## 7. 对用户的输出（narrative 落点）

| 层 | 内容 |
|----|------|
| L0 覆盖 | Pack `inputCollectionStatus`/警告码透传；Facts 有无；写观察形态 A/B/C 计数；temp 折叠数；`SELF_READ` 数；调度邻居未采集数 |
| L1 确定 | 档 A/B `partitionMatchStatus=CONFIRMED` 的 读次 ← 写观察；`identityStatus=CONFIRMED` 的表；**已确认输出派生**（`edgeEvidence=CONFIRMED` 的 `IDENTITY/TRANSFORMATION/AGGREGATION` 列边；`CONSTANT/WINDOW` 作为输出属性展示，不是来源边） |
| L2 候选/推断 | `partitionMatchStatus=ASSUMED/UNKNOWN`；`WRITER_NOT_IN_UNION`；`CANDIDATE_DATASET`（含 `qualificationStatus=ASSUMED`）；`edgeEvidence=CANDIDATE`；`scheduleReference`；传输类无 DDL 的表级 |
| L3 缺口 | 身份/分区/绑定/materializations 各 reason 码；S10 query boundary 未 proven；Facts `unknowns.jsonl` 透传（CTE 噪声占其 90%，不当完整度分数） |

期望表述（119044 读 `pdata_n.t03_agt_stati_info_h`，期望由 Facts + producer-index 生成）：
读次 #1（`SRC_TBL='…D_TRD_OTC_TRADE'` LITERAL，`busi_date` NON_LITERAL）← 105387#3/#6、144289（并集外边界），`103939`/`105385` 因 `src_tbl` `DISJOINT` 剪除；读次 #2（`SRC_TBL='…D_REF_BOOK'`）← 105385（边界）。

---

## 8. 工作包与分阶段领取

### 8.1 先做决策性闭环（8～12 人日）

```text
WP-6 Pack 声明写观察（结构化路径核验）
  → WP-7 一个任务的 读次 / 写观察 投影（含逐列分区谓词）
  → WP-8 用 119044 对目标表 `pdata_n.t03_agt_stati_info_h` 的两个真实读次完成逐列分区接续
  → 输出 L0–L3 查询 envelope
```

闭环成立 → 再承诺 WP-9～WP-12 完整工期；不成立 → 问题在进入大闭包前暴露。
**不**同时开 WP-7 / WP-8 / WP-10 并改状态词汇（身份、接续、传播三变量不得同时变）。WP-9 不作主链阻塞项。

### 8.2 工作包

| WP | 名称 | 侧 | 完成定义（真语料断言；括号内回归样例） | 难度 | 粗估 | 信心 | 主要风险 |
|----|------|----|------------------------------------------|------|------|------|----------|
| WP-6 | `pack-declared-write-observation` | Facts | **已合入 main（2026-09-02）**。`PACK_DECLARED_QUERY_OUTPUT` 写观察带 provenance、原 SQL hash；fail-closed 门覆盖目标/边界/Schema/分区；不修改原 SQL。验收：132028 / 155939（目标身份 unresolved → FAILED）/ 176827；测试内临时重生，不覆盖共享 evidence pack | 中 | 1～3 | 85% | 若重生成后字段绑定仍缺失才开 spike；坚持拼 SQL 信心降至 ~60% |
| WP-7 | `graph-identity-and-local-closure` | 投影（WP-3 契约 1.2.0） | **已合入 main（`9393ba4`，2026-09-03）**。身份按 §3；temp 仅按 materializations；`SELF_READ`；`READ_OCCURRENCE` 成节点，谓词按列。**落地验收金样**：103928（含 SELF_READ + 折叠路径）、105380（UNRESOLVED 边界）、158641（无 materialization → `CANDIDATE`）、181058（折叠）；身份 ASSUMED/TARGET 另有单测。调查期候选 103234 / 103230 / 100513 / 100629 / 100815 **未绑回归** | 高 | 5～8 | 70% | 裸名资格、temp、多写、自读、读次同时改投影契约 |
| WP-8 | `union-continuation-v2` | data-graph | **内核与 CLI 已落地（2026-09-03）**：三档 + 自实现四态 `partitionMatchStatus`（契约对齐 PIQ 字面量语义，非调用 PIQ）；`ASSUMED` 不进 L1；调度不进任何档；119044 目标表 `pdata_n.t03_agt_stati_info_h` 两读次按 §7；多写同表任务抽 20 个写观察级不塌回 taskId；CLI：`npm run union-continuation-v2` → `src/project-graph/topology/task-local-union/union-continuation-v2-cli.ts` | 高 | 5～8 | 75% | 从 task/dataset 提升到读次×写观察 |
| WP-9 | `transfer-graph` | 投影 | 形态 C：源表取 `FROM`；列级仅 DDL 对齐；无 query 的 hive2* 显式表级 + gap（86840 夹具） | 高 | 4～7 | 60% | 类别异构、无 SQL/DDL 上限低；受建包覆盖约束 |
| WP-10 | `closure-on-union` | closure | **已暂停（2026-09-03）**。C0–C3 已落地；归档 `openspec/changes/archive/2026-09-03-closure-on-union-paused/`。不再以 legacy 对比 / Gate B-UNION L1 计数作产品验收。接续库代码 maintenance-only | 很高 | — | — | 已迁出主链 |
| WP-11 | `output-derivation-kind` + WP-4 | Facts 消费 / 投影 | 修混合角色丢列（带回归）；window 上下文列不进值流；`outputDerivationKind` 登记；`CONSTANT` 不生成来源边；344 Facts 上分布留档；`processingKind` 分歧留档 | 中 | 3～5 | 80% | 别把 CONSTANT/WINDOW 装成字段来源 |
| WP-12 | `build-narrative` | 两侧 | L0–L3 结构化 + 人读；覆盖性事实只出现在 L0 | 中 | 2～4 | 90% | 过早做会返工 |

串行约 25～44 人日；并行关键路径约 18～28 人日。基于代码面估算，非实测。

顺序：WP-6 → WP-7 → WP-8（决策闭环）→ **金样调查页**；WP-10 暂停；WP-11 冻结至案例列讲透；WP-9 独立；WP-12 与调查页同步推进。
每包合入：两仓 `typecheck/build/test/format:check`；`test:field-lineage`、`test:target-table-causal-closure`、legacy topology 回归绿；**新增断言必须来自真 Pack/Facts**。

### 8.3 工程信心（主观）

- 架构方向正确：85%
- 覆盖范围内可信的表级图：80%
- 写观察 / 读次 / 逐列分区完整闭环：70%
- 当前语料上高可信字段级图：60%～65%
- WP-6～WP-12 一口气交付：~65%；按 §8.1 拆包逐层验收：~80%

难点在跨两仓的证据契约迁移，不在图算法或性能。

---

## 9. 明确不做

- 不新引解析器；不在图侧补 SQL 解析或 adaptor；不合成伪 INSERT 冒充原 SQL。
- 不用名字启发式（temp 前缀/后缀、任务名推表、catalog tail）产生 CONFIRMED。
- 不用调度父节点补 producer、打破多写平局或替代分区判定。
- 不把 `ASSUMED`（模板相等、日期默认）写成 PROVEN/CONFIRMED；不把 `ASSUMED` 做成全局边状态。
- 不把 `CONSTANT/WINDOW` 塞进 `FIELD_DIRECT.subtype`；不为常量输出虚构来源边。
- 不把覆盖率当完成定义；不为覆盖改结构。
- 不改 legacy root 快照与六个参考查询（回归基线）。

---

## 10. 何时算“准”

- §0 S1–S10 每条都有真语料回归断言且为绿；
- 任一 L1 断言可回溯到 `write_observation_id` / `read_occurrence_id` / 逐列 `partitionMatchStatus` / Facts 行；
- L1 中不存在 `ASSUMED`、`UNKNOWN`、调度来源、LEGACY_COMPAT 来源的断言；
- 同一输入两次构建 L0–L3 集合一致；Pack/Facts 增量到达只重投影对应任务。
