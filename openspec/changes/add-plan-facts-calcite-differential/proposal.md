## Why

现有 Calcite 工具直接解析原始 Horae/Hive SQL，容易在平台方言、模板包装和保留字处失败，因而无法稳定发挥 Calcite 的关系代数 metadata 能力。仓库已经拥有经过适配的 `src → Plan Facts` 结构化事实链，应复用该边界建立旁路差分能力，同时严格保证原解析、证据和产物链默认行为不变。

## What Changes

- 新增从 canonical Plan Facts 到 Calcite `RelNode` 的单向、只读转换桥，优先覆盖 read、project、filter、join、aggregate、set operation、window 和 Top-N。
- 将现有 `calcite-oracle` 命名迁移为 `calcite-differential`，明确 Calcite 是差分语义引擎而非绝对真值或 Oracle 数据库；保留必要的协议兼容入口。
- 新增独立 JSONL 协议与差分报告，保存 Plan Facts relation occurrence、字段、source evidence 与 Calcite node/metadata 的可核对映射。
- Calcite 继续固定为离线、显式启用的 Java 工具；默认 Node/TypeScript pipeline、测试和 canonical artifacts 不依赖 Java，也不读取 Calcite 结果。
- Calcite unsupported、failed 或 unmappable 只形成差分状态；不得修改 Native 结论或生成 `PROVEN_UNRELATED`。只有显式启用的验证消费方可将同一精确语义对象上的冲突暴露为独立 gap。
- 建立代表性 Plan Facts fixture、真实 Horae/Hive 语料映射测试和原链路不变回归门禁。

## Capabilities

### New Capabilities

- `plan-facts-calcite-differential`: 将既有 Plan Facts 映射为 Calcite 关系计划并生成可追溯、默认隔离的 metadata 差分结果。

### Modified Capabilities

无。现有 parser、Plan Facts、Machine Facts、field-lineage 和 target-field causal-slice 的既有行为契约不变。

## Impact

- 实现与独立测试位于 `E:\02_area\股衍数据-数据cookbook\scripts\Calcite\`；其 `protocol.ts`、`sidecar-runner.mjs`、`native-input/`、`candidate-evidence/` 和 `*test.mjs` 是当前外部入口。
- 复用 `scripts/plans/plan-contract.ts` 和 `scripts/plans/plan-adapter.ts` 的输出契约，不在本变更中修改其 canonical 语义。
- Java/Calcite 1.42.0 仍为可选开发依赖；默认 npm 工作流不要求 Maven、JDK 或 Calcite jar。
- 现有 `scripts/calcite-oracle/` 与 `tools/calcite-oracle/` 需要兼容迁移，避免一次性破坏已有命令、fixture 或文档引用。
