# Table producer 反向索引

Table producer index 是从 Task/Table Input Pack V1 完全重建的离线派生产物，用于回答：

```text
(platform, dataSource, qualifiedName) -> confirmed producer Task[]
```

它不是 Input Pack 资产、调度关系缓存或运行实例索引。构建和查询都不调用 Horae、SZData 或其他实时平台。

## 构建

```text
npm run producer-index -- --data-root <input-pack-root> [--output <producer-index.json>]
```

输出文件必须位于 Input Pack 根目录之外。未传 `--output` 时只写标准输出。

当前 `producer-index` artifact 为 schema `1.1.0`；它新增独立的 `intermediateMaterializations` 数组，旧的 schema `1.0.0` artifact 仍可读取。命令仍是显式全量重建。`inputFingerprint` 来自排序后的相对输入路径及实际内容哈希；`contentHash` 覆盖除 `generatedAt` 和自身以外的完整语义内容。数组使用固定 code-unit 顺序，绝对根路径不进入 artifact。

## 按 Input Pack fingerprint 固定缓存

`producer-index:pin` 仍保留给需要不可变快照目录的离线场景：

```text
npm run producer-index:pin -- --data-root <input-pack-root> \
  --cache-root <producer-index-cache-root>
```

命令把索引和 manifest 写入 `<cache-root>/<inputFingerprint>/`。相同 fingerprint
直接复用原缓存；Input Pack 变化后生成新的缓存目录，不覆盖或宣告旧运行失效。

**`lineage:all` / Input Pack 闭包默认不再走这条路径。** 热路径改为固定可变索引
`<data-root>.producer-index/producer-index.json`：有则直接加载，缺了或本轮补采后
再全量重建，运行时不做整仓 fingerprint 寻址。

## 持续更新（快照复用 + 变化检测）

对批量任务使用独立的更新命令，并让所有对账任务复用同一个索引快照：

```text
npm run producer-index:update -- --data-root <input-pack-root> \
  --output <producer-index.json> [--manifest <producer-index.manifest.json>]
```

命令在索引文件旁生成一个独立的 `TABLE_PRODUCER_INPUT_MANIFEST`。manifest 保存本次 Input Pack 的 `inputFingerprint`、Task/Table Pack 输入摘要和单调递增的 `generation`：

- 输入未变化且旧索引、manifest 均可验证时，直接复用旧索引，不重新解析 SQL；
- 首次运行或发现新增、修改、删除 Pack 时，安全回退到一次全量重建，并递增 generation；
- 索引和 manifest 都通过临时文件校验后原子发布，旧文件损坏时不静默沿用；
- `changedPacks` 只用于审计和调度判断，不把候选关系升级为 confirmed producer。

当前这是“快照复用 + 变化检测”，不是 Task/Table 级增量重算：发生变化时仍会全量重建。manifest 本身仍需读取并校验当前 Input Pack，因而它不能消除首次扫描成本；它避免的是稳定快照反复解析全部 SQL。定期全量校验和真正的按 Pack 增量合并尚未实现。

## 按物理表和分区查询 producer Task

查询脚本只读取已有的 producer-index，不重新扫描 Input Pack，也不重新解析 SQL：

```text
npm run producer-index:query -- --index <producer-index.json> \
  --table <qualified-name> \
  [--partition "field=value,field=value"]
```

`--platform` 和 `--data-source` 可选。省略时，脚本会返回该 qualified name 下所有匹配的物理身份和 producer Task；传入这两个参数时才限制为指定物理身份。

例如：

```text
npm run producer-index:query -- \
  --index <producer-index.json> \
  --platform hive \
  --data-source gfhive \
  --table dm_cisp_n.otc_deri_swap_trd_equi_pymt_det \
  --partition "src_tbl=*,busi_date=2026-05-24"
```

分区匹配支持：

- 静态值精确匹配；
- `${YYYY-MM-DD}` 匹配具体日期；
- `*` 匹配任意值；
- 一个 Task 的多个写入分支分别保留在结果中。

省略 `--partition` 时，返回该物理表的全部 confirmed producer Task。

输出只返回 Task 和匹配写入摘要；完整证据仍从 `current.json` 的 `evidence` 或对应 Input Pack 读取。

## Confirmed producer 门槛

confirmed edge 的逻辑键为：

```text
platform + dataSource + qualifiedName + taskId
```

必须同时满足：

1. WRITE 方向来自 `DIRECT_PLATFORM_TARGET`、`SQL_EXACT_TABLE_TARGET` 或显式的 qualified SQL `INSERT OVERWRITE / INSERT INTO / MERGE INTO / CTAS`。
2. 表身份唯一绑定到有效 Table Pack；`dataSource=default` 不算已解析身份。
3. Task Pack、SQL 文件、Table Pack 和 DDL 文件通过现有 hash 校验。

普通 `FROM/JOIN`、任务名、候选顺序和分区值不能生成 producer edge。

Task Pack 带有 Horae 直接周期证据 `scheduleCycle=手工`/`手动`，或任务状态
证据 `scheduleStatus=F`（冻结）时，该任务不进入 producer index 的 confirmed
edge 或 non-confirmed relation；原始 Task Pack 仍保留在隔离区，便于审计。
周期和状态未知不会被猜成手工或冻结。

## 异构 Task 的写入语义

Task 不要求 SQL 中出现 `INSERT`。`DIRECT_PLATFORM_TARGET` 是平台直接给出的目标端点证据，适用于 SQL 只是 `SELECT` 但平台任务负责把结果转存到目标表的形态；`SQL_EXACT_TABLE_TARGET` 是结构化 SQL/Table/DDL 目标证据。两者都不等同于运行成功或业务正确性。

每条新生成的 `writes[]` observation 会保留三个兼容扩展字段：

- `writeDirection`：当前 confirmed observation 为 `WRITE_CONFIRMED`；关系方向不明的候选仍在 `nonConfirmedRelations` 中保持 `UNKNOWN`。
- `operationClass`：`INSERT_OVERWRITE`、`INSERT_INTO`、`MERGE_INTO`、`CTAS`、`PLATFORM_TRANSFER`、`DELETE`、`TRUNCATE` 或 `UNKNOWN`。
- `dataPathRole`：`PRODUCER`、`MUTATION_ONLY` 或 `UNKNOWN`。

目标证据还会保留 `targetEvidenceKind`（`DIRECT_PLATFORM_TARGET` 或 `SQL_EXACT_TABLE_TARGET`），用于区分平台目标与结构化 SQL/Table 目标；旧 artifact 没有该字段时仍按原 V1 规则读取。

对于 `SQL_EXACT_TABLE_TARGET`，索引会重新查看 SQL slot 的结构化目标：INSERT 目标可进入 `PRODUCER`，TRUNCATE 进入 `MUTATION_ONLY`，纯 CREATE 或无法判定的目标保持 `UNKNOWN`，不会仅凭 target 字段升级为数据 producer。

平台目标但没有 SQL `INSERT` 的 Task 通常归为 `PLATFORM_TRANSFER/PRODUCER`。声明为 `delete` 或 `truncate` 的目标写入，或 SQL slot 中能与目标表对应的 `DELETE FROM`/`TRUNCATE TABLE`，在没有字段生产 SQL 时归为 `MUTATION_ONLY`：它确认修改了表，但不应被解释为产生了新的上游数据。若同一 Task 同时存在可枚举的 `SELECT`/CTAS/INSERT 查询输出，`truncate` 只是装载前清理动作，整体仍归为 `PLATFORM_TRANSFER/PRODUCER`。旧的 V1 artifact 可以省略这三个字段，消费者按原有 `observationKind`、`sqlWriteKind` 和 `declaredWriteMode` 解释。

边界：只有 SQL 中单独出现 `DELETE FROM`/`TRUNCATE TABLE`、而没有可确认的目标证据时，当前 SQL WRITE 提取器不会把它生成 producer observation；这类 SQL-only 形态不能据此确认 producer，也不会进入 `lookupConfirmedProducers()`，仍需保留为未覆盖证据边界。

`lookupConfirmedProducers()` 只返回至少有一条 `dataPathRole=PRODUCER` observation 的边；全为 `MUTATION_ONLY` 的写入仍保留在 artifact 中供审计，但不会进入单跳/多跳的数据 producer 查询。

同一表允许多个 producer Task。同一 Task 对同一表的多次 WRITE 收在该 edge 的 `writes[]` 中，每条 observation 分别保留 direct target 或 SQL write 类型、声明写模式、SQL write kind、分区和 provenance，不选择“最像”的一条。

## Non-confirmed relations

方向未知、表身份缺失或多义、输入损坏等最终关系保存在 `nonConfirmedRelations`，不进入 confirmed 查询。中间 SQL 物化单独保存在 `intermediateMaterializations`，不计入最终 producer 缺口。`directionStatus` 与 `tableRef.identityStatus` 正交：显式 SQL WRITE 即使缺少唯一物理身份，方向仍为 `WRITE_CONFIRMED`；候选 target 则保持 `UNKNOWN`。

- `TABLE_TASK_RELATION_DIRECTION_UNKNOWN` 即使包含完整三元组也仍是 UNKNOWN。
- qualified SQL WRITE 找不到唯一 Table Pack 时保留为未确认观察，不静默丢弃。
- 对无 schema 的终端 SQL WRITE，如果 Task Pack 的 `taskName` 提供 schema，索引会用同 Task 的 SQL 引用关系判断它是否为终端写入，并补全限定名；这不依赖重新调用 SZData。缺少 Table Pack 时，原因标为 `SQL_FINAL_TARGET_PHYSICAL_IDENTITY_UNRESOLVED`，表示逻辑目标已识别、物理身份尚未确认。
- 如果一个 SQL WRITE 的目标在同一 Task 的后续 SQL 中又被读取，且物理 Table Pack 不存在，索引会将观察放入 `intermediateMaterializations`，原因标为 `SQL_INTRA_TASK_INTERMEDIATE_IDENTITY_UNRESOLVED`。这只是“同 Task 中间物化”的证据分类，不会把它升级为 producer，也不会把它计入最终 producer 缺口。
- `SQL_WRITE_TABLE_IDENTITY_UNRESOLVED` 和 `SQL_FINAL_TARGET_PHYSICAL_IDENTITY_UNRESOLVED` 仅表示最终 SQL WRITE 仍无法确认唯一物理身份，计入 `nonConfirmedRelations`。
- `dataSource=default` 是未解析占位值，不能显示为 `identityStatus=RESOLVED`。
- 坏 Input Pack 只隔离对应输入；artifact 标为 `PARTIAL`，其他有效 producer edge 仍可使用。

递归代码只能调用 `lookupConfirmedProducers()`。人工复核和覆盖率统计可单独调用 `lookupNonConfirmedRelations()`，不能把两者混合后再选择候选。

## 分区与证据边界

分区只属于 Task-to-Table WRITE observation，不参与物理表 identity。`${...}`、`{{...}}` 等表达式保持 `RUNTIME_EXPRESSION`；采集到的具体值仅为 `OBSERVED_RENDERED_VALUE`。

`SUCCESS` 只表示本次发现的输入均成功处理；`PARTIAL` 表示至少一个 Task/Table/SQL/DDL 输入无效。二者的覆盖语义始终是 `OBSERVED_EVIDENCE_ONLY`，都不证明 producer 全覆盖、调度执行、数据到达或业务正确性。
