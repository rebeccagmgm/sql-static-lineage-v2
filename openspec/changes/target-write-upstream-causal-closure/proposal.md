## Why

现有 `target-field-causal-slice` 以目标字段为遍历根，在 209119 这类宽表上形成“目标字段 × 候选分支”的笛卡尔积，导致大量重复路径和 gap，运行时间、内存和结果可读性都不可接受。重跑影响分析真正需要的是目标表写入观测受哪些上游生产分支影响，同时保留字段血缘作为 `FIELD_VALUE` 一等证据通道，并覆盖 JOIN、过滤、聚合、行存在性和重复度等非直接字段影响。

需要新增一个独立的目标表级静态因果闭包 consumer：一次按任务/语句摘要算出关系影响，一次建立全局跨 Task 影响图，再从目标写入观测反向传播；Calcite 继续作为可选的关系语义增强和差分校验器，而不是替换现有证据主链。

## What Changes

- 新增以 `TargetWriteRef` 为根的目标表上游因果闭包 consumer、artifact、CLI、摘要和 HTML。
- 新增可确定解析并绑定证据的 `TargetWriteIdentity`（含 SQL source、statement/write ordinal）与 `AnalysisSnapshotRef`；目标写入或上游 producer write 无法唯一映射时必须输出明确 gap，不得猜根或任选写入。
- 在 Baseline 阶段先投影 Candidate Universe，再构建字段值证据 provider；通过路径串联与备选路径合并的不同证据代数，避免错误吞掉 Unknown 或污染已闭合证明。
- 按任务/语句/目标写入观测生成去重的关系语义摘要，使用 `impactChannels` 表达字段值、行成员、重复度、分组、关系存在性和 Top-N 选择等影响。
- 从现有 table multi-hop artifact 投影候选生产分支，建立一次性的全局影响图和反向固定点传播，取消目标字段×候选分支作为主计算模型。
- 通过 `FieldValueEvidenceProvider` 或 canonical VALUE_FLOW index 聚合现有字段血缘；字段可作为内部 field port 接续跨任务值传播，但不得成为顶层根或 assessment 维度。
- 将逐通道 `ChannelAssessment` 与静态 `relationStatus` 分离；输出最小确定候选集和保守安全候选集，运行期重跑决策保持 `NOT_EVALUATED`，不把静态结论冒充实际运行重跑结论。
- 继续复用 Plan Facts、Machine Facts、Input Pack、producer bridge 和 Calcite 差分基础设施；Calcite 按唯一任务/语句摘要缓存，不能按字段或候选分支重复执行。
- 为 209119 提供 field-only/causal-only 重算入口，校验输入 fingerprint，不隐式触发全量采集或旧字段血缘重建。
- 增加性能、桥接闭合、候选覆盖和旧链路不变的验收指标；超出预算时 fail-fast 并暴露阶段耗时和边界 gap。
- 在 M2、M4 后分别执行 209119 Gate A/Gate B；只有图规模、性能和产品价值均达标，才继续扩大算子与 Calcite 覆盖。

## Capabilities

### New Capabilities

- `target-table-upstream-causal-closure`: 从目标表写入观测出发，提取静态可观测边界内的最小上游因果闭包，按候选生产分支输出可审计的相关性、影响通道、证据和重跑候选。

### Modified Capabilities

无。现有字段血缘和目标字段因果切片保持独立，本变更只新增目标表级 consumer。

## Impact

- 新增目标表级 semantic summary、global impact graph、反向传播、assessment、artifact contract、validator、summary 和 HTML renderer。
- 只读消费现有 Input Pack、Plan/Machine Facts、producer index、table multi-hop artifact 和 field-lineage evidence provider；不替换 parser、IR、物理身份或跨 Task bridge。
- 复用并必要时补强共享 physical resolver/bridge evidence adapter，但必须以旧 field-lineage golden 回归证明兼容。
- Calcite 作为独立、可选的 shadow/differential 语义来源；默认生产命令和默认 TypeScript 测试不依赖 Java/Maven。
- 新 artifact 使用独立 type、文件名、schema/version 和 content hash。旧 `FIELD_MULTI_HOP_RECONCILIATION` 产物不被覆盖、不降级、不重新计算。
