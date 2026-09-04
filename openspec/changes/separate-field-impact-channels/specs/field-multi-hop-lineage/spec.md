## MODIFIED Requirements

### Requirement: Value flow and rowset control are separate projections
字段主树 SHALL 仅包含 `VALUE_FLOW`。Join key、filter、日期范围和其他只影响记录集合的依赖 SHALL 作为独立的 `DATASET_CONTROL` 输出，MUST NOT 被表示成目标值来源，MUST NOT 作为字段节点上的 `ROWSET_CONTROL` / `rowsetControls` 注解按 `nodeId` 附着。

#### Scenario: Join and filter columns exist
- **WHEN** 目标字段表达式所在关系可证明受到 Join 或 filter 字段控制
- **THEN** 主树保持值流路径不变，控制证据写入 `DATASET_CONTROL`，不出现在该字段节点的逐字段控制列表里

#### Scenario: Control scope is not provable
- **WHEN** 无法证明控制条件作用于目标字段关系
- **THEN** 系统记录 typed gap（如 `ROWSET_SCOPE_UNRESOLVED`），不得把控制字段强行附着到值流路径，也不得猜测其作用于每个输出字段

### Requirement: Task projection preserves full and field-specific views
摘要 SHALL 同时展示既有表级全量上游树和由所选根字段投影得到的 Task 值流树。字段值流树可以省略不提供目标值的 Task。数据集控制 MUST 在独立区块保留，不得为了让字段树好看而把 JOIN/FILTER 任务写进值来源。

#### Scenario: 155015 field-specific projection
- **WHEN** 155015 的根字段仅从 114026 与 105387 的已证明输出取得值，且更上游只有 112715 与 71698 提供相应值流
- **THEN** 字段 Task 树只保留 `112715 → 114026 → 155015` 与 `71698 → 105387 → 155015`，其他表级上游不被误报为值来源

#### Scenario: 155015 zipper tables are not value sources
- **WHEN** 根字段为 `internal_trade_id`
- **THEN** 四张 LEFT JOIN 参考表不出现在该字段的 `FIELD_DIRECT` / 值流树上，而以 Task 105387 的 `DATASET_CONTROL / JOIN` 出现
