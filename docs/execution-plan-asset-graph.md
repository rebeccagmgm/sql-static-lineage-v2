# 数据资产图执行方案

配套架构文档：`docs/domain-asset-graph-architecture.md`（**是什么**）。  
本文件讲 **怎么执行**：工作包、依赖、状态、当前主路径。

细则按 WP 拆分，不要在本文件重复实现细节：

| 文档                                        | 内容                                |
| ------------------------------------------- | ----------------------------------- |
| `execution-plan-task-local-projection.md`   | WP-3 纸条 TL-0…TL-8                 |
| `execution-plan-task-local-union.md`        | WP-5 并集 + WP-8 接续（data-graph） |
| `execution-plan-gold-case-investigation.md` | **P0** 金样调查页 GC-0…GC-4         |
| `execution-plan-writer-catalog.md`          | 表→writer 的 SQLite 目录（替 JSON PI） |
| `graph-accuracy-architecture.md`            | WP-6…WP-12 准确性冻结               |
| `graph-user-narrative.md`                   | L0–L3 对用户陈述                    |

每个工作包（WP）按 1:1 可转成一个 OpenSpec change。领取时 `openspec new change "<wp-name>"`。

---

## 北极星与范围（2026-09-03）

### 我们要建什么

一张 **可增量长大、无域边界** 的静态资产图：每个任务只贡献本任务 SQL 能证明的局部事实；
跨任务在 **查询期** 用物理表身份 + 读次×写观察接续拼接；对用户按 L0–L3 诚实陈述准/不准。

### 当前不追求什么

- 不以「闭包 L1 计数追 legacy」为产品北星（WP-10 **已暂停**）
- 不先铺 13k 任务全库并集或 Neo4j 全图上线
- 不在 WP-11 列路径讲透之前扩 operator 全矩阵
- 不把调度边当数据血缘

### P0 交付物

**金样调查页：DM_RSK_N 四锚点 · 向上穿透 · 一张并集图**

| 锚点 | taskId | 目标表                              |
| ---- | ------ | ----------------------------------- |
| A    | 181058 | `dm_rsk_n.otc_opt_inr_comp_pal_sum` |
| B    | 176827 | `dm_rsk_n.otc_opt_greek_val_det_h`  |
| C    | 209119 | `dm_rsk_n.otc_opt_sub_trd_info`     |
| D    | 155015 | `dm_rsk_n.v_risk_audit_log`         |

**方案**：四锚点 `--expand-upstream` 定批 → WP-3 纸条 → WP-8.1 INDEX → gaps + L0–L3（JSON 主交付，HTML 可选）。

**当前阻塞**：真数据 **GC-0 尚未跑通**（代码已齐：穿透 CLI、INDEX CLI）。

**接下来（按序）**：见 `execution-plan-gold-case-investigation.md` **§0 / §8** — 跑穿透批 → INDEX → gaps.jsonl → L0–L3 →（可选）GC-2 一键脚本。

```text
四锚点 --expand-upstream → WP-3 → WP-8.1 INDEX → gaps/报告
```

细则：**`docs/execution-plan-gold-case-investigation.md`**（本 P0 的唯一执行规格）。

---

## 架构三层 ↔ 工作包

产品上的「三层」= **Facts → 投影/接续 → 呈现**（见架构文档「端到端数据流」）。

| 层      | 职责                                       | 主要 WP      | 仓库               | 状态                         |
| ------- | ------------------------------------------ | ------------ | ------------------ | ---------------------------- |
| ① 事实  | Input Pack、Machine Facts、写观察/读次证据 | WP-6         | sql-static-lineage | **已合入**                   |
| ②a 纸条 | 每任务 `TASK_LOCAL_PROJECTION` 1.2.0       | WP-3、WP-7   | sql-static-lineage | **已验收**                   |
| ②b 并集 | N 份纸条 merge 为 `TASK_LOCAL_UNION`       | WP-5         | data-graph         | **库完成**；主 CLI 未接      |
| ②c 接续 | 读次×写观察 + `partitionMatchStatus`       | WP-8、WP-8.1 | data-graph         | **CLI 完成**                 |
| ③ 呈现  | 可消费 JSON + L0–L3                        | GC、WP-12    | sql-static-lineage | INDEX/gaps **P0**；HTML 可选 |
| —       | 单表重跑闭包                               | WP-10 等     | sql-static-lineage | **暂停** / 维护              |

**金样锚点** = 四写任务（181058 / 176827 / 209119 / 155015）+ **`--expand-upstream` 穿透闭包**；不是四张表、也不是 `DM_RSK_N` topic 全扫。表级 spine 见金样执行方案 §3.1。

---

## 工作包状态总览

### 地图主链（WP-1～WP-5 + GC）

| WP   | 名称          | 状态       | 说明                                    |
| ---- | ------------- | ---------- | --------------------------------------- |
| WP-1 | 影响通道分离  | **已合入** | field-lineage 体积与假阳性              |
| WP-2 | 声明口径采集  | 未做       | 非 P0 阻塞                              |
| WP-3 | 任务局部投影  | **已验收** | schema **1.2.0**；三金样 TL-6/7         |
| WP-4 | 加工/通道识别 | 未做       | 非 P0 阻塞                              |
| WP-5 | 并集 source   | **库完成** | 见 union 执行方案；主管线未接           |
| GC   | 金样调查页    | **进行中** | **四锚点一张图**；见 gold-case 执行方案；**表级精度验收**见 `execution-plan-table-lineage-acceptance.md` |

### 准确性链（WP-6～WP-12，见 graph-accuracy-architecture）

| WP                     | 状态               | 与 P0 关系                                                                                                                                           |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-6 Pack 声明写观察   | **已合入**         | 事实基础                                                                                                                                             |
| WP-7 身份/读次/1.2.0   | **已合入**         | 纸条契约                                                                                                                                             |
| WP-8 接续 v2 + INDEX   | **CLI 完成**       | 调查页接续层                                                                                                                                         |
| WP-9 传输图            | 独立               | 非阻塞                                                                                                                                               |
| WP-10 closure-on-union | **暂停**           | experimental                                                                                                                                         |
| WP-11 字段证据链 V1    | **Phase 2 进行中** | Phase 1 已完成（`field-evidence-v1`）；Impact Query + 金样 + 止损 → `openspec/changes/field-evidence-v1-impact-query`；见 `execution-plan-field-evidence-v1.md` §6–§9 |
| WP-12 L0–L3 envelope   | 与 GC 同步         | 调查页文案                                                                                                                                           |

### 历史 P0：重跑收缩

`docs/execution-plan-rerun-shrink.md` — RS-5 **已过**。闭包 consumer 仍服务场景 B，不是地图 P0。

---

## 先读这些

1. **架构**：`domain-asset-graph-architecture.md` — 机器单位、三层、两条产品线、数据流。
2. **P0 怎么做**：`execution-plan-gold-case-investigation.md` — 命令链与 GC 完成定义。
3. **准确性**：`graph-accuracy-architecture.md` — 为何从「任务/表」升级到「写观察×读次」。
4. **陈述**：`graph-user-narrative.md` — L0–L3 不准升级证据。

全量语料审计说明：**必须先诚实再扩图**；P0 从「铺批」改为「金样端到端可调查」。

---

## 现状事实（2026-09-01 实测，作为所有 WP 的共同基线）

```text
采集
  task pack            2,708      其中 2,694 有 SQL（99.5%）
  table pack           4,740
  schedule 缓存       13,740      13,284 带 topicName（290 个域）
  facts bundle           344      ~349 KB/任务，已按 sql_sha256 内容哈希缓存
  已发布 artifacts        10      ← 0.4%

体积失控点
  209119  field-lineage.json 22.21 MB   rowsetControls 占 90.6%
          11,783 条控制注解 / 219 个不同 relationId = 53.8x
          字段身份 27,104 次 / 750 唯一 = 36.1x
  176827  10.15 MB   4,376 / 202 = 21.7x
  155015   0.29 MB      78 /  25 =  3.1x

语义资产（已采集，未消费）
  DDL 字段 COMMENT   110,021 条，覆盖 89.6% 的表，去重 29,263，仅出现一次 15,222
  表级 description   90.4%

结构约束
  data-graph loadProjectTopologySources 写死 maxRoots = 32
  血缘跨域是常态：抽样 400 任务，有上游的 309 个中 226 个跨域（73%）
```

## 工作包总览

| WP   | 名称                             | 仓库               | 前置                                            | 可并行                                                                              |
| ---- | -------------------------------- | ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| WP-1 | `separate-field-impact-channels` | sql-static-lineage | **已合入 `cdc187a`**                            | 已完成                                                                              |
| WP-2 | `harvest-declared-semantics`     | sql-static-lineage | 无（地图侧采集，不依赖闭包播种）                | 可先做；不要当成「WP-1 已开工」                                                     |
| WP-3 | `task-local-graph-projection`    | sql-static-lineage | **已验收** schema **1.2.0**（含 WP-3.1 / WP-7） | 已完成                                                                              |
| WP-4 | `task-processing-kind`           | sql-static-lineage | WP-1                                            | 可与 WP-5 并行                                                                      |
| WP-5 | `task-local-union-source`        | data-graph         | WP-3 契约冻结（**1.2.0**）                      | **库完成**；主拓扑 CLI 未接；金样调查见 `execution-plan-gold-case-investigation.md` |

```text
WP-1 影响通道分离 ──┬─> WP-3 任务局部投影（已验收 1.2.0）──> WP-5 并集（库完成）──> WP-8 接续 INDEX
                    │                                      └──> GC 金样调查页（P0）
                    └─> WP-4 加工/通道识别（未做）
WP-6→WP-7 准确性 ──> 并入 WP-3 契约 1.2.0
WP-2 声明口径 ─────────────────────────────> 非 P0
场景 B 闭包 consumer ──────────────────────> 维护；WP-10 暂停
```

WP-1 / WP-3 已合入。WP-2、WP-4 仍可并行。WP-5 细则见 `docs/execution-plan-task-local-union.md`。
WP-3 细则与完成定义以 `docs/execution-plan-task-local-projection.md` 为准，不要再用本节旧的「递归展开到四张 ref 任务号」。
**调度为 `scheduleReference`，非数据血缘。**

## 共享不变量

**所有 WP 必须遵守。违反其一即判定失败，不论其他门槛是否通过。**

1. 不修改 SQLLens、`scripts/plans/`、`scripts/machine-facts/` 的事实生产逻辑。
   事实不足时补 typed gap，不在消费侧猜测或补齐。
   增补（2026-09-02，见 `docs/graph-accuracy-architecture.md` §2）：对运行契约明确为“query 输出写入 Pack target”的任务，
   Facts 生产侧允许从已确认的 Pack target、partition 和唯一 query producer 构造 `PACK_DECLARED_QUERY_OUTPUT` 写观察；
   不得修改或伪装原始 SQL，必须保留 provenance、原 SQL hash，并在目标、查询边界、Schema 或分区证据不足时 fail closed。
2. 不引入新解析器（Calcite / sqlglot / ScopeLineage / SQLLineage）。
3. 数据集级控制证据**不得**挂到字段节点，不得产生 `affectedRootFields`
   一类字段级断言。这是 WP-1 的核心，也是其余 WP 的前提。
4. 证据三态 `CONFIRMED | CANDIDATE | UNKNOWN` 与静态边界声明必须逐边保留；
   不得因为下游好看而升级状态。
5. 语义三档来源 `DECLARED | INHERITED | GENERATED` 不得合并或互相冒充。
6. 调度缓存中的 `querySql` / `prepareSql` 不作为事实来源。Input Pack 是唯一
   权威输入边界（`docs/l1-scope-and-architecture.md`）。
7. 缺证据的对象必须在产物中显式存在（边界节点 / gap），不得静默缺失。
8. 已发布的 10 份 root 产物与 `LEGACY_ARTIFACT_PAIRS` 路径的行为、快照 ID 算法、
   六个参考查询结果不得改变，用作回归基线。
9. 每个 WP 自带 155015 金样断言。跨任务值流
   `112715 → 114026 → 155015` 与 `71698 → 105387 → 155015` 精度不得回退。
10. 不另起通道词典。已有 `target-table-upstream-causal-closure` 的
    `FIELD_VALUE` / `ROW_MEMBERSHIP` / `MULTIPLICITY` / `EXPRESSION_CONTROL`
    是权威语义；WP-1 的 OpenLineage 投影与 WP-3 的图边必须是它的视图，
    不得平行发明 `rowDetermining` 一类同义新词。

## 既有 consumer 对齐（场景 B：单表重跑，非地图 P0）

> 以下描述 **target-table-upstream-causal-closure**（产品线 B）。地图主链不依赖 Gate B 通过。
> WP-10 将闭包接到并集 INDEX 的工作 **已暂停**（`docs/experimental/`）。

`openspec/changes/target-write-upstream-causal-closure` 已覆盖场景 3 的骨架，
不是空白。核对 `tasks.md` 与 `209119-gate-evidence.md` 后的状态：

```text
已完成    Baseline、M1（除 2.3 完整 field-port）、Gate A（带范围）
          M3 的图与 rollup（5.1–5.4）、M4 通道代数（除 6.6）
          5.1 JOIN 侧别（LEFT 保留侧 ROW_MEMBERSHIP，可空侧 MULTIPLICITY）
          3.4 部分字段不扩散（119044 档一只挂 5 列）
          拉链 CASE 的 summary 层标签（existenceCaseSelections）
          105387 / 176827 夹具与 176827 基线产物
未完成    2.3 完整 field-port
          3.2 跨任务 FIELD_VALUE 精确接续
          闭包播种已收口：值召回跳本地有拉链 CASE 才问 RM；LEFT 维表在档三
          （P0 RS-3 / 7b.6 + RS-5 / 7b.8：档二仅拉链三张）
暂停      M5/M6（Gate B 未过）
未开始    M7 独立 HTML/schema 发布
Gate B    任务清单勾了，证据写 NOT VERIFIED / REOPENED
          只过了更窄的 projection-readiness：可发表 overlay，不是运行期重跑清单
```

209119 最近一次：542 候选分支，46 `CONFIRMED_RELATED` / 496 `UNKNOWN`，
最小确定 41 任务 / 保守安全 78 任务。`runtimeRerunDecision = NOT_EVALUATED`。
155015 / 105387 拉链样例**已经进入**该 consumer 的金样
（`join-side-and-field-scope.test.ts` + `105387-zipper-relations.json`）。
176827 也跑过基线：`176827-baseline.json` 档一 27 任务可用，档二/档三空，32/59 UNKNOWN。
`155015.json` 档二已有四张 ref。`176827.json`（14:22）档二仅拉链三张；LEFT 维表
和 103943 generic CASE 子查询在档三。RS-5 已过。

现有 `summarizeTaskRelations` **已经按 JOIN 侧别分通道**，不再把任意 `join`
一律标成三通道。`demandedFieldNames` 对 join 取 `condition_columns`，
拉链 CASE 经 `existenceCaseSelections()` 能给出 `Agt_Modifr` 理由。
176827 到 105387 **不是直连**（`176827 --FV--> 119044 --FV--> 105387`）。
RS-3 已收口：值召回跳本地有拉链 CASE 才问 RM，LEFT 可空维表在档三。详见 P0 方案。

分工因此固定：

- 场景 3（单表重跑溯源）继续用该 consumer 做查询期反向闭包，先做 P0
  （闭包播种 + UNKNOWN 可解释 + 档四归因）。不在 WP-3 重写一遍闭包引擎。
- 场景 1（全局地图）仍需要 WP-3 的任务局部投影；该 consumer 是按 root 加载
  multi-hop universe 的，结构上铺不满 13,740 个任务。
- WP-3 只物化 `TaskRelationSummary` 已有的通道为图边，查询期把闭包引擎接到
  这张图上。

## WP-1 `separate-field-impact-channels`

**前置**：P0 重跑收缩的 RS-5 通过。总览表已写明；不要只看旧印象里的「立即开始」。

**目标**：把"值影响"和"行集影响"拆成互不污染的两条通道。同时消除假阳性与 90% 体积。

**改动范围**

```text
scripts/reconcile/consumer/field-lineage/field-lineage.ts
  rowsetControlsFor()        不再以 node.nodeId 为键
  主循环调用点               控制证据改为按 relation 收集一次
scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts
  RowsetControlAnnotation -> DatasetControlAnnotation
  新增 grain 字段与 FIELD_DIRECT subtype / FIELD_CONDITIONAL
  counts / canonicalize / validate 同步
scripts/reconcile/consumer/field-lineage/format-field-lineage.ts
scripts/visualize/field-lineage-visualize.ts
  字段值流与数据集控制分列展示，不合并成单一"影响表数"
```

**这不是自创重构。** OpenLineage `ColumnLineageDatasetFacet`（spec v1.52.0）已定义
同一套分类，并提供独立的 `dataset` 数组承载影响整个数据集的算子依赖。其文档中的
"Legacy representation" 一节描述的正是把这些依赖搬进每个输出字段的旧行为，原文结论是
"producing almost a cartesian product of all dataset fields. This is very inefficient."，
并建议切换到分离表示。本仓库当前的 `rowsetControls → node.nodeId` 即处于该 legacy 形态，
209119 的 53.8 倍重复就是这段描述的笛卡尔积。

**契约要点**

- `DATASET_CONTROL` 键为 `task + relation + 控制字段`，与受影响的输出字段数无关。
  起点是控制字段而非整张表，与 OpenLineage `dataset` 数组条目为 `InputField` 一致。
- `subtype` 逐字采用 OpenLineage 词典，不自造：
  - DIRECT：`IDENTITY | TRANSFORMATION | AGGREGATION`
  - INDIRECT：`JOIN | GROUP_BY | FILTER | SORT | WINDOW | CONDITIONAL`
- 新增 `masking` 布尔位（`hash`、`count` 等脱敏变换），对齐 OpenLineage。
- `FIELD_CONDITIONAL` 即 OpenLineage 的 `INDIRECT/CONDITIONAL`，
  仅在 `expression_roles` 命中 `BRANCH_SELECTION` 时产生。
- `grain` 是**本地扩展**（OpenLineage 无行倍增语义），第一版只做可证明的粗档：
  `GROUP BY`/`DISTINCT`/`FILTER` → `REDUCE`；可证明多对一或一对一的 JOIN → `PRESERVE`；
  证不出基数的 JOIN → `EXPAND_RISK`（INNER 不落 `UNKNOWN`）。
  `WINDOW` 证据不足才记 `UNKNOWN`。不做唯一键证明，不做行数估算。
- 证据三态与 typed gaps 沿用本仓库既有模型，同样标注为本地扩展。
- 重跑影响集分两档：最小确定集（`FIELD_DIRECT` + `CONFIRMED`），
  保守安全集（并入 `FIELD_CONDITIONAL` 与非 `PRESERVE` 的 `DATASET_CONTROL`）。

**完成定义**

1. 155015：`internal_trade_id` 的 `FIELD_DIRECT` 上游不含那四张 LEFT JOIN 表。
2. 155015：四张表以 `DATASET_CONTROL / JOIN` 出现在 Task 105387 的目标写入上，带 `grain`。
3. 209119：控制注解由 11,783 条降到与不同 `relationId` 同量级（实测 711 条 /
   339 个 relationId，比值 2.10；旧形态是 11,783 / 219 = 53.8 的逐字段复制），
   `field-lineage.json` 由 22.21 MB 降至 3 MB 以内（实测 2.69 MB）。
   176827 由 10.33 MB 降至 2 MB 以内（实测 1.37 MB）。
4. 155015、176827、209119 的 `nodes` / `edges` 计数不减少。
5. 产物与页面中字段值流与数据集控制分列统计。
6. `npm run test:field-lineage`、`npm run typecheck`、`npm run build`、
   `npm run format:check` 全绿。

## WP-2 `harvest-declared-semantics`

**目标**：把已采集但未消费的 110,021 条 DDL 注释变成可查询的声明口径层。

**改动范围**：新增独立模块，不改动现有 Table Pack 采集与 DDL 冻结逻辑。
只读 `<data-root>/tables/**/ddl.sql` 与 `table.json` 的 `description`。

**契约要点**

- 输出 `DECLARED_SEMANTICS` 记录：`platform | dataSource | qualifiedName [| column]`
  → 描述文本 + 来源 locator + DDL sha256。
- `provenance` 固定为 `DECLARED`。本 WP 不产生 `INHERITED` / `GENERATED`。
- 标注低信息量：注释在全库出现频次超过阈值（如 `数据时间` 2,817 次、
  `业务日期` 2,127 次、`指标值` 669 次）时置 `lowInformation: true`，
  供地图排序与人工补全优先级使用。不删除，不改写。
- 不做 LLM 生成，不做跨字段推断。

**完成定义**

1. 覆盖率留档：字段级注释条数、去重数、覆盖表比例，与基线（110,021 / 29,263 / 89.6%）
   一致或给出差异说明。
2. 表级 `description` 覆盖率留档，与基线 90.4% 一致。
3. 低信息量标注可复现：同一输入两次运行结果字节一致。
4. 不修改任何 Table Pack 文件；DDL sha256 校验通过。
5. `npm run typecheck` / `build` / `format:check` 全绿，新增聚焦测试通过。

## WP-3 `task-local-graph-projection`

**状态**：**已验收**（TL-0…TL-8 + WP-3.1 + WP-7 并入 1.2.0）。
OpenSpec：`openspec/changes/archive/2026-09-02-task-local-graph-projection/`、`openspec/changes/task-local-projection-wp31/`。

**完整方案**：`docs/execution-plan-task-local-projection.md`（TL-0…TL-8）。

**契约**：`TASK_LOCAL_PROJECTION` **1.2.0**（`READ_OCCURRENCE` 两跳 READS、`localClosure`）。

一句话：每个任务只投影自己的 READ/WRITE/值边/控制边；任务之间靠物理表身份在查询期用 writer catalog（Facts 派生的 SQLite 倒排；见 `execution-plan-writer-catalog.md`）拼接。
调度邻居只落在 TASK 的 `scheduleReference`（`SCHEDULE_REFERENCE_ONLY`），**不是数据血缘**。
不要把上游 taskId 写进数据边，也不要把「从 176827 递归走到四张拉链 ref」当完成定义——那是 105387 自己的 `DATASET_CONTROL`，外加查询期拼接。

**金样**：176827 为主；119044 / 105387 用 `--also-task-ids` 点名（105387 不在 `DM_RSK_N` 63 里）。
并集链形状：105387 写 `t03_agt_stati_info_h` → 119044 读它（并主读 `t03_otc_opt_comp_info`）→ 写 `t98` → 176827 读 `t98`。

## WP-4 `task-processing-kind`

**目标**：区分"真加工"与"纯通道"，这是业务地图最直观的一层。

**前置**：WP-1 合入（需要 `FIELD_DIRECT` subtype）。可与 WP-3 并行。

**契约要点**

```text
PASSTHROUGH    输出字段全 IDENTITY，单一源表，无 filter/join/aggregate/window
PROJECTION     全 IDENTITY，仅列裁剪或重命名
FILTERED_COPY  全 IDENTITY，但存在 FILTER
TRANSFORM      存在 TRANSFORMATION 表达式
AGGREGATE      存在 AGGREGATION 或 GROUP_BY
JOIN_ENRICH    读入多张物理表且存在 JOIN
UNKNOWN        SQL 缺失或证据不足
```

判据完全来自任务局部事实，不需跨任务遍历。`taskCategory` 只作**交叉验证**，
不作判据。当前分布：加工候选 1,598（`sparkIndex` 1,058 / `hiveTask-2.0` 314 /
`hiveTask` 216 / `qualityTask` 10），通道候选 1,097（`oracle2hive` 528 /
`hive2starrocks` 486 / 其余 83），`checkdbflag` 13。

**完成定义**

1. 声明为通道类别却检出 `JOIN_ENRICH` / `AGGREGATE`，或声明为加工却是
   `PASSTHROUGH`，一律输出为显式分歧项，数量留档，不静默采信任一侧。
2. `UNKNOWN` 必须给出原因码，不得作为兜底默认值。
3. 同一输入两次运行结果一致。

## WP-5 `task-local-union-source` + WP-8 接续

**完整方案**：`docs/execution-plan-task-local-union.md`（TU-0…TU-8 + §5.0 WP-8）。

**WP-5 目标**：N 份局部投影并成 `TASK_LOCAL_UNION` 快照；表级 walk（§5.1）+ producer-index 边界。

**WP-8 目标**：在读次级用 `partitionMatchStatus` 把读次绑到具体 `writeObservationId`；批索引 `UNION_CONTINUATION_INDEX`。

**实现（2026-09-03）**：data-graph `task-local-union-*` + `npm run union-continuation-index` **已完成**；`project-topology-cli` **未接**。

**金样调查页**：不必等 WP-5 入主拓扑；INDEX CLI 内嵌 merge 即可（见金样执行方案 §5.2）。

**金样链**：105387 → 119044 → 176827（`t03_agt_stati_info_h` / `t98`）；`t03_otc_opt_comp_info` writer 不在三金样内 → 边界。

## 并行调度建议

```text
第 0 波
  P0 重跑收缩 RS-5 已过   见 docs/execution-plan-rerun-shrink.md
  agent B -> WP-2         声明口径采集（仍可做）

第 1 波
  WP-1 已合入

第 2 波
  WP-3 已验收（schema 1.2.0 + WP-3.1）   见 docs/execution-plan-task-local-projection.md
  agent D -> WP-4   加工/通道识别（仍可做）

第 3 波（已完成库实现，未接主拓扑）
  WP-5 / WP-8   data-graph 并集 + 接续 INDEX   见 docs/execution-plan-task-local-union.md

第 4 波（现在）
  GC-0…GC-3     金样调查页 V0   见 docs/execution-plan-gold-case-investigation.md
  agent B -> WP-2         声明口径采集（仍可做，非阻塞）
  agent D -> WP-4   加工/通道识别（仍可做，非阻塞）
```

派单 WP-5 时必须同时给出：本文件的**共享不变量**、`docs/execution-plan-task-local-union.md`、
`docs/execution-plan-task-local-projection.md`（上游契约）、以及 `docs/domain-asset-graph-architecture.md`。

## 里程碑（修订：case-first）

**M0（GC-0）**：四锚点向上穿透 → INDEX + gaps + L0–L3 可程序消费。**当前 P0。**

| 子阶段 | 内容                                 | 状态     |
| ------ | ------------------------------------ | -------- |
| M0.1   | `--expand-upstream` CLI（GC-1）      | **完成** |
| M0.2   | 真数据跑穿透批 + INDEX（GC-0 A1–A3） | **未做** |
| M0.3   | gaps.jsonl + L0–L3（GC-3）           | **未做** |
| M0.4   | golden / 一键脚本（GC-4 / GC-2）     | **未做** |

**M1（WP-1 + WP-2）**：影响分类正确、产物体积可用、口径层可查（155015 等）。

**M2（WP-3 + WP-4）**：域级投影成本留档；加工/通道分歧可见。

**M3（WP-5 入主拓扑）**：`TASK_LOCAL_UNION` 进入 data-graph 地图/Neo4j 主管线——**在 M0 之后**，非金样前置。

## 明确不在本方案内

- 指标口径归并与指标目录绑定。指标口径是**行级**的（指标宽表 `index_val`
  列注释恒为"指标值"，真实口径由行内 `index_id` 决定），锚点必须是
  `(表, 列, index_id 值)`。从 SQL 字面量提取不可靠（DM_INDEX_N 652 个包中
  仅 57 个命中，8.7%）。该能力依赖一个尚不存在的权威指标目录，需单独立项。
- 业务粒度词典（一行 = 交易 / 账户 / 日终快照）。
- 接入 OpenLineage 生态。仅借用 `DIRECT` / `INDIRECT` 分层词典；
  其 columnLineage facet 无法表达 `grain`、证据等级、typed gaps 与
  `write_observation_id`，`JobEvent` 导出只作将来对接外部目录的有损出口视图。
- 运行时是否跑成功、数据是否正确、业务是否验收。
