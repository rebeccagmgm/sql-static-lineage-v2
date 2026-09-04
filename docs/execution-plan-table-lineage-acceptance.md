# 表血缘精度验收方案（任务内 + 跨任务，不含字段）

配套：

| 文档 | 读什么 |
| --- | --- |
| `graph-accuracy-architecture.md` | 写观察×读次、身份、分区四态、跨任务三档 |
| `graph-user-narrative.md` | L0–L3 对用户怎么讲准/不准 |
| `execution-plan-task-local-projection.md` | WP-3 纸条契约 |
| `execution-plan-task-local-union.md` | WP-5 并集 + WP-8 接续 INDEX |
| `execution-plan-gold-case-investigation.md` | 四锚点穿透批、spine、GC 路线图 |
| `execution-plan-writer-catalog.md` | 表→谁写了它（SQLite，替代 `producer-index:update`） |
| `execution-plan-field-evidence-v1.md` | 列级 Impact Query（**本方案不验收**） |

状态：**可实施（2026-09-04）** — 金样案例已够，先落文档与 fixture，再写自动测试。

---

## 0. 一页摘要

### 要什么

在**不涉及具体字段**的前提下，把「图准不准」收成可自动验收的两层：

1. **任务内表级**：SQL 读了/写了的物理表，纸条（`TASK_LOCAL_PROJECTION`）上一条不少、一条不多。
2. **跨任务表级**：每个 `externalRead` **要么**接到非 DISJOINT 的写观察（可多写扇入），**要么**落在具名 gap / 边界（DISJOINT 剪掉、批外 writer、源端点、无已知 writer 等）。**能跨与不能跨同一套验收，不许静默丢。**

证不出唯一上游 writer **不算**地图失败；那是列级追因的另一把尺子。

### 方案三句话

1. **金标从 SQL + Facts 来**：四锚点各一份 `map-acceptance` fixture（读/写表清单）；自动对账以 Facts `dataset-io.jsonl` 为机器真值，fixture 为人工复核锚。
2. **任务内先闭合**：`projectTaskLocal` 的 `READS` / `WRITES` 与 `dataset-io` 做召回/精度 100%。
3. **跨任务闭包**：穿透批上的 `union-continuation-index` 对每个 `externalRead` **全覆盖**——能连的出边（`partitionMatchStatus ≠ DISJOINT`），不能连的出 gap / `prunedWriteObservationIds` / 边界节点，禁止「无 entry、无 gap」。

### 主交付物

| 产物 | 必须 |
| --- | --- |
| `tests/fixtures/map-acceptance/<taskId>.json` | ✓ 四锚点 |
| `tests/project-graph/map-acceptance/*.test.ts` | ✓ fail-closed |
| `npm run test:map-acceptance`（或并入 `test:task-local-projection`） | ✓ |
| 跨任务 INDEX 集成测（Phase B） | 第二批 |
| `gold-case-gaps.jsonl` / L0 报告 | 与 GC-3 共用，不重复造 |

---

## 1. 范围

### 1.1 机器单位（本方案只验这些）

```text
TASK
  └─ TARGET_WRITE（写观察）──WRITES──▶ PHYSICAL_DATASET（物理表）
  └─ READ_OCCURRENCE（读次）──READS──▶ PHYSICAL_DATASET

跨任务（批级）：
  任务 A 的写观察 ──▶ 表 D ◀── 任务 B 的读次
  边上属性：partitionMatchStatus（CONFIRMED | ASSUMED | UNKNOWN | DISJOINT）
```

| 单位 | 问什么 |
| --- | --- |
| 任务 | 谁跑的 SQL；`coverageStatus` 是否为 `PROJECTED` |
| 物理表 | `qualifiedName` + 身份（`nodeId` / `identityStatus`） |
| 读次 | 读了哪张表、几次（`readOccurrenceId`） |
| 写观察 | 写了哪张表、几次（`writeObservationId`） |
| 跨任务对接 | 读次能否接到写观察；**能接必显式接，不能接必显式拒**（边 / gap / 边界三选一） |

### 1.2 明确不做（本 WP）

- 字段边：`FIELD_DIRECT`、`FIELD_CONDITIONAL`、`outputColumn`
- 控制边：`DATASET_CONTROL`、JOIN/FILTER 控制列、`FIELD_SCOPED`
- 列级跨任务闭合、Impact Query、`confirmedTwoHopRatio`、`l1Eligible` 唯一 writer
- 调度边当数据血缘：`scheduleReference` / Horae `upstreamTaskIds` **不算**证据来源
- 加工标签、口径声明、HTML 调查页（可后接，非验收门槛）

### 1.3 两把尺子（禁止混判）

| 尺子 | 验收问题 | 本方案 |
| --- | --- | --- |
| **地图结构** | 边在不在、分区是否错连（DISJOINT 不能留） | **验这个** |
| **列级定责** | 这次读是否唯一来自那次写 | **不验**；留给 field-evidence / INDEX 标注 |

地图绿了，列级仍可能 frontier；列级 CONFIRMED 了，也不代表地图没漏表。

### 1.4 跨任务闭包速查（Phase B 核心）

每个 `externalRead` 在 INDEX 上只能处于下列状态之一或组合（**不许第四种：啥也没有**）：

```text
                    externalRead (任务 B 读表 D)
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
    【能跨·正例】        【不能跨·剪枝】      【不能跨·边界/gap】
    candidates[]         prunedWriteIds[]     gaps[] / 边界节点
    分区 ≠ DISJOINT      分区 = DISJOINT      WRITER_NOT_IN_UNION
    可多条               不得留在 candidates   NO_KNOWN_WRITER
                                              SOURCE_ENDPOINT_BOUNDARY
                                              READ_SCOPE_UNAVAILABLE
```

| 你关心的 | 地图验收 | 列级追因（不验） |
| --- | --- | --- |
| 有没有接上可能的上游 | `candidates` 非空或 gap 解释为何全空 | 要求 `candidates.length === 1` |
| 分区对不上 | DISJOINT → 进 `pruned`，不留边 | 候选被剪掉 |
| 批外 writer | 必须有 `WRITER_NOT_IN_UNION` | 可能仍在 frontier |
| 边上 CONFIRMED | 不强制 | 才升 CONFIRMED |

---

## 2. 验收定义

### 2.1 四条硬指标（fail-closed）

#### T1 — 任务内表级召回 100%

对批内每个 `coverageStatus = PROJECTED` 的任务：

- Facts `dataset-io.jsonl` 中每张**物理读表**（`direction=READ` 且可解析 `qualifiedName`），纸条上必须存在至少一条 `READ_OCCURRENCE → PHYSICAL_DATASET` 的 `READS` 边。
- 每张**物理写表**（`direction=WRITE` 且 `field_producing` 为最终写），纸条上必须存在 `TARGET_WRITE → PHYSICAL_DATASET` 的 `WRITES` 边。

少一条即失败。temp 表按 Facts 是否产出读/写记录判定，不另加表名启发式。

#### T2 — 任务内表级精度 100%

纸条上每条任务↔表 `READS` / `WRITES` 边必须能回指：

- 一条 `dataset-io.jsonl` 记录，或
- Pack 声明写（`target` / 平台目标写观察路径）。

无证据来源的边不允许存在。调度邻居、Horae relation **不算**回指证据。

#### T3 — 跨任务闭包 100%（能跨 + 不能跨一起验）

**每个 `externalRead` 必须「结案」**：在 INDEX 上要么列出可能的上游写观察，要么写明为什么不能接、停在哪。**禁止**「无 entry、无 gap、无边界」的静默空白。

覆盖对象：

- 纸条 `localClosure.externalReads[]` 中的每一项；
- INDEX `entries[]` 中与该读次 `readOccurrenceId` 对应的 entry（二者必须存在且可对齐）。

对每个 `externalRead`，系统必须落入下列**互斥结局之一**（或组合：多条 A + 若干 B，见下表）：

| 结局 | 何时 | INDEX / 图上的要求 |
| --- | --- | --- |
| **A. 接续边** | 并集内存在同表写观察，且对该读次 `partitionMatchStatus ∈ {CONFIRMED, ASSUMED, UNKNOWN}` | 写观察出现在 `candidates[]`；**允许多条**（多写扇入） |
| **B. 分区剪除** | 某写观察对该读次 `partitionMatchStatus = DISJOINT` | 该写观察**不得**在 `candidates[]`；必须出现在 `prunedWriteObservationIds[]`（或等价剪除清单） |
| **C. 批外边界** | producer-index 有 confirmed writer，但 writer 任务不在穿透批 | `WRITER_NOT_IN_UNION` 边界节点或 INDEX 同义 gap；**禁止假装没有 writer** |
| **D. 无已知 writer** | 并集内无写观察，且 producer-index 也无 confirmed writer | `NO_KNOWN_WRITER` gap |
| **E. 源端点 / 平台边界** | 如 `*2hive` / `oracle2hive` 读源库视图，PI 无该源表的 Hive writer | `SOURCE_ENDPOINT_BOUNDARY`（或契约等价码）；**禁止伪造跨任务边** |
| **F. 读侧 scope 不可得** | 分区谓词/身份不足以做匹配 | `READ_SCOPE_UNAVAILABLE` 等具名 gap；**禁止空 entry** |

**组合规则（常见）**：

- 同一读次可同时有 **A + B**：例如 3 个批内 writer，2 个 DISJOINT 进 `prunedWriteObservationIds`，1 个 ASSUMED 留在 `candidates[]`。
- **C / D / E / F** 与 **A** 可并存：批内 writer 走 A/B，批外 writer 另走 C。
- 不允许：DISJOINT 的写观察同时出现在 `candidates[]` 和 `prunedWriteObservationIds[]` 之外的「灰色地带」。

硬规则：

1. **全覆盖**：每个 `externalRead` 必有 INDEX `entry`；`candidates` + `prunedWriteObservationIds` + `gaps` 必须解释全部已知写观察的去向。
2. **正例（能跨）**：非 DISJOINT 的批内写观察 → 必须在 `candidates[]`。
3. **反例（不能跨）**：DISJOINT → 不得冒充接续边；批外 / 无 writer / 源端点 / scope 不可得 → 必须边界或 gap。**与正例同一轮验收，不是可选项。**
4. **不验唯一 writer**：`candidates.length > 1` 合法；`l1Eligible`、`partitionMatchStatus=CONFIRMED` 只是边上标注，不是「有没有边」的门槛。

**注意**：T3 验的是跨任务**闭包完整性**，不是「是否只剩一个 CONFIRMED writer」。

#### T4 — 身份不合并

同名表若算出两个 `PHYSICAL_DATASET` `nodeId`（平台 / dataSource / qualification 分歧），禁止硬并；必须以 `DATASET_IDENTITY_DIVERGENT`（或契约等价 gap）显式出现。对齐 `graph-accuracy-architecture.md` 红线与 `graph-user-narrative.md` L1 条件 2。

### 2.2 两条诚实性指标（报告项，非 T1–T4 门槛）

#### H1 — L0 覆盖显式

每张批级产物带：

- `projected` / `scheduleOnly` / `collectionFailed` 计数
- `batchRef`（manifest `contentHash` 或等价 fingerprint）

#### H2 — 分区标注抽查

跨任务边上 `partitionMatchStatus` 人工抽 20 条，与 SQL 读侧分区谓词、写侧分区对照，一致率 ≥ 95%。

这是**标注质量**，不是边存在的门槛。ASSUMED / UNKNOWN 边可以存在，但不能把 DISJOINT 标成 CONFIRMED。

### 2.3 明确不作为验收的

| 项 | 处理 |
| --- | --- |
| L1 密度、全图 CONFIRMED 比例 | 留档观察 |
| `confirmedTwoHopRatio`、`WAIT_WP8` | field-evidence 止损，非地图 KPI |
| 列级跨任务闭合 | Impact Query |
| 加工标签 / 口径 | 不做 |
| 唯一 writer / `l1Eligible` | 边上标注；不挡 T3 |

---

## 3. 金样 cohort

四锚点写任务（与 `execution-plan-gold-case-investigation.md` §3 一致）：

| 锚点 | taskId | 目标表 | fixture 角色 |
| --- | --- | --- | --- |
| A | 181058 | `dm_rsk_n.otc_opt_inr_comp_pal_sum` | 临时表 / 物化边界 |
| B | 176827 | `dm_rsk_n.otc_opt_greek_val_det_h` | 多读表 + spine 下游 |
| C | 209119 | `dm_rsk_n.otc_opt_sub_trd_info` | 多分支 / 扇入 |
| D | 155015 | `dm_rsk_n.v_risk_audit_log` | 跨域、少表 |

人工基准表数量（读 SQL 核对，写入 fixture）：

| taskId | 读表数（约） | 写表数（约） | 备注 |
| --- | --- | --- | --- |
| 209119 | 35 | 1 | 控制边多，本方案不计控制表除非 `dataset-io` 有 READ |
| 176827 | 11 | 1 | 与现有 TL-6 一致 |
| 181058 | 18 | 1 | 含物化链上的读表 |
| 155015 | 1 | 1 | 值链跨域在 Phase B 验 |

已知表级 spine（Phase B **正例**必核）：

```text
105387 ──WRITES──▶ pdata_n.t03_agt_stati_info_h ◀──READ── 119044
119044 ──WRITES──▶ pdata_n.t98_sb_otc_opt_comp_info ◀──READ── 176827
```

Phase B **反例 / 边界**金样（写入 fixture `crossTaskClosure[]`）：

| 场景 | 读任务 / 表 | 期望结局 | 说明 |
| --- | --- | --- | --- |
| 分区剪除 | 119044 读 `t03_agt_stati_info_h`，某 writer DISJOINT | **B** | 见 `union-continuation.test.ts` |
| 多写扇入 | 176827 读 `t98_sb_otc_opt_sub_trd_prcg_indx`（vola 等） | **A×n** | 多个 `candidates` 合法；不要求长度为 1 |
| 批外 writer | 读表在 PI 有 writer、穿透批未投影 | **C** | `WRITER_NOT_IN_UNION` |
| 源端点 | 78588 链上读 `titans_dm.pos_eod_position_view` | **E** | 不往 Oracle 伪造边 |
| 批内无 writer | 某读表并集内无任何写观察 | **D** 或 **F** | 视 PI / scope 证据而定 |

---

## 4. Fixture 契约

Phase A 用任务内表清单；Phase B 用 `crossTaskClosures[]` 钉死每个读次的**正例或反例结局**（同一文件或批级 `batch-dm-rsk-n.json`）。

### 4.1 任务内（Phase A）

路径：`tests/fixtures/map-acceptance/<taskId>.json`

```json
{
  "schemaVersion": "map-acceptance-v1",
  "taskId": "176827",
  "coverageStatus": "PROJECTED",
  "writeTables": [
    {
      "qualifiedName": "dm_rsk_n.otc_opt_greek_val_det_h",
      "writeObservationId": "write-observation:176827:platform-target:0"
    }
  ],
  "readTables": [
    { "qualifiedName": "pdata_nds.pos_eod_position_view" },
    { "qualifiedName": "pdata_n.t98_sb_otc_opt_comp_info" }
  ],
  "notes": "人工读 SQL；机器对账以 dataset-io 为准，fixture 用于漂移审查"
}
```

### 4.2 跨任务闭包（Phase B）

同文件或批级 `tests/fixtures/map-acceptance/batch-dm-rsk-n.json` 中增加 `crossTaskClosures[]`。
每条描述**一个读次**在 INDEX 上的预期结局（T3-A…F 之一）。

```json
{
  "crossTaskClosures": [
    {
      "consumerTaskId": "176827",
      "qualifiedName": "pdata_n.t98_sb_otc_opt_comp_info",
      "readOccurrenceId": "task:176827:…:read.t98",
      "expectedOutcome": "CONTINUATION",
      "requiredCandidateTaskIds": ["119044"],
      "allowedPartitionMatch": ["CONFIRMED", "ASSUMED", "UNKNOWN"],
      "forbiddenInCandidates": { "partitionMatchStatus": ["DISJOINT"] }
    },
    {
      "consumerTaskId": "176827",
      "qualifiedName": "pdata_n.t98_sb_otc_opt_sub_trd_prcg_indx",
      "readOccurrenceId": "task:176827:…:read.prcg",
      "expectedOutcome": "CONTINUATION",
      "minCandidateCount": 2,
      "notes": "多写扇入合法；不要求唯一 writer"
    },
    {
      "consumerTaskId": "176827",
      "qualifiedName": "pdata_n.t98_sb_otc_opt_sub_trd_prcg_indx",
      "readOccurrenceId": "task:176827:…:read.prcg.disjoint-writer",
      "expectedOutcome": "PRUNED",
      "prunedWriterTaskIds": ["999001"],
      "prunedReason": "DISJOINT"
    },
    {
      "consumerTaskId": "176827",
      "qualifiedName": "pdata_nds.pos_eod_position_view",
      "expectedOutcome": "WRITER_NOT_IN_UNION",
      "boundaryWriterTaskIds": ["150384"]
    },
    {
      "consumerTaskId": "78588",
      "qualifiedName": "titans_dm.pos_eod_position_view",
      "expectedOutcome": "SOURCE_ENDPOINT_BOUNDARY",
      "notes": "oracle2hive 读源库；不伪造 Oracle 写者"
    },
    {
      "consumerTaskId": "209119",
      "qualifiedName": "pdata_n.t03_otc_opt_comp_info",
      "expectedOutcome": "NO_KNOWN_WRITER"
    }
  ]
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `expectedOutcome` | `CONTINUATION` \| `PRUNED` \| `WRITER_NOT_IN_UNION` \| `NO_KNOWN_WRITER` \| `SOURCE_ENDPOINT_BOUNDARY` \| `READ_SCOPE_UNAVAILABLE` |
| `requiredCandidateTaskIds` | 正例：这些 writer **必须**出现在 `candidates[]`（可多不可少） |
| `minCandidateCount` | 正例：至少 N 条接续（多写扇入） |
| `prunedWriterTaskIds` | 反例：这些 writer **必须**在 `prunedWriteObservationIds` 且 **不在** `candidates[]` |
| `boundaryWriterTaskIds` | 批外 writer：图上必须有边界节点，INDEX 可记 gap |
| `allowedPartitionMatch` | 正例边上允许的状态；**不含 DISJOINT** |

`readOccurrenceId` 可省略：测试运行时从纸条 `externalReads[]` 按 `qualifiedName` 解析，fixture 只钉结局。

### 4.3 通用规则

- `readTables` / `writeTables` 只列**物理表**；不列字段。
- `qualifiedName` 与投影节点 `properties.qualifiedName` 同一 normalize 规则（小写、去引号）。
- 可选 `readOccurrenceCount` / `writeObservationCount` 用于发现多读次回归；默认可从 Facts 推导。

---

## 5. 怎么验

### 5.1 Phase A — 任务内（先做）

```text
input:  taskId, dataRoot, factsRoot
step 1: load dataset-io.jsonl → 集合 R_facts, W_facts
step 2: projectTaskLocal → 集合 R_proj, W_proj（仅 READS/WRITES 到 PHYSICAL_DATASET）
assert: R_facts ⊆ R_proj  （T1 召回）
        R_proj ⊆ R_facts  （T2 精度）
        对 W 同理
```

实现要点：

- 复用 `tests/project-graph/task-local/golden-samples.test.ts` 里 `uniqueReadTables` / 写表提取逻辑，抽到 `map-acceptance-harness.ts`。
- 环境变量与 TL-6 对齐：`TASK_LOCAL_GOLDEN_DATA_ROOT`、`TASK_LOCAL_GOLDEN_FACTS_ROOT`、`TASK_LOCAL_GOLDEN_REQUIRED=1`。
- CI 无 sibling data 时 skip；有 data 且 `MAP_ACCEPTANCE_REQUIRED=1` 时 fail-closed。

### 5.2 Phase B — 跨任务闭包（能跨 + 不能跨一起验）

#### 5.2.1 在验什么（一句话）

对穿透批里**每一个** `externalRead`，INDEX 必须**结案**：

- **能跨** → `candidates[]` 里要有对应写观察（分区非 DISJOINT）；
- **不能跨** → 必须落在 `prunedWriteObservationIds`、边界节点或 `gaps[]` 之一，并带稳定 `reasonCode`。

**禁止第四种状态**：无 INDEX entry、或 entry 里 `candidates`/`gaps`/`pruned` 全空——等于静默丢读次。

这与列级「唯一定写者」无关：`candidates.length` 可以是 0（全 DISJOINT）、1 或多；边上可以是 ASSUMED/UNKNOWN。

#### 5.2.2 决策表（T3 落地）

对每个 `externalRead`（消费任务 B、读表 D、读次 r）：

```text
1. INDEX 是否有 entries[] 中 (consumerTaskId=B, readOccurrenceId=r)？
     NO  → FAIL（静默丢）
     YES → 继续

2. 并集批内是否存在写表 D 的 finalWrite？
     NO  → 跳到 5

3. 对每个批内写观察 w，算 partitionMatchStatus(r, w)：
     CONFIRMED | ASSUMED | UNKNOWN  → w 必须 ∈ candidates[]
     DISJOINT                         → w 必须 ∈ prunedWriteObservationIds[]
                                      且 w ∉ candidates[]

4. candidates[] 是否为空且 gaps[] 也为空？
     YES → FAIL（未解释为何全拒）
     NO  → 若仅有 PRUNED、无正例候选，须在 gaps 或报告注明「批内 writer 均 DISJOINT」

5. producer-index 是否有 D 的 confirmed writer？
     YES 且不在批内 → 图/INDEX 必须有 WRITER_NOT_IN_UNION 边界（T3-C）
     NO              → gaps 含 NO_KNOWN_WRITER（T3-D）

6. 传输/源库类读（如 *2hive 读 Oracle 源表）且 PI 无该源表 writer？
     → SOURCE_ENDPOINT_BOUNDARY（T3-E）；禁止伪造跨任务边

7. 读侧分区/身份不足以匹配任何 writer？
     → READ_SCOPE_UNAVAILABLE 等 gap（T3-F）；禁止空 entry
```

#### 5.2.3 正例 vs 反例（同一轮断言）

| 类型 | 含义 | 断言 |
| --- | --- | --- |
| **正例（能跨）** | 至少一个批内写观察与读次分区**可能相交** | 该写观察 ∈ `candidates[]`；`partitionMatchStatus ≠ DISJOINT` |
| **反例（不能跨·剪枝）** | 批内写观察与读次**确定不相交** | ∈ `prunedWriteObservationIds[]`；∉ `candidates[]` |
| **反例（不能跨·边界）** | writer 已知但不在批内 | 边界节点 + `WRITER_NOT_IN_UNION`（或 INDEX 等价 gap） |
| **反例（不能跨·无 writer）** | 全库无 confirmed writer | `NO_KNOWN_WRITER` gap |
| **反例（不能跨·源端点）** | 平台/源库边界，不追上游 | `SOURCE_ENDPOINT_BOUNDARY`；不造假边 |

**金样实例（表级，不含列）：**

| 读次场景 | 预期结局 | 说明 |
| --- | --- | --- |
| 176827 读 `t98_sb_otc_opt_comp_info` | T3-A，`candidates` 含 119044 | spine 第二跳 |
| 176827 读 `t98_sb_otc_opt_sub_trd_prcg_indx` | T3-A，`candidates` ≥ 2 | 多写扇入；不验唯一 |
| 某读次 vs 某写观察分区冲突 | T3-B，`pruned` 含该 writeObservationId | DISJOINT 不得留边 |
| 176827 读 `pos_eod_position_view`（批外 150384 写 Hive 目标） | T3-C 边界 | 批内无 writer 时显式边界 |
| 78588 读 `titans_dm.pos_eod_position_view` | T3-E 源端点 | 不往 Oracle 追 |
| 119044 读批外表 | T3-C 或 T3-D | 与 `union-continuation.test.ts` 对齐 |

#### 5.2.4 自动测试算法

```text
input:
  batch-manifest.json
  tasks/*/task-local-projection.json   → externalReads[] 全集 E
  union-continuation-index.json        → entries[] 全集 I
  tests/fixtures/map-acceptance/*.json → crossTaskClosures[]（金标结局）
  producer-index.json                  → 批外 writer 核对

for each e in E:
  entry := I.find(consumerTaskId=e.taskId, readOccurrenceId=e.readOccurrenceId)
  assert entry exists                                    // 禁止静默丢

  for each fixture closure matching e:
    switch closure.expectedOutcome:
      CONTINUATION:
        for each tid in closure.requiredCandidateTaskIds:
          assert ∃ c ∈ entry.candidates: c.taskId == tid
          assert c.partitionMatchStatus ∉ {DISJOINT}
        if closure.minCandidateCount:
          assert entry.candidates.length >= closure.minCandidateCount
      PRUNED:
        for each tid in closure.prunedWriterTaskIds:
          assert ∃ w: w.taskId == tid and w.writeObservationId ∈ entry.prunedWriteObservationIds
          assert no candidate with taskId == tid
      WRITER_NOT_IN_UNION:
        assert boundary node or gap reasonCode matches
      NO_KNOWN_WRITER | SOURCE_ENDPOINT_BOUNDARY | READ_SCOPE_UNAVAILABLE:
        assert entry.gaps contains expected reasonCode

  // 通用反例（无 fixture 时仍执行）：
  for each c in entry.candidates:
    assert c.partitionMatchStatus != DISJOINT
  for each wid in entry.prunedWriteObservationIds:
    assert no candidate with writeObservationId == wid
```

#### 5.2.5 与 `UNION_CONTINUATION_INDEX` 字段对齐

每条 `entries[]` 至少利用：

| 字段 | 用途 |
| --- | --- |
| `candidates[]` | T3-A 正例接续边 |
| `prunedWriteObservationIds[]` | T3-B 分区剪除 |
| `gaps[]` | T3-D/E/F 及批级解释 |
| `partitionMatchStatus`（候选上） | 边上标注；DISJOINT 只许出现在剪除路径 |

批外 writer 的边界可出现在：INDEX `gaps[]`、并集 merge 报告、或图上的边界任务节点——**三处至少一处可读**；验收以「consumer 读次能追到 writer 线索」为准，不要求边画成 TASK→TASK。

#### 5.2.6 Phase B 完成标准

- 穿透批上 **100%** `externalReads` 有 INDEX entry（无静默丢）。
- 金样 `crossTaskClosures[]` 全部绿（正例 + 反例）。
- spine（105387↔119044↔176827）两跳均为 T3-A。
- 至少 1 条 T3-B（DISJOINT prune）、1 条 T3-C 或 T3-E 在金样中有钉死案例。

### 5.3 Phase C — 证据对齐卫生（并行、不挡 A/B）

| 检查 | 动作 |
| --- | --- |
| Pack ↔ Facts `task_content_hash` | 批处理前扫描；stale 重跑 `input-pack:machine-facts` |
| Pack ↔ writer catalog | Facts SUCCESS 后 UPSERT；见 `execution-plan-writer-catalog.md`。**不要**为表血缘批再跑 `producer-index:update` |
| 读侧分区谓词缺失 | 记 L3 gap，不伪造 scope |

---

## 6. 与现有测试的关系

| 现有 | 本方案 |
| --- | --- |
| `golden-samples.test.ts` (TL-6) | 176827/119044/105387 已有读表断言；迁入 map-acceptance 或并行保留 |
| `test:task-local-projection` | 可挂载 `test:map-acceptance` |
| `test:field-evidence` / stop-loss | **不替代**本方案；列级止损与地图验收无关 |
| `reconcile-one-hop` 金样 | 老消费者；地图验收以 WP-3 + INDEX 为准，不混用启发式路径 |

---

## 7. 工作包与顺序

| 包 | 内容 | 完成定义 |
| --- | --- | --- |
| **MA-0** | 本文档 + 四锚点 fixture JSON | fixture 与人工 SQL 清单一致 |
| **MA-1** | `map-acceptance-harness.ts` + Phase A 测试 | 四锚点 T1/T2 绿；`MAP_ACCEPTANCE_REQUIRED` 可 fail-closed |
| **MA-2** | Phase B INDEX 集成测 + `crossTaskClosures` + spine | T3 正例（spine）与反例（DISJOINT/批外/源端点）同一轮绿 |
| **MA-3** | H1 批级报告字段；H2 抽查表模板 | GC-3 报告可引用，不重复实现 |
| **MA-4** | 文档回写 `execution-plan-gold-case-investigation.md` §6 | 表级验收指向本文档 |

领取顺序：**MA-0 → MA-1 → MA-2**；MA-3/MA-4 可与 MA-2 并行。

---

## 8. 硬约束

1. 验收代码不得含任务 id、表名、列名字面量（金样 fixture 除外）。
2. `SCOPE_DISJOINT` / `DATASET_IDENTITY_DIVERGENT` 只能由可证明规则产生，禁止「没找到路径」当_disjoint。
3. 调度边不得参与 T1–T3 的边存在性判定。
4. 不修改 SQLLens / Machine Facts 发布器来「迎合」验收；先修证据，再修投影。
5. 本方案通过后，折叠视图 / HTML 只是换画法，不改变 T1–T4 语义。

---

## 9. 完成判据（一句话）

**四锚点穿透批上：**

1. **任务内**：读写表与 Facts 100% 对齐（T1/T2）。
2. **跨任务**：每个 `externalRead` 在 INDEX 上结案——能连的非 DISJOINT 写观察在 `candidates[]`；不能连的落在 `prunedWriteObservationIds[]` 或具名 gap/边界（T3）；**不许静默空白**。
3. **身份**：分叉必 `DATASET_IDENTITY_DIVERGENT`（T4）。

列级能否定唯一上游，另册验收（field-evidence / `confirmedTwoHopRatio`）。
