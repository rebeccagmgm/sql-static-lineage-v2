# Input Pack 缓存接入逻辑

对照 `docs/input-pack.md` 的在线采集路径，把 `schedule-evidence/tasks/<taskId>/`
当成已经取到的平台证据，离线组装同一套 `tasks/` + `tables/`。

**不改落盘契约。** 只替换取证来源。Writer、Hash、目录名、`create.sql` /
`ddl.sql` 分离、fail-closed 规则全部沿用现有 `writeTaskInput` /
`writeTableInput` / `materializeTaskAndTablePacks`。

当前库存（2026-09-01）：

| 根                                                 | 规模                          |
| -------------------------------------------------- | ----------------------------- |
| `sql-static-lineage-cache/schedule-evidence/tasks` | 17962 任务目录                |
| 其中 `horae-task-type.json`                        | 15116                         |
| 其中 `szdata-schedule-detail.json`                 | 15846                         |
| 其中 `hive-task.sql`                               | 4565                          |
| 其中 `run-script.sql`                              | 746                           |
| `sql-static-lineage-data/tasks`                    | 2708 个 `task.json`           |
| `sql-static-lineage-data/tables`                   | 4740 个 `table.json`          |
| `数综基础信息/原信息` Hive 元数据 jsonl            | 211922（ACTIVE 150098）       |
| 同上 Hive DDL jsonl                                | 142409                        |
| 同上 RDBMS 核心 jsonl                              | 1223553（INCOMPLETE，缺 114） |
| 同上 RDBMS DDL jsonl                               | 1202531（INCOMPLETE，缺 92）  |

---

## 1. 原接入 vs 缓存接入

```text
原路径（collect-task-input-pack + collectOneTask）
────────────────────────────────────────────────
taskIds
  │
  ├─ horae search（手工 / 冻结 / 全状态）     → 排除 / 归档
  ├─ szdata task-source                      → 身份 + SQL 槽 + source/target
  ├─ 必要时 horae detail                     → 补 SQL
  ├─ SQL FROM/JOIN + 直接 source/target      → 表候选
  ├─ szdata table / table-search / table-ddl → Table Pack
  └─ 必要时 szdata table 任务关系            → 无直接端点时的 target
        │
        ▼
  writeTaskInput + writeTableInput


缓存路径（本文件）
────────────────────────────────────────────────
schedule-evidence/tasks/<taskId>/
  │
  ├─ horae-task-type.detail.cycle/status     → 排除 / 归档（不再 search）
  ├─ 按 taskType 路由缓存文件                → TaskEvidence
  ├─ SQL + syncInfo + schedule-detail        → 表候选
  ├─ 已有 tables/ + 原信息 jsonl 目录        → Table Pack
  │     Hive：按 db.table 对 DDL（可无元数据/guid）
  │     RDBMS：按 db.table@dataSource 对核心+DDL
  └─ 不调用 OpenCLI
        │
        ▼
  同一套 writeTaskInput + writeTableInput
```

`horae-relation-*-depth-1.json` **不参与** Table Pack 身份，也不替代表 GUID /
`szdata table` 任务关系。from-cache 组装 Task Pack 时，若对应方向的 relation
cache 为 HIT，则把去重排序后的邻居 taskId 写入 `task.json` 的
`upstreamTaskIds` / `downstreamTaskIds`（调度配置的一部分；空数组表示已证实无邻居，
MISS/INVALID 则省略该字段）。

---

## 2. 原路径每一步对照

| 原步骤             | 原证据                                                   | 缓存替代                                                                                                       | 缺失时                                                                       |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 手工/冻结预分类    | `horae search --cycle 手工` / `--status F`               | `horae-task-type.detail.cycle` + `.status`；`szdata-schedule-detail.detail.status`                             | 两边都没有状态 → 不排除，继续采；两边都没有任务记录 → `HORAE_TASK_NOT_FOUND` |
| 任务不存在         | 全状态 search 无此 ID                                    | 无 `horae-task-type` 且无 `szdata-schedule-detail`                                                             | 归档到 `.not-found-tasks`，不进主根                                          |
| 任务身份           | `szdata task-source`                                     | 见 §3 类型路由                                                                                                 | 无类型且无 SQL → `FAILED`，不写半包                                          |
| SQL 槽             | task-source `sqlSlots`；不可用再 `horae detail`          | 类型路由后的 SQL 文件 / detail 字段                                                                            | 槽位省略，不编造；标 `PARTIAL`                                               |
| 直接 source/target | task-source `source`/`target`/`loadMode`/`hivePartition` | Horae `syncInfo` + schedule-detail `targetTable`/`insertMode`/`hivePartition`                                  | 保留原始字符串或省略；不用类型猜表名                                         |
| 表候选             | 直接端点 + SQL `FROM`/`JOIN` + 终端 INSERT/CTAS          | 同样的抽取函数，输入换成缓存 SQL                                                                               | 无候选则 Task 仍可写，Table 为 0                                             |
| Table 元数据+DDL   | `szdata table-search` + `table` + `table-ddl`            | ① 已有 `tables/` ② `原信息` jsonl 按表名拼接（Hive 可只靠 DDL） ③ Hive 无 DDL 时才用任务 CREATE ④ 否则 PARTIAL | **不**现场打 table-ddl                                                       |
| 任务关系兜底       | `szdata table --view full` 的 `taskIds`                  | **无等价缓存**。只用 SQL 精确写目标 + 已有 Table Pack                                                          | 不根据任务名猜表                                                             |
| 落盘               | `materializeTaskAndTablePacks`                           | 原样复用                                                                                                       | 原子替换；hash 不变不重写                                                    |

---

## 3. 类型路由：怎么从缓存组成 TaskEvidence

分类只认 `horae-task-type.detail.taskType`（名称，如 `sparkIndex`）。
schedule-detail 的 `taskType` 是数字码（如 `64`），用现有
`task-type-map.json` 反查，**仅当 Horae 类型缺失时**使用。两者冲突时 Horae
字典名优先，与现网 `taskCategory()` 一致。

`evidenceProvider` 写成缓存出处，不再写 `opencli:szdata.task-source`：

- `local:schedule-evidence:horae-task-type`
- `local:schedule-evidence:szdata-schedule-detail`
- `local:schedule-evidence:hive-task-sql`
- `local:schedule-evidence:run-script-sql`

多源合并时逗号拼接，和现网 `sqlFiles[].evidenceProvider` 一样。

### 3.1 sparkIndex（缓存 3915 / 已落 1058）

现成参照：`collect-one-task-input-pack-sparkindex.ts`。离线时只走 HIT，MISS
不刷新。

```text
主：szdata-schedule-detail
    taskName / topicName / taskType=64
    targetTable → target
    insertMode  → writeMode
    prepareSql / querySql / createSql / truncateSql / finishSql
辅：horae-task-type
    querySql、name、topic、cycle、status
合并：schedule-detail 有值用主，缺槽用 Horae
```

`100931` 已证明：schedule-detail 有 `targetTable`、`insertMode=overwrite`、
`prepareSql`+`querySql`；Horae 只有 `querySql`。现网 `create.sql` 来自 sql-mcp，
内容等于 `prepareSql` 开头那条 `CREATE TABLE`。缓存没有单独 `createSql` 时，
离线把这条 CREATE 抄进 `create` 槽，**完整 `prepareSql` 仍留在 `prepare`**
（官方也是 create 与 prepare 里各有一份 CREATE）。

FROM/JOIN 读表仍按 §4 解析。jsonl 没有 CREATE TABLE 的读表会 PARTIAL，
不能从 ALTER/RENAME 编造 `ddl.sql`。

### 3.2 hiveTask / hiveTask-2.0（缓存 4931 / 已落约 413）

Horae 几乎没有 SQL（2567 条里只有 1 条带 SQL）。SQL 在 `hive-task.sql`。

```text
身份：horae-task-type + szdata-schedule-detail
      taskName、topic、database、cycle、status、scriptPath
SQL ：hive-task.sql
      -- createSql → sql.create
      -- querySql  → sql.query
      若 `-- createSql` 一块里同时有 CREATE 和 INSERT OVERWRITE/INTO，
      拆成两个槽（与现网 create.sql / query.sql 一致）；中间 SET 丢弃
target：
      1. schedule-detail.targetTable（若有）
      2. 否则 SQL 精确写目标（INSERT/CTAS），无库名时用任务名 schema
         或 hive-task.sql 头的 hiveDb 限定
      3. 都没有则省略 target，不从中文任务名猜

落盘校验要求 `SQL_EXACT_TABLE_TARGET` 必须带
`sql-mcp:explicit-table-target` + `opencli:szdata.table`。缓存路径不能伪造
这两条，所以 hiveTask 的物理 target 对象会写出来，但 **不写**
`targetEvidenceKind: SQL_EXACT_TABLE_TARGET`。
```

`hive-task.sql` 头必须能被现有 `readHiveTaskSqlCache` 读成 HIT，
`sqlStatus=UNAVAILABLE` 时省略 SQL 槽。

### 3.3 runScript / runScript-2.0 / sparkScript（SQL 来自 Horae log）

```text
身份：horae-task-type + schedule-detail
SQL ：horae log → 抽「待执行sql为[…]」→ run-script.sql → sql.query
      source=HORAE_LOG
target：只认 SQL 精确写目标；没有就不写
```

`sparkScript` 与 `runScript*` 同一条证据链（`fill-run-script-sql-cache` /
`assembleRunScript`），不是 schedule-detail SQL 槽。没有 `run-script.sql` 时
标 `PARTIAL` 或不写完整 SQL，不回退 OpenCLI。

### 3.4 `*2hive` 同步（oracle2hive / mysql2hive / postgre2hive / mongo2hive / oceanbase2hive）

Horae `querySql` 覆盖几乎全集。关键在 `syncInfo`，不是 task-source。

以 `62190` mysql2hive 为例，缓存已有现网 Pack 的全部直接字段：

| Task Pack 字段                | 缓存位置                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| `taskCategory`                | `horae.taskType=mysql2hive`                                  |
| `taskType`                    | schedule-detail `19` 或字典反查                              |
| `taskName`                    | schedule-detail.taskName / Horae.name                        |
| `topicName`                   | Horae.topic / schedule-detail.topicName                      |
| `source`                      | Horae.source / `syncInfo.sourceServer`（数据源标签，不是表） |
| `target.qualifiedName`        | `syncInfo.targetTable` 或 `hiveDb.hiveTable`                 |
| `partition` / `hivePartition` | `syncInfo.hivePartition`                                     |
| `sql.query`                   | Horae.querySql / `syncInfo.querySql`                         |

`source` 保持数据源标签，不把它当成物理表。物理读表只从 SQL `FROM`/`JOIN`
发现，再用 §4 解析。这与现网 “受控库到 Hive 任务的 source 不是表” 一致。

Hive **目标表 DDL** 常不在原信息 jsonl。`*2hive` AnyLoader 日志里有
`Process hive ddl:` → `CREATE EXTERNAL TABLE`。走日志缓存（与 runScript 同型）：

```text
summaries.jsonl → ONLY_HIVE_TARGET_GAP ∩ *2hive
        │
        ▼
heal-hive-target-ddl（一键：填日志 DDL + from-cache --force）
        │
        ├── fill-hive-ddl-from-log → tasks/<id>/hive-target-ddl.sql
        └── input-pack:from-cache --force → Table Pack
```

推荐（合并多份 summaries，跳过 hiveTask/sparkIndex 等非日志类型）：

```powershell
npm run input-pack:heal-hive-target-ddl -- `
  --data-root sql-static-lineage-data `
  --from-summaries sql-static-lineage-data\tmp\from-cache-full\logs\summaries.jsonl,sql-static-lineage-data\tmp\from-cache-full\logs-oracle2hive-hive-ddl-force\summaries.jsonl `
  --data-date 2026-08-27 `
  --write-ids-dir sql-static-lineage-data\tmp\from-cache-full\partial-analysis `
  --log-dir sql-static-lineage-data\tmp\from-cache-full\logs-heal-hive-ddl
```

先看会处理谁（不打 Horae、不写 Pack）：加 `--dry-run`。  
只要补缓存、不 force：`--skip-force`。缓存已有、只 force：`--skip-fill`。

底层分步（仍可用）：

```powershell
npm run input-pack:fill-hive-ddl-from-log -- `
  --from-summaries sql-static-lineage-data\tmp\from-cache-full\logs-oracle2hive-refresh\summaries.jsonl `
  --bucket ONLY_HIVE_TARGET_GAP `
  --write-ids-dir sql-static-lineage-data\tmp\from-cache-full\partial-analysis `
  --data-date 2026-08-27
```

### 3.5 `hive2*` 同步（hive2oracle / hive2mysql / hive2starrocks / hive2postgre / hive2oceanbase）

Horae **通常没有 querySql**。身份和端点在 `syncInfo` + schedule-detail。

以 `180065` hive2oracle 对照：

| 现网 Pack                                        | 缓存能否复原                                                   |
| ------------------------------------------------ | -------------------------------------------------------------- |
| source `dm_otc_n.trd_sso_exch_scr_mtch_day`      | 能。`syncInfo.hiveDb` + `hiveTable`                            |
| target `TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT` | 能。`syncInfo.targetTable` 与 schedule-detail.targetTable 一致 |
| writeMode `append`                               | 能。`syncInfo.loadMode` / schedule-detail.insertMode           |
| hivePartition                                    | 能。`syncInfo.hivePartition`                                   |
| `sql.truncate`                                   | 能。schedule-detail.truncateSql                                |
| `sql.query`（sql-mcp 抽数 SQL）                  | **不能。** 缓存没有这条 SELECT                                 |

因此 `hive2*` 的缓存路径：

1. 必须写出身份 + 两端点 + 已有 SQL 槽（常见只有 truncate/prepare）。
2. 缺 query 时 `collectionStatus=PARTIAL`，`sqlCollectionStatus=PARTIAL`。
3. **不要**用 Horae relation 上游任务名冒充 query，也不要现场打 task-source。
4. 已有合法 Pack 且 SQL 更完整时，默认跳过，不覆盖。

### 3.6 非加工类

`checkdbflag` / `checkHdfsFlag` / `alert` / `checkAlert` / `exeSql` /
`qualityTask` / `hiveEmail` / `file2hive` / `hive2file`：

- 有 SQL 才落 Task Pack（qualityTask 的 Horae SQL、exeSql 若后续补了缓存）。
- 无 SQL 记 `SKIPPED/NO_SQL_SLOT`，不进主根，也不当失败。

---

## 4. Table Pack：`原信息` jsonl 目录

`E:\02_area\股衍数据-数据cookbook\数综基础信息\原信息` 是离线 Table 的主证据，
不是任务身份。只认恢复后的 **jsonl**（字节与导出一致）。xlsx / zip / csv /
sqlite / `_partial*` 是还原中间件，接入层不读。

### 4.1 四份正式目录

| 角色       | 路径                                                | 行数                                                            | 报告               | 主键                                          | 给 Table Pack 什么                                                                 |
| ---------- | --------------------------------------------------- | --------------------------------------------------------------- | ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Hive 身份  | `hive元信息-20260831快照/hive_table_restored.jsonl` | 211922，全部 `datasource=gfhive`；ACTIVE 150098 / DELETED 61824 | 无完整 report      | 查询键 `lower(db.table)`                      | `qualifiedName` / `dataSource=gfhive` / `status` / `objectType=hive_table`；不写快照 guid |
| Hive DDL   | `20260830211426ddl/hive_table_ddl_restored.jsonl`   | 142409                                                          | SUCCESS            | 查询键：去掉 `@gfhive:时间戳` 后的 `db.table` | `querytext` → `ddl.sql`；可单独落盘                                                |
| RDBMS 身份 | `RDBMS核心信息/gf_rdbms_table_core_restored.jsonl`  | 1223553                                                         | INCOMPLETE，缺 114 | 查询键 `db.table@dataSource`                  | 拆 `@` 后的 qn+ds / `comment`；不写 jsonl guid                                      |
| RDBMS DDL  | `关系ddl-实际/gf_rdbms_table_ddl_restored.jsonl`    | 1202531                                                         | INCOMPLETE，缺 92  | 查询键同上                                    | `ddl` → `ddl.sql`（禁止 strip）                                                    |

Hive 现网 collector 已经在读第一份（`DEFAULT_HIVE_METADATA_SNAPSHOT_PATH`），
但只当“表存在”门闩，**还没接 DDL jsonl**。`180065` 的 Oracle 目标
`TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb` 在核心和
DDL 里都有，guid 与已落 `table.json` 的 `5a571b33-…` 一致。

`type_name` 在 RDBMS 里全是 `gf_rdbms_table`。现网 `tablePlatform()` 会丢掉
`gf_rdbms`，平台必须从 **dataSource 前缀** 映射，不能从 `type_name` 猜：

| dataSource 前缀        | platform    |
| ---------------------- | ----------- |
| `gforacle_`            | `oracle`    |
| `gfmysql_`             | `mysql`     |
| `gfpostgre_` / `gfpg_` | `postgre`   |
| `gfstarrocks_`         | `starrocks` |
| 含 `oceanbase`         | `oceanbase` |
| 含 `tidb`              | `tidb`      |
| `gfgoldendb_`          | `goldendb`  |
| `gfsqlserver_`         | `sqlserver` |

对不上前缀 → 不写 Table。核心里还有少量 `gfclickhouse_*` / `gfdolphindb_*`，
现 Writer 没有对应 platform token，保持缺口。

### 4.2 解析顺序

原路径每个候选打 `table-search` + `table-ddl`。离线按优先级，**命中即停**：

```text
表候选（直接端点 ∪ SQL READ ∪ SQL 精确写目标）
        │
        ▼
① 已有 tables/<platform>/<qn>__<ds>/
   唯一命中 → 复用
        │
        ▼
② Hive 候选（ds=gfhive，或名字像 db.table）
   按 lower(db.table) 查 Hive DDL.jsonl（去掉 @gfhive 与时间戳）
        ├─ DDL HIT（可无元数据、可无 guid）
        │    → table.json + ddl.sql=querytext
        │           有元数据：evidenceProvider=local:hive-metadata-snapshot,local:hive-ddl-jsonl
        │           仅 DDL：evidenceProvider=local:hive-ddl-jsonl
        ├─ DDL MISS + 元数据唯一 ACTIVE + 任务 SQL 有唯一 CREATE
        │    → ddl.sql=CREATE
        │           evidenceProvider=input-pack:task-sql-create
        └─ 都没有 → PARTIAL
        │
        ▼
③ RDBMS 候选
   按 lower(db.table@dataSource) 查核心，再查关系 DDL
        ├─ 两份都 HIT → 完整 Table Pack
        │           evidenceProvider=local:rdbms-core-jsonl,local:rdbms-ddl-jsonl
        └─ 核心或 DDL 缺 / 同名不同内容 → PARTIAL
           不打 table-ddl，不用任务 CREATE 冒充 Oracle/MySQL DDL
```

### 4.3 拼接规则

- 身份键是规范化表名，**不是 guid**。jsonl / 快照 guid 不写入 `table.json`；已有正式 Pack 复用时才保留其 guid。
- Hive：`lower(db.table)`。DDL `qualifiedname` 的 `@gfhive:时间戳` 先剥掉再匹配。
  同名且 `querytext` / `querytext_md5` 相同 → 合成一条；内容不同才 AMBIGUOUS。
- gfhive 行内容相同可直接加。Hive 只有唯一 DDL 也可以落 Table Pack。
- 元数据与 DDL 的 guid 可以不一致，只要表名对上。
- RDBMS：`db.table@dataSource`（以及裸 `db.table`）。核心和 DDL 都要有。
- RDBMS 核心/DDL 报告是 INCOMPLETE：缺行就是 MISS，不把空洞解释成“表不存在”。
- `create.sql` 仍是任务槽；`ddl.sql` 优先用 jsonl 里的当前结构。只有 Hive
  DDL 缺失时，才允许把任务 CREATE 字节写成 `ddl.sql`。
- RDBMS `ddl` / Hive `querytext` 按恢复脚本约定：**不 strip、不换行规范化**。
  Writer 自己的 UTF-8 hash 覆盖落盘字节。
- 受控 dataSource / platform 仍走 `task-endpoints.ts` 校验。
- `objectType`：Hive 用 `hive_table`；RDBMS 用 `gf_rdbms_table`（与已落
  Oracle Pack 一致）。`type=视图类` 仍可落，但要原样留下，供后续判断。

对照：`dm_index_n.index_grp_assm_trust_auth_end_date` 在 Hive 元数据里有
guid `0c376750-…`，**不在** Hive DDL jsonl。已有 Table Pack 走 ①；新表则
要靠任务 CREATE 兜底。`180065` 的 Oracle 目标走 ③ 即可离线复现。

---

## 5. 单任务离线算法

对缓存目录里的每个 `taskId`：

```text
1. 读 horae-task-type、szdata-schedule-detail。
   两者都 INVALID/MISS → EXCLUDED/HORAE_TASK_NOT_FOUND，挪到 .not-found-tasks。

2. 分类
   cycle ∈ {手工,手动,manual} 或 status ∈ {F,冻结} → 归档 .manual-tasks。
   不进主根。

3. 已有 tasks/<category>/<id>/task.json
   结构+SQL hash 合法 → SKIPPED（与 canSkipSuccessfulTask 相同）。
   --force 才重写。
   旧 category 残留 → 报 staleLegacyTaskDirectories，不自动删。

4. 按 §3 组装 TaskEvidence。
   无 taskCategory 且无任一 SQL 槽 → FAILED，不落盘。

5. 抽表候选，按 §4 解析。
   已解析的 TableEvidence[] 交给 materializeTaskAndTablePacks。

6. 物理表缺口
   原路径会把 PHYSICAL_TABLE_NOT_FOUND 挪出主根。
   缓存路径：Hive DDL/元数据对不上、或 RDBMS 核心/DDL 表名对不上 → PARTIAL，
   **先留在主根**。原因：缺口来自离线目录不全（RDBMS 两份都是 INCOMPLETE），
   不是平台确认表不存在。
   只有原在线采集明确记过 PHYSICAL_TABLE_NOT_FOUND 的，才维持归档。

7. 状态文件
   仍写 data-root 外的 <data-root>.input-pack-status.json。
   每条多记 cacheArtifacts: [HIT 的文件名]。
```

批次：从缓存列 ID，不从调用方手写 1 万个 `--task-ids`。单批仍 ≤ 1000，
或按类型切片（先 sparkIndex / _2hive / hiveTask / runScript / hive2_）。

---

## 6. 字段映射（TaskEvidence）

| TaskEvidence                      | 取值顺序（有值即停）                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskId`                          | 目录名，必须等于两个 detail 的 id                                                                                                                               |
| `taskCategory`                    | Horae.taskType → 字典名；否则 schedule-detail.taskType 码映射                                                                                                   |
| `taskType`                        | schedule-detail.taskType（数字码）否则 Horae 名称                                                                                                               |
| `taskName`                        | schedule-detail.taskName → Horae.name                                                                                                                           |
| `topicName`                       | schedule-detail.topicName → Horae.topic                                                                                                                         |
| `scheduleCycle`                   | Horae.cycle → schedule-detail.cycle                                                                                                                             |
| `scheduleStatus`                  | schedule-detail.status → Horae.status                                                                                                                           |
| `source`                          | 直接对象优先；否则 Horae.source / syncInfo.sourceServer；`*2hive` 保持标签                                                                                      |
| `target`                          | schedule-detail.targetTable → syncInfo.targetTable → hiveDb.hiveTable                                                                                           |
| `writeMode`                       | schedule-detail.insertMode → syncInfo.loadMode                                                                                                                  |
| `schedulerEvidence.hivePartition` | syncInfo.hivePartition → Horae.hivePartition                                                                                                                    |
| `sql.create`                      | hive-task.createSql → schedule-detail.createSql → Horae.createSql                                                                                               |
| `sql.query`                       | 类型主源（§3）→ schedule-detail.querySql → Horae.querySql                                                                                                       |
| `sql.prepare/truncate/finish`     | schedule-detail 对应槽 → Horae 对应槽                                                                                                                           |
| `partition`                       | 现有 `buildCompactTaskPartition`，输入换成上面这些证据                                                                                                          |
| `targetEvidenceKind`              | 有直接 target 文本 → `DIRECT_PLATFORM_TARGET`；仅 SQL 写目标 → `SQL_EXACT_TABLE_TARGET`；**不再**标 `TABLE_TASK_RELATION_DIRECTION_UNKNOWN`（缓存没有任务关系） |

空串、`-`、缺槽：省略，不写 `null`（与现 Writer 一致）。

---

## 7. 明确不做

- 不把 `horae-relation` 当表或 SQL。
- 不把任务名、topic、上游任务名当成 qualifiedName。
- 不把 Hive 元数据行单独写成 `ddl.sql`（没有 `querytext` / `ddl` 就不写）。
- 不读 `原信息` 里的 xlsx / zip / csv / sqlite / `_partial*`。
- 不在本路径调用 `task-source` / `table-ddl` / `horae detail` 补洞。
- 不覆盖一个 SQL 更完整的已有 SUCCESS Pack。
- 不把分析层的 inputs/outputs/tableRef/血缘写入 Pack。

---

## 8. 建议落地顺序

1. **离线入口**：遍历缓存 ID，只读 HIT，调用现有 writer。
2. **sparkIndex**：逻辑已在专用 collector 里，关掉 MISS 刷新即可批量补约 2800 个。
3. **Table 目录索引**：按表名建 Hive DDL / RDBMS 核心 / RDBMS DDL 的
   只读偏移索引（不要每次扫 1.8GB）。Hive 可只靠 DDL 落盘。
4. **`*2hive`**：Horae `querySql` + `syncInfo`；Hive 目标用元数据⊕DDL。
5. **hiveTask\***：接上已有 4565 份 `hive-task.sql`。
6. **runScript\***：接上 746 份 `run-script.sql`，目前 Pack 为 0。
7. **`hive2*`**：端点用 `syncInfo`；Oracle/MySQL 目标用 RDBMS jsonl 落
   Table；query 槽仍可能 PARTIAL。已有完整 Pack 跳过。

第 2 步不需要新契约。第 3 步是 Table 离线路径的前置。第 4–6 步接
`TaskEvidence`。第 7 步不要为了补 query 重新打开在线采集。

## 9. PARTIAL 修复入口（2026-09-03）

上一节描述的是默认离线组装路径；本节是针对已有 PARTIAL 的显式、可审计修复入口。它不会改变默认 `input-pack:from-cache` 的证据边界，也不会把 relation cache 当成表或 SQL。

### 9.1 盘点与修复命令

```powershell
# 先生成稳定 inventory；相关 cache writer 活跃时不会发布最终结论
npm run input-pack:partial-inventory -- `
  --data-root sql-static-lineage-data `
  --cache-root sql-static-lineage-cache `
  --output sql-static-lineage-data\tmp\from-cache-partial-repair\final-inventory.json

# 默认只读本地 cache/catalog；缺表证据时不访问在线接口
npm run input-pack:repair-partials -- `
  --data-root sql-static-lineage-data `
  --cache-root sql-static-lineage-cache `
  --inventory sql-static-lineage-data\tmp\from-cache-partial-repair\final-inventory.json `
  --manifest sql-static-lineage-data\tmp\from-cache-partial-repair\local-table-repair-manifest.jsonl

# 只有明确允许 backup 时才启用在线 table adapter；每次应使用有界 task-id workset
npm run input-pack:repair-partials -- `
  --data-root sql-static-lineage-data `
  --cache-root sql-static-lineage-cache `
  --task-ids-file sql-static-lineage-data\tmp\from-cache-partial-repair\online-hive2-table-ids.txt `
  --allow-online-backup `
  --manifest sql-static-lineage-data\tmp\from-cache-partial-repair\online-hive2-table-manifest.jsonl
```

repair runner 每次只处理一个有界 workset；成功写入的 evidence 才会进入正式 Table Pack，并由调用方把 changed task IDs 交给 `input-pack:from-cache --force`。manifest 是证据审计，不是把失败任务改成成功的替代品。

### 9.2 重试、datasource 与失败语义

- `fill-hive-task-sql-cache`、`fill-run-script-sql-cache`、`fill-hive-ddl-from-log` 的 `--force` 只重试已经存在且 `UNAVAILABLE` 的缓存；AVAILABLE 内容和 provider 保留不动。
- `hiveTask` / `hiveTask-2.0`：本地代码优先；若 SQL 仍含结构性 `${…}`（如 `${DB_TEMP}`，不含 `data_day*` 等日期变量），再试 MCP（`szdata task-sql`）——只要返回非空 SQL 即写入 `SQL_MCP`；MCP 为空则拉 Horae log 的 `hive -e` 展开体写入 `HORAE_LOG`。
- `runScript` / `sparkScript` 的 SQL 只能来自 Horae log 中可定位的实例。实例缺失时记录 `HORAE_LOG_INSTANCE_MISSING`，不回退到不等价的 schedule SQL。
- Table resolution 先用已有 Pack，再用 Hive/RDBMS 本地 jsonl；在线 fallback 必须 exact-match qualified name、platform、dataSource，并且只能有一个可对账候选。多个 GUID、多个 datasource、404/not found、403、429、timeout、malformed response 都不写 evidence。
- Horae datasource 映射只作为 endpoint hint。映射冲突时保留未知；唯一 hint 也不能覆盖 SQL/目录的多实例冲突。`*2hive` 的 source 标签不转成物理表，hive2* 的 target server hint 只在 SQL 精确写目标与 datasource 同时成立时使用。Oracle / Postgre / OceanBase 用 `gf*_${service}#${service}`；MySQL / StarRocks / GoldenDB 用无 `#` 的 `gf*_${service}`，并在 core 中按 exact → 唯一前缀 → 唯一家族行消歧。
- **多实例消歧通用约定（区分不出唯一物理库时）**：
  1. 先在已有 SUCCESS `tables/` Pack 上按 atlas `dataSource` **计数**（同一逻辑服务族，如 `#jgjdb` / `#winddb`）。
  2. **选出现次数最多的实例**作为 preferred atlas 常量写入代码（并在文档点名）；并列多数或样本过少则不要猜，保持 `RDBMS_CORE_AMBIGUOUS`。
  3. 这是显式产品选择，不是 MCP/`table-search` 的唯一证明；以后若要以别的实例为准，改常量并 force 受影响任务。
- **已落地的特殊 prefer**（均遵循上款统计→多数）：
  1. **万得 / UIP `winddb`**：tag 为 `oracle_wande_*` / `oracle_uip_winddb*`（或 host `10.2.89.132`）→ `gforacle_oracle_uip_winddb#winddb`（`ORACLE_UIP_WINDDB_ATLAS_DATASOURCE`）。
  2. **金管家 `jgjdb`（2026-09-04）**：Horae Oracle service=`jgjdb` 时，服务形态是 `gforacle_jgjdb#jgjdb`，core 常有 `jgjdb1`/`jgjdb2`/uat。统计当时 SUCCESS Pack：`gforacle_jgjdb1#jgjdb`=191、`jgjdb2`=0 → preferred 固定 **`gforacle_jgjdb1#jgjdb`**（`ORACLE_JGJDB_PREFERRED_ATLAS_DATASOURCE`）。
- 任务 SQL 的 query fallback 只能从同任务的 `hive-task.sql` query 槽补 specialized route 的空 query；create 槽永远不提升为 Table Pack 的 `ddl.sql`。

### 9.3 本轮执行结果

2026-09-03 的稳定基线为 `SUCCESS 5472 / PARTIAL 5938 / FAILED 238`，最终稳定 inventory 为 `SUCCESS 5615 / PARTIAL 5795 / FAILED 238`。实际可复用的证据已经重跑并落盘；失败和未知仍保留原 warning 及 manifest failure class。详见 [`input-pack-from-cache-partial-analysis.md`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/docs/input-pack-from-cache-partial-analysis.md) §10，以及最终 inventory：

`E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data\tmp\from-cache-partial-repair\final-inventory.json`

默认离线入口仍不因为这套修复 runner 而自动访问在线接口；要做 online backup，必须显式传 `--allow-online-backup` 并保存逐条 manifest。
