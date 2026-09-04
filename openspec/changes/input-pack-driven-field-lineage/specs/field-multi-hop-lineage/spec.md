## Purpose

定义从显式目标字段出发、跨 Task 递归追踪字段值来源的可验证行为，并将值流、行集控制、候选关系和证据缺口清晰分离。

## ADDED Requirements

### Requirement: Traversal starts from explicit physical target fields
字段级 multi-hop SHALL 要求调用方提供根 Task、根物理目标表和一个或多个根字段。系统 MUST 验证根字段存在于根目标 Table Pack；没有显式根字段时不得退化为全字段遍历。

#### Scenario: Valid root fields
- **WHEN** 调用方提供的根表和根字段均可由 Input Pack Schema 证明
- **THEN** 系统为每个根字段建立独立、可去重的遍历状态

#### Scenario: Unknown root field
- **WHEN** 任一根字段不在根目标 Schema 中
- **THEN** 系统拒绝该字段并输出明确原因，不猜测大小写以外的别名映射

### Requirement: Cross-task recursion follows confirmed task edges and field bindings
系统 SHALL 仅沿每层表级 one-hop 结果中的 `finalUpstreamTaskIds.primary` 递归；`additional` SHALL 作为候选证据展示但不递归，`unknown` MUST NOT 递归。跨 Task 字段桥接 SHALL 同时要求下游输入字段物理身份与上游 Task 已证明的目标输出字段物理身份精确一致。

#### Scenario: Primary producer and exact physical field match
- **WHEN** 下游字段值流到达一个 Schema-backed 物理输入字段，且 one-hop primary 指向生产同一物理表字段的 Task
- **THEN** 系统进入该上游 Task 的对应输出字段继续追踪

#### Scenario: Additional producer candidate
- **WHEN** 字段所在表仅出现于 one-hop `additional`
- **THEN** 系统记录候选 producer 与原因，但不进入该 Task

#### Scenario: Physical identity does not match
- **WHEN** 表名或列名相似但 platform、dataSource 或稳定表身份不一致
- **THEN** 系统不得建立跨 Task 字段边，并报告物理身份不匹配

### Requirement: Value flow and rowset control are separate projections
字段主树 SHALL 仅包含 `VALUE_FLOW`。Join key、filter、日期范围和其他只影响记录集合的依赖 SHALL 作为相关 Task/字段节点的 `ROWSET_CONTROL` 注解输出，MUST NOT 被表示成目标值来源。

#### Scenario: Join and filter columns exist
- **WHEN** 目标字段表达式所在关系可证明受到 Join 或 filter 字段控制
- **THEN** 主树保持值流路径不变，并在相应节点附加可定位的 `ROWSET_CONTROL` 证据

#### Scenario: Control scope is not provable
- **WHEN** legacy facts 缺少跨 CTE 或子查询的 scope binding，无法证明控制条件作用于目标字段关系
- **THEN** 系统记录 `ROWSET_SCOPE_UNRESOLVED`，不得把控制字段强行附着到值流路径

### Requirement: Traversal is bounded, deterministic, and cycle-safe
系统 SHALL 支持最大深度、最大状态数和最大路径数边界，并 SHALL 基于稳定物理身份与 Task/字段状态去重。相同输入的 JSON、树形摘要、节点顺序和停止原因必须确定；检测到 cycle 时 SHALL 终止该分支但保留 cycle 证据。

#### Scenario: Cycle is encountered
- **WHEN** 遍历再次到达当前路径已经出现的 Task 与物理字段状态
- **THEN** 系统以 `CYCLE` 终止该分支并继续处理其他分支

#### Scenario: Safety limit is reached
- **WHEN** 最大深度、状态数或路径数任一达到配置上限
- **THEN** 系统停止受影响的扩展，输出对应 limit reason，并将整体结果标为不完整

### Requirement: Canonical artifact and summary expose evidence status
系统 SHALL 输出版本化的 `FIELD_MULTI_HOP_RECONCILIATION` JSON，并可从同一规范化结果生成确定性树形摘要。节点或边证据状态 SHALL 为 `CONFIRMED`、`PROVISIONAL_LEGACY`、`CANDIDATE` 或 `UNRESOLVED`，整体状态 SHALL 为 `COMPLETE`、`PARTIAL` 或 `BLOCKED`。

#### Scenario: All requested fields close on confirmed evidence
- **WHEN** 每个根字段的全部 primary 值流分支都在边界内闭合且没有降级或缺口
- **THEN** 产物整体状态为 `COMPLETE`，且 canonical JSON 与摘要表达相同路径

#### Scenario: A required Input Pack is excluded or missing
- **WHEN** 递归需要的 Task Pack 不在主 data root，或状态文件将其标为 excluded
- **THEN** 系统在该节点以 `UNRESOLVED` 停止并输出缺失/排除原因，不得静默读取隔离目录

#### Scenario: Legacy evidence is used
- **WHEN** 任一路径消费了显式允许的 Contract 1.3 facts
- **THEN** 对应路径至少为 `PROVISIONAL_LEGACY`，整体结果不得标为 `COMPLETE`

### Requirement: Task projection preserves full and field-specific views
摘要 SHALL 同时展示既有表级全量上游树和由所选根字段投影得到的 Task 值流树。字段值流树可以省略不提供目标值的 Task，但 SHALL 在注解或缺口中保留这些 Task 对行集控制或候选关系的影响。

#### Scenario: 155015 field-specific projection
- **WHEN** 155015 的根字段仅从 114026 与 105387 的已证明输出取得值，且更上游只有 112715 与 71698 提供相应值流
- **THEN** 字段 Task 树只保留 `112715 → 114026 → 155015` 与 `71698 → 105387 → 155015`，其他表级上游不被误报为值来源

