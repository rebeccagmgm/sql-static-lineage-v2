## Purpose

从本地 schedule-evidence 与原信息 jsonl 离线生成与在线采集同一契约的 Task Pack 和 Table Pack，不访问 OpenCLI。

## ADDED Requirements

### Requirement: 离线采集不得调用平台接口

离线采集入口 MUST 只读取本地 schedule-evidence 与原信息 jsonl（或已有 Input Pack）。它 MUST NOT 调用 `szdata task-source`、`table-search`、`table`、`table-ddl`、`horae detail` 或 `horae search`。缓存 MISS 时 MUST 报告缺口并继续，不得现场刷新。

#### Scenario: 缓存命中即可落盘

- **WHEN** 某任务的类型主源缓存 HIT，且 writer 校验通过
- **THEN** 系统 MUST 写出 `tasks/<taskCategory>/<taskId>/`，不得发起 OpenCLI

#### Scenario: 缓存缺失不补采

- **WHEN** 某任务缺少类型所需的 SQL 缓存
- **THEN** 系统 MUST 省略该 SQL 槽或将任务标为 PARTIAL/SKIPPED，不得回退在线采集

### Requirement: 按任务类型从缓存组装 TaskEvidence

系统 MUST 用 `horae-task-type.detail.taskType` 作为 taskCategory；仅当该字段缺失时，才用 schedule-detail 数字码经既有类型字典映射。`evidenceProvider` MUST 记录缓存出处，不得写成 `opencli:szdata.task-source`。

- sparkIndex：schedule-detail 为主，horae-task-type 补缺槽
- hiveTask / hiveTask-2.0：SQL 只来自 `hive-task.sql`
- runScript / runScript-2.0 / sparkScript：SQL 只来自 `run-script.sql` 的 query（Horae log 抽取）
- `*2hive`：query 与 target 来自 Horae `querySql` / `syncInfo`
- `hive2*`：端点来自 `syncInfo` 与 schedule-detail；缺 query 时 MUST 仍写出身份和已有槽位，并标 PARTIAL
- 无 SQL 的非加工类任务 MUST 记 SKIPPED，不得写入空 Task Pack

手工/冻结任务 MUST 归档到 manual-tasks 根。horae-task-type 与 schedule-detail 皆无时 MUST 归档到 not-found 根。`horae-relation` MUST NOT 作为表身份或 SQL。

#### Scenario: mysql2hive 从 syncInfo 还原端点

- **WHEN** Horae detail 含 `syncInfo.targetTable` 与 `querySql`
- **THEN** Task Pack MUST 保存该 query 与 Hive target，source 保持数据源标签

#### Scenario: hive2oracle 缺 query 仍可落身份

- **WHEN** `syncInfo` 给出 Hive source 与 Oracle target，但缓存没有抽数 query
- **THEN** 系统 MUST 写出 task.json 与已有 SQL 槽，`collectionStatus` 为 PARTIAL

#### Scenario: sparkIndex 从 prepareSql 抄出 create

- **WHEN** schedule-detail 有以 `CREATE TABLE` 开头的 `prepareSql`，且没有单独 `createSql`
- **THEN** Task Pack MUST 同时写出 `create` 与 `prepare`；`create` 为该 CREATE 语句，`prepare` 保持原文

#### Scenario: hiveTask 拆开合并在 createSql 里的 INSERT

- **WHEN** `hive-task.sql` 只标了 `-- createSql`，且内容先 CREATE TABLE 再 INSERT OVERWRITE
- **THEN** `create` 槽 MUST 不含 INSERT，`query` 槽 MUST 含 INSERT

### Requirement: Table 从原信息 jsonl 按表名拼接

系统 MUST 只读四份 jsonl：Hive 元数据、Hive DDL、RDBMS 核心、RDBMS DDL。xlsx/csv/sqlite/`_partial*` MUST NOT 作为输入。GUID MUST NOT 作为落盘或拼接的必要条件。jsonl / 快照里的 guid MUST NOT 写入 `table.json`（现网 OpenCLI guid 与快照 guid 不是同一套）；已有正式 Pack 复用时才保留其 guid。Hive 按规范化 `db.table` 匹配，并去掉 `@gfhive` 与时间戳；内容相同的重复行 MUST 合成一条。RDBMS 按 `db.table@dataSource` 匹配。解析顺序 MUST 为：已有 Table Pack → Hive DDL 表名（可无元数据）→ Hive 元数据 + 任务 CREATE → RDBMS 核心+DDL。RDBMS 不得用任务 CREATE 冒充 DDL。platform MUST 由 dataSource 前缀映射；无法映射则不写 Table。jsonl 缺行 MUST 视为 MISS，不得解释为表不存在。`table.json.partitionFields` 为空数组表示已确认无分区；RDBMS 在 DDL 含 `PARTITION BY` 或核心 `ispartitioned` 为真时 MUST NOT 写 `[]`。能从 `PARTITION BY RANGE|LIST|HASH (col)` 解析出的列名 MUST 写入；`PARTITION BY RANGE (null)` 等缺列名导出 MUST 省略该字段，不得编造列名。`description` MUST 取核心 `comment`（或 Hive 对应字段），不得改写 jsonl DDL 原文。

#### Scenario: Oracle 目标用核心加 DDL 落盘

- **WHEN** 候选为 `TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb`，且核心与 DDL 有同一 qualifiedname
- **THEN** 系统 MUST 写出 `tables/oracle/<qn>__<ds>/`，`ddl.sql` 为 jsonl 中的 ddl 原文，且 MUST NOT 写入 jsonl guid

#### Scenario: gfhive 只有 DDL 也可落盘

- **WHEN** Hive DDL 按表名唯一命中（或重复行 querytext 相同），即使没有 guid 或元数据
- **THEN** 系统 MUST 写出 `tables/hive/<qn>__gfhive/`

#### Scenario: Hive PARTITIONED BY 写入 table.partitionFields

- **WHEN** Hive DDL `querytext` 含 `PARTITIONED BY ( busi_date STRING, tag_id STRING )`
- **THEN** `table.json.partitionFields` MUST 为 `["busi_date","tag_id"]`，不得把物理分区字段抄进 `task.json.partition`

#### Scenario: Oracle 可解析 PARTITION BY 写入 partitionFields

- **WHEN** RDBMS DDL 含 `PARTITION BY RANGE ("TRADE_DATE")`（或 LIST/HASH 同类列清单）
- **THEN** `table.json.partitionFields` MUST 为解析出的列名（如 `["TRADE_DATE"]`），`description` MUST 来自核心 `comment`

#### Scenario: Oracle PARTITION BY RANGE (null) 不得写成空数组

- **WHEN** RDBMS 核心 `ispartitioned` 为 true，且 DDL 含 `PARTITION BY RANGE (null)`（导出缺列名），即使后面粘着 `COMMENT ON TABLE`
- **THEN** `table.json` MUST 省略 `partitionFields`，MUST NOT 写 `[]`，MUST NOT 编造列名，MUST NOT 写入 jsonl guid；`description` MUST 仍取核心 `comment`

#### Scenario: Hive ALTER querytext 不得当物理 DDL

- **WHEN** Hive DDL jsonl 仅有 `ALTER TABLE`，且元数据唯一 ACTIVE，任务 SQL 有唯一 CREATE
- **THEN** 系统 MUST 忽略该 ALTER，用任务 CREATE 写 `ddl.sql`，`evidenceProvider` 为 `input-pack:task-sql-create`

#### Scenario: Hive 元数据有、DDL 无

- **WHEN** Hive 元数据唯一 ACTIVE，但该表名不在 Hive DDL jsonl，且任务无唯一 CREATE
- **THEN** 系统 MUST 不写该 Table Pack，任务标 PARTIAL

### Requirement: 已有更完整 Pack 不得被离线路径覆盖

当主根已有结构合法且 SQL hash 闭合的 Task Pack 时，离线采集 MUST 默认跳过。仅 `--force` 可重写。离线路径 MUST NOT 用更少 SQL 槽覆盖已有 SUCCESS Pack。

#### Scenario: 已有完整 hive2oracle Pack 被跳过

- **WHEN** 主根已有含 query 的合法 `hive2oracle/<id>/task.json`，且未指定 `--force`
- **THEN** 系统 MUST 跳过该任务，不得用缺 query 的缓存结果替换
