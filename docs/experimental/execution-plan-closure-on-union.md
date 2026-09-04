# WP-10 闭包接并集图：执行方案（`closure-on-union`）— **已暂停，仅供维护参考**

> **2026-09-03**：迁出产品主链。当前副本在 `docs/experimental/`；OpenSpec 在
> `openspec/changes/archive/2026-09-03-closure-on-union-paused/`。见 `docs/experimental/README.md`。

配套：

- `docs/graph-accuracy-architecture.md`（准确性冻结架构；§4 三档接续、§6 复用/禁止、§8.2 WP-10、§10）
- `docs/graph-user-narrative.md`（L0–L3 陈述）
- `docs/execution-plan-asset-graph.md`（总地图）
- `docs/execution-plan-task-local-projection.md`（WP-7 投影 1.2.0）
- data-graph：`openspec/changes/union-continuation-v2`、`task-local-union-continuation-v2.ts`、
  `task-local-union-continuation-envelope.ts`、`union-continuation-v2-cli.ts`（WP-8 内核 + CLI 已合入）

本文件只解决一件事：

**让 `target-table-upstream-causal-closure` 的跨任务候选来自 WP-8 三档接续（读次 × 写观察 × `partitionMatchStatus`），
传播骨架复用；multi-hop 的调度候选、fan-out 假 resolved、legacy field-lineage 值证据不得再冒充 L1。**

事前信心约 65%（架构表）。本版（**v2.1**，2026-09-03）按对 closure 消费者的**实码核查**修订，并补齐契约：
接缝=候选宇宙 + JSON 契约；WP-8.1 索引 + **1.2.0 fail-closed 预检**；INDEX provenance 加厚；分区表述改为「四态契约执行」非「复用 PIQ」；
刀序 C0–C4，**第一刀只做 C0+C1**。C2 / Gate B-UNION / L0–L3 envelope **不得提前宣称完成**。

---

## 0. 现状（实码核查，2026-09-03）

### 0.1 上游已完成（不要重做）

| WP | 产物 | 位置 |
|----|------|------|
| WP-6 | `PACK_DECLARED_QUERY_OUTPUT` | sql-static-lineage Facts |
| WP-7 | `TASK_LOCAL_PROJECTION` 1.2.0：`READ_OCCURRENCE`、`localClosure.finalWrites / externalReads` | sql-static-lineage `scripts/project-graph/task-local/` |
| WP-5 | `TASK_LOCAL_UNION` 并集 | data-graph |
| WP-8 | `traceUnionContinuationV2` + `UNION_CONTINUATION_EVIDENCE` 1.0.0 + CLI `npm run union-continuation-v2` | data-graph `5c83639` 及后续 |

### 0.2 闭包消费者的真实结构（`scripts/reconcile/consumer/target-table-upstream-causal-closure/`）

| 组件 | 事实 | 对本 WP 的含义 |
|------|------|---------------|
| 候选宇宙 `projectCandidateUniverse`（`target-field-causal-slice/candidate-universe.ts`） | 来自 **multi-hop**：`writeEdges`（ROOT）、`producerBridges`（PHYSICAL_PRODUCER）、剩余 `scheduleEdges`（**SCHEDULE_ONLY**）、未绑读（UNBOUND/BLOCKED）、terminals（COVERAGE） | **接缝在这里**；调度候选今天就在宇宙里 |
| `CandidateBranch` | `branchKind ∈ ROOT_WRITE / PHYSICAL_PRODUCER / SCHEDULE_ONLY / UNBOUND_READ / BLOCKED_READ / COVERAGE_BOUNDARY`；`readOccurrence`、`writeObservationId?`、`writeScope?`、`evidenceRefs[]`、`gapRefs[]`（字符串） | 无 `partitionMatchStatus`、无 `source=IN_UNION/PI_ONLY`；需新增字段而非硬塞 |
| `enrichProducerWriteBridges` / `bindProducerWrite` | 给 PHYSICAL_PRODUCER 挂 Facts 写（`field_producing===true`）与 `writeScope`；1 写 → `resolved++`；**N 写 → `resolved += N`，`ambiguous` 永远 0** | 只是附着步；保留其 scope 绑定，替换其计数 |
| 分区对照 | **目录内零处**：无 `partitionMatchStatus / PROVEN_DISJOINT / POSSIBLE_OVERLAP / DATE_PARTITION_DEFAULTED` | 分区判定必须**只来自 WP-8** |
| `causal-closure.ts`（642 行） | `buildCausalClosure(targetWriteId, universe, summaries, fieldValueProvider, rootWriteScope, sameTaskUpstreamWrites, budget)`；certainty `CONFIRMED / CONDITIONAL / UNKNOWN`；产品档：`valueCertain / rowDetermining / multiplicityRisk`（档一/二/三） | 骨架可复用；**档位 ≠ WP-8 三档**，要做映射 |
| `field-value-provider.ts` | 读 legacy `field-lineage.json` VALUE_FLOW；pair 级回退 `unboundByPair`；"最多引用胜出" sort | **LEGACY_COMPAT 产物**；架构不复用 → 值证据在 union-v2 模式最多 L2 |
| 调度 | 仅 multi-hop `scheduleEdges` → `SCHEDULE_ONLY` 分支；本目录无 `SCHEDULE_FALLBACK` | union-v2 模式下不得作 producer |
| `read-scope.ts` 的 `readOccurrenceId` | 是 **Facts relation/occurrence 定位符**（如 `task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h`） | 与 WP-7 `READ_OCCURRENCE.occurrenceId` **同源**，可作 join key |
| 传播硬约束 | `WriteScope` 缺失 → UNKNOWN；`sameTaskUpstreamWrites`；`TARGET_WRITE_AMBIGUOUS` 须 `--write-observation-id`；宇宙 `INCOMPLETE` ⇒ 无 `PROVEN_UNRELATED` | 方案必须保留这些 |
| 与 data-graph | **零耦合**：不读 `TASK_LOCAL_UNION` / 1.2.0 / `UNION_CONTINUATION_*` | 需新增 JSON 适配层 |
| 金样/产物 | `sql-static-lineage-artifacts/target-table-causal-closure/{176827,176827-baseline,155015,209119}`；`209119-gate-evidence.md`：Gate A PASS WITH SCOPE，**Gate B NOT VERIFIED / REOPENED**，542 分支 46 CONFIRMED / 496 UNKNOWN | 176827 ~6–8s 可回归；209119 只抽样 |
| 测试 | 5 文件，合成 + 抽取 relation JSON，**非**真 Facts 直跑 | 新增真语料断言要走 CLI 产物 |

### 0.3 本 WP 不解决

- WP-9 传输图、WP-11 `outputDerivationKind` / STRICT_CAUSAL field-lineage、WP-12 全文案 UI
- 不改 WP-7 身份五级；不改 WP-8 `partitionMatchStatus` 枚举与匹配语义
- 不改 legacy root 快照 / `LEGACY_ARTIFACT_PAIRS` 六个参考查询
- 不为绿测给 105387 `#3/#6` 共享 PI `:0`（保持 WP-8 fail-closed）
- 不在 sql-static-lineage 复制一份 WP-8 内核

---

## 1. 目标、仓界、接缝

**目标**：union-v2 模式下，闭包候选与分区状态**全部来自 WP-8**；`ambiguous` 真计数；调度与 legacy 值证据不进 L1；
176827 / 209119 在 union-v2 与 legacy 的差异逐条可解释；产出机读的 **L1 闭包集合**（Gate B-UNION）。

### 1.1 仓界

| 角色 | 仓 | 做什么 |
|------|----|--------|
| **上游小交付（先做）** | `scripts/data-graph` | **WP-8.1 并集接续索引**：把并集内所有 PROJECTED consumer 的每个 `externalReads` 读次跑 v2，汇成一份 `UNION_CONTINUATION_INDEX`（见 §2.1）；只编排，不改内核 |
| **主战场** | `sql-static-lineage` | 闭包候选适配、计数、Gate B-UNION 证据、金样 diff |

两仓**只通过 JSON 产物**交互（进程内 import 不可能）。契约版本钉死；DTO 各自解析，不 copy 枚举后各改各的。

### 1.2 join key

闭包侧 `readOccurrence` 定位符 与 WP-7/8 `readOccurrenceId` **同为 Facts occurrence/relation id**。适配层以此为主键；
对不上者记 gap `CONTINUATION_READ_NOT_FOUND`，分支退为 UNKNOWN，**不得回退 legacy 多写 fan-out**。

领取：sql-static-lineage `openspec new change "closure-on-union"`；data-graph `openspec new change "union-continuation-index"`（WP-8.1，小）。

---

## 2. 产出 / 不产出

### 2.1 WP-8.1（data-graph）`UNION_CONTINUATION_INDEX` 1.0.0

**CLI 入口 fail-closed 预检（在调用 v2 内核之前）**：

1. 并集内所有 `PROJECTED` task 必须 `projectionSchemaVersion === "1.2.0"`；
2. `SCHEDULE_ONLY`、`COLLECTION_FAILED` **不进入** v2 计算（不进 entries）；
3. 任一 `PROJECTED` 不合格（非 1.2.0 / 缺投影 / schema 漂移）→ **整次 index 生成失败**，不产出可消费的部分结果。

105387 等金样必须按**当前** 1.2.0 投影重跑进索引；禁止拿旧 envelope / 旧投影代替。

```text
schemaVersion, artifactType=UNION_CONTINUATION_INDEX, generatedAt
input {
  batchManifestRef{path?, contentHash},
  producerIndex{contentHash, inputFingerprint},
  taskProjections[]{taskId, contentHash, schemaVersion}   # 仅进预检通过的 PROJECTED=1.2.0
}
entries[]  每个 (consumerTaskId, readOccurrenceId) 一条：
  {
    consumerTaskId,
    readOccurrenceId,                 # Facts occurrence/relation id（闭包 join key）
    readOccurrenceNodeId,             # 投影图节点 id（§10 回溯）
    datasetNodeId, qualifiedName, identityStatus,
    partitionPredicateStatus,         # 读侧谓词整体状态（来自 WP-8 读次）
    candidates[]{
      taskId,
      writeObservationId,
      targetWriteNodeId,              # Facts / 投影写节点 id
      datasetNodeId, qualifiedName,   # 写侧数据集（与读侧同表时仍显式带上）
      source,                         # IN_UNION_FINAL_WRITE | PRODUCER_INDEX_ONLY
      partitionMatchStatus,           # CONFIRMED|ASSUMED|UNKNOWN|DISJOINT
      partition,                      # 写侧分区字面量/模板（或等价结构，供解释）
      evidenceEnvelopeRef?,           # 可选：逐读次 UNION_CONTINUATION_EVIDENCE 路径/hash
      evidenceLayer, l1Eligible,
      alignmentGapCode?, reasonCode?  # 含 WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS 等
    },
    prunedWriteObservationIds[],      # DISJOINT 等剪除清单
    gaps[]                            # 读次级 gaps + reason codes
  }
contentHash（忽略 generatedAt）
```

实现 = 预检通过后，对每个 PROJECTED task 调 `traceUnionTaskContinuationV2` 并平铺；复用 envelope 的 hash 规则。
**按 WP-8 已冻结的四态 `partitionMatchStatus` 契约执行；闭包侧与索引侧均不新增匹配逻辑，也不重新解释分区状态。**
（WP-8 内核自实现四态判定；语义对齐历史上的 PIQ 字面量/DISJOINT 规则，**不是**代码复用 `producer-index-query`。）
可选同时保留逐读次 `UNION_CONTINUATION_EVIDENCE`（已有 CLI）。

### 2.2 WP-10（sql-static-lineage）

1. **适配层** `union-continuation-candidate-source.ts`：加载 §2.1 索引；提供
   `candidatesForRead(consumerTaskId, readOccurrenceId)`。
2. **候选宇宙 union-v2 模式**：
   - PHYSICAL_PRODUCER 分支只从索引 `candidates` 生成（含 `IN_UNION_FINAL_WRITE` 与 `PRODUCER_INDEX_ONLY`），但跨 Task 候选还必须通过原始 multi-hop `scheduleEdges` 的 consumer-side whitelist；
   - multi-hop `scheduleEdges` **不生成** SCHEDULE_ONLY producer 分支（可保留为参考属性），只约束 INDEX 候选是否可保留；
   - schedule relation 缺失或解析失败时只保留 UNKNOWN 边界，不回退到 INDEX 全量 fan-out；
   - `DISJOINT` 不入宇宙（记 `disjointPruned`）。
3. **`CandidateBranch` 新增字段**（可选字段，legacy 模式为空）：
   `continuation { source, partitionMatchStatus, evidenceLayer, l1Eligible, indexEntryRef }`。
4. **附着步**：仍用 `bindProducerWrite` 绑 `writeScope`（按 `writeObservationId` 精确，不再"表内全部写"）。
5. **计数**：新增 `continuationStats { l1, l2Assumed, l2Unknown, piOnly, disjointPruned, ambiguousReads, unmatchedReads, selfReadBoundaries? }`；同任务自读属于本地 UNKNOWN 边界 `SELF_READ_NOT_EXTERNAL`，不计入 `unmatchedReads`；
   `bridgeStats.resolved` **仅**计 `l1Eligible` 且 scope 绑定成功者；`bridgeStats.ambiguous` = 分区档后同读次仍 ≥2 写观察的读次数。
6. **值证据降级**：union-v2 模式下 `field-value-provider` 结果最高 **CONDITIONAL/L2**，不得单独构成 `valueCertain`；
   `valueCertain`（档一）只由 `l1Eligible` 链 + 本任务 Facts `localFieldPaths`/output-field-bindings 支撑。
7. **CLI**：`--candidate-source legacy|union-v2`（默认 legacy）、`--continuation-index <path>`。
8. **差异报告**：176827 / 209119 `union-v2 vs legacy` 逐分支 diff（任务、写观察、原因码）。
9. **Gate B-UNION 证据**：机读 L1 集合 + 断言（§5）。

### 2.3 不产出

- 不重写 `causal-closure.ts` 传播算法
- 不在闭包侧实现任何分区匹配
- 不把调度边/调度父任务直接升格为 producer；允许原始 `scheduleEdges` 作为 INDEX 候选的 consumer-side whitelist，缺失或解析失败必须 fail-closed 为 UNKNOWN
- 不要求本 WP 完成 STRICT_CAUSAL field-lineage（WP-11）或 HTML/M7 发布

---

## 3. 原料

| 输入 | 用途 |
|------|------|
| `UNION_CONTINUATION_INDEX`（WP-8.1） | 唯一跨任务候选与分区状态来源 |
| 现有 Facts bundles | `writeScope`、`field_producing`、`sameTaskUpstreamWrites`、`localFieldPaths` |
| table-multi-hop 产物 | legacy 模式沿用；union-v2 模式仅用于 diff 对照与 UNBOUND/COVERAGE 边界 |
| legacy `field-lineage.json` | legacy 模式沿用；union-v2 模式降为 L2 |
| `176827-baseline` / 209119 产物 | 对照 |

**硬规则**：分区 CONFIRMED/ASSUMED/UNKNOWN/DISJOINT 只信 WP-8 索引字段；闭包侧禁止再实现任何分区匹配，也禁止调用 `producer-index-query` 重算。

---

## 4. 状态映射与计数（冻结）

### 4.1 WP-8 候选 → 闭包分支资格

| WP-8 候选 | 入宇宙 | 传播资格 | 计数 |
|-----------|--------|----------|------|
| `DISJOINT` | 否 | — | `disjointPruned` |
| `l1Eligible=true`（身份 CONFIRMED + in-union + 分区 CONFIRMED）且 `writeScope` 绑定成功 | 是 | **可达 CONFIRMED / L1** | `l1`；`bridgeStats.resolved` |
| `l1Eligible=true` 但 `writeScope` 缺失 | 是 | UNKNOWN（现有规则） | `l1` + gap `PRODUCER_WRITE_SCOPE_UNRESOLVED` |
| `IN_UNION` + `ASSUMED` | 是 | 最高 CONDITIONAL / L2 | `l2Assumed` |
| `IN_UNION` + `UNKNOWN` | 是 | UNKNOWN / L2 | `l2Unknown` |
| `PRODUCER_INDEX_ONLY` | 是（边界） | 表级可叙；不进 L1 | `piOnly` + gap `WRITER_NOT_IN_UNION` |
| gap `WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS` | 对应写观察按 UNKNOWN 处理 | L2 | 透传；**禁止**用 PI `:0` 消歧 |
| 索引中找不到该读次 | 分支退 UNKNOWN | — | `unmatchedReads` + gap `CONTINUATION_READ_NOT_FOUND` |
| 同任务写回同表的本地自读不在 `externalReads` | 分支退 UNKNOWN | — | `selfReadBoundaries` + gap `SELF_READ_NOT_EXTERNAL` |
| multi-hop SCHEDULE_ONLY | **不生成 producer 分支** | — | 仅参考属性 |

**`ambiguous` 真计数**：同一读次在分区档保留后仍有 ≥2 个写观察 → 该读次计 1（`ambiguousReads`，同时写入 `bridgeStats.ambiguous`）。
**禁止**：`resolved += writes.length`。

### 4.2 闭包产品档 ↔ L0–L3

| 闭包产物 | union-v2 模式含义 |
|----------|------------------|
| `valueCertain`（档一） | 仅 `l1Eligible` 链 + 本任务 Facts 字段路径；**legacy field-lineage 不能单独撑起** |
| `rowDetermining` / `multiplicityRisk`（档二/三） | 沿用 JOIN 侧别 / 控制通道规则；候选来源同上 |
| `UNKNOWN` | 含 L2（ASSUMED/UNKNOWN/PI-only）与 gaps |
| envelope | L0：索引/PI/投影 hash 与 `continuationStats`；L1：`l1Eligible` 到达集合；L2：其余保留候选；L3：gaps |

**预期代价**：176827 档一相对 baseline（27 任务）**大概率收缩**。这是把 LEGACY_COMPAT 值证据降为 L2 的直接后果，
属准确性优先的正确结果；diff 报告要按原因码解释每条收缩，**不得**为保数字回退 legacy 值证据。

---

## 5. Gate B-UNION（本 WP 验收定义；与历史 Gate B 区分）

历史 Gate B（`209119-gate-evidence.md`）= 运行期重跑清单 / overlay，状态 **NOT VERIFIED / REOPENED**，本 WP **不宣称改变它**。

**Gate B-UNION** 指：

1. union-v2 模式闭包产出可序列化的 **L1 闭包集合**（任务 × 写观察 × 读次链）；
2. 集合中不出现：`ASSUMED`/`UNKNOWN` 升格、`SCHEDULE_ONLY` producer、单靠 legacy `field-lineage.json` 支撑的 `valueCertain`；
3. `union-v2 vs legacy` 差异文件存在，每条带原因码；
4. 176827 与 209119 各至少一条自动化回归读取该证据（209119 抽样锚定即可）。

STRICT_CAUSAL 字段证据、HTML 发布不阻塞 Gate B-UNION（记 known gap）。

---

## 6. 刀序（C0–C4）与工期（按 LOC 与产物规模修订）

### C0 — 契约与开关（0.5～1 人日，两仓）

- data-graph：OpenSpec `union-continuation-index`，`UNION_CONTINUATION_INDEX` 类型（§2.1 全字段）+ CLI 子命令（编排现有 API）+ **1.2.0 预检**
- sql-static-lineage：OpenSpec `closure-on-union`；`CandidateBranch.continuation?` 字段；`continuationStats` 类型；
  `--candidate-source` 开关（默认 legacy，行为不变）
- **完成**：两仓 typecheck/test 绿；行为未变；索引对非 1.2.0 PROJECTED fail-closed

### C1 — 附着步接 WP-8 状态（**第一刀必达**，2～3 人日）

- 适配层加载索引；PHYSICAL_PRODUCER 分支按 `writeObservationId` 精确绑 scope；
  写入 `continuation` 字段；`DISJOINT` 剪除；计数按 §4；SCHEDULE_ONLY 不生成 producer 分支
- **候选宇宙仍由 multi-hop 提供表级边**（本刀不重写宇宙）
- 金样：**119044 索引条目**（目标表 `pdata_n.t03_agt_stati_info_h` 的两读次 → `SRC_TBL` DISJOINT；
  勿误解为该 task 仅有两个 externalReads；105387 `#3/#6` 对齐歧义 → UNKNOWN，须用当前 1.2.0 投影重跑）
  用合成 multi-hop 输入接上；计数断言：不再假 resolved
- **完成**：union-v2 模式 C1 单测绿；legacy 模式产物 hash 不变

### C2 — 候选宇宙改源 + 值证据降级 + 176827（4～6 人日）

- union-v2 模式下 PHYSICAL_PRODUCER 分支**完全**由索引生成；multi-hop 只供边界与 diff
- `field-value-provider` 上限 CONDITIONAL/L2；`valueCertain` 改由 `l1Eligible` 链 + Facts 字段路径
- 保留 `WriteScope` / `sameTaskUpstreamWrites` / `TARGET_WRITE_AMBIGUOUS` 现有约束
- 176827：跑 union-v2，产 diff v0（锚定档一 27 任务 + 拉链三张的去向与原因码）
- **完成**：176827 diff 文件 + 自动化锚定断言；档一收缩可解释

### C3 — Gate B-UNION + 209119（1～2 人日）

- L1 集合序列化与断言；209119 抽样锚定（不追求 542 分支全 diff）
- 更新 `209119-gate-evidence.md`：新增 Gate B-UNION 小节，历史 Gate B 状态**原样保留**
- **完成**：Gate B-UNION 机读通过

### C4 — 产品面（可选，后置）

- 闭包结果挂到 L0–L3 envelope（与 WP-8 envelope 同风格）；WP-12 叙事对接

**总计约 8～12 人日**（架构表 5～9 偏乐观；超出主要在 C2 值证据降级 + 176827 解释）。
C0+C1 单独验收信心 ~80%；整包仍 ~65%。

---

## 7. 金样与断言来源

| 样例 | 刀 | 用途 |
|------|----|------|
| 119044：目标表 `pdata_n.t03_agt_stati_info_h` 的两读次（WP-8 索引条目） | C1 | 接续状态进闭包分支、DISJOINT 剪、计数 |
| 105387 `#3/#6`（当前 1.2.0 投影重跑，不用旧 envelope） | C1 | 对齐歧义保持 UNKNOWN，不共享 `:0` |
| 176827（`176827-baseline` 档一 27） | C2 | 规模闭包；档一收缩逐条解释 |
| 209119（542 分支） | C3 | Gate B-UNION 抽样 |

断言来自真 Pack/Facts / 当前 producer-index / 当前 1.2.0 投影 / WP-8 索引；禁止手抄表名当唯一期望。

---

## 8. 复用 / 禁止清单（架构 §6，本 WP 强制）

| 组件 | 决策 |
|------|------|
| `causal-closure.ts` 传播、`WriteScope`、`sameTaskUpstreamWrites` | **复用** |
| `bindProducerWrite` scope 绑定 | 复用（改为按 `writeObservationId` 精确） |
| `task-relation-summary` JOIN 侧别、`datasetControlsForStatement` | 复用 |
| WP-8 四态 `partitionMatchStatus` / `l1Eligible` / gaps | **权威，只读**（契约执行，非复用 PIQ 代码） |
| `producer-index-query` 实现 | **不调用**；分区状态只信索引里 WP-8 已算好的四态 |
| `enrichProducerWriteBridges` 的 N 写全 resolved | **替换** |
| multi-hop `scheduleEdges` → SCHEDULE_ONLY producer | union-v2 **禁止**；原始边仅作为 INDEX 候选 whitelist |
| `field-value-provider` pair 回退 / 最多引用胜出 | union-v2 **不进 L1**（≤ L2） |
| `physical-field-expander` LEGACY_COMPAT | 间接输入，**不进 L1**；换 STRICT_CAUSAL 属 WP-11 |
| 调度父节点直接升格 producer、任务名推表、`POSSIBLE_OVERLAP`→PRIMARY、本地分区规则 | **禁止** |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 一次改传播爆炸（信心 65%） | C1 只改附着与计数；C2 才换宇宙来源；C1 合入前不开 C2 |
| 两仓契约漂移 | `UNION_CONTINUATION_INDEX` 版本钉死 + contentHash；DTO 各自解析 |
| 档一收缩被当"退步" | §4.2 预先声明；diff 原因码逐条；legacy 模式默认保留作对照 |
| 读次 join 对不上 | gap `CONTINUATION_READ_NOT_FOUND` + UNKNOWN，不回退 fan-out |
| 105387 多写无 PI id | 保持 WP-8 gap；闭包不消歧 |
| 与 P0 重跑收缩回归冲突 | legacy 模式 hash 不变作回归；union-v2 并行金样 |
| 索引规模 | 只对并集内 PROJECTED 任务生成；按 contentHash 增量 |

---

## 10. 验证命令

sql-static-lineage：`npm run test:target-table-causal-closure`、`npm run test:field-lineage`、`npm run typecheck`、`npm run build`
data-graph（WP-8.1）：`npx vitest run tests/task-local-union-continuation-v2.test.ts`、`npm test`、`npm run build`
真语料：`npm run reconcile-target-table-causal-closure -- … --candidate-source union-v2 --continuation-index <index.json>`（176827 / 209119）
Gate B-UNION L1 集合：`npm run gate-b-union -- --closure-artifact <union-v2-closure.json> --continuation-index <index.json> --output <l1-set.json>`

---

## 11. 完成定义（整包 WP-10）— 暂停时交付状态

> **2026-09-03 暂停**：下列项为归档前已交付 / 未交付记录，**不再作产品验收清单**。

- [x] WP-8.1 `UNION_CONTINUATION_INDEX` 合入 data-graph（WP-8 接续核 `5c83639`）
- [x] C0–C3 合入 sql-static-lineage（C4 未做；产品已暂停）
- [x] union-v2：`ambiguousReads` 真计数路径；SCHEDULE_ONLY 不作 producer（维护测试覆盖）
- [~] 119044 / 105387 与 WP-8 状态一致（合成金样有测；全量 diff 非验收项）
- [ ] 176827、209119 union-v2 vs legacy 差异逐条可解释 — **暂停，不作 Gate**
- [~] Gate B-UNION CLI 与测试（`gate-b-union.ts`）— maintenance-only
- [x] legacy 模式默认开关；产物 hash 回归在既有测试中
- [x] OpenSpec 归档；`graph-accuracy-architecture.md` §8.2 WP-10 行已更新

---

## 12. 给实现 agent 的第一刀范围（可直接粘贴）

**Agent D（data-graph，WP-8.1）**：基于 `origin/master`，新增 `UNION_CONTINUATION_INDEX` 1.0.0（字段按 §2.1，含 provenance / node ids / partition / gap codes）+ CLI 子命令；
**入口预检**：全部 PROJECTED=`1.2.0`，`SCHEDULE_ONLY`/`COLLECTION_FAILED` 不进算，任一 PROJECTED 不合格则整次失败；
预检通过后平铺 `traceUnionTaskContinuationV2`；复用 envelope hash 规则；**不改内核、不调用 PIQ、不重新解释分区**；
119044（目标表 `pdata_n.t03_agt_stati_info_h` 两读次）与 105387（当前 1.2.0 投影重跑）进索引测试。

**Agent C（sql-static-lineage，C0+C1）**：新分支；OpenSpec `closure-on-union`；`CandidateBranch.continuation?`、`continuationStats`、
`--candidate-source` 开关（默认 legacy，产物 hash 不变）；适配层读索引；PHYSICAL_PRODUCER 按 `writeObservationId` 精确绑 scope；
DISJOINT 剪、SCHEDULE_ONLY 不作 producer、计数按 §4；119044（目标表两读次）/105387 合成金样。
**不做** C2 宇宙改源、不降级值证据、不改 WP-8 核、不为多写共享 PI 分区、不宣称 Gate B-UNION / L0–L3 envelope 完成。

---

## 13. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-03 v1 | 初版：刀序 C0–C4，切在 `enrichProducerWriteBridges` |
| 2026-09-03 v2 | 按 closure 实码核查修订：接缝改为候选宇宙 + JSON 契约；新增 WP-8.1 `UNION_CONTINUATION_INDEX`；明写 WriteScope/field_producing/sameTaskUpstreamWrites 约束；值证据降级与档一收缩代价；Gate B-UNION 与历史 Gate B 区分；工期 8～12 人日；WP-8 CLI 已落地 |
| 2026-09-03 v2.1 | 契约补丁：索引 CLI 1.2.0 fail-closed 预检；INDEX 字段加 nodeId/partition/gap/provenance；PIQ 改为「四态契约执行非代码复用」；119044 写明目标表两读次 |
