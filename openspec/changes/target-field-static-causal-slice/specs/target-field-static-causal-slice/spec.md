## Purpose

给定一个或多个目标物理字段，在静态可观测的完整表级候选上游空间内，生成可审计、证据保守的 value/control/relation 因果切片，并输出最小确定重跑集、保守安全集以及明确的 Unknown 边界。

## ADDED Requirements

### Requirement: Canonical evidence pipeline remains authoritative
系统 SHALL 继续以现有 TypeScript parser、immutable IR、Plan Facts、Machine Facts、物理字段身份和 occurrence-specific producer bridge 作为 canonical 静态证据来源。外部语义引擎 MUST NOT 改写原始 SQL、source span、字段身份、producer 判断或 canonical Machine Facts。

#### Scenario: External semantic engine disagrees
- **WHEN** 外部语义引擎与 canonical evidence pipeline 对同一 relation occurrence 得出冲突结论
- **THEN** 系统保留双方证据并输出 `SEMANTIC_ENGINE_CONFLICT` 的 `UNKNOWN`，不得静默选择任一结果

### Requirement: Causal slicing is an isolated evidence consumer
系统 SHALL 将目标字段因果切片作为独立 consumer、artifact、CLI 和 renderer 发布。该 consumer MUST 只读消费匹配 fingerprint 的 Input Pack、Plan/Machine Facts、table multi-hop artifact 和共享物理 evidence adapter；MUST NOT 改写或替换旧 `FIELD_MULTI_HOP_RECONCILIATION` artifact、旧 field-lineage CLI 或旧 HTML。

#### Scenario: Legacy field lineage remains unchanged
- **WHEN** 调用方继续执行旧 field-lineage CLI 或读取旧 field-lineage artifact
- **THEN** 系统保持旧 1.1 contract 与 renderer 行为，不要求存在 causal-slice artifact，也不从新模块回写 assessment

#### Scenario: Causal slice fails independently
- **WHEN** 新 consumer 因 Candidate Universe、semantic support 或 fingerprint 问题失败
- **THEN** 失败仅影响 causal-slice 输出，已经存在的旧 field-lineage JSON/HTML 不得被删除、降级或重新计算

### Requirement: Semantic dependencies are orthogonal and auditable
系统 SHALL 将依赖主体、影响类型、局部边语义和根目标影响原因分开表达。依赖主体 MUST 支持物理字段和 relation occurrence；影响类型 MUST 覆盖值贡献、表达式分支选择、行成员、重复度、分组、排序、窗口、集合成员和关系存在性。

#### Scenario: CASE expression separates selectors from values
- **WHEN** 目标字段由 `CASE`、`IF` 或 `COALESCE` 产生
- **THEN** 系统将条件/选择字段表示为表达式控制，将结果分支表示为值贡献，并保留可定位的表达式和 source span 证据

#### Scenario: Fieldless relation dependency
- **WHEN** 目标字段通过 `COUNT(*)`、`SELECT literal FROM relation`、`EXISTS` 或无条件 `CROSS JOIN` 依赖输入关系的存在性或基数
- **THEN** 系统生成 relation occurrence 依赖，禁止因缺少控制字段而裁掉该关系

### Requirement: Native semantics cover rerun-relevant operators conservatively
系统 SHALL 对 filter、having、qualify、各类 join、aggregate、distinct、set operation、window、Top-N 和 expression subquery 建立结构化 transfer 规则。Join 的结构依赖 MUST NOT 以唯一性已知为前提；唯一性只用于细化 fanout 或 multiplicity。任何未建模或证据不足的算子 MUST 输出明确 `UNKNOWN`。

#### Scenario: Join uniqueness is unknown
- **WHEN** JOIN 条件和两侧 relation occurrence 已确认但唯一键证据缺失
- **THEN** 系统确认 JOIN 结构依赖，同时将精确 multiplicity/fanout 结论保留为 `CONDITIONAL` 或 `UNKNOWN`

#### Scenario: Unmodeled operator is reached
- **WHEN** 因果遍历到达当前语义矩阵未覆盖的 operator 或 expression role
- **THEN** 系统生成 operator-specific gap 并停止受影响证明，禁止产生 `PROVEN_UNRELATED`

### Requirement: Value and control branches traverse independently per target field
系统 SHALL 为每个 root target field 建立独立的 visited、cycle、decision 和 frontier 状态。VALUE、EXPRESSION、ROWSET、WINDOW 与 RELATION 分支 SHALL 共享物理字段 resolver、producer bridge 和 evidence objects，但 MUST NOT 共享根字段 decision。VALUE 与控制分支 MUST 使用独立状态/路径预算并共享最大深度边界。

#### Scenario: One target closes while another remains unknown
- **WHEN** 同一 Task 的一个目标字段证据闭合而另一个目标字段因控制字段身份缺失而无法闭合
- **THEN** 系统分别输出确定结论和 `UNKNOWN`，不得因共享 visited 或 budget 混合两个目标字段的状态

#### Scenario: Control budget is reached
- **WHEN** ROWSET 或 RELATION 控制遍历达到独立预算而 VALUE_FLOW 已闭合
- **THEN** 系统只将受影响的控制结论标为 `UNKNOWN`，不得降低已闭合 VALUE_FLOW 的 value status

### Requirement: Physical resolution and cross-task expansion use one evidence path
VALUE 和所有控制字段 SHALL 使用同一物理字段 resolver，优先应用 Task/Input Pack 的默认物理 schema，再进行唯一 catalog 匹配。跨 Task 展开 MUST 引用确定的 read occurrence、producer write 和 candidate branch，任何多候选或缺失身份 MUST 保留为 gap。

#### Scenario: Bare table uses default Hive schema
- **WHEN** SQL 引用裸表名且 Task/Input Pack 提供默认 Hive 库
- **THEN** VALUE 与控制依赖均先限定到该 Hive 库，并对同一字段得到一致的物理身份结果

#### Scenario: Same table is read more than once
- **WHEN** 同一 Task 以不同 alias 或 scope 多次读取同一物理表
- **THEN** 系统按 read occurrence 隔离 bridge、predicate、source span 和 candidate branch，禁止合并为一条模糊读边

### Requirement: Candidate universe is explicit and complete within its boundary
系统 SHALL 从 canonical table multi-hop artifact 投影 Candidate Universe，并覆盖 root write、physical producer、schedule-only、unbound read、blocked read 和 coverage boundary。Candidate branch ID MUST 由稳定物理候选身份构成，producer role MUST 作为可变化 metadata 而非 ID 组成部分。

#### Scenario: Table artifact has an unresolved read boundary
- **WHEN** 表级 artifact 存在未绑定或 blocked physical read
- **THEN** Candidate Universe 保留该边界及 gap，禁止因没有 producer bridge 而静默省略该分支

### Requirement: Causal assessments never fabricate certainty
遍历期间 SHALL 传播 `CONFIRMED / CONDITIONAL / UNKNOWN` Path Certainty；证据闭合阶段 SHALL 对每个 `rootTargetField × candidateBranch` 生成且仅生成一个 `CONFIRMED_RELATED / CONDITIONAL_RELATED / PROVEN_UNRELATED / UNKNOWN` assessment。每个 `UNKNOWN` MUST 引用至少一个 gap。

#### Scenario: Positive evidence path is complete
- **WHEN** value 或 control 因果路径具有连续字段身份、operator、read/write bridge 和 evidence refs，且没有必要 Unknown
- **THEN** 系统可生成 `CONFIRMED_RELATED` 并提供完整可核对 proof path

#### Scenario: Evidence is provisional
- **WHEN** 必要路径包含 provisional legacy evidence 或运行时才可确定的条件
- **THEN** 结论最高为 `CONDITIONAL_RELATED`，不得升级为 confirmed

### Requirement: Proven unrelated requires a negative proof
系统 MUST 仅在 Candidate Universe 边界完整、value/control/relation 检查全部完成、没有 gap/截断/未建模算子且存在可引用 negative proof 或已知 cut 时生成 `PROVEN_UNRELATED`。未枚举对象 MUST NOT 被虚构并继承无关结论。

#### Scenario: Known branch is cut by a closed negative proof
- **WHEN** 已知 candidate subtree 的入口被证明无法通过任何支持的依赖到达目标字段
- **THEN** 系统可对 Candidate Universe 中已枚举的该 subtree 分支记录 `INHERITED_FROM_PROVEN_UNRELATED_CUT`

#### Scenario: Candidate universe is incomplete
- **WHEN** 表级 coverage、operator support 或 traversal limits 任一不完整
- **THEN** 受影响 assessment 为 `UNKNOWN`，不得使用“未找到路径”作为无关证明

### Requirement: Independent causal-slice artifact exposes decisions, proofs, limits, and quality metrics
系统 SHALL 发布独立、版本化且类型为 `TARGET_FIELD_CAUSAL_SLICE` 的 canonical artifact，包含 legacy VALUE_FLOW 引用、dependency definitions/applications/edges、Candidate Universe、逐目标 assessment、positive/negative proof、VALUE/CONTROL limits、gaps 和质量指标。causal-slice HTML 与文本摘要 MUST 仅渲染该 artifact，不得重新计算因果结论；旧 field-lineage artifact 保持独立。

#### Scenario: Confirmed closure metric is reported
- **WHEN** artifact 至少包含一个 `CONFIRMED_RELATED`
- **THEN** `confirmedEvidenceClosureRate` MUST 为 1.0，否则 artifact validation 失败

#### Scenario: No confirmed assessment exists
- **WHEN** artifact 不包含 `CONFIRMED_RELATED`
- **THEN** `confirmedEvidenceClosureRate` 为 `NOT_APPLICABLE`，Precision 与 Recall 均为 `NOT_EVALUATED`

#### Scenario: Artifact names do not collide
- **WHEN** 同一 Task 同时生成旧字段血缘和目标字段因果切片
- **THEN** 两者使用不同 artifact type、文件名、content hash 和 renderer 输出，调用方可独立验证和发布

### Requirement: Rerun outputs distinguish certainty from safety
系统 SHALL 从同一 canonical assessment 生成两套 Task 重跑清单：最小确定集仅包含 `CONFIRMED_RELATED`；保守安全集包含 `CONFIRMED_RELATED`、`CONDITIONAL_RELATED` 和 `UNKNOWN`。任务进入清单时 MUST 保留触发它的目标字段、candidate branch 和 proof/gap refs。

#### Scenario: Business chooses conservative rerun
- **WHEN** 调用方选择保守安全集
- **THEN** 所有无法证明无关的已知候选 Task 均进入结果，且 `PROVEN_UNRELATED` Task 不进入结果

### Requirement: Calcite is a first-class differential validation track
系统 SHALL 提供固定版本、JSONL 输入输出的 Calcite 语义校验器，输出 expression lineage、predicates、unique keys、functional dependencies、table occurrences、row-count/cardinality metadata 以及 unsupported/failed 原因。每批 Native operator transfer rule MUST 有对应的 Calcite differential fixture 或明确的 `NOT_EVALUATED` 原因；差分结果 SHALL 归类为 `NATIVE_CONFIRMED`、`CALCITE_CORROBORATED`、`CALCITE_ONLY_UNMAPPABLE`、`NOT_EVALUATED` 或 `SEMANTIC_ENGINE_CONFLICT`。默认生产 CLI 和默认 TypeScript 测试 MUST NOT 依赖 Java 或 Calcite。

#### Scenario: Native operator rule is implemented
- **WHEN** 新增或修改 Native CASE、JOIN、aggregate、set operation、window、Top-N 或 relation-context transfer rule
- **THEN** 对应语料同时产生 Native 与 Calcite observation，并验证 occurrence、字段、operator 与 source evidence 映射；Calcite 不支持时必须记录 `NOT_EVALUATED`，不得静默跳过

#### Scenario: Explicit Calcite shadow validation is requested
- **WHEN** 调用方显式启用 Calcite shadow 模式且本机 Java/Calcite 工具可用
- **THEN** 系统生成独立 differential report 和带版本 fingerprint 的 validation summary，但不得改写 canonical evidence、assessment 或重跑集合

#### Scenario: Calcite adds an unmappable observation
- **WHEN** Calcite 返回额外 metadata 但不能精确映射回 canonical relation occurrence、字段和 source evidence
- **THEN** 该 observation 仅记录为辅助结果，不得进入 confirmed proof 或产生 `PROVEN_UNRELATED`

#### Scenario: Native and Calcite conflict
- **WHEN** 两个语义引擎对同一已映射 occurrence 和 operator 得出冲突结论
- **THEN** differential report 记录双方 observation，相关结论降为带 `SEMANTIC_ENGINE_CONFLICT` gap 的 `UNKNOWN`，不得由配置选择性忽略冲突

#### Scenario: Default test suite runs without Java
- **WHEN** 执行仓库默认 `npm test`
- **THEN** 测试不构建或启动 Calcite；Calcite 差分测试通过独立命令显式执行

### Requirement: Field-only reconciliation reuses existing immutable inputs
针对已有 Task 的重新评估 SHALL 通过独立 causal-slice CLI 复用同一 Input Pack fingerprint、Machine Facts、producer index、table multi-hop artifact，并可引用匹配的旧 field-lineage artifact，仅重算 causal slice、其摘要和其 renderer。只有必要输入 fingerprint 缺失或不一致时才要求重建对应上游层；CLI MUST NOT 隐式触发全量采集或全量 producer-index 重建。

#### Scenario: Re-evaluate task 209119
- **WHEN** 209119 的现有 Input Pack、Machine Facts 和 table artifact fingerprint 一致
- **THEN** 系统生成独立 causal-slice JSON/摘要/HTML，不触发全量 Task 收集、旧 field-lineage 重建或全量 producer-index 重建
