## Why

SQL 静态分析目前缺少一套统一、可复用的外部输入落盘约定：同一任务的原始 SQL 槽位、平台配置和相关物理表 DDL 分散在 Horae、SzData 与下游数据库中，容易把“任务当时如何加工”和“表现在是什么结构”混在一起。现在需要先冻结一个足够小的 V1，使跑批无需大模型即可稳定取得最新任务材料和表结构。

## What Changes

- 在 Git 外的独立 `sql-static-lineage-data` 根目录中，以 `tasks/<task-category>/<taskId>` 保存任务平台配置和实际存在的原始 SQL 槽位。
- 以 `tables/<platform>/<qualifiedName>__<dataSource>` 保存唯一物理表的 `table.json` 和一份当前 `ddl.sql`，供多个任务复用；平台 GUID 仅保存在 `table.json` 中。
- 明确 `create.sql` 是 Task 的原始执行材料，`ddl.sql` 是 Table 的当前结构事实，二者互不替代。
- 固定 `qualifiedName`、稳定表身份、SHA-256 canonicalization、`null` 与字段缺失的语义。
- 直接维护一份最新状态；不引入 Snapshot、CAS、历史版本、latest 指针或根 Manifest。
- 落盘层只保存平台和元数据系统直接取得的事实，不保存 SQL 静态分析推导出的输入表、输出表、tableRef、字段血缘或加工关系。

## Capabilities

### New Capabilities

- `task-input-pack`：定义任务加工材料与物理表结构的统一采集、落盘、Hash 和校验契约。

### Modified Capabilities

- 无。

## Impact

- 后续实现主要涉及 `scripts/input`、对应 JSON Schema、外部数据目录写入和脱敏测试 Fixture。
- OpenCLI 继续负责 Horae/SzData 等平台适配；落盘层复用其直接证据，不新增 HTTP、Cookie 或凭据逻辑。
- `src` 继续保持纯 SQL Parser/Analyzer，不导入平台适配逻辑。
- 真实 SQL、DDL 和平台配置不进入 Git；Git 中只保存程序、Schema、脱敏 Fixture 和测试期望。
