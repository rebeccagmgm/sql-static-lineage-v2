## Purpose

规定统一 Task/Table Input Pack 如何转换为可审计的任务级 Machine Facts，使 SQL、Schema、目标表和字段绑定共享同一份输入证据并可确定性重放。

## ADDED Requirements

### Requirement: Input Pack is the Machine Facts evidence boundary
系统 SHALL 从指定 data root 内的 Task Pack、其 SQL slots、目标 Table Pack 与 DDL 构建任务级 Machine Facts，并 SHALL 记录这些输入的身份、内容指纹和选择结果。系统 MUST NOT 要求调用方另行手工拼装等价 analysis profile 或 Schema snapshot。

#### Scenario: Complete Task and Table packs
- **WHEN** Task Pack 包含可分析 SQL、可解析的物理目标表，且对应 Table Pack 与 DDL 可用
- **THEN** 系统从这些 Input Pack 文件生成 Machine Facts，并记录可重放的输入来源与指纹

#### Scenario: Input changes during preparation
- **WHEN** 准备过程中任一已读取 Input Pack 文件的内容指纹发生变化
- **THEN** 系统以明确的输入变化错误停止该任务，且不发布混合快照的 Machine Facts

### Requirement: SQL selection is deterministic and evidence-preserving
系统 SHALL 以 `query` 作为任务目标输出的主 SQL；当同一 Task 的其他 slot 含有被 `query` 消费的字段生产 CTAS/INSERT 时，系统 SHALL 按稳定 slot 顺序一并分析这些原始 SQL。没有 `query` 时，只能选择唯一且结构上可证明产生目标字段的 slot。系统 SHALL 分别按原字节冻结每个 Input Pack SQL，记录其 hash，并保留每个 statement 的 Task、slot 与 slot 内顺序身份；联合分析快照必须明确标记为派生物，MUST NOT 覆盖 canonical SQL。

#### Scenario: Query slot is available
- **WHEN** Task Pack 的 `query` slot 可用且包含可分析 statement
- **THEN** 系统以 `query` 确定任务目标输出，同时纳入可证明产生其 Task-local 中间字段的 slot，并以 Task ID、slot 名和 slot 内 statement ordinal 构造稳定身份

#### Scenario: Query consumes a Task-local CTAS from another slot
- **WHEN** `create` 或 `prepare` slot 以 CTAS 生成临时表，且 `query` 读取该临时表写入任务目标
- **THEN** 系统发布 Task 内字段绑定并穿透 CTAS；临时字段身份仅允许 Task 内递归，不得作为 confirmed 跨 Task 物理桥

#### Scenario: Selection is ambiguous
- **WHEN** 没有可用 `query`，且多个 slot 都可能产生目标字段
- **THEN** 系统返回 SQL slot 选择不确定，不建立平台目标字段绑定

### Requirement: Explicit and platform target writes remain distinguishable
系统 SHALL 将 SQL 中显式目标写入记为 `SQL_EXPLICIT_WRITE`。对于查询型 SQL 由任务配置声明目标表的场景，系统仅在目标物理身份唯一、查询输出唯一可枚举、目标 DDL 可用、输出与非分区目标列可按 ordinal 完整对应且分区处理可证明时，建立 `PLATFORM_TARGET_QUERY_OUTPUT` 字段绑定。两种证据 MUST 保留原始类别。

#### Scenario: Explicit INSERT or CTAS target
- **WHEN** SQL 结构明确包含目标写入且目标表身份可解析
- **THEN** 系统按 `SQL_EXPLICIT_WRITE` 发布目标字段绑定和对应字段值流

#### Scenario: Query output maps to platform target
- **WHEN** 任务仅有查询输出，任务目标与 Table Pack 唯一一致，并满足完整 ordinal 映射条件
- **THEN** 系统按 `PLATFORM_TARGET_QUERY_OUTPUT` 发布目标字段绑定，并记录该绑定的证明条件

#### Scenario: Platform target mapping is incomplete
- **WHEN** 查询输出数量、目标列、分区列或目标物理身份无法完整证明
- **THEN** 系统保留未解析原因，且 MUST NOT 猜测或部分拼接平台目标字段绑定

### Requirement: Schema-backed physical field identity
可供跨 Task 桥接的字段 SHALL 使用 `platform + dataSource + stableTableId or qualifiedName + normalized column` 形成物理身份，并 SHALL 由 Table Pack Schema 证明字段存在。仅 SQL 文本推断但缺少 Schema 证明的字段 MUST NOT 作为已确认跨 Task 桥接键。

#### Scenario: Table ID is available
- **WHEN** Task/Table Pack 提供稳定目标 Table ID 且目标列存在于 Schema
- **THEN** 系统使用含 Table ID 的物理字段身份

#### Scenario: Schema does not contain the field
- **WHEN** SQL 引用了字段但目标 Table Pack Schema 无法证明该字段
- **THEN** 系统将字段标记为未验证或未解析，不发布 confirmed 物理桥接身份

### Requirement: Legacy facts require explicit downgrade policy
系统 SHALL 将当前 Contract 1.3 生成的字段事实标记为 `PROVISIONAL_LEGACY`。默认策略 MUST 拒绝把 legacy 事实升级为 confirmed；调用方只有显式选择允许 legacy partial 时才能消费，并且输出状态必须保留降级。

#### Scenario: Default current-only policy
- **WHEN** 调用方未显式允许 legacy facts 且仅有 Contract 1.3 事实
- **THEN** 系统停止该字段分支并报告事实版本不满足要求

#### Scenario: Legacy partial is explicitly allowed
- **WHEN** 调用方选择允许 legacy partial 且 Contract 1.3 事实通过自身校验
- **THEN** 系统可以消费该事实，但所有派生路径保持 `PROVISIONAL_LEGACY`
