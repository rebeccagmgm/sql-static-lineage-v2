## Purpose

提供一个可选、可追溯且与生产证据链隔离的 Calcite 差分能力，将既有 Plan Facts 转换为关系计划并核对语义 metadata，而不要求 Calcite重新解析原始 Horae/Hive SQL。

## ADDED Requirements

### Requirement: Structured Plan Facts input
系统 SHALL 接受版本化的 Plan Facts 投影和显式 schema/type 信息作为 Calcite 差分输入，不得要求 Calcite成功解析生成该 Plan Facts 的原始 SQL。

#### Scenario: Dialect-specific SQL already lowered by Native parser
- **WHEN** Native 链已经把包含 Horae/Hive 方言结构的 SQL 降级为受支持的 Plan Facts
- **THEN** Calcite 差分工具从该 Plan Facts 构建关系计划，不再对原始 SQL执行语法解析

#### Scenario: Required type information is missing
- **WHEN** 构建某个 Calcite表达式所需的字段类型、nullable 或函数签名不可确定
- **THEN** 工具返回该对象的 `UNSUPPORTED` 或 `NOT_EVALUATED` 原因，不得猜测类型或修改 Native 事实

### Requirement: Bounded relational operator mapping
系统 SHALL 对 read、project、filter、join、aggregate、set operation、window 和 Top-N 提供显式支持矩阵；任何未支持的 relation 或 expression MUST 形成可定位的 unsupported 结果。

#### Scenario: Supported core operator graph
- **WHEN** 输入图仅包含支持矩阵中已实现且类型完整的算子
- **THEN** 工具生成对应 Calcite关系计划及请求的 expression lineage、predicate、unique key、functional dependency、table occurrence 和 cardinality metadata

#### Scenario: Unsupported operator is present
- **WHEN** 输入图包含未建模的 lateral、UDTF、相关子查询、Hive函数或其他算子
- **THEN** 工具指出 relation occurrence、operator kind 和原因，并禁止把该范围解释成已证无关

### Requirement: Exact Native-to-Calcite evidence mapping
每个可比较的 Calcite observation SHALL 能映射回 Native relation occurrence、字段或输出 ordinal 和 canonical evidence reference；无法形成精确映射的 observation MUST 保持不可用于结论。

#### Scenario: Observation maps exactly
- **WHEN** Calcite metadata可唯一映射到一个 Native relation occurrence 和字段/输出表达式
- **THEN** 差分结果保存双方 identity、mapping reference、版本 fingerprint 和 observation

#### Scenario: Observation cannot map uniquely
- **WHEN** Calcite节点经过转换后无法唯一对应 Native occurrence 或字段
- **THEN** 差分结果为 `CALCITE_ONLY_UNMAPPABLE`，不得合并到 canonical evidence

### Requirement: Conservative differential reconciliation
系统 SHALL 区分一致、Native-only、Calcite-only-unmappable、not-evaluated 和 semantic-engine-conflict；Calcite单方结果 MUST NOT 生成 canonical dependency、assessment 或 negative proof。

#### Scenario: Engines agree on the same mapped object
- **WHEN** Native与 Calcite对同一精确映射对象给出规范化后一致的 observation
- **THEN** 报告记录交叉验证成功，但保持 Native 为 canonical 来源

#### Scenario: Calcite is unsupported or fails
- **WHEN** Calcite返回 `UNSUPPORTED`、`FAILED`、超限或工具不可用
- **THEN** 报告记录 `NOT_EVALUATED` 及原因，Native既有结论和默认流程状态保持不变

#### Scenario: Engines materially conflict
- **WHEN** 双方对同一精确映射语义对象给出不兼容结论
- **THEN** 独立报告记录 `SEMANTIC_ENGINE_CONFLICT` 及双方证据；只有显式启用的验证消费方可把该冲突暴露为 Unknown gap

### Requirement: Default pipeline isolation
Calcite差分 SHALL 默认关闭，并且默认解析、Plan Facts、Machine Facts、field-lineage、causal-slice、npm测试和 artifact发布 MUST NOT 依赖 Java、Maven 或 Calcite输出。

#### Scenario: Default production command runs without Java
- **WHEN** 用户运行现有默认 pipeline 或 npm验证命令且机器上没有可用 Java/Calcite工具
- **THEN** 命令保持原有行为，不尝试启动 Calcite，也不因缺少 Calcite失败

#### Scenario: Differential mode is explicitly enabled
- **WHEN** 用户调用独立 Calcite差分命令或显式启用验证模式
- **THEN** 工具只写独立 differential产物，不覆盖 canonical JSON/HTML

### Requirement: Legacy naming compatibility
从 `calcite-oracle` 到 `calcite-differential` 的迁移 SHALL 提供有界兼容期，且所有新输出和文档 MUST 使用 differential术语而非暗示 Calcite是绝对真值。

#### Scenario: Existing oracle command or fixture is referenced
- **WHEN** 现有测试或开发命令仍引用旧路径、协议常量或 jar入口
- **THEN** 兼容入口转发到新实现或给出明确迁移提示，不得静默改变协议含义

#### Scenario: New differential report is generated
- **WHEN** 新工具成功输出结果
- **THEN** tool identity、artifact名称和用户文档使用 `calcite-differential` 或 `calcite-rel-bridge`

### Requirement: Versioned and resource-bounded execution
差分协议 SHALL 固定 Calcite和协议版本、携带构建 fingerprint，并对输入、schema、计划节点和输出实施可配置但不可突破的硬上限。

#### Scenario: Valid bounded request
- **WHEN** 请求版本匹配且所有资源规模在硬上限内
- **THEN** 每个响应携带协议、Calcite和构建 fingerprint

#### Scenario: Request exceeds a hard limit
- **WHEN** 输入字节数、表/字段数、计划节点数或输出大小超过硬上限
- **THEN** 工具以结构化错误结束该请求，不产生部分的确定性语义结论

### Requirement: Regression proof for unchanged Native behavior
变更 SHALL 提供回归证据，证明 Calcite未启用时现有代表性 Native输出和接口行为不变。

#### Scenario: Differential feature is disabled
- **WHEN** 对冻结 fixture运行变更前后的默认 Native命令
- **THEN** canonical事实、assessment、gap和发布文件保持契约等价，任何差异都必须作为回归失败处理
