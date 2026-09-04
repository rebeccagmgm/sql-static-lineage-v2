## Purpose

给定目标任务和目标表的写入观测，从已有表级上游候选空间中计算目标表的静态上游因果闭包，保留字段值、行成员、重复度和关系存在性等间接影响，并为每个候选生产分支输出可审计的相关性与保守重跑候选结论。

## ADDED Requirements

### Requirement: Target write is the causal slicing criterion

系统 SHALL 以版本化且已绑定 canonical evidence 的目标写入观测作为因果闭包的根，而不是以目标表字段集合建立主遍历。目标写入观测至少包含任务、写入观测、物理目标表、语句/关系范围和分析快照引用；同一任务存在多个写入观测时 MUST 分别计算或由调用方显式指定根集合，禁止隐式合并。

#### Scenario: One target write is analyzed

- **WHEN** 调用方提供一个目标任务、目标表和唯一匹配的写入观测
- **THEN** 系统从该 `TargetWriteRef` 建立一次目标表级闭包，字段可作为内部 typed field port 接续精确值证据，但不生成目标字段×候选分支的主 assessment 矩阵

#### Scenario: Multiple writes are present

- **WHEN** 目标任务对同一物理表存在多个语句或写入观测
- **THEN** 系统要求显式选择写入观测或输出按 `TargetWriteRef` 隔离的闭包，不能因为目标表名相同而合并证据

### Requirement: Target write identity is deterministic and evidence-bound

系统 SHALL 将目标写入的稳定身份与分析输入快照分开表示。`TargetWriteIdentity` MUST 能唯一绑定 task、目标物理表、`sqlSourceId`、statement ordinal、write ordinal、root relation 和 write evidence；`AnalysisSnapshotRef` MUST 记录参与分析的 Input Pack、Machine Facts、producer index、table multi-hop、可选 field-lineage 和语义规则版本。`targetWriteId` 是 canonical SQL 结构中的确定性 occurrence identity，不承诺 SQL 任意修改后保持不变。若写入无法唯一绑定到 SQL/Plan Facts relation 或 canonical write evidence，系统 MUST 输出可定位 gap 并停止该根的确定性闭包。

#### Scenario: Target write is uniquely resolved

- **WHEN** 目标任务、目标表、语句位置、root relation 和 write evidence 能唯一匹配
- **THEN** 系统生成稳定 `targetWriteId`，并将它与独立的 `AnalysisSnapshotRef` 绑定到闭包 artifact

#### Scenario: Target write cannot be uniquely resolved

- **WHEN** 同一目标存在多个候选写入、语句与 root relation 无法映射或 canonical write evidence 缺失
- **THEN** 系统输出 `TARGET_WRITE_AMBIGUOUS` 或 `TARGET_WRITE_RELATION_UNMAPPED` gap，不得猜测根或生成确定性无关结论

### Requirement: Relation summaries expose rerun-relevant impact channels

系统 SHALL 对每个任务/语句/目标关系生成可去重的语义摘要，并以正交的 `impactChannels` 表达输入对输出的潜在影响。至少支持 `FIELD_VALUE`、`EXPRESSION_CONTROL`、`ROW_MEMBERSHIP`、`MULTIPLICITY`、`GROUPING`、`SET_MEMBERSHIP`、`ORDER_SELECTION`、`WINDOW_EFFECT` 和 `RELATION_EXISTENCE`；字段血缘不得成为表达关系级影响的唯一方式，也不得被从内部值传播中完全剥离。

#### Scenario: Indirect operator influence is retained

- **WHEN** 输入关系通过 JOIN、WHERE/HAVING/QUALIFY、GROUP BY、DISTINCT、SET operation 或 `ORDER BY` 与 LIMIT/TOP/FETCH 参与目标写入
- **THEN** 摘要保留对应 relation occurrence、operator evidence 和影响通道，即使输入字段没有直接流入目标字段值

#### Scenario: Fieldless relation dependency is present

- **WHEN** SQL 使用 `COUNT(*)`、`EXISTS`、无条件 CROSS JOIN 或 `SELECT literal FROM relation` 等不产生具体输入字段的关系依赖
- **THEN** 系统以 relation occurrence 表达行存在性或基数影响，不得因 `affectedFields` 为空而裁掉该上游关系

#### Scenario: Ordering does not imply row impact by itself

- **WHEN** 输入只参与没有截断或筛选效果的 ORDER BY 或普通窗口上下文
- **THEN** 系统仅记录 ordering/window impact，不将其自动升级为目标表行成员变化或重跑必需

#### Scenario: Field value evidence is incomplete

- **WHEN** 现有 field-lineage 或 canonical VALUE_FLOW index 无法完整覆盖某个候选生产分支的字段值影响
- **THEN** 仅将 `FIELD_VALUE` 通道标为 `UNKNOWN` 并附 gap；其他已闭合的关系通道继续独立评估，不能据此生成 `PROVEN_UNRELATED`

### Requirement: Global impact closure is computed once at relation granularity

系统 SHALL 将任务语义摘要、精确 read occurrence、producer bridge 和目标写入观测组成全局影响图，并从目标写入观测执行一次有界反向闭包。相同任务/语句/算子摘要和跨任务证据 MUST 去重；系统不得按每个目标字段或每个候选分支重复执行完整语义分析。Task-local semantic edges MUST NOT 携带 `candidateBranchId`；只有跨任务 producer/relation bridge edge 携带候选分支身份。

#### Scenario: Shared upstream is reached through multiple channels

- **WHEN** 同一候选生产分支同时通过字段值、JOIN 行成员和重复度影响目标表
- **THEN** 系统合并为一个候选分支结论并保留多个 `impactChannels`，不复制成多条字段级主路径

#### Scenario: Local semantic edge is shared

- **WHEN** 同一个 Task-local JOIN、FILTER 或 aggregate 语义事实服务于多个候选 producer bridge
- **THEN** 系统只保存一份 local semantic edge，并在跨任务 bridge edge 上分别引用候选分支，不复制 local edge

#### Scenario: Candidate branch is not reachable

- **WHEN** 全局图中的候选生产分支无法在已完成的静态边界内到达目标写入观测
- **THEN** 系统只有在负向证明条件满足时输出 `PROVEN_UNRELATED`，否则输出 `UNKNOWN` 并暴露阻断原因

### Requirement: Candidate universe and evidence boundaries are explicit

系统 SHALL 从 fingerprint 匹配的 table multi-hop artifact 投影候选空间，至少保留目标写入、物理生产、schedule-only、unbound read、blocked read 和 coverage boundary。每个候选分支 MUST 具有稳定身份，producer role 只能作为可变化 metadata；缺失、歧义或不连续的 read/write bridge MUST 成为可定位 gap。

#### Scenario: Physical producer bridge is complete

- **WHEN** 候选分支具有唯一物理表身份、read occurrence、producer write、output binding 和连续 evidence refs
- **THEN** 系统可将该分支纳入正向闭包，并在结果中回溯完整 bridge 证据

#### Scenario: Table artifact has an unresolved boundary

- **WHEN** table multi-hop artifact 标记覆盖不完整、unbound/blocked read 或截断边界
- **THEN** 系统把边界纳入 candidate universe，受影响结论保持 `UNKNOWN`，不得因未枚举的对象缺席而声称无关

#### Scenario: Stable identity is ambiguous

- **WHEN** 同名表或字段无法通过 platform、data source、qualified name 和 occurrence 唯一解析
- **THEN** 系统记录 `IDENTITY_AMBIGUOUS` gap 并停止该分支的确定性桥接，不把空 identity 当作通配符

#### Scenario: Producer has multiple writes

- **WHEN** 同一个 producer task 对同一物理表存在多个无法区分的 write observation
- **THEN** 系统记录 `PRODUCER_WRITE_AMBIGUOUS`，将该 bridge 降为 `CONDITIONAL_RELATED` 或 `UNKNOWN`，不得仅依据 producer task 和表名任选一个写入

### Requirement: Static relation assessment is separate from runtime rerun policy

系统 SHALL 输出静态 `relationStatus`、逐通道 `channelAssessments` 和静态候选集合；本 change 的运行期 `runtimeRerunDecision` MUST 固定为 `NOT_EVALUATED`，不得在没有运行实例证据时输出 `REQUIRED`、`SAFE_INCLUDE` 或 `NOT_REQUIRED`。静态状态保留 `CONFIRMED_RELATED`、`CONDITIONAL_RELATED`、`PROVEN_UNRELATED` 和 `UNKNOWN` 的兼容枚举；本轮实现 MUST 暂时禁用 `PROVEN_UNRELATED` 和 negative proof 生成，无法证明无关时输出 `UNKNOWN`。静态分析不得声称已验证具体运行实例、分区重叠、参数变化或数据内容变化。

#### Scenario: Confirmed static relation

- **WHEN** 候选生产分支通过连续的 operator、identity、read/write bridge 和 evidence refs 证明可能影响目标写入
- **THEN** 系统将对应通道标为 `CONFIRMED`，聚合输出 `CONFIRMED_RELATED` 并将该分支加入最小确定候选集；`runtimeRerunDecision` 保持 `NOT_EVALUATED`

#### Scenario: Conditional or unknown relation

- **WHEN** JOIN 唯一性、动态参数、分区范围、operator 语义或 bridge evidence 仍不完整
- **THEN** 系统输出 `CONDITIONAL_RELATED` 或 `UNKNOWN`，将其加入保守安全候选集，并引用具体 gap 或条件

#### Scenario: Static unrelated relation remains disabled in this phase

- **WHEN** candidate universe 完整但没有本轮显式启用的 negative-proof gate
- **THEN** 系统仍输出 `UNKNOWN` 并暴露缺少 negative cut 的原因，不得输出 `PROVEN_UNRELATED`

#### Scenario: One channel is unknown while another is confirmed

- **WHEN** `FIELD_VALUE` 通道为 `UNKNOWN`，但 `ROW_MEMBERSHIP` 或 `RELATION_EXISTENCE` 通道存在连续 `CONFIRMED` 证据
- **THEN** 系统保留逐通道状态并聚合为 `CONFIRMED_RELATED`，不得让独立 Unknown 通道污染已闭合的 confirmed witness

### Requirement: Field transfers preserve precise cross-task value semantics

系统 SHALL 允许字段作为 Task-local typed vertex、field port 或压缩 FieldSet 参与值传播和跨任务接续，但字段 MUST NOT 成为顶层 traversal root 或 assessment dimension。系统 SHALL 通过 `FieldValueEvidenceProvider` 或 canonical VALUE_FLOW index 按候选生产分支聚合字段值影响，不得重新创建逐字段 assessment 矩阵。字段传递至少记录输入物理字段 subject、输出字段 binding、局部 effect kind、evidence refs 和必要 gap；`affectedTargetFields` 只能作为 `FIELD_VALUE` 解释信息，不能成为关系级传播 frontier。

#### Scenario: Value transfer affects a subset of output fields

- **WHEN** 一个输入关系只通过某个输出字段 binding 影响下游，而同一 Task 还有其他不相关输出字段
- **THEN** 系统只沿对应 field port 接续 `FIELD_VALUE`，不会把该关系无差别传播到该 Task 的全部输出字段

#### Scenario: Field lineage is missing but relation evidence exists

- **WHEN** `FIELD_VALUE` 无法闭合，但该候选分支有完整的 JOIN、过滤、关系存在性或重复度证据
- **THEN** 系统保留 `FIELD_VALUE = UNKNOWN`，并可基于其他通道输出 `CONFIRMED_RELATED` 或 `CONDITIONAL_RELATED`

### Requirement: Channel assessments use independent status and proof algebra

系统 SHALL 为每个候选分支和每个适用影响通道保存独立 `ChannelAssessment`。通道状态至少包括 `CONFIRMED`、`CONDITIONAL`、`PROVEN_ABSENT`、`UNKNOWN` 和 `NOT_APPLICABLE`，并分别保存 proof、witness 和 gap refs。不同候选路径在同一通道内按 `CONFIRMED > CONDITIONAL > UNKNOWN` 聚合；不同通道之间按“任一 `CONFIRMED` 即整体 `CONFIRMED_RELATED`，否则任一 `CONDITIONAL` 即整体 `CONDITIONAL_RELATED`，存在未关闭义务则 `UNKNOWN`”聚合。本轮不启用由 `PROVEN_ABSENT` 推导 `PROVEN_UNRELATED` 的负向 gate。

#### Scenario: Confirmed and unknown channels coexist

- **WHEN** 同一候选分支存在 `FIELD_VALUE = CONFIRMED` 且 `MULTIPLICITY = UNKNOWN`
- **THEN** 系统输出两个独立通道状态，整体 `relationStatus = CONFIRMED_RELATED`，并保留 multiplicity gap

#### Scenario: Missing negative cut is not a proven absence

- **WHEN** 候选分支没有本轮显式启用的 negative cut
- **THEN** 系统输出 `UNKNOWN`；仅仅没有发现正向路径不能产生 `PROVEN_ABSENT` 或 `PROVEN_UNRELATED`

### Requirement: Path composition is distinct from alternative-path merging

系统 SHALL 区分同一因果路径内的证据串联和同一影响通道内的备选路径合并。路径串联 MUST 取最差 certainty：`CONFIRMED + CONDITIONAL = CONDITIONAL`、任一必要 `UNKNOWN` 即为 `UNKNOWN`；备选路径合并 MUST 优先保留已闭合的更强正向证明：`CONFIRMED + UNKNOWN = CONFIRMED`、`CONDITIONAL + UNKNOWN = CONDITIONAL`。本轮不生成 `PROVEN_ABSENT`/`PROVEN_UNRELATED`；未来启用时 `PROVEN_ABSENT` 只能由完整 negative proof 产生，不能由正向传播的“未找到路径”产生。

#### Scenario: Unknown bridge is in the same path

- **WHEN** 一条路径包含已确认的 operator edge，但其后续必要 producer bridge 为 `UNKNOWN`
- **THEN** 该路径的通道状态为 `UNKNOWN`，不能被前面的 confirmed edge 覆盖

#### Scenario: Confirmed alternative exists

- **WHEN** 同一通道存在一条完整 `CONFIRMED` 路径和另一条 `UNKNOWN` 路径
- **THEN** 该通道保留 `CONFIRMED`，同时保留未知路径的 gap 作为未闭合旁证，不将整体降为 Unknown

### Requirement: Evidence and proof obligations are mechanically auditable

系统 SHALL 为正向相关结论保存可回溯的 witness evidence refs，为 Unknown 保存至少一个 gap。兼容的 `PROVEN_UNRELATED` 若在未来 gate 中启用，才要求保存 negative proof 或已知安全 cut；本轮 validator MUST 拒绝该状态。证据 closure、candidate coverage、bridge closure、限制和阶段耗时 MUST 可在 artifact 中读取。

#### Scenario: Positive witness is continuous

- **WHEN** 一个候选分支被标为 `CONFIRMED_RELATED`
- **THEN** validator 能从目标写入观测经 relation/operator edge 回溯到候选生产分支，并核对每个 occurrence-specific evidence ref

#### Scenario: Negative proof is incomplete

- **WHEN** 负向搜索遇到未知 identity、未建模算子、候选覆盖边界或预算截断
- **THEN** 系统禁止生成 `PROVEN_UNRELATED`，并将该分支标为 `UNKNOWN`

### Requirement: Independent artifact preserves existing lineage compatibility

系统 SHALL 发布独立、版本化的目标表因果闭包 artifact、摘要和 HTML；artifact MUST 包含 `TargetWriteIdentity`、`AnalysisSnapshotRef`、逐通道 assessment、task-level rollup 和 `runtimeRerunDecision = NOT_EVALUATED`。HTML 只能渲染 canonical artifact，不得重新推断相关性。旧 `FIELD_MULTI_HOP_RECONCILIATION`、旧 field-lineage artifact、CLI 和 renderer MUST 保持可独立运行和读取。

#### Scenario: Legacy field lineage is run alone

- **WHEN** 调用方执行现有 field-lineage 命令或读取旧 artifact
- **THEN** 系统不要求目标表因果闭包产物存在，也不修改、删除或降级旧输出

#### Scenario: Causal closure is rendered

- **WHEN** 目标表因果闭包 artifact 已生成
- **THEN** 新 renderer 展示目标写入、候选分支、impact channels、静态状态、证据/gap、最小确定集和保守安全集，且不重新执行因果算法

#### Scenario: Task rollup is requested

- **WHEN** 一个 producer task 存在多个 candidate branch 或多个影响通道
- **THEN** artifact 提供按 producer task 聚合的状态、branch refs、impact channels 和 proof/gap refs；`ROOT_WRITE` 不计入上游任务候选数量

### Requirement: Calcite is optional semantic enrichment, not canonical authority

系统 SHALL 允许在显式 shadow/differential 模式下，以任务/语句语义摘要为粒度调用固定版本 Calcite，复用同一摘要结果；Calcite 结果只能作为关系语义补充、交叉验证或 Unknown 解释，不得单独生成 canonical dependency、assessment、negative proof 或实际重跑决策。Calcite 调用次数 MUST 以唯一 semantic digest 为上限，而不是以字段或候选分支数量为上限。

#### Scenario: Calcite corroborates a mapped summary

- **WHEN** Calcite 对已精确映射的 relation/operator observation 给出一致的谓词、唯一性、函数依赖或基数 metadata
- **THEN** 系统记录可追溯的 corroboration，并保持 Native Plan/Machine Facts 为 canonical evidence

#### Scenario: Calcite is unsupported or unavailable

- **WHEN** Calcite 不支持某个方言/算子、Java 工具不可用、超限或 observation 无法映射回 occurrence
- **THEN** 系统记录 `NOT_EVALUATED` 或 unmappable 原因，不污染 Native 结论，也不把缺失当作无关证明

#### Scenario: Native and Calcite conflict

- **WHEN** 双方对同一精确映射的 relation/operator 命题给出实质冲突
- **THEN** 系统记录 `SEMANTIC_ENGINE_CONFLICT`；若冲突只涉及一个 operator/channel，则只将该 `ChannelAssessment` 降为 `UNKNOWN`，若冲突涉及目标写入、read occurrence 或 producer bridge identity，则阻断整个候选分支；不得配置为静默忽略

### Requirement: Re-evaluation reuses immutable inputs and is resource bounded

系统 SHALL 在输入 fingerprint 一致时复用 Input Pack、Plan/Machine Facts、producer index、table multi-hop artifact 和可用 field-lineage evidence，只执行目标表因果闭包相关阶段。CLI MUST 提供硬性的时间、内存、节点、边和深度限制；超限时 fail-fast，输出阶段耗时、已完成范围和 Unknown boundary，不隐式触发全量采集。

#### Scenario: Cached 209119 re-evaluation

- **WHEN** 209119 的既有输入 fingerprint 一致且调用方执行 causal-only 模式
- **THEN** 系统不重新采集全量任务、不重建旧 field-lineage、不重建全量 producer index，并只生成独立闭包 JSON/摘要/HTML

#### Scenario: Gate A checks the graph model early

- **WHEN** M2 完成并对 209119 执行结构闸门
- **THEN** 系统验证 `TargetWriteIdentity`、Candidate Universe、branch-level assessment、一次字段证据扫描、bridge closure 和阶段性能；不满足约定规模或资源目标时停止后续 operator 扩展

#### Scenario: Gate B checks product value before expansion

- **WHEN** M4 完成并对 209119 执行产品闸门
- **THEN** 系统验证 FIELD_VALUE、FILTER、JOIN、COUNT(*)、EXISTS、CROSS JOIN、MULTIPLICITY 和 task rollup 的结果与 Unknown 原因；只有通过后才进入剩余算子和 Calcite 扩展

#### Scenario: Resource budget is exceeded

- **WHEN** 闭包达到时间、内存、图规模或深度上限
- **THEN** 系统停止扩展受影响范围，保留已闭合证据，生成结构化 Unknown/gap 和阶段指标，不能把截断分支标为 `PROVEN_UNRELATED`

#### Scenario: Performance regression is detected

- **WHEN** 参考任务 209119 在复用输入的 causal-only 基准中超过约定性能门槛
- **THEN** 验收失败并报告 load、summary、Calcite、graph、propagation、validation 和 render 各阶段耗时及调用/缓存命中数；不得以提高 heap 或无限延长等待掩盖回归
