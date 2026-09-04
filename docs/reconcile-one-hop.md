# 表级单跳对账器

`reconcile-one-hop(taskId)` 只回答当前任务的直接上一跳：

```text
上游 Task --WRITE--> Table --READ--> 当前 Task
```

## 入口

```text
npm run reconcile-one-hop -- --task-id <taskId> --data-root <input-pack-root> [--producer-index <index.json>] [--terminal-table-config <path>] [--output <result.json>] [--summary-output <summary.json>]

# 发现缺失父任务后自动补采 Input Pack、重建索引并重跑
npm run reconcile-one-hop:autofill -- --task-id <taskId> --data-root <input-pack-root> --producer-index <index.json> [--terminal-table-config <path>] [--output <result.json>] [--summary-output <summary.json>] [--force]
```

处理多个根任务时，使用批量入口复用一次 Table catalog；需要严格校验 input fingerprint 时显式加开关：

```text
npm run reconcile-one-hop:batch -- \
  --task-ids <task-id-1,task-id-2,...> \
  --data-root <input-pack-root> \
  --producer-index <index.json> \
  [--terminal-table-config <path>] \
  [--verify-input-fingerprint] \
  --output-dir <result-dir>
```

批量入口默认不扫描全量 Input Pack；传入 `--verify-input-fingerprint` 后，会在开始时校验并在批次结束时复核 Input Pack 指纹。批次运行期间不要修改 `tasks/` 或 `tables/`。

Horae `relation up depth=1` 使用固定的 read-through 缓存：
`E:\02_area\股衍数据-数据cookbook\sql-static-lineage-cache\schedule-evidence\tasks\<taskId>\horae-relation-up-depth-1.json`。
默认 runner 先读取并校验缓存的 schema、Task ID、方向、深度、行记录和内容 SHA-256；命中时不调用 OpenCLI，缺失或校验失败才实时查询，成功结果使用同目录临时文件改名原子写入。缓存是可删除的派生证据快照，没有 TTL；需要刷新时删除对应 Task 文件即可。显式注入 `scheduleRows` 或 `scheduleEvidenceByTaskId` 时仍完全绕过缓存。

one-hop 默认加载 `config/multi-hop-terminal-table-rules.json`，也可通过
`--terminal-table-config` 指定同一份共享配置。命中的 terminal/reference 表仍保留为当前 SQL 的直接读表证据，但不会进入 confirmed producer、非确认关系或 `finalUpstreamTaskIds` 递归集合；原始调度父任务仍作为调度证据保留。

`--data-root` 指向 Task/Table Input Pack V1。未传 `--output` 时，结果只写到标准输出。

传入 `--output` 后会同时生成同目录的 `<name>.summary.json` 简要版；也可以用 `--summary-output` 指定摘要路径。完整 JSON 保留证据、父任务详情和逐项对账；摘要只保留表名、Task ID、counts、下一步 Task ID、问题列表和按任务定位的 `issueDetails`，其中 `missingTaskInputPackTaskIds` 可直接列出缺少 Input Pack 的父任务。

`--producer-index` 是可选的离线 producer 反向索引。显式提供后会校验 schema 和 `contentHash`；默认不重新扫描当前 `data-root`。传入 `--verify-input-fingerprint` 后，才会重新计算 `inputFingerprint`，用于严格确认索引没有过期；失效或过期直接失败，不回退到实时 producer 补证。`PARTIAL` 索引可以消费其中已确认的边，但覆盖语义仍为 `OBSERVED_EVIDENCE_ONLY`。

库调用方可通过 `scheduleRows` 显式注入已冻结的 Horae relation 行；传入该字段后不会调用默认 OpenCLI/Horae runner，调度 evidence 的 `observedAt` 保持为 `null`。multi-hop 使用这个离线边界，并以 `finalUpstreamTaskIds.primary` 作为递归入口。

独立 one-hop 默认仍构建完整 DDL Schema。multi-hop 通过 prepared context 使用
`TASK_SCOPED` Schema：先识别当前 Task 涉及的物理表，再只加载这些表的 DDL，保持
相同的 expression dependency 与分区范围判定，不把全量 DDL Schema 常驻内存。

## 证据顺序

1. 当前任务直接读表：读取并校验 Task Input Pack 中各 SQL 文件的 SHA-256，再使用现有 `SqlSession + buildPlanFacts` 提取物理读表。one-hop 会加载 Table Pack DDL schema，并启用 adaptor 的 expression dependency，把 WHERE 谓词保留为 `AND` / `OR` / `NOT` 结构和物理列来源；裸表名仅在 Task Pack 的限定任务名可证明默认 schema 且未与限定 target 冲突时继承该 schema；否则保留未解析状态。
2. 调度骨架：读取或查询 `horae relation <taskId> --direction up --depth 1`；缓存命中时不访问 OpenCLI。
3. terminal/reference 表边界：读取共享配置；命中的表保留 direct-read，但不做 producer 对账或递归展开。
4. 父任务写表：优先使用方向明确的 `DIRECT_PLATFORM_TARGET` / `SQL_EXACT_TABLE_TARGET` 和显式 SQL WRITE；父任务 Input Pack 缺失时才查询 `szdata task-source`。
5. 表身份：使用 Table Input Pack 将 `qualifiedName` 解析为唯一的 `platform + dataSource + qualifiedName`。缺失或多义身份不能形成 `MATCHED`。
6. READ 分区范围：先沿 PlanFacts 的 `source`、`Join.left/right`、setop 和显式 CTE scope mapping 回溯到每个物理 `ReadRelation` occurrence，再结合 Table Pack `partitionFields`（缺失时回退 DDL）解析 `readPartitionScopes`。同一物理表的多次 READ 不提前去重；每个 occurrence 保留独立 predicate tree、source span、relation path 和归属证据。只使用静态 SQL 谓词；调度分区、脚本参数和运行实例不补 READ 分区。
7. producer 分区匹配：对同表 producer 的 WRITE observation 计算 `PROVEN_OVERLAP`、`POSSIBLE_OVERLAP`、`PROVEN_DISJOINT` 或 `UNKNOWN`。这是旁路判断，不改变旧表级 `nextDataTaskIds`。

## 状态

- `MATCHED`：Horae 直接父任务有已确认 WRITE，且物理表身份与当前 SQL READ 相同。
- `SQL_ONLY`：当前 SQL 直接读取，但没有任何已确认的 Horae 父任务 WRITE 覆盖。
- `SCHEDULE_ONLY`：Horae 父任务有已确认 WRITE，但当前 SQL 未直接读取该表。
- `UNRESOLVED`：有调度父任务或候选目标，但 WRITE 方向或物理身份证据不足。

`nextScheduleTaskIds` 保留直接调度父任务；在未传 producer index 的兼容模式下，`nextDataTaskIds` 只包含形成 `MATCHED` 的父任务。候选任务、任务名、普通 `FROM/JOIN` 和分区值都不能单独把任务提升为 producer。

`producer-index` 只提供所有静态 WRITE candidate；最终递归分类只由本层 one-hop 的物理身份、分区和调度证据共同决定。`finalUpstreamTaskIds.primary` 是唯一可递归集合，`additional` 是当前层候选，`unknown` 是证据不足或冲突的候选。若同一物理表/分区存在多个可能重叠的 `INSERT OVERWRITE` writer，且没有唯一调度父任务可以裁决，结果使用 `decision=MULTIPLE_OVERLAPPING_PRODUCERS`，将相关 Task 放入 `unknown`，不得放入 `primary`。

未传 producer index 时，`nextDataTaskIds` 保持上述兼容语义。显式提供 producer index 时，完整 artifact 的 `dataPath.confirmedProducers` 保留当前 SQL READ 表对应的全部静态 confirmed producer Task，供审计和 multi-hop 使用；非 Horae 直接父任务在 `scheduleRelation` 中标为 `NOT_DIRECT_PARENT`，但不会被改写成 `MATCHED`。其中 `partitionMatch.status=PROVEN_DISJOINT` 的 producer 仍保留在完整 artifact，但不会进入 `partitionAwareNextDataTaskIds`。sidecar summary 会将这类 producer 从 `confirmedProducers` 移到 `excludedProducers`，并保留分区及排除原因。`dataPath.nonConfirmedRelations` 只用于审计和覆盖率，绝不进入递归节点。

输出 artifact 版本为 `1.1.0`。`currentTask.directReads[].readPartitionScopes` 保留 occurrence 级范围；其中 `predicateEvidence` 区分可安全归属、局部未知和不可下推的 Filter/Join 子树，并保留完整 predicate tree、source span、reason codes 与 relation path。`dataPath.confirmedProducers[].partitionMatch` 保留匹配状态、原因和参与比较的 WRITE observation。新增 `partitionAwareNextDataTaskIds.proven/possible/unknown`：只有确定不相交的 producer 不进入这些集合；旧 `nextDataTaskIds` 仍是表级 confirmed producer 集合。

## Counts 与覆盖率口径

原 `counts` 保持兼容，单位不是互斥物理表：

- `matched` / `scheduleOnly` 是一个 `Task × Table` 对账 item。
- `unresolved` 是没有 confirmed write 的调度父任务 item。
- `sqlOnly` 是未被 confirmed Horae 直接父任务 WRITE 覆盖的 SQL direct-read reference。

所以同一物理表可以同时出现 `SQL_ONLY` 与某个候选父任务的 `UNRESOLVED`；多个父任务写同一表时，`matched` 也可以大于 `sqlDirectReads`。输出中的 `countSemantics.statusesExclusivePerPhysicalTable=false` 明确记录这一点。

`coverage` 使用整数分子/分母，不输出舍入百分比，并分开记录：direct-read 身份/producer 覆盖、调度父任务 Input Pack/WRITE 覆盖、producer 方向/身份观察、索引或实时补证来源，以及重叠表数量。`SUCCESS`、`VALID_SUCCESS` 都只说明已观察输入可用，不代表 producer 全覆盖。

`coverage.partitionScopes` 和 summary 中还记录 READ scope 状态计数、producer 匹配状态计数、proven/possible/unknown Task 数量和多 producer 表数量。

## 边界

该入口不做字段级血缘、多跳递归、运行实例核验、数据到达核验或业务正确性验收。`boundaries.readPartitionScope=STATIC_SQL_PREDICATE`；平台/Portal 查询失败会保留为 `UNRESOLVED`，不会回退到历史实验结果冒充当前证据。
