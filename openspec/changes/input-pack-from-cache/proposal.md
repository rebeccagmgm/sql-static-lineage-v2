## Why

`schedule-evidence` 和 `数综基础信息/原信息` jsonl 已经够用，但 Input Pack 采集仍走 OpenCLI。现在要把同一套 `tasks/` + `tables/` 从本地缓存离线落盘，不再现场打 `task-source` / `table-ddl`。

## What Changes

- 新增只读缓存采集入口：遍历 `schedule-evidence/tasks/<taskId>/`，按任务类型组装 `TaskEvidence`，复用现有 writer。
- 新增 Table 离线解析：已有 `tables/` → Hive 元数据⊕DDL jsonl → RDBMS 核心⊕DDL jsonl；Hive DDL 缺失时才用任务 CREATE。
- 手工/冻结/未找到任务仍归档到现有 sibling 根；离线表缺口标 `PARTIAL`，不挪出主根。
- 不改 Task/Table 落盘契约、Hash、目录名。不调用 OpenCLI。

## Capabilities

### New Capabilities

- `input-pack-from-cache`：从 schedule-evidence 与原信息 jsonl 离线生成 Input Pack。

### Modified Capabilities

- 无。落盘契约沿用已归档的 `task-input-pack`，本变更只加离线取证路径。

## Impact

- 主要改动：`scripts/input/mainline`、`scripts/input/shared`、对应测试、`package.json` 脚本。
- 只读外部目录：`sql-static-lineage-cache/schedule-evidence`、`数综基础信息/原信息` 四份 jsonl。
- 写入：`sql-static-lineage-data/tasks` 与 `tables`。
- 不改 `src` parser、不改在线 `collect-task-input-pack` 默认行为。
