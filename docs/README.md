# 文档索引

## 当前主链（2026-09-03）

| 文档 | 用途 |
| --- | --- |
| [execution-plan-gold-case-investigation.md](execution-plan-gold-case-investigation.md) | **P0 执行规格**：方案、命令链、产物契约、路线图（§0 / §8） |
| [domain-asset-graph-architecture.md](domain-asset-graph-architecture.md) | **架构**：机器单位、三层、两条产品线、端到端数据流 |
| [execution-plan-asset-graph.md](execution-plan-asset-graph.md) | **执行总地图**：WP 状态、里程碑 M0–M3 |
| [value-scenarios-dm-otc-n.md](value-scenarios-dm-otc-n.md) | **价值场景清单**：§1 应用方向（V1–V3）+ §2 架构可行性 + §4 技术能力（A–D），验证与实施顺序 |

| 文档 | 用途 |
| --- | --- |
| [graph-accuracy-architecture.md](graph-accuracy-architecture.md) | WP-6…WP-12 准确性冻结 |
| [graph-user-narrative.md](graph-user-narrative.md) | L0–L3 对用户陈述 |
| [execution-plan-task-local-projection.md](execution-plan-task-local-projection.md) | WP-3 纸条 |
| [execution-plan-task-local-union.md](execution-plan-task-local-union.md) | WP-5 并集 + WP-8 接续 |

### 金样一句话

四锚点 taskId → **`--expand-upstream` 穿透闭包** → 纸条 + **`union-continuation-index.json`** → gaps / L0–L3；HTML 可选。

### 接下来做什么（顺序）

1. 跑 `project-task-local --task-ids … --expand-upstream`（GC-0 步骤 1）
2. 跑 `union-continuation-index`（GC-0 步骤 2）
3. 写 `gold-case-gaps.jsonl` + 分锚点 L0–L3（GC-3）
4. 扩 golden / 一键脚本（GC-4 / GC-2）

细节：**[execution-plan-gold-case-investigation.md §8](execution-plan-gold-case-investigation.md)**。

## L1 主线与采集

| 文档 | 用途 |
| --- | --- |
| [l1-scope-and-architecture.md](l1-scope-and-architecture.md) | L1 边界 |
| [input-pack.md](input-pack.md) | Task/Table Input Pack V1 |
| [input-pack-from-cache.md](input-pack-from-cache.md) | 缓存离线组装 |
| [acceptance.md](acceptance.md) | 验收入口 |

## 已暂停 / 实验性

| 文档 | 用途 |
| --- | --- |
| [experimental/README.md](experimental/README.md) | 暂停工作说明 |
| [experimental/execution-plan-closure-on-union.md](experimental/execution-plan-closure-on-union.md) | WP-10 闭包接并集（已暂停） |

旧路径 `docs/execution-plan-closure-on-union.md` 仅保留重定向桩。
