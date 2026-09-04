## Why

现有 one-hop 与 multi-hop 只能回答 Task/表级上游，Machine Facts 又依赖独立 profile 与 Schema snapshot，导致跨 Task 字段链路需要人工拼接证据。需要让统一 Task/Table Input Pack 成为 Machine Facts 的受控输入，并在相同物理字段身份上递归，才能稳定回答 155015 一类字段级问题，同时保留证据不足为 Unknown。

## What Changes

- 新增 Input Pack 到 Machine Facts 的准备层，从 Task Pack、SQL slots、目标表身份和 Table Pack DDL 生成可追溯的任务级字段事实。
- 区分 SQL 显式写入与平台目标查询输出；只有满足可证明的目标字段绑定条件时才建立物理字段映射。
- 新增字段级 multi-hop 消费器，以显式根字段为种子，沿 one-hop 已确认 primary Task 边和 Machine Facts `VALUE_FLOW` 递归。
- 主树只表达 `VALUE_FLOW`；Join、筛选和其他 `ROWSET_CONTROL` 作为节点注解输出，不伪装成字段值来源。
- 输出规范化 JSON 与确定性文本摘要，并对 legacy Contract 1.3、候选关系、缺失/排除 Input Pack 和无法解析的字段映射显式降级。
- 以 155015 为真实验收种子；112715 未进入主 Input Pack 时必须停止相应分支并报告证据缺口，不能读取隔离目录后伪装为已确认。

## Capabilities

### New Capabilities

- `input-pack-machine-facts`: 定义从统一 Task/Table Input Pack 选择 SQL、加载 Schema、绑定平台目标并发布任务级 Machine Facts 的证据契约。
- `field-multi-hop-lineage`: 定义跨 Task 字段值流递归、物理身份桥接、证据状态、边界控制和双格式输出。

### Modified Capabilities

无。

## Impact

- 影响 `scripts/machine-facts`、`scripts/reconcile/consumer`、CLI/npm scripts、Schema 与对应测试。
- 复用现有 Input Pack、DDL loader、producer-index、one-hop/multi-hop 结果和任务内 output-field bindings，不改变现有表级产物的语义。
- 首版允许显式选择 legacy 1.3 事实作为 `PROVISIONAL_LEGACY`，默认策略仍拒绝将其当作 confirmed；后续 Contract 2.0/L1 可升级证据等级。
- 真实内部 SQL/DDL 和生成结果继续留在外部 data root，不提交到 Git。
