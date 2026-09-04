## Why

`from-cache` 已经能生成大部分 Input Pack，但当前仍有一批 PARTIAL 是因为缓存尚未刷新、日志 SQL/DDL 没有被消费、datasource 标签被误当成表，或本地目录证据缺失。旧 change 明确不做在线补洞，因此需要一个独立的后续能力，在不改变默认离线入口的前提下逐条补充可复核 evidence 并重新生成受影响 Pack。

## What Changes

- 增加当前 PARTIAL 的稳定清单和逐任务修复记录，禁止使用过期批次统计替代当前状态。
- 修复 `runScript` 日志 SQL 类型遗漏，并允许只重试已有 `UNAVAILABLE` 的 SQL cache。
- 让已有精确 task-sql evidence 在专用 SQL 路径缺 query 时作为受限 fallback，只补真实 SQL 槽，不制造物理表身份。
- 使用精确的 Horae datasource 映射识别 datasource label，并为可唯一映射的端点提供 RDBMS 消歧 hint。
- 增加显式 opt-in 的 online backup repair：本地 cache/catalog/log 优先，只有缺失或冲突时才查询精确的表元数据、DDL、任务 SQL 或日志。
- 对成功补证据的任务定向 force 重跑 Input Pack；无法唯一确认的任务保留 PARTIAL/UNKNOWN 并记录原因。
- 更新 Input Pack 使用文档和 PARTIAL 分析文档，区分历史快照、当前基线、已解决项和不可解决项。

## Capabilities

### New Capabilities

- `input-pack-partial-repair`: 对当前 Input Pack PARTIAL 进行证据盘点、受限补证据、定向重跑和结果审计。

### Modified Capabilities

无。

## Impact

- 影响 `scripts/input/mainline` 的 SQL/log cache 填充器和新的 partial repair 入口。
- 影响 `scripts/input/shared` 的 TaskEvidence、datasource 识别和离线表解析。
- 新增只读外部证据调用的 opt-in 路径；默认 `input-pack:from-cache` 仍不访问 OpenCLI。
- 影响现有 Input Pack 文档、修复 evidence manifest 和受影响任务/表目录；不删除或重写无关的既有 Pack。
