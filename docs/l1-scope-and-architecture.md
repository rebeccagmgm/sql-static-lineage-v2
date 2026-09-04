# L1 Scope 与 Architecture

## 目标

L1 只建立一条可复核的静态字段血缘主线：

```text
SQL bytes + declared dialect + Schema/View snapshot
  -> parse/lower
  -> resolve/qualify
  -> per-Write observations and producer ordinals
  -> Contract 2.0 Canonical Machine Facts
  -> JSON/CLI or bounded evidence card
```

完整合法输入下，字段绑定必须闭合。Parser/Analyzer 不支持是算法缺陷；输入本可查询但没有采到是采集缺陷；事实没有完整表达是契约或发布缺陷。三者不能通过猜测互相掩盖。没有足够证据时，状态必须是 `UNKNOWN`、`NOT_EVALUABLE`、`PARTIAL` 或 `STALE`。

## 范围

### 必做

- SQL Statement、Relation、Expression、Dataset I/O 与 source span。
- Schema/View snapshot、使用闭包和 hash identity。
- 每个独立 Write 的稳定 `write_observation_id`。
- 每个 field-producing Write 的 producer ordinal 恰好一个处置：唯一 Binding 或同 Write 的 gap；无法枚举 producer 时显式失败。
- INSERT、CTAS、显式目标列、位置绑定、静态/动态分区、Schema drift 的 fail-closed 处置。
- Contract 2.0 Core Facts：base origin、output binding、rowset control、typed gaps、capability summary、freshness attestation。
- 一个 Consumer：只从 Current Canonical Machine Facts 生成稳定 JSON 和简洁 HTML 证据卡。

### 不做

- 不读取业务行、不做运行时/调度验证、不写源系统。
- 不构建下游发现、指标语义、业务对象、Wiki/LLM、Panorama 或 Python 语义系统。
- 不把 Hop、复杂路径、历史 Projection 或 1003 corpus 作为 L1 Core 依赖。
- 不让 Consumer 重新解析 SQL、重新绑定字段或用 Profile 补全静态事实。

## 模块职责

`sqllens`（npm）是 parser/analyzer engine 边界；它只输出项目无关的结构观察。`scripts/plans/plan-adapter.ts` 将这些观察转为 L1 计划事实。`scripts/machine-facts/` 负责 per-task Canonical assembly、hash、span、Write/ordinal 校验和发布。`scripts/query/current-task-bundle.ts` 是唯一允许 Reader 读取任务事实的入口；`task-inspection.ts` 只做派生 Projection。

当前迁移的 Publisher 仍是旧 Contract 1.3.0 基线，因此不能宣称 L1 Ready。它只为旧 schema compatibility 保留空的 Hop 输出文件，不计算或发布 Hop 内容，相关 Gate 为 `false`。Contract 2.0 的 Core/Optional 分层、used Schema ref 精确闭包和 capability truth table 是下一阶段实现内容，不在目录整理中预先伪造。

## 唯一执行顺序

1. 冻结目标 SQL、声明方言和 Schema/View snapshot，记录内容 hash；不以当前库查询代替 snapshot。
2. Parser/lower 保留每个 Statement、原始文本和 span；失败或不支持结构保留 typed diagnostic。
3. Analyzer 在 Schema evidence 上 resolve/qualify；歧义、缺失和未支持结构不选名猜测。
4. 对每个 Write 建立独立身份、Write/Producer statement、target、source/`AS` boundary 和有序 producer ordinals。
5. 对每个 ordinal 生成唯一 Binding，或生成引用同一 Write 且列出 uncovered ordinals 的 gap；发布前执行 Bundle validator。
6. 生成 Contract 2.0 Core Facts、used Schema closure、capability summary 和 read-time freshness attestation。
7. Consumer 只加载 Current Index 指向且 hash 链闭合的 Core Bundle，输出 JSON/HTML；不重新推断。
8. 先通过工程 Gate，再做独立 surrogate reader review；任何 Gate 通过都不等于运行成功、业务正确或用户验收。

## 证据状态

`generation_status=SUCCESS` 只表示 Bundle 生成和发布校验成功；`freshness_status` 是相对当前 Index/snapshot 的读取时判断；`coverage_status` 分能力维护。`READY` 只允许在适用 subject 全部被唯一处置、无阻断 gap 且证据链闭合时使用。当前 1.3.0 bundle 统一为 `LEGACY_NOT_L1`，不能进入这个 READY 状态。
