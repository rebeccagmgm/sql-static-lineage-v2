## Why

现有字段 multi-hop 能证明跨 Task 的 `VALUE_FLOW`，也能附着部分 `ROWSET_CONTROL`，但控制字段不会继续递归，表达式控制、无字段关系依赖和候选分支的负向证明仍不完备。把这些能力继续塞入旧 `field-lineage` 生成器和 renderer 会放大兼容、并发修改和发布风险，因此需要在同一仓库中增加一个只读消费现有证据的独立目标字段静态因果切片模块，并让 Calcite 从算子开发开始作为贯穿全程的并行语义校验轨。

## What Changes

- 新增独立 `TARGET_FIELD_CAUSAL_SLICE` consumer、artifact、CLI、摘要和 HTML；旧 `FIELD_MULTI_HOP_RECONCILIATION` 1.1 artifact、CLI 和 renderer 保持原行为，不被新模块回写。
- 新增正交的 semantic dependency 模型，区分值贡献、表达式分支、行成员、重复度、分组、排序、窗口、集合和关系存在性影响。
- 将 ROWSET/EXPRESSION/WINDOW/RELATION 控制从注解升级为可遍历、可审计且有独立预算的因果分支，同时保留现有 `VALUE_FLOW` 主边兼容性。
- 按单个目标字段建立 Candidate Universe 和 `CONFIRMED_RELATED / CONDITIONAL_RELATED / PROVEN_UNRELATED / UNKNOWN` 结论，任何 Unknown 均绑定 gap，任何无关结论均绑定 negative proof。
- 统一 VALUE 与控制依赖的物理字段 resolver、producer bridge 和 occurrence-specific evidence refs。
- 发布独立、版本化的 causal-slice artifact，并从该 canonical JSON 生成最小确定重跑集、保守安全集、摘要和 HTML。
- 增加固定版本的 Calcite JSONL 语义校验器、逐算子差分语料、显式 shadow 模式和独立验证报告；它不进入默认生产流程，也不能单独改变 assessment 或产生 `PROVEN_UNRELATED`。

## Capabilities

### New Capabilities

- `target-field-static-causal-slice`: 在完整静态候选上游空间内，对每个目标字段生成 evidence-conservative 的 value/control/relation 因果切片、四分类结论、重跑集合和 Calcite 离线差分结果。

### Modified Capabilities

无。

## Impact

- 影响 Plan Facts 的表达式/关系语义投影、共享物理字段 evidence adapter，以及新增的 causal-slice traversal、artifact contract/validator、文本摘要与 HTML renderer。
- 保留现有 TypeScript parser、immutable IR、Machine Facts、表级 producer 判断和 Input Pack 缓存；不引入 SQLGlot/DataHub 运行依赖。
- 保留旧 field-lineage artifact/CLI/HTML 作为兼容输入与对照输出；新能力不在旧 renderer 内重新计算或发布。
- 新增独立、非默认的 Java/Calcite 验证工具；每批 Native 算子实现均须同步运行对应差分语料，默认 `npm test` 和生产 CLI 仍不依赖 Java。
- 209119 验收只复用已有 Input Pack、Machine Facts 与 table artifact，执行 field-only 重算，不触发全量采集。
