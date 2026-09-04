## Why

任务局部投影（`TASK_LOCAL_PROJECTION` 1.2.0）已经在四锚点展开批（186 PROJECTED 任务）上产出 9,070 条 `FIELD_DIRECT`、201 条 `FIELD_CONDITIONAL`、2,204 条 `DATASET_CONTROL`，且锚点输入字段有 246/255 能在批内找到 producer 的同名输出列 binding。字段事实**已经存在**，但还不能回答「这个字段怎么来的、什么会让它变、哪里我们不知道」：

1. 字段边没有读次：`FIELD_DIRECT` 起点是全局 `(表, 列)`，接不上按读次键控的 `UNION_CONTINUATION_INDEX`，字段级悄悄退回了第一代 `column → column` 模型。
2. 值边没有语义：`subtype` 100% `UNKNOWN`，`select a`、`sum(a)`、`a*b` 同形。
3. 控制没有侧别：JOIN/FILTER 事实齐全，但缺 `joinType / controlSide`，无法按列判定 `FIELD_SCOPED / DATASET_SCOPED`。

写代码前实测（186 投影，§2.5）：朴素子树算法 RESOLVED 仅 63.29%；181058 11.56%（物化折叠丢上下文）；176827 setop 顶层 57 列全挂 `setop`。全库 344 Facts：setop 40%、同表多读 47%、外连接 49%、物化 10%——非锚点特例。

**本 change 只做 Phase 1**。baseline 用三组 cohort：`anchorExpansionBatch`（186，锚点展开批）、`shadowEvaluationSlice`（158，344−186，结构性泛化检查，**非独立标注 holdout**）、`all`（344）。Phase 2 另开 `field-evidence-v1-impact-query`。

## What Changes

- **FE-0 契约先行**：`contract.ts` 支持 1.3.0 类型与校验；`TASK_LOCAL_PROJECTION_SCHEMA_VERSION` **暂留 1.2.0**，与投影 bump 同 PR（§4.6）；`ids.ts` 增加 `fieldDirectEdgeSemanticKey`（含 `sourceReadOccurrenceId + expressionId`）；1.2.0 可读、`>= 1.2.0` READS 校验不放松；`gaps[]` + reasonCode fail-closed。
- **FE-1…FE-3 + FE-1′**：读次三步派生、路径 subtype、relation 子树侧别、临时表 gap 按表聚合；同 PR bump 常量并发射 1.3.0。
- **FE-B**：`phase1-baseline.json` 三组 cohort + 源码 lint。
- **不做**：Impact Query、跨任务 resolve、Phase 2 金样、止损脚本；新节点类型、字段级控制边、改 INDEX/SQLLens/Facts 发布器。

## Capabilities

### New Capabilities

（无。Phase 2 查询能力另开 change；草稿见 `docs/execution-plan-field-evidence-v1.md` §6–§7。）

### Modified Capabilities

- `task-local-graph-projection`: 1.3.0 字段边读次/物理 read relation/表达式/subtype；setop 分支下沉；`DATASET_CONTROL` join 侧别；`gaps[]`；legacy 1.1.0/1.2.0 可读。

## Impact

- `contract.ts`、`ids.ts`（FE-0）；`project-task-local.ts`、`dataset-controls.ts`（FE-1…FE-3）。
- 新增 `scripts/project-graph/field-evidence-v1/`。
- Consumer 硬编码 `1.2.0`（`gate-b-union` 等）在 1.3.0 投影上线前另改，不在 FE-0 范围。
