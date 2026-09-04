## Context

参见 `proposal.md` 的动机。现有 OpenCLI 已能从 Horae、SzData 和代码仓库取得不同任务形态的直接证据；表 DDL 也可通过元数据系统或受控只读数据库入口独立取得。若 SzData 明确返回 SQL unavailable，任务 SQL 可按槽位补读现有 Horae detail，最多等待 5 秒；补读超时或无 SQL 时必须报告并保留 unavailable，不伪造 SQL。设计重点不是再造采集平台，而是固定任务材料与表结构的落盘边界。

## Goals / Non-Goals

**Goals:**

- 用最小目录模型保存每个任务的最新平台配置和原始加工材料。
- 每个物理表只保存一份当前结构，供多个任务复用。
- 让文件内容和 JSON 配置可确定性 Hash、可校验、可原子更新。
- 保留平台原值，不把 SQL 内容重新解释成平台配置。

**Non-Goals:**

- 不保存历史 Snapshot，不支持历史版本回放。
- 不在落盘层生成 inputs、outputs、tableRef、statement role、血缘或字段映射。
- 不把运行成功、业务正确或下游验收写入 Task/Table 数据。
- 不修改 Parser/Analyzer、Machine Facts Publisher 或 Consumer 的语义。

## Decisions

### 1. 数据根目录只分 Task 和 Table

```text
sql-static-lineage-data/
├─ tasks/
│  └─ <task-category>/
│     └─ <taskId>/
│     ├─ task.json
│     └─ sql/
│        ├─ create.sql
│        ├─ query.sql
│        ├─ prepare.sql
│        ├─ truncate.sql
│        └─ finish.sql
└─ tables/
   └─ <platform>/
      └─ <stable-table-id>/
         ├─ table.json
         └─ ddl.sql
```

目录直接表示最新状态。SQL 槽位不存在时不创建空文件。相比 Snapshot/CAS，这一选择降低了读写和运维复杂度；代价是不能重放历史版本。

### 2. Task 只保存平台任务配置和原始加工材料

`task.json` 包含统一的：版本、taskId、平台任务分类 taskCategory、平台原始 taskType、平台直接返回的 taskName/topicName、source/target 配置、端点可确认时的独立 dataSource、平台原始 writeMode、目标写入 partition、实际 SQL 文件索引、采集时间和 contentHash。不同 task type 不改变字段契约；字段没被平台直接返回时保持缺失/null 三态，不能互相猜补。

- `source` 与 `target` 是平台配置事实，不是 Analyzer 生成的读写关系。
- `writeMode` 保存平台原值；即使 `truncate` 槽内容是 `DELETE`，也不改写为 `overwrite`。
- `partition` 只表示目标写入分区。唯一确认一组完整分区字段值时保存紧凑键值对象；同一任务确认多组完整写入分区时保存对象数组，并保持每组字段值的配对关系。对 SQL 能证明为时间粒度的目标分区字段允许使用模板：`busi_date` 为 `${YYYY-MM-DD}`，`busi_mon` 按 SQL 形态为 `${YYYYMM}` 或 `${YYYY-MM}`，并保留可证明的相对月份偏移；目标表、分区字段和目标 SQL 写入已确认但动态值无法枚举时，对应字段保存 `*`，表示动态写入范围而非具体值。目标分区字段或目标身份证据不可用时仍省略整个字段；目标确认无分区时为 `null`。详细的目标、写入、赋值和 reasonCodes 只用于内部判定，不写入 Input Pack。源表读取分区、普通 WHERE 条件以及无法证明输出序号的 `SELECT *` 不进入该字段；没有目标写入证据的源抽取 SQL 不得触发通配符。
- `sqlFiles` 只允许 `create`、`query`、`prepare`、`truncate`、`finish` 等实际槽位。文件名跟随槽位，内容保持平台原文。
- 每个 SQL 文件索引保存相对路径、文件 SHA-256 和直接证据提供方。
- `taskCategory` 使用独立的数综 Horae 类型字典文件进行受控映射，例如 `19 → mysql2hive`、`30 → hive2mysql`、`24 → hive2oracle`、`101 → hiveTask-2.0`；当前来源是 `05_l_lb_task_type_Horae任务类型字典_20260819.xlsx` 的 `type_id/type_desc`（60 条）。已收录编码以字典为准，平台返回的过时 `taskTypeName` 不得覆盖它；仅当编码未收录时才使用平台直接类型名称，仍无名称则保留为 `taskType-<code>`。不从 SQL、source/target 或任务名称猜测。更新字典不改变 `task.json.taskType` 的原始编码。
- 物理 source/target 端点统一使用 `{ platform, qualifiedName, dataSource }`。受控数据源规则为 `sparkIndex → gfhive`、`hiveTask-2.0 → gfhive`、`mysql2hive.target → gfhive`、`hive2oracle.source → gfhive`；其余数据源必须来自平台或直接匹配的 Table 证据，冲突时不能覆盖。
- `taskName` 是平台直接返回的任务/调度名称，`topicName` 是平台直接返回的主题名称；若 task-source 没有直接 source/target，优先使用 `szdata table` 的直接 `tasks` 关系；若该关系没有 taskId，则只对 SQL 中明确的 DDL/写入目标做结构化解析，并用任务名严格提供的库名、唯一 Table 元数据和当前 DDL 复核。关系回退使用 `targetEvidenceKind=TABLE_TASK_RELATION_DIRECTION_UNKNOWN`；SQL 回退使用 `targetEvidenceKind=SQL_EXACT_TABLE_TARGET`。普通 SQL 表名、任务名称本身或描述不能升级为 target；86840 继续走关系证据，163712 可走 SQL 精确目标证据。若类型字典更新导致同一 taskId 仍存在旧 category 目录，采集器不自动删除旧目录，而是在摘要中列出 `staleLegacyTaskDirectories`，要求迁移或隔离后再视为单一最新事实。

### 8. 按 taskId 隔离采集流程

`collect-task-input-pack.ts` 只负责参数解析、旧目录检查、任务顺序调度和全局 OpenCLI 限流；`collect-one-task-input-pack.ts` 负责一个 taskId 的完整证据采集、Table 解析、原子写入和摘要。批量入口逐个调用单任务函数，单个任务异常只输出该 taskId 的 `FAILED` 摘要并继续后续任务。拆分不改变 3 秒调用间隔，也不并行启动多个 OpenCLI 进程。

批量入口在所有 taskId 处理完后，如果任一任务失败则设置非零退出码，避免“继续处理”被调用方误判为“整体成功”。每次 OpenCLI 进程调用都有 30 秒默认超时，Horae SQL 回退保持 5 秒超时；超时按失败/不可用证据处理，不允许批次无限等待。限流间隔和上述超时可由显式环境变量覆盖，但覆盖值必须为正整数毫秒。Task 和 Table 分别执行 staging 校验后的原子替换，不构成跨资产事务；若 Task 已提交而 Table 写入失败，失败摘要标记 `writePhase=TABLE_AFTER_TASK_COMMITTED` 并给出 Task 目录和变更结果，调用方必须按半成功处理并在下次运行时重试该 taskId。若 source/target 是非物理引用而未能绑定 Table，摘要必须包含 `tableReferencesUnavailable`、`TABLE_REFERENCE_UNAVAILABLE` warning，并将 `collectionStatus` 标为 `PARTIAL`。

批量入口在 data root 外维护一个独立的操作状态文件，默认路径为 `<data-root>.input-pack-status.json`；自定义 `--status-file` 也必须位于 data root 外。它按 taskId 保存最后一次 `SUCCESS`、`PARTIAL` 或 `FAILED` 结果、Task/Table Hash、Table 资产路径、不可用引用、warning 和错误。只有状态字段完整、Task JSON/SQL 与全部已记录 Table JSON/DDL 仍存在且 Hash 一致、并且没有 warning/stale legacy 的 `SUCCESS` 才能在下次跳过；外部删改资产会触发重试。`--force` 可强制重跑成功任务。纯 task 数量/状态大小检查和状态加载先于 `--repair-malformed-tables` 的目录移动；超过 100 个 taskId 或 2 MiB 状态文件时输出拆分告警，超过 200 个 taskId 或 8 MiB 状态文件时在 OpenCLI 和 repair 副作用前拒绝。若本批次 checkpoint 后跨过 8 MiB，则保留已完成 task，停止剩余 task 并返回非零退出码。状态替换中断后，读取器会尝试恢复有效的孤儿 `.bak`/`.tmp` checkpoint；状态文件写入失败会记录错误并继续后续 task，但批次最终返回非零退出码。当前保留逐 task checkpoint，不引入追加式日志。该文件是任务运行索引，不是 data root 全量资产清单；汇总区分 `cleanSuccess`、`successWithWarnings` 和 `successNeedingRefresh`。该文件不是根 Manifest、Snapshot、latest 指针，也不改变 Task/Table 落盘边界。

`create.sql` 只表示任务平台中的原始 CREATE 槽位，不能被当前表 DDL 替代，也不能替代当前表 DDL。

### 3. Table 只保存唯一物理表和当前 DDL

`table.json` 包含：版本、stableTableId、platform、可选 GUID、稳定数据源身份、qualifiedName、schema、name、可选平台 description、对象类型、可选 status、可选 primaryKey、物理 partitionFields、DDL 文件索引、采集时间和 contentHash。description 只作为展示元数据保存，不参与身份、目录名或匹配。

- `qualifiedName` 统一为数据库对象内部完整名，例如 `dm_otc_n.trd_sso_exch_scr_mtch_day`，绝不附加 `@gfhive` 等数据源后缀。
- `dataSource` 单独保存数据源身份。
- `partitionFields` 只表示 DDL/元数据确认的物理分区字段。
- `platform` 只保存 `hive`、`oracle` 等标准 token；写入器拒绝 `hive / Hive内部表`、`oracle / 物理表` 等展示型路径值。直接返回 `DELETED` 且 DDL 可取时保存 `status: "DELETED"`，否则报告 unavailable/deleted。
- `primaryKey` 只保存 DDL/元数据直接返回的字段顺序，例如 `TRADE_DATE`、`TE_REPORT_ID`；不从 SQL 推断。
- `ddl.sql` 表示采集时表的当前结构；一个 stableTableId 在当前数据根目录中只有一份 DDL。
- DDL 来自测试或其他非生产环境时必须保留真实 provenance，不能冒充生产对象版本。

### 4. Stable Table ID 使用可读物理身份

目录名和 stableTableId 统一使用以下单一目录段：

```text
<qualifiedName>__<dataSource>
```

例如：

```text
TITANS_TRADEFLOW.TRANS_T_REPORT_ETF_COMPONENT__gforacle_gftzdb#gftzdb
```

GUID 仍保存为 `table.json.guid`，但不再作为目录名。qualifiedName 和 dataSource 必须分别来自物理对象与稳定数据源证据；已确认的展示名到稳定标识映射必须显式配置，例如 `场外衍生品投资管理系统 → gforacle_gftzdb#gftzdb`。未映射展示名使用保留值 `default`，表示未知物理数据源，不得解释为真实数据源。目录段必须拒绝 Windows 路径分隔符、保留字符和尾随点/空格。

### 5. Hash 使用统一 canonicalization

- JSON canonicalization：递归按 key 排序、移除非语义空白、编码为 UTF-8，再计算 SHA-256。
- `contentHash` 排除自身与 `collectedAt`；其余契约字段均参与计算。
- SQL/DDL 文件 Hash 对实际落盘的 UTF-8 字节计算，不先做 SQL 规范化。
- `task.json` 的 contentHash 覆盖任务配置及 SQL 文件索引中的文件 Hash。
- `table.json` 的 contentHash 覆盖物理身份、结构元数据及 DDL Hash。

### 6. 字段缺失与 null 严格区分

统一语义如下：

```text
字段不存在 = 没取得或平台不提供
null       = 已确认该值为空或不适用
有值       = 来源系统明确取得
```

Writer 不得用 `-`、空字符串、零字节 SQL 或自行生成的默认值代替这三种状态。

### 7. 更新采用 staging 后原子替换

采集器先在数据根目录下的临时位置生成并校验文件，再按内容 Hash 判断：Hash 未变则不更新；Hash 变化则原子替换对应 Task 或 Table 目录。更新 Table 不复制到各 Task，更新 Task 也不复制 DDL。失败不得破坏上一份有效最新数据。

## Risks / Trade-offs

- [只保留最新状态，无法历史回放] → 明确作为 V1 取舍；Hash 只能检测变化，不能恢复旧内容。
- [同名表跨数据源碰撞] → stableTableId 同时包含 qualifiedName 和 dataSource；GUID 只作为 table.json 元数据保留。使用 `default` 时无法区分同名未知数据源，属于已知取舍。
- [平台字段语义不一致] → 保留平台原值和提供方，不把 `hivePartition`、WHERE 条件或 SQL 内容统一改写成目标 partition。
- [Task 与 Table 在刷新瞬间不一致] → staging 完整校验后原子替换，并让单次分析记录实际消费的 Task/Table contentHash。
- [DDL 来源环境与任务环境不同] → 在 table.json 中保留真实提供方和采集时间，禁止提升为未证明的生产版本。

## Migration Plan

1. 定义并验证 `task.json`、`table.json` 的 V1 Schema 与 canonical Hash 规则。
2. 先为 39045、180065 生成外部数据目录样例，核对 SQL 槽位、目标 partition 和 DDL 边界。
3. 加入 86840 的 `create.sql` 案例和 246247 的原始 writeMode 案例，防止 `create.sql`/`ddl.sql` 或平台模式被混写。
4. 切换采集入口到新 Writer；写入失败时继续保留上一份有效目录。
5. 回滚时停用新 Writer，不删除现有外部数据目录。
