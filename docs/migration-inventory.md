# Migration Inventory

本清单记录“迁移什么、参考什么、丢弃什么、尚未验证什么”。新目录不继承旧目录的生成状态，也不继承历史事实包的业务含义。

## 应迁移

| 内容                                              | 新目录位置                                   | 来源与用途                                                                                             | 状态                    |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| parser/analyzer engine snapshot                   | npm `sqllens@1.8.0`（不再 vendoring `src/`） | 原 f335 worktree `efeb98a` 的 `sql-static-lineage/src`；现改为依赖已发布的 sqllens 包                  | 已切到 npm 依赖         |
| Plan adapter 与 plain-data contract               | `scripts/plans/`                             | f335 `sql-static-lineage/scripts/plans/{plan-adapter,plan-contract}.ts`；保持 engine 与 Publisher 分层 | 已迁移                  |
| P0 Write/ordinal binding 与 fail-closed validator | `scripts/machine-facts/`                     | f335 `efeb98a` 的 Machine Facts 变更；保留 `write_observation_id`、CTAS pairing、ordinal disposition   | 已迁移                  |
| Schema/runtime publication helpers                | `scripts/machine-facts/`                     | 同一 P0 基线；只接受本地 SQL/Schema snapshot                                                           | 已迁移                  |
| Current Bundle freshness loader                   | `scripts/query/current-task-bundle.ts`       | f335 未合入 worktree；按 Index → Status → Manifest → output hash 链读事实                              | 已迁移                  |
| Task Inspection Consumer                          | `scripts/query/task-inspection.ts`           | f335 未合入 worktree；已完成 focused tests 和独立 surrogate review                                     | 已迁移                  |
| Focused regressions                               | `tests/`                                     | f335 的 Machine Facts、Plan adapter、Task Inspection tests                                             | 已迁移，需在新 cwd 重跑 |

## 仅参考

- `openspec/changes/stabilize-sql-static-lineage-machine-facts-l1/`：目标契约、P0 顺序和 Contract 2.0 设计依据，不把所有 OpenSpec 未完成任务误报为已实现。
- 旧嵌套 `sql-static-lineage` 的 README、测试和当前 dirty tree：用于识别能力与缺口；它不是新目录的 Canonical source。
- `docs/sql-case-86840/` 与已有 surrogate review：只证明当前 86840 Reader Bundle 的可读性边界，不证明 Contract 2.0 或业务正确性。

## 必须丢弃

- `node_modules/`、缓存、5GB staging、历史 `output/`、`machine-facts/` 生成目录和 1003-task corpus。
- 复杂 Hop/Projection、minimal causal path、下游任务发现、Panorama/Python 语义系统。
- 旧的生成 JSON/JSONL、历史 manifest、旧 Reader 页面和任何未重新核对 snapshot hash 的结论。
- 任何把 task count、测试通过、`SUCCESS` 或同名字段当作业务闭合的叙述。

## 尚未验证 / 不得宣称

- Contract 2.0 Core Bundle 与 exact used-Schema consultation closure。
- 86840 的“最终 SQL + Schema/View 依赖闭包”在新目录中的冻结输入与重放。
- 86840 的所有 Write、CTAS/INSERT、目标 ordinal、Schema drift 和最终字段事实是否满足 `READY`。
- L1 支持矩阵覆盖的全量脱敏回归、完整 typecheck/format 的基线对比。
- 任何运行时调度、业务行值、指标口径和业务验收。

## 来源追踪

- P0 committed source: `C:\Users\13246\.codex\worktrees\f335\titans-cognition`, commit `efeb98a` (`fix: close machine facts P0 truth gaps`).
- Hop endpoint source used only as implementation context: same worktree commit `b1b0c61`; Hop files are intentionally not migrated into this L1 Core.
- Task Inspection source: `C:\Users\13246\.codex\worktrees\f335\titans-cognition\sql-static-lineage\scripts\query\{current-task-bundle,task-inspection}.ts`, uncommitted at inspection time; review `review/surrogate-review-task-inspection-20260820.md`, disposition `ACCEPT` for the bounded Reader slice only.
- Original OpenSpec/source references remain outside this directory and are not modified.
