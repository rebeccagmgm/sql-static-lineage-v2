## Context

在线采集在 `collect-one-task-input-pack.ts`（通用）和
`collect-one-task-input-pack-sparkindex.ts`（可吃缓存但 MISS 会刷新）。
Writer 已稳定：`materializeTaskAndTablePacks`。详细字段对照见
`docs/input-pack-from-cache.md`。

## Goals / Non-Goals

**Goals:**

- 一条离线 CLI，从缓存落同一套 Input Pack。
- Table 用表名索引四份 jsonl，避免每任务扫 1.8GB；guid 可选。
- 复用现有 writer、partition、SQL 抽表函数。

**Non-Goals:**

- 不改在线 `input-pack:tasks` 默认路径。
- 不补 hive2* 缺失的 sql-mcp query。
- 不做关系缓存、Producer Index、血缘。
- 不把整仓 1.7 万任务一次跑完作为本变更验收；验收用 fixture + 几个真实 ID。

## Decisions

1. **新入口，不改通用 collector 默认行为**  
   新增 `scripts/input/mainline/collect-input-pack-from-cache.ts` 和
   `npm run input-pack:from-cache`。通用 `collectOneTask` 继续打 OpenCLI。  
   备选：给 `collectOneTask` 加 cache 分支——拒绝，怕污染在线路径。

2. **TaskEvidence 按类型函数组装，再共用 writer**  
   sparkIndex 复用 `buildSparkIndexTaskEvidence` / merge，但禁止 runner。
   其他类型写薄适配，不复制 writer。

3. **jsonl 按表名建只读偏移索引**  
   首次扫描写到 data-root 外的索引文件（或进程内 Map）。查询按规范化表名，不按 guid。
   Hive 去掉 `@gfhive` 与时间戳；同内容重复行合并。Hive 只有 DDL 也可落盘。  
   备选：每次全扫——拒绝。

4. **platform 从 dataSource 前缀映射**  
   `gforacle_`/`gfmysql_`/`gfpostgre_`/`gfstarrocks_`/oceanbase/tidb/
   `gfgoldendb_`/`gfsqlserver_`。对不上不写 Table。

5. **离线表缺口留主根**  
   与在线 `PHYSICAL_TABLE_NOT_FOUND` 归档区分：jsonl INCOMPLETE ≠ 表不存在。

6. **测试用小 fixture，不读生产 1.8GB**  
   单测用截断 jsonl + 内存缓存。可选脚本才允许打真实目录，不进 `npm test`。

## Risks / Trade-offs

- [jsonl 缺行] → PARTIAL，不编造  
- [覆盖更完整 Pack] → 默认 skip，SQL 槽数更少时即使 `--force` 也要警告  
- [索引占内存] → 表名→offset，不要把 DDL 全文载入  
- [过度防御] → 不新增抽象层、不包一层 Repository、不加 TTL/CAS

## Migration Plan

加脚本即可。已有 2708 个 Pack 默认跳过。索引可删了重建。无需回滚数据契约。
