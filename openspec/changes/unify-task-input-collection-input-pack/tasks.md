## 1. 冻结 V1 契约

- [x] 1.1 定义 `task.json` V1 Schema，覆盖平台任务分类、平台原始 taskType、source/target、writeMode、目标 partition、实际 SQL 文件索引、采集时间和 contentHash，并拒绝 inputs、outputs、tableRef、statement role 和血缘字段。
- [x] 1.2 定义 `table.json` V1 Schema，覆盖可读 stableTableId、platform、GUID、稳定 dataSource、无数据源后缀的 qualifiedName、对象类型、primaryKey、partitionFields、DDL 索引、采集时间和 contentHash。
- [x] 1.3 实现并记录统一 canonical JSON、文件 SHA-256、contentHash 排除字段及可读 stableTableId 算法；用 key 重排、空白变化和内容变化用例验证确定性。
- [x] 1.4 为所有可选采集字段实现缺失、`null`、有值三态校验，拒绝 `-`、空字符串和零字节 SQL/DDL 作为替代状态。

## 2. 实现 Task 最新状态落盘

- [x] 2.1 从统一 OpenCLI 任务证据生成 `tasks/<task-category>/<taskId>/task.json`，所有 task type 使用统一字段契约；只映射平台直接字段和受控任务类型分类并记录实际证据提供方，不根据 SQL 补造平台配置；SzData SQL 明确 unavailable 时，按槽位尝试现有只读 Horae detail 作为补充来源。
- [x] 2.2 将实际存在的 create/query/prepare/truncate/finish 槽位按原名称和原文写入 `sql/`，逐文件计算 SHA-256；不存在的槽位不创建文件。
- [x] 2.3 保留平台原始 writeMode，并仅在平台明确返回目标写入分区时生成 partition；验证 WHERE 条件和源 Hive 读取分区不会进入目标 partition。
- [x] 2.4 将目标 partition 统一为紧凑三态：唯一完整值写键值对象、确认无分区写 `null`、证据不足省略；内部证据树不得落盘。
- [x] 2.5 使用 staging、Schema/Hash 校验和原子替换更新 Task；Hash 未变不更新，失败时保留上一份有效 Task。

## 3. 实现 Table 最新状态落盘

- [x] 3.1 通过现有元数据/受控只读入口解析物理表身份和当前 DDL，写入 `tables/<platform>/<qualifiedName>__<dataSource>/table.json` 与 `ddl.sql`，不把 DDL 复制进 Task。
- [x] 3.2 实现可读 qualifiedName/dataSource identity；验证同名跨数据源表不会碰撞，平台 GUID 仅保存在 table.json。
- [x] 3.3 从直接 DDL/元数据证据保存对象类型、description、primaryKey 和 partitionFields，保持 qualifiedName 与 dataSource 分离，并记录 DDL 真实提供方。
- [x] 3.4 使用 staging、Schema/Hash 校验和原子替换更新 Table；Hash 未变不更新，失败时保留上一份有效 Table。

## 4. 验证事实边界和真实案例

- [x] 4.1 增加 39045 脱敏 Fixture：验证 mysql2hive 只落 `query.sql`、目标 partition 为 `null`，并独立落盘 MySQL 源表和 Hive 目标表 DDL。
- [x] 4.2 增加 180065 脱敏 Fixture：验证原始 `query.sql` 与 `truncate.sql`、目标 partition 为 `null`、源 Hive Table 的 partitionFields 为 `busi_date`，且目标 Oracle DDL 独立保存。
- [x] 4.3 增加 86840 的 create/query Fixture，验证 Task `create.sql` 与 Table `ddl.sql` 同时存在但互不覆盖。
- [x] 4.4 增加 246247 的平台原始 writeMode Fixture，验证 SQL 内容不会改写平台模式或槽位文件名。
- [x] 4.5 增加负例，验证分析得到的 inputs、outputs、tableRef、statement role、血缘和加工关系不能写入 Task/Table 目录。
- [x] 4.6 运行 OpenSpec strict validation、JSON Schema 测试、Hash 确定性测试和聚焦集成测试，并记录仍未取得的平台字段。
- [x] 4.7 保存直接取得的任务/调度名称与主题名称；对 86840 保持无直接 target 的证据缺口；对旧 malformed Table platform 目录 fail-fast；对 DELETED Table 单独保存状态并输出覆盖报告。
- [x] 4.8 增加显式 `--repair-malformed-tables` 修复入口：将旧 malformed Table 目录移动到同级 quarantine，不删除数据，并继续使用原数据根。
- [x] 4.9 对无 direct source/target 的任务增加有界 Table 任务关联 fallback；仅当 `szdata table` 直接返回的任务关联包含 taskId 时落盘，同时将规范化 Table 身份写入 `task.json.target` 并标注 `targetEvidenceKind=TABLE_TASK_RELATION_DIRECTION_UNKNOWN`，明确不把无方向关联升级为写入方向，并修正摘要只报告实际写入的 SQL 槽位。
- [x] 4.10 统一所有任务类型的 source/target 物理端点数据源表达；落实 `gfhive` 受控映射、按数据源筛选 Table 候选，并报告端点数据源冲突。
- [x] 4.11 对无 direct source/target 且无 Table 任务关联的任务，解析明确的 SQL DDL/写入目标；仅在目标唯一、与任务名提供的库名严格一致且 `szdata table`/DDL 唯一校验通过时，使用 `targetEvidenceKind=SQL_EXACT_TABLE_TARGET` 回填 Task/Table。
- [x] 4.12 将批量入口与单 taskId 采集流程拆分；批量入口统一执行 3 秒 OpenCLI 限流、逐任务隔离失败并保留原有命令参数，单任务流程可独立测试和复用。
- [x] 4.13 批量采集在单 taskId 失败后继续处理后续任务，但最终以非零退出码表示存在失败；明确 Task 与 Table 是两个独立原子写入，Table 写入晚于 Task 写入失败时输出已提交 Task 的半成功状态。
- [x] 4.14 将 Horae 任务类型码映射独立为可更新字典文件；类型码 30 按权威字典映射为 `hive2mysql`，未收录的新类型继续保留 `taskType-<code>`，不从任务端点或 SQL 猜测。
- [x] 4.15 对类型映射变更后的旧 Task category 目录输出 `staleLegacyTaskDirectories`，不自动删除旧数据；已收录编码优先于冲突的过时平台类型名称，并记录字典来源。
- [x] 4.16 为所有 OpenCLI 进程调用设置默认超时；非物理 source/target 引用输出 warning 并将采集状态标为 `PARTIAL`，避免无限等待或把端点缺口报告为成功。
- [x] 4.17 在 data root 外增加按 taskId 持久化的采集状态文件；校验 Task/SQL 与已写 Table/DDL Hash 后，只有成功且无告警的任务下次跳过，部分成功/失败/旧目录告警或资产被删改的任务重试，并提供 `--force`、`--status-file` 和最终汇总进度。
- [x] 4.18 对大批量状态 checkpoint 增加 task 数量与状态文件字节双阈值；超过 100 个 taskId 或 2 MiB 告警，超过 200 个 taskId 或 8 MiB 在 OpenCLI 前拒绝，并允许通过环境变量显式覆盖默认限流/超时策略。
- [x] 4.19 修正大批次可观测性与副作用顺序：汇总同时输出初始/最终 status 文件大小，硬拒绝先于 malformed Table repair，并在运行中 checkpoint 跨过 8 MiB 时停止剩余 task；限流/超时环境变量必须为正整数。
