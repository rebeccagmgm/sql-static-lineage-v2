## Purpose

本能力定义任务加工材料和物理表当前结构的统一外部落盘契约，使无大模型跑批能够取得可校验的最新原始输入，同时不把静态分析结果混入基础数据层。

## ADDED Requirements

### Requirement: 数据根目录必须只包含 Task 和 Table 资产

系统 MUST 在独立、Git 外的数据根目录中，将 Task 保存到 `tasks/<task-category>/<taskId>`，将 Table 保存到 `tables/<platform>/<stable-table-id>`。Task 目录 MUST 包含 `task.json` 和实际存在时的 `sql/<slot>.sql`；Table 目录 MUST 包含 `table.json` 和 `ddl.sql`。系统 MUST 直接维护一份最新状态，不能要求 Snapshot、CAS、历史版本、latest 指针或根 Manifest。若 SzData 明确返回 SQL unavailable，系统 MAY 通过现有只读 Horae detail 入口按槽位补取，等待上限为 5 秒；超时或无 SQL 时必须报告该状态并保留 unavailable 事实，不得生成空 SQL 文件或伪造 SQL。

#### Scenario: 只创建实际 SQL 槽位

- **WHEN** 平台只为某任务提供 query 和 truncate 槽位
- **THEN** Task 目录必须只创建 `sql/query.sql` 和 `sql/truncate.sql`，不能创建其他空 SQL 文件

#### Scenario: 多任务复用同一 Table

- **WHEN** 多个任务涉及同一个 stableTableId
- **THEN** 数据根目录必须只保存一份该 Table 的 `table.json` 和 `ddl.sql`

#### Scenario: 显式修复旧平台目录

- **WHEN** 既有数据根包含由展示型平台值产生的 malformed `tables/` 子目录，且用户显式开启修复选项
- **THEN** 系统 MUST 将这些目录移动到数据根同级的可回滚 quarantine 目录后继续使用原数据根；不得静默删除，也不得在未开启修复选项时改写既有目录

### Requirement: Task 必须只保存平台任务配置和原始加工材料

`task.json` MUST 使用同一字段契约保存版本、taskId、平台任务分类 taskCategory、平台直接取得的 taskType、taskName（调度/任务名称，如有）、topicName（如有）、source、target、targetEvidenceKind（如 target 来自无方向 Table 任务关联或明确 SQL 目标）、端点可确认时的独立 dataSource、writeMode、目标写入 partition、实际 SQL 文件索引、采集时间和 contentHash。物理 source/target 端点 MUST 使用统一的 `{ platform, qualifiedName, dataSource }` 形状；非表值可以保持平台原始值，不能伪造 qualifiedName。不同 task type 只能改变 taskCategory 和平台直接返回值，不能改变字段契约。taskCategory MUST 来自平台任务类型码的受控映射或平台直接返回的类型名称，不能由 SQL 文本推导。taskName、topicName、source、target、端点 dataSource、writeMode 和 partition MUST 只使用平台直接证据、受控平台规则、直接匹配的 Table 证据，或经过唯一 Table 校验的结构化 SQL 目标证据，不能由 Analyzer、任务名称或普通 SQL 文本推导补造。`targetEvidenceKind=TABLE_TASK_RELATION_DIRECTION_UNKNOWN` MUST 只表示 Table 关联，不能表示平台已证明写入方向；`targetEvidenceKind=SQL_EXACT_TABLE_TARGET` MUST 只表示 SQL 中明确的 DDL/写入目标已被唯一 Table/DDL 证据校验，不得由任务名称单独产生；直接平台 target 使用 `DIRECT_PLATFORM_TARGET`。SQL 文件名 MUST 遵循平台原始槽位，内容 MUST 保持平台原文。

#### Scenario: 各任务类型使用统一端点数据源规则

- **WHEN** 任务类型为 `sparkIndex`、`hiveTask-2.0`、`mysql2hive` 或 `hive2oracle`
- **THEN** 系统 MUST 对 source/target 使用同一端点结构；`sparkIndex` 和 `hiveTask-2.0` 的物理端点数据源为 `gfhive`，`mysql2hive` 的 target 和 `hive2oracle` 的 source 数据源为 `gfhive`，另一端必须使用平台或直接 Table 证据

#### Scenario: 端点数据源与 Table 证据冲突

- **WHEN** 任务端点的受控数据源与直接取得的 Table `dataSource` 不一致
- **THEN** 系统 MUST 保留冲突状态并将该端点视为 unavailable，不能覆盖 Table 的数据源或静默绑定

#### Scenario: 保留平台原始 writeMode 与 SQL 槽位

- **WHEN** 平台 writeMode 为 `truncate`，且 truncate 槽位内容是 `DELETE FROM ...`
- **THEN** `task.json.writeMode` 必须仍为 `truncate`，文件必须命名为 `sql/truncate.sql`，不能改写为 `overwrite` 或 `delete.sql`

#### Scenario: 目标写入分区

- **WHEN** 平台明确返回目标写入分区 `busi_date=${busi_date}` 和 `grp_id=01`
- **THEN** `task.json.partition` 必须保存为对应的紧凑键值对象

#### Scenario: 多组目标写入分区

- **WHEN** 同一任务的 SQL 分支分别完整写入 `grp_id=01` 和 `grp_id=02`，且目标表分区字段为 `grp_id,busi_date`
- **THEN** `task.json.partition` MUST 保存为两个紧凑键值对象组成的数组，并保持每个 `grp_id` 与其余分区字段的配对关系

#### Scenario: 时间粒度分区模板

- **WHEN** `sparkIndex` 目标表的分区字段为 `busi_mon`，SQL 只能证明该字段来自运行时月份参数或其 SQL 可证明的相对月份表达式
- **THEN** 系统 MUST 按 SQL 形态保存 `${YYYYMM}`、`${YYYY-MM}` 或带相对月份偏移的模板；不能因为字段不是 `busi_date` 就直接省略，同时不能为非时间分区字段生成默认值

#### Scenario: 动态分区范围通配符

- **WHEN** SQL 写入类任务已确认目标表及其分区字段和目标写入，但 SQL 不能枚举某个动态分区字段的具体写入值
- **THEN** 系统 MUST 在该字段保存 `*` 表示动态写入范围；`*` 不得解释为具体分区值，目标表或目标分区字段证据不可用时仍 MUST 省略整个 `partition`

#### Scenario: 读取条件不是目标分区

- **WHEN** SQL 只包含 `WHERE busi_date='${yyyy-MM-dd}'`，或者平台字段表示源 Hive 读取分区
- **THEN** 系统不能把该条件写入 `task.json.partition`

#### Scenario: 原始 SQL 明确声明目标写入分区

- **WHEN** 原始 query 槽位明确包含 `INSERT OVERWRITE TABLE ... PARTITION(busi_date='2026-05-24', grp_id='01')`
- **THEN** `task.json.partition` MUST 保存这组目标写入键值；系统只能读取目标 INSERT 的静态分区赋值，不能把 `WHERE`、窗口函数 `PARTITION BY`、`SELECT *` 的同名过滤条件或源表读取分区写入该字段

#### Scenario: 不保存分析结果

- **WHEN** SQL 静态分析能够推导输入表、输出表、临时表、字段血缘或加工关系
- **THEN** `task.json` 不能保存 inputs、outputs、tableRef、statement role、字段血缘或加工关系

#### Scenario: 任务类型使用统一元数据字段

- **WHEN** 不同 task type 的平台响应分别提供任务名称、主题名称或其中一部分
- **THEN** 所有 Task MUST 使用同一 `task.json` 字段契约；已直接取得的 `taskName`、`topicName` MUST 保存，未取得字段遵循缺失/null/有值三态，不能因 task type 改变字段命名或静默丢弃

#### Scenario: 仅有名称但有直接 Table 任务关联

- **WHEN** 任务没有 direct source/target，但以任务名称作为有界查询候选取得的 `szdata table` 直接响应明确列出该 taskId，且当前 DDL 可取得
- **THEN** 系统 MUST 保存该 Table，并将规范化 Table 身份写入 `task.json.target`，同时写入 `targetEvidenceKind=TABLE_TASK_RELATION_DIRECTION_UNKNOWN`；该字段只表示物理 Table 关联，不表示平台已证明写入方向。不能仅凭任务名称或 SQL 文本创建候选对象；Table 任务关联必须保留为 Table 证据提供方

#### Scenario: 仅有明确 SQL 目标但没有 Table 任务关联

- **WHEN** 任务没有 direct source/target，且 `szdata table` 的任务关联不包含该 taskId，但原始 `INSERT INTO/OVERWRITE TABLE`、`CREATE TABLE` 或 `TRUNCATE TABLE` 子句声明了唯一目标；对于未带库名的 SQL 目标，任务名只用于提供库名且其表名去除受控任务后缀后必须与 SQL 表名大小写不敏感一致；随后 `szdata table` 与当前 `ddl.sql` 能唯一确认同一物理 Table
- **THEN** 系统 MUST 保存该 Table，并将规范化 Table 身份写入 `task.json.target`，同时写入 `targetEvidenceKind=SQL_EXACT_TABLE_TARGET`，并在 `evidenceProvider` 中同时保留 SQL 目标证据和 Table/DDL 校验证据。普通 `FROM`、`JOIN`、注释、任务名称或描述不能触发该回退；目标多于一个、无法补全库名、Table 不唯一或 DDL 不可取得时必须保持 unavailable/partial

`SQL_EXACT_TABLE_TARGET` 只表示原始 SQL 在 `create`、`query`、`prepare`、`truncate` 或 `finish` 槽位中明确声明了结构化 DDL/写入操作目标，且该目标已被当前 Table/DDL 唯一校验。它不表示平台调度配置中的 target、不表示实际运行成功，也不表示数据或业务正确；解析时的操作类型和 SQL 槽位不得作为 `statement role` 或加工关系写入落盘层。

### Requirement: create.sql 与 ddl.sql 必须保持不同事实角色

`tasks/<task-category>/<taskId>/sql/create.sql` MUST 只保存任务平台提供的原始 CREATE 槽位；`tables/<platform>/<stable-table-id>/ddl.sql` MUST 只保存元数据系统或受控表结构来源取得的当前物理对象定义。两者不能互相生成、覆盖或替代。

#### Scenario: 任务没有 CREATE 但表有 DDL

- **WHEN** 任务 SQL 没有 create 槽位，但目标物理表 DDL 可独立取得
- **THEN** 系统不能创建 `create.sql`，但必须允许对应 Table 保存 `ddl.sql`

#### Scenario: CREATE 与当前 DDL 同时存在

- **WHEN** 任务提供 create 槽位且物理表当前 DDL 也可取得
- **THEN** 系统必须分别保存 `create.sql` 和 `ddl.sql`，并分别计算 Hash

### Requirement: Table 必须保存唯一物理身份和当前结构

`table.json` MUST 保存版本、stableTableId、platform、可选 GUID、dataSource、qualifiedName、schema、name、可选平台 `description`、对象类型、可选 status、可选 primaryKey、物理 partitionFields、DDL 文件索引、采集时间和 contentHash。`description` MUST 只作为展示元数据保存，不能参与 stableTableId、qualifiedName 或物理匹配。`qualifiedName` MUST 只表示数据库对象内部完整名，不能包含 `@gfhive` 等数据源后缀；dataSource MUST 单独保存。无法取得稳定数据源标识时，系统 MUST 使用保留值 `default`，该值只表示未知，不得解释为真实数据源。

#### Scenario: 保存平台直接返回的 Table 展示描述

- **WHEN** 元数据直接返回 Table `description`，例如中文表名
- **THEN** `table.json.description` MUST 原样保存；该字段不能改变目录名、stableTableId 或 qualifiedName

#### Scenario: 可读身份作为 stableTableId

- **WHEN** 元数据平台提供物理表 GUID
- **THEN** GUID 必须保存在 `table.json.guid`，但 stableTableId 和目录名必须使用 `<qualifiedName>__<dataSource>`，且该值必须是安全的单一目录段

#### Scenario: 不同数据源同名表保持不同目录

- **WHEN** 两个物理表的 qualifiedName 相同但稳定 dataSource 不同
- **THEN** 两个 Table 目录必须使用不同的 `<qualifiedName>__<dataSource>` stableTableId

#### Scenario: Table 保存直接取得的主键

- **WHEN** DDL/元数据直接返回主键字段 `(TRADE_DATE, TE_REPORT_ID)`
- **THEN** `table.json.primaryKey` 必须按平台返回顺序保存该字段数组，不能从 SQL 查询表达式推导

#### Scenario: 物理分区属于 Table

- **WHEN** DDL 或元数据明确表的物理分区字段为 `busi_date`
- **THEN** `table.json.partitionFields` 必须包含 `busi_date`，且该字段不能被复制成 Task 的目标写入 partition

#### Scenario: 平台目录只使用标准 token

- **WHEN** 元数据返回 `hive / Hive内部表` 或 `oracle / 物理表` 这类平台与展示类型的组合文本
- **THEN** collector MUST 提取标准平台 token `hive` 或 `oracle`；writer 遇到包含路径分隔符、空白或中文展示名的平台值 MUST 失败，不能创建嵌套目录

#### Scenario: 保留已删除 Table 的直接状态

- **WHEN** 元数据直接返回 Table 状态 `DELETED`，且仍能取得当前 `table.json` 与 `ddl.sql`
- **THEN** Table MUST 保存 `status: "DELETED"`，覆盖报告 MUST 单独列出该 Table；若 DDL 不可取得，则 MUST 报告 unavailable/deleted，不能宣称任务表覆盖完整

### Requirement: Hash 必须确定且可复算

系统 MUST 使用 SHA-256。JSON MUST 递归按 key 排序、移除非语义空白并编码为 UTF-8 后计算 canonical Hash；contentHash MUST 排除自身和 collectedAt。SQL 与 DDL MUST 对实际落盘的 UTF-8 文件字节计算 Hash，不能先做 SQL 规范化。Task contentHash MUST 覆盖任务配置和 SQL 文件 Hash，Table contentHash MUST 覆盖物理身份、结构元数据和 DDL Hash。

#### Scenario: JSON key 顺序变化

- **WHEN** 两份 JSON 的契约字段和值相同，仅 key 顺序和非语义空白不同
- **THEN** 两份 JSON 的 contentHash 必须相同

#### Scenario: SQL 或 DDL 内容变化

- **WHEN** 实际落盘文件任一 UTF-8 字节发生变化
- **THEN** 对应文件 Hash 必须变化，并导致所属 Task 或 Table contentHash 变化

### Requirement: null 与字段缺失必须有统一语义

所有可选采集字段 MUST 遵循统一三态：字段不存在表示未取得或平台不提供；`null` 表示已确认该值为空或不适用；非空值表示来源系统明确取得。系统不能用 `-`、空字符串、零字节文件或自行生成的默认值代替三态。

#### Scenario: 已确认目标无分区

- **WHEN** 平台或物理结构证据明确目标写入不使用分区
- **THEN** `task.json.partition` 必须为 `null`

#### Scenario: 未取得分区证据

- **WHEN** 采集未能确定目标写入是否使用分区
- **THEN** `task.json` 必须省略 partition 字段，不能写成 `null`、空对象或内部证据树

### Requirement: 更新必须保持上一份有效数据

系统 MUST 在数据根目录内先完成 staging、Schema 校验和 Hash 校验。内容 Hash 未变化时 MUST 不更新；内容变化时 MUST 原子替换对应 Task 或 Table；采集或校验失败时 MUST 保留上一份有效数据。系统不能为了更新 Task 而复制 DDL，也不能为了更新 Table 而复制 SQL。

#### Scenario: 内容未变化

- **WHEN** 新采集的 Task 或 Table contentHash 与当前文件一致
- **THEN** 系统必须保持现有文件不变

#### Scenario: 更新中途失败

- **WHEN** 新内容在写入、Schema 校验或 Hash 校验阶段失败
- **THEN** 当前有效 Task/Table 目录必须仍可完整读取

### Requirement: 落盘层必须保持原始事实边界

落盘层 MUST 只保存平台、代码仓库和元数据系统直接取得的任务配置、原始 SQL/代码材料及物理对象结构。SQL Parser/Analyzer 推导出的输入表、输出表、临时表、tableRef、字段血缘、statement role 和加工关系 MUST 留在分析结果层，不能回写 Task/Table 数据。

#### Scenario: Analyzer 产生新事实

- **WHEN** Analyzer 从已落盘 SQL 和 DDL 生成读写表、字段血缘或加工关系
- **THEN** Analyzer 必须将结果写入自己的事实产物，且 Task/Table 目录内容和 contentHash 必须保持不变

### Requirement: 真实案例必须验证 Task/Table 边界

系统 MUST 使用有界真实形态验证 V1：39045 必须表现为 mysql2hive、一个 query 槽、确认无目标分区，以及可独立取得的 MySQL 源表和 Hive 目标表 DDL；180065 必须表现为 hive2oracle、query 与 truncate 两个槽、Oracle 目标无目标分区，以及源 Hive 表物理 partitionFields 包含 `busi_date`。案例断言必须基于采集证据，不能用任务 ID 硬编码生产逻辑。

#### Scenario: 39045 只保存 query

- **WHEN** 采集任务 39045
- **THEN** Task 目录必须保存 `query.sql`，不能生成 create、prepare、truncate 或 finish 文件，Table 目录必须分别保存已解析物理身份的源表和目标表当前 DDL

#### Scenario: 180065 不混淆源分区和目标分区

- **WHEN** 采集任务 180065
- **THEN** Task 目录必须保存原始 `query.sql` 与 `truncate.sql`，`task.json.partition` 必须为 `null`，源 Hive Table 的 `partitionFields` 必须包含 `busi_date`
