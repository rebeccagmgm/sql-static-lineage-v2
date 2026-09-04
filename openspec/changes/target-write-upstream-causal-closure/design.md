## Context

现有仓库已经有稳定的 TypeScript parser、immutable IR、Plan Facts、Machine Facts、物理字段 resolver、producer bridge、table multi-hop artifact 和 field-lineage consumer。`dc041f5` 又补充了 Plan Facts 到 Calcite Rel 的独立差分旁路，以及 relation-level bridge 的基础能力。

但现有 `target-field-causal-slice` 仍按目标字段启动 traversal，并为每个目标字段与候选分支生成 assessment。对 209119 这类 137 字段、549 候选分支的宽表，这会重复计算同一任务/算子/关系证据，且不能自然表达没有具体字段的行存在性和重复度影响。本 change 只新增目标表级 consumer；旧 field-lineage 和旧目标字段 consumer 都是兼容输入或独立产品，不在本 change 中原地升级。

## Goals / Non-Goals

**Goals:**

- 以 `TargetWriteRef` 为目标表级 slicing criterion，按生产分支而非字段矩阵输出静态影响结论。
- 复用既有 immutable evidence，并将任务内 operator semantics 归一化为可去重的 `TaskRelationSummary`。
- 对 FIELD_VALUE 之外的 ROW_MEMBERSHIP、MULTIPLICITY、GROUPING、RELATION_EXISTENCE 和 ORDER_SELECTION 等重跑相关影响建立统一表达。
- 从现有 table multi-hop artifact 投影 candidate universe，使用 occurrence-specific bridge 做一次全局反向闭包。
- 让 Calcite 按任务/语句摘要作为可选的语义增强和差分轨，默认不阻塞生产链。
- 输出可核对的 relation status、候选集、proof/gap、coverage、limits 和阶段性能数据。
- 为 209119 提供不触发全量采集或旧字段血缘重建的 causal-only 重算与可量化性能门槛。

**Non-Goals:**

- 不重写 parser、IR、Plan Facts、Machine Facts、producer index 或旧 field-lineage contract。
- 不把 Calcite 变成 canonical parser、唯一语义来源或默认生产依赖。
- 不承诺纯静态分析能证明真实运行实例的 actual causality、分区重叠、参数变化或数据内容变化。
- 不在首版生成运行期 `MUST_RERUN` 事实；只提供静态相关性和可供策略消费的候选集。
- 不为首版追求所有 SQL 方言/UDTF/lateral/动态 SQL 的完整覆盖；未建模能力必须进入 Unknown 边界。
- 不枚举所有字段级路径或保存完整路径集合；字段级细节通过既有 field-lineage evidence 引用和有限 witness 提供。

## Decisions

### 1. Create a separate target-table consumer

新增目录建议为：

```text
scripts/reconcile/consumer/target-table-upstream-causal-closure/
├─ target-write-contract.ts
├─ task-relation-summary.ts
├─ impact-graph.ts
├─ candidate-universe.ts
├─ causal-closure.ts
├─ static-assessment.ts
├─ proof-validator.ts
├─ artifact-contract.ts
├─ format-target-table-causal-closure.ts
└─ reconcile-target-table-causal-closure.ts
```

新模块只读调用共享 evidence adapter，并使用独立 artifact type、文件名和 renderer。选择独立 consumer 而不是继续扩大 `target-field-causal-slice`，是为了让旧消费者不会因为新关系语义、图预算或 Calcite 可用性而改变行为。

### 2. Use a write-observation root and producer-branch assessment

根对象拆成稳定写入身份和分析快照引用：

```ts
type TargetWriteIdentity = {
  targetWriteId: string;
  taskId: string;
  targetTableKey: string;
  sqlSourceId: string;
  statementOrdinal: number;
  /** Zero-based ordinal among this task's canonical WRITE observations. */
  taskWriteOrdinal: number;
  rootRelationId: string;
};

type AnalysisSnapshotRef = {
  inputPackFingerprint: string;
  machineFactsHash: string;
  producerIndexHash: string;
  tableMultiHopHash: string;
  fieldLineageHash?: string;
  semanticRuleVersion: string;
};

type TargetWriteRef = {
  identity: TargetWriteIdentity;
  snapshot: AnalysisSnapshotRef;
};
```

主 assessment key 为：

```text
targetWriteId + candidateBranchId
```

`candidateBranchId` 在 V1 继续使用现有稳定候选身份，包含 consumer/read occurrence/physical producer 等稳定身份，不包含 producer role。以后 producer index 提供稳定 write observation identity 时，可增加字段而不改变当前候选语义。

`TargetWriteResolver` 必须把目标任务、物理目标表、SQL statement slot、root relation 和 canonical write evidence 唯一绑定；无法唯一绑定时输出 `TARGET_WRITE_AMBIGUOUS` 或 `TARGET_WRITE_RELATION_UNMAPPED`，禁止猜根。

物理表和 read occurrence 也必须 fail-closed：occurrence 只允许规范化后的完整 identity 相等匹配，禁止 substring/前缀命中；表名只能在完整 qualified identity 相等时解析为确认身份，唯一的 tail-name 命中也不能生成 `CONFIRMED` 或 `SCHEMA_BACKED` 证据。

`targetWriteId` 是某个 canonical SQL 结构中的确定性 occurrence identity，由 `sqlSourceId`、statement ordinal、write ordinal、root relation 和目标物理身份共同派生；SQL 任意修改后不承诺保持同一 ID。`sqlSourceId` 必须包含 query/prepare/finish 等 SQL slot 和 canonical locator，避免不同 slot 的相同 statement ordinal 发生碰撞。上游 producer 存在多个无法区分的 write observation 时，bridge resolver 输出 `PRODUCER_WRITE_AMBIGUOUS`，不得按 task/table 任意选择一个写入。

字段不得成为顶层 traversal root 或 assessment dimension，但可以作为 Task-local typed vertex、field port 或压缩 FieldSet，在 `FIELD_VALUE`/`EXPRESSION_CONTROL` 中接续精确值语义。它通过 `FieldValueEvidenceProvider` 或 canonical VALUE_FLOW index 按候选生产分支返回聚合摘要：

```ts
type FieldValueImpact = {
  candidateBranchId: string;
  status: "CONFIRMED" | "CONDITIONAL" | "UNKNOWN" | "PROVEN_ABSENT" | "NOT_APPLICABLE";
  affectedTargetFields: string[];
  outputFieldBindingIds: string[];
  evidenceRefs: string[];
  gapRefs: string[];
};
```

`affectedTargetFields` 只用于 FIELD_VALUE 的解释和钻取，不能成为关系级传播 frontier，因此不会产生 137×549 的 assessment 数量。

### 2.1 Project candidate universe before value evidence aggregation

Candidate Universe 必须在字段值 provider 之前完成最小投影，因为 provider 的输出键就是 `candidateBranchId`。Baseline 阶段先从匹配 fingerprint 的 table multi-hop artifact 投影：

```text
ROOT_WRITE
PHYSICAL_PRODUCER
SCHEDULE_ONLY
UNBOUND_READ
BLOCKED_READ
COVERAGE_BOUNDARY
```

这一步只枚举和稳定化候选身份，不计算全部 operator 语义。随后 `FieldValueEvidenceProvider` 以这些候选分支为聚合键读取或索引现有 VALUE_FLOW。这样 M1 可以验证“候选分支数量和证据扫描次数”而不依赖后续完整 relation graph。

### 3. Normalize once into task relation summaries

每个唯一的 task、statement、root relation/semantic digest 只生成一个摘要。摘要记录：

```ts
type TaskRelationSummary = {
  taskId: string;
  sqlSourceId: string;
  statementIndex: number;
  rootRelationId: string;
  digest: string;
  readImpacts: ReadonlyArray<{
    readOccurrenceId: string;
    impactChannels: ImpactChannel[];
    operatorEvidenceRefs: string[];
    fieldEvidenceRefs: string[];
    relationEvidenceRefs: string[];
    gaps: string[];
  }>;
  fieldTransfers: ReadonlyArray<{
    inputSubject: PhysicalFieldSubject;
    outputFieldBindingIds: string[];
    localEffectKind: "VALUE_FLOW" | "EXPRESSION_CONTROL" | "WINDOW_CONTEXT";
    evidenceRefs: string[];
    gapRefs: string[];
  }>;
};
```

Native Plan Facts/Machine Facts 负责确定“观察到的 operator、occurrence 和证据”；summary 负责把这些事实映射为重跑相关影响通道。字段值证据由 `FieldValueEvidenceProvider` 或 canonical VALUE_FLOW index 聚合到候选生产分支，并保留受影响的具体 output field binding；它不生成目标字段 assessment，也不驱动关系级全量扩散。`fieldTransfers` 是可按需物化的精确字段投影，M1 首先实现基于现有 field-lineage/VALUE_FLOW 的一次扫描或索引 adapter，不默认重建完整字段图。完整的跨 Task field-port propagation 只有在 Gate A 证明 adapter 无法精确接续时才建设，不与 provider 重复实现两套字段引擎。Calcite 以 `digest` 为缓存键补充 predicates、unique keys、functional dependencies 和 cardinality metadata，不以字段或候选分支为缓存键。

首版 operator semantics 按批次实现：

1. project/value、CASE/IF/COALESCE 和 expression subquery；
2. filter/having/qualify、inner/outer/semi/anti/cross join；
3. aggregate、GROUP BY、COUNT(*)、DISTINCT 和 set operation；
4. window value/partition/order/frame、ORDER + LIMIT/TOP/FETCH；
5. relation existence/cardinality，包括 EXISTS、literal-from-relation 和 fieldless dependency。

JOIN dependency 不以 uniqueness 为前提；uniqueness 只更新 `MULTIPLICITY` 的 certainty。普通 ORDER BY 和普通 window context 不自动变成 row membership dependency。

### 4. Build a deduplicated global impact graph

图的节点以 relation/read/write occurrence 为主；Task-local semantic edge 与跨任务 bridge edge 分开。local edge 是共享语义事实，不携带某个候选身份；bridge edge 才以生产者到消费者方向保存候选关联，并携带：

```text
candidateBranchId
readOccurrenceId
impactChannels
evidenceRefs
gapRefs
```

构图顺序是：

```text
TaskRelationSummary
  → exact read occurrence
  → producer bridge / relation bridge
  → producer write observation
  → GlobalImpactGraph
```

从 `TargetWriteRef` 反向传播一次。传播状态只保留节点、impact-channel bitset、逐通道 `ChannelStatus`、深度和少量 witness predecessor；不保存所有 root field、所有路径或所有字段组合。重复到达同一节点时，在同一 channel 内按 `CONFIRMED > CONDITIONAL > UNKNOWN` 合并；不同 channel 独立合并，直到固定点或预算停止。

每个候选分支最终保存逐通道结果：

```ts
type ChannelAssessment = {
  channel: ImpactChannel;
  status: "CONFIRMED" | "CONDITIONAL" | "PROVEN_ABSENT" | "UNKNOWN" | "NOT_APPLICABLE";
  proofRefs: string[];
  witnessRefs: string[];
  gapRefs: string[];
};
```

任一 channel 为 `CONFIRMED` 即整体 `CONFIRMED_RELATED`；无 confirmed 但有 conditional 即 `CONDITIONAL_RELATED`；仍有未关闭义务即 `UNKNOWN`。本轮重新关闭通用负向结论：`PROVEN_ABSENT`/`PROVEN_UNRELATED` 不由正向传播或“没有找到路径”产生，当前 validator 拒绝负向 proof；因此完整 universe 但没有显式、未来批准的 negative cut 时仍输出 `UNKNOWN`。`FIELD_VALUE = CONFIRMED` 不会被独立的 `MULTIPLICITY = UNKNOWN` 降级，但 multiplicity gap 仍会保留。

证据合并必须区分路径内串联和同通道备选路径并联：

```ts
composePath(CONFIRMED, CONDITIONAL) = CONDITIONAL;
composePath(CONFIRMED, UNKNOWN) = UNKNOWN;
composePath(CONDITIONAL, UNKNOWN) = UNKNOWN;

mergeAlternative(CONFIRMED, UNKNOWN) = CONFIRMED;
mergeAlternative(CONDITIONAL, UNKNOWN) = CONDITIONAL;
mergeAlternative(UNKNOWN, UNKNOWN) = UNKNOWN;
```

`PROVEN_ABSENT` 只能由完整 negative proof 产生，不能由正向传播中的“没有找到路径”产生。这个区分防止一个 confirmed operator edge 吞掉后续未知的 producer bridge，也防止一条未知备选路径污染另一条已经闭合的 confirmed witness。当前 change 暂不启用 negative proof 输出，相关 schema 字段仅为兼容/后续显式 gate 保留。

为避免跨任务闭环造成无限传播，使用稳定 occurrence/branch 状态键和共享 depth 上限；只有在实际输入出现强连通循环时再增加 SCC 压缩，不能用循环上限掩盖未知证据。

### 5. Keep positive propagation and negative proof separate

正向传播只回答“已发现哪些可能影响”；它可以形成 `CONFIRMED_RELATED` 或 `CONDITIONAL_RELATED` 的候选证据。最终 assessment 还要读取 candidate universe coverage 和 gap。

当前阶段不生成 `PROVEN_UNRELATED`，也不把 local `PROVEN_ABSENT` 自动升级为 `PROVEN_UNRELATED`；validator 对该关系状态和 negative proof 均 fail-closed。后续若重新开放，候选分支必须已在完整静态边界中枚举、所有支持的 operator/channel 都已检查、没有 gap/截断/未建模 operator，并且有明确的 no-path cut。没有满足这些条件时即使没有找到路径也只能是 `UNKNOWN`。

`UNKNOWN` 不向未枚举的上游虚构分支传播；对 candidate universe 中已知属于已证明 cut subtree 的分支，可以引用同一个 negative proof，记录继承来源。

### 6. Separate static assessment from runtime rerun policy

canonical artifact 保存：

```text
relationStatus
channelAssessments
evidenceRefs
gapRefs
negativeProofs (typed, content-addressed and validator-checked)
```

本 change 只保存静态候选集，并显式写入：

```text
runtimeRerunDecision = NOT_EVALUATED
```

本 change 的默认投影为：

```text
minimumCertainSet = CONFIRMED_RELATED
conservativeSafetySet = CONFIRMED_RELATED
                          + CONDITIONAL_RELATED
                          + UNKNOWN
```

它们是静态候选集，不等价于某个运行实例的必然重跑列表。`REQUIRED`、`SAFE_INCLUDE` 和 `NOT_REQUIRED` 由后续独立 `RuntimeRerunPolicy` consumer 根据分区、参数、运行状态和数据变化产生，不改变静态闭包证明。

同时生成任务级 rollup，便于最终消费方直接得到“哪些任务需要考虑”：

```ts
type UpstreamTaskRollup = {
  producerTaskId: string;
  branchIds: string[];
  relationStatus: "CONFIRMED_RELATED" | "CONDITIONAL_RELATED" | "PROVEN_UNRELATED" | "UNKNOWN";
  impactChannels: ImpactChannel[];
  evidenceRefs: string[];
  gapRefs: string[];
};
```

一个 Task 任一 branch confirmed 即进入最小确定集；没有 confirmed 但有 conditional/unknown 即进入保守安全集；所有 branch proven unrelated 才排除。`ROOT_WRITE` 只展示为目标根，不计入上游任务数量。

### 7. Reuse Calcite as a bounded shadow semantic track

Calcite 继续复用 `dc041f5` 的 Plan Facts Rel 投影和 JSONL bridge。目标表闭包只为唯一 semantic digest 请求一次（或命中缓存），请求超限、Java 不可用或无法映射时记录 `NOT_EVALUATED`，不阻塞 Native summary。

只有双方对同一已映射命题发生实质冲突时，才生成 `SEMANTIC_ENGINE_CONFLICT`。如果冲突只涉及某个 operator/channel，则只把对应 `ChannelAssessment` 降为 `UNKNOWN`，其他已闭合通道保持原状态；只有目标写入 identity、read occurrence mapping 或 producer bridge identity 等共享基础证据冲突，才阻断整个候选分支。Calcite 单方额外 metadata 先作为 validation observation；若要改变 Native transfer rule，必须沉淀为有 source/evidence 映射的回归 fixture。

### 8. Make performance a measured contract

causal-only CLI 的阶段必须分别计时：

```text
input load
summary normalization
Calcite shadow (if enabled)
candidate projection
graph build
reverse propagation
assessment/proof validation
artifact + renderer
```

每阶段输出调用次数、cache hit/miss、节点数、边数、候选数、witness 数和峰值内存。209119 的首轮验收使用已固定 fingerprint 的输入，不包含全量 Horae 采集；目标是缓存复用模式 5 分钟内、峰值 1GB 内，超出即失败并定位阶段。冷启动采集另行测量，不把外部采集耗时混入算法性能结论。

### 9. Preserve compatibility and publish independently

新 artifact 不覆盖：

```text
FIELD_MULTI_HOP_RECONCILIATION
target-field-causal-slice.json/html
```

新 renderer 只读取目标表闭包 artifact。共享 resolver/expander 若需要补强，先用旧 field-lineage golden、occurrence bridge 和 hash 检查锁定兼容性；任何旧输出变化都作为回归失败，而不是顺手更新基线。

## Risks / Trade-offs

- [Relation-level graph 仍可能很大] → 以 task/statement digest 去重，按 relation occurrence 建图，只保留 channel bitset 和少量 witness，并使用硬预算 fail-fast。
- [一次全局传播可能掩盖某个局部分支的证据差异] → 边和 assessment 仍保留 candidateBranchId、read occurrence、certainty、gap 和 evidence refs，合并只发生在共享语义节点。
- [没有稳定 producer write observation ID] → V1 使用现有稳定 candidateBranchId，并把 `TargetWriteRef` 纳入 assessment key；待 producer index 契约成熟后再无损升级。
- [上游 Task 对同一表存在多个 write observation] → 只有唯一 write 可确认 bridge；多写无法区分时输出 `PRODUCER_WRITE_AMBIGUOUS` 并降为 Conditional/Unknown，不任意选写入。
- [完整 field-port propagation 重复实现已有字段血缘] → M1 只建设 branch-level `FieldValueEvidenceProvider` adapter；只有 Gate A 证明无法精确接续时才建设 field-port propagation。
- [过晚才发现目标表级模型仍然昂贵或过宽] → M2 后执行 Gate A、M4 后执行 Gate B，未通过时停止后续 operator/Calcite 扩展。
- [Calcite 方言或 Plan Facts 投影不完整] → Calcite 只做 shadow enrichment；unsupported/unmappable 进入 `NOT_EVALUATED` 或 Unknown，不影响 Native canonical facts。
- [唯一性/函数依赖缺失导致大量 Conditional] → 将 dependency existence 与 multiplicity refinement 分开；不因缺少唯一键而删除明确 JOIN 结构依赖。
- [table artifact coverage 不完整] → 显式 candidate boundary 和 coverage status；禁止在边界内生成 `PROVEN_UNRELATED`。
- [共享 adapter 改动影响旧字段血缘] → 通过兼容 re-export、旧 golden、artifact hash 和独立 causal-only 开关验证，必要时回滚新 consumer而不回滚旧链路。
- [严格 5 分钟/1GB 门槛不适用于冷启动] → 门槛只约束复用 fingerprint 的 causal-only 基准，采集和浏览器/外部服务耗时单列。

## Migration Plan

1. 冻结 `dc041f5` 及旧 field-lineage/target-field 产物和 golden；确认新 change 不修改其 contract。
2. **Baseline：**实现 `TargetWriteResolver`、`TargetWriteIdentity`/`AnalysisSnapshotRef` 和最小 Candidate Universe 投影，先验证根与候选身份可唯一构造。
3. **M1：**基于现有 field-lineage/VALUE_FLOW index 实现一次扫描的 `FieldValueEvidenceProvider` 和单 Task `FIELD_VALUE` 闭包；完整 field-port engine 暂不默认建设。
4. **M2：**接入 exact producer/read bridge，完成跨 Task `FIELD_VALUE` 聚合；验证字段只精确接续对应 output binding，不扩散到全部字段。
5. **Gate A：**立即用 209119 验证 assessment 数量不超过唯一 candidate branch 数、不存在 137×549、字段证据只扫描/加载一次、bridge closure 可见、阶段指标可见，并满足缓存复用模式约 5 分钟/1GB 目标；不通过则停止后续扩展。
6. **M3：**加入 FILTER/JOIN 的 ROW_MEMBERSHIP/MULTIPLICITY、relation bridge、去重 GlobalImpactGraph 和 task-level rollup；验证 local semantic edge 不复制 candidate branch。
7. **M4：**加入 COUNT(*)、EXISTS、CROSS JOIN、literal-from-relation 等 RELATION_EXISTENCE/基数影响，完成逐通道 status、路径串联/备选合并代数和 `PRODUCER_WRITE_AMBIGUOUS`。
8. **Gate B：**再次运行 209119，核对 FIELD_VALUE、FILTER、INNER/LEFT JOIN、COUNT(*)、EXISTS、CROSS JOIN、MULTIPLICITY、task rollup、Unknown 原因和候选范围；只有产品价值成立才进入后续阶段。
9. **条件阶段 M5/M6：**在 Gate B 通过后，再加入 AGGREGATE、DISTINCT、SETOP、WINDOW、Top-N、negative proof safe rules 和 Calcite semantic digest 级 shadow/differential enrichment。
10. **M7：**发布独立 JSON/摘要/HTML、完整 validator 和性能报告，验证旧 field-lineage 产物、hash 和命令行为不变；运行期 RuntimeRerunPolicy 或 Calcite 生产侧车另开 change。

## Open Questions

- 209119 的目标表是否存在多个实际 write observation，需要在首个 fixture 中确认；这不影响 contract 对多写入隔离的要求。
- 209119 的现有 field-lineage/VALUE_FLOW index 是否足以支撑跨 Task 字段值聚合，需要在 Gate A 通过真实 provider 统计后决定是否建设完整 field-port propagation。
- producer-index 何时提供稳定的 `ProducerWriteObservation` ID，可在 V1 使用 branch identity 后单独迁移。
