## Context

现有 Input Pack 已统一持久化 Task、SQL slots、目标表和 Table Pack/DDL；producer-index 与 one-hop/multi-hop 提供表级 producer 关系。Machine Facts publisher 仍接收独立 analysis profile 与 Schema snapshot，Contract 1.3 明确不生成 cross-task field stitching。任务内字段解析已有 output bindings、physical field edges 和 inspection projection，但字段身份主要依赖 logical source，不能直接作为跨 Task 物理桥接键。

155015 同时暴露两个约束：oracle2hive/SparkIndex 类任务可能以纯 `SELECT` 配合平台目标表，而不是 SQL 显式写入；112715 当前处于 excluded Input Pack 状态，真实验收必须把它作为缺口，不能读取隔离目录后假装链路闭合。

## Goals / Non-Goals

**Goals:**

- 建立唯一的 Input Pack → Machine Facts 准备入口，消除人工 profile 拼装。
- 在不改变表级 one-hop/multi-hop 语义的前提下，新增跨 Task 字段值流消费器。
- 支持 SQL 显式写入和可证明的平台目标查询输出。
- 生成机器可消费 JSON 与适合核对的树形摘要，并保持所有降级/Unknown。
- 用通用合成案例验证引擎，用外部 data root 中的 155015 做验收。

**Non-Goals:**

- 不把静态事实解释为调度运行成功、数据到达、数据正确或业务验收。
- 不在首版完成 Contract 2.0/L1 全量迁移，也不把 Contract 1.3 自动升级为 confirmed。
- 不沿 `additional` 或 `unknown` producer 递归，不从字段名相似度猜测跨 Task 连接。
- 不将内部真实 SQL、DDL、Input Pack 或生成产物提交到 Git。
- 不修复/补采 112715；该动作属于 Input Pack 收集流程，字段引擎只消费主 data root 的受控状态。

## Decisions

### 1. 新增 Input Pack-driven builder，保留现有 publisher 作为底层

新增准备层负责定位 Task Pack、选择 SQL slots、加载 Table Pack DDL、构建 publisher 所需 profile/schema 输入并写入 provenance。`query` 决定任务目标输出；被纳入分析的其他字段生产 slot 逐份按原字节和 hash 冻结，并按稳定顺序形成明确标记的派生联合快照。Task-local CTAS Schema 只用于同 Task 中间字段展开。现有 SQL parser、plan adapter、Machine Facts builder 与 validator 继续负责语义分析，避免在 Input Pack 层复制完整 SQL 血缘逻辑。

替代方案是让字段 consumer 临时拼 profile；这会让每个调用方重复目标表、Schema 和 slot 选择规则，无法形成统一证据边界，因此不采用。

### 2. 使用两种输出绑定证据类型

`SQL_EXPLICIT_WRITE` 复用 INSERT/CTAS 的结构事实。`PLATFORM_TARGET_QUERY_OUTPUT` 仅用于纯查询 SQL 加平台目标的任务，要求：目标物理身份唯一；最终查询只有一个可枚举 producer；Table Pack DDL 可用；非分区目标列与输出 ordinal 完整对应；分区列处理有明确证据。任一条件失败则整体不绑定，避免“能对上几个就先对几个”的伪精确。

目标查询输出绑定作为语义适配层证据，不伪装成 SQL WRITE；事实中同时保留平台目标来源和证明条件。

### 3. 跨 Task 桥接使用独立 PhysicalFieldIdentity

桥接键定义为：

`platform | dataSource | stableTableId-or-qualifiedName | normalizedColumn`

优先使用 Table ID；没有 Table ID 时才使用经 Task/Table Pack 一致性验证的 qualified name。字段必须存在于目标 Table Pack Schema。Machine Facts 内部原有 field ID 不改名，consumer 通过 bridge index 将任务内字段投影到物理身份，从而降低对 Contract 1.3 数据模型的破坏。

Task-local CTAS 字段使用独立 `TASK_LOCAL_SCHEMA_BACKED` 身份，只在同一 Task 的 output binding 间递归。即使临时表存在缓存 Table Pack，也不会因此进入表级 producer 决策；只有最终回到真实 Table Pack 字段后才允许跨 Task 桥接。

### 4. 字段遍历叠加在表级 reconciliation 之上

字段 consumer 不自行重新判断 producer。每层先读取或生成 one-hop reconciliation，只从 `finalUpstreamTaskIds.primary` 构造可递归 Task 边；`additional` 只形成 `CANDIDATE`；`unknown` 形成停止原因。表级 multi-hop artifact 用于展示完整上游树和校验允许的 Task/深度范围，不替代逐层 primary 语义。

遍历状态为 `(taskId, targetPhysicalFieldIdentity, outputBindingId)`；路径集合和 active-path 集合分别用于全局去重与 cycle 检测。所有 frontier 按 Task ID、物理字段身份、binding ID 排序。

### 5. VALUE_FLOW 是主图，ROWSET_CONTROL 是旁路注解

主图只从 output binding 沿 value-producing field edges 回溯到 physical source fields。Join/filter/group/order 等控制信息从 relation ancestry 与 control edges 收集，附着到能够证明作用域的 Task/field path 节点。

Contract 1.3 未持久化完整 scope bindings；无法证明跨 CTE/子查询控制范围时生成 `ROWSET_SCOPE_UNRESOLVED`。首版不通过字符串位置或同 statement 猜测关联。

### 6. 事实策略与结果状态分离

CLI 默认 `current-only`，拒绝 legacy 事实。真实 155015 首次验证可显式使用 `allow-legacy-partial`，但所有经过 Contract 1.3 的边为 `PROVISIONAL_LEGACY`，overall 至少为 `PARTIAL`。

节点/边 evidence status 与 overall status 分开计算：未闭合根字段、输入缺失、limit、cycle（若导致未闭合）或 legacy 降级都不能输出 `COMPLETE`。`BLOCKED` 表示没有任何请求根字段能够开始有效遍历；其他有缺口的结果为 `PARTIAL`。

### 7. 一个 canonical model 驱动两种输出

新增版本化 `FIELD_MULTI_HOP_RECONCILIATION` JSON Schema。CLI 先构造 canonical result，再由纯 formatter 生成文本摘要，避免 JSON 与树形输出各自计算路径。摘要固定包含：请求与策略、完整表级树、字段 Task 树、逐 Task 字段映射、ROWSET_CONTROL、candidates、gaps 和 limits。

## Risks / Trade-offs

- [Contract 1.3 缺少完整 scope binding，ROWSET_CONTROL 可能大量 unresolved] → 明确降级并为 Contract 2.0 留扩展字段，不用启发式填满。
- [平台查询输出 ordinal 映射可能因隐藏分区列或目标列差异而错误] → 仅完整证明时整体绑定，任何不一致 fail closed。
- [producer-index 或 one-hop 与 Input Pack 快照不一致] → 比较 artifact fingerprint/provenance；不一致时停止并要求重建，不混用快照。
- [字段分支数量膨胀] → 提供 depth/state/path 三个硬边界、稳定去重和确定性截断原因。
- [真实 155015 因 112715 excluded 无法闭合] → 把 expected gap 纳入验收；待 Input Pack 正常补采后用同一命令重跑，不在引擎中加入例外。
- [现有 worktree 有用户未提交修改] → 实施只编辑新模块和明确相关文件；遇到重叠先审阅差异，不覆盖用户内容。

## Migration Plan

1. 先增加 schema、类型、builder 与合成测试，不改变现有 Machine Facts CLI 默认行为。
2. 增加 field multi-hop consumer、CLI 和 formatter；默认 facts policy 为 `current-only`。
3. 使用外部 Input Pack 运行 155015：当前允许 legacy 时预期为 `PARTIAL`，112715 分支明确停止。
4. 112715 经既有采集流程恢复到主 Input Pack 后重建 producer-index/Machine Facts 并复验，不需要代码特例。
5. 后续 Contract 2.0 发布 scope bindings 与 L1 facts 后，将相同 artifact 的边升级为 `CONFIRMED`。

回滚只需移除新增 CLI/模块与 npm script；现有 Input Pack、Machine Facts 和表级 reconciliation 产物不迁移、不重写。
