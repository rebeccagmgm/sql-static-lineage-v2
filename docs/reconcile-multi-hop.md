# 表级多跳数据路径

`reconcile-multi-hop` 从一个调度 `taskId` 出发，离线展开：

```text
当前 Task --READ--> Table <--WRITE-- producer Task
```

递归节点始终是 Task，Table 只是任务间的数据桥梁。每个 Task 先执行/消费一次
one-hop reconciliation；BFS 下一层只取该结果的
`finalUpstreamTaskIds.primary`。`additional` 作为当前层的保留证据但不再展开，
`finalUpstreamTaskIds.unknown` 永不进入 frontier。遇到
`MULTIPLE_OVERLAPPING_PRODUCERS` 时保留候选和 terminal 证据，但停止该表分支。
无冻结 one-hop snapshot 时，multi-hop 会离线读取
`schedule-evidence` 缓存（不调用 live Horae）；缓存未命中才退回空调度行。
遍历仍只消费经过校验的 Task/Table Input Pack V1 和 `TABLE_PRODUCER_INDEX`
candidate/WRITE bridge；producer index 不重新决定递归集合。

命令默认加载 `config/multi-hop-terminal-table-rules.json`。这是 Input Pack closure、one-hop、字段驱动补链和 multi-hop 共用的 terminal/reference 表配置。配置命中的表会保留为当前 SQL 的直接读表证据，但不会查询其 confirmed producer、补入 producer Task 或继续递归；也可用 `--terminal-table-config <path>` 显式指定另一份 JSON 配置。该配置不删除 Input Pack 或静态 SQL 血缘产物，也不替代当前 Task 所需的 Table Pack 身份/DDL 证据。

## 运行

```text
npm run reconcile-multi-hop -- \
  --task-id <root-task-id> \
  --data-root <input-pack-root> \
  --producer-index <producer-index.json> \
  --max-depth 3 \
  --max-tasks 1000 \
  --max-edges 10000 \
  [--root-one-hop <frozen-one-hop.json>] \
  [--terminal-table-config <terminal-table-rules.json>] \
  [--output <multi-hop.json>]
```

多个根任务可以使用批量入口，避免每个根任务重复扫描整套 Task/Table Pack：

```text
npm run reconcile-multi-hop:batch -- \
  --task-ids <task-id-1,task-id-2,...> \
  --data-root <input-pack-root> \
  --producer-index <producer-index.json> \
  --output-dir <result-dir> \
  [--root-one-hop-dir <one-hop-result-dir>] \
  [--max-depth 3] [--max-tasks 1000] [--max-edges 10000]
```

`--root-one-hop-dir` 中可放置 `reconcile-<taskId>.json` 或 `<taskId>.json`。批量入口只建立一次 evidence repository，开始时校验并在结束时复核 `inputFingerprint`，然后复用给所有根任务；批次运行期间不要修改 `tasks/` 或 `tables/`。

### 在线补采缺失 producer Task Pack

离线 Input Pack 不完整、而表详情可能提供关联调度任务时，使用 autofill 外层编排：

```text
npm run reconcile-multi-hop:autofill -- \
  --task-id <root-task-id> \
  --data-root <input-pack-root> \
  --max-depth 3 --max-tasks 1000 --max-edges 10000 \
  --output <multi-hop.json> \
  --report <autofill-report.json> \
  [--producer-index-cache-root <cache-root>] \
  [--schedule-evidence-cache-root <cache-root>] \
  [--allow-input-changes] \
  [--producer-index <legacy-fixed-index.json>] \
  [--trust-existing-index]
```

每轮先冻结访问到的 one-hop Horae 结果；对“SQL 已确认 READ、producer index 尚无
confirmed WRITE、且不属于终止配置”的表，查询表详情并把其中 Task ID 仅作为 Input
Pack 补采候选。候选 Pack 采集后，每轮只更新一次 producer index。任务只有在其 SQL
WRITE 被新索引确认后才成为 Table bridge；表详情中的 Task ID 本身不是 producer 证据。

下一轮仍只沿各 Task 的 `finalUpstreamTaskIds.primary` 前进。表详情发现但不属于 Horae
直接父任务的生产者会保留在 `additional`，作为未展开 Task 节点和 Table bridge 展示，
不会调用其 Horae 上游。发现失败、限流重试耗尽或补采后 Pack 仍不可用会写入 report，
状态为 `PARTIAL`，不会冒充完整结果；不可用的任务不会再次进入 one-hop 递归，因此不会因
缺失 Pack 让整条 autofill 命令异常退出。默认表查询最多重试 3 次，OpenCLI 单次调用限制
30 秒，并由 `maxRounds`、`maxDiscoveryTables`、`maxDiscoveredTasks` 控制外部补采规模；默认值分别为 6、1000、5000。

autofill 搜索阶段对每个 `horae relation` 使用同一份 read-through schedule-evidence 缓存：默认根目录为
`E:\\02_area\\股衍数据-数据cookbook\\sql-static-lineage-cache`，也可用
`--schedule-evidence-cache-root` 显式指定。缓存 HIT 时不访问 Horae；MISS 或校验失败才实时查询，成功结果按
Task ID 原子写回 `schedule-evidence/tasks/<taskId>/horae-relation-up-depth-1.json`。该缓存只复用调度证据，
不会把调度父任务自动提升为确认的 producer。

测试阶段若多个 collector 会并行向同一 Input Pack 根目录追加文件，可显式传
`--allow-input-changes` 放宽 manifest/index 构建期间的一致性检查。该模式可能使用未包含最新追加文件的快照，
只适合临时测试；若两次扫描 fingerprint 不一致，本次索引不会写入缓存。正式结果应在输入稳定后运行。

表详情未返回 producer 时，Hive 表仍记录为
`TABLE_PRODUCER_TASK_NOT_OBSERVED`；非 Hive 表不计入异常，而记录在 autofill report 的
`nonHiveSourceBoundaries` 中。该标记只表示当前 Hive producer 追踪范围在此停止，不代表
该表已被确认是全局最上游。

默认启动时计算当前 Input Pack fingerprint，并在 data root 外部的
`<data-root>.producer-index-cache/<inputFingerprint>/` 固定或复用对应 index。补采写入
Task Pack 后会固定到新的 fingerprint 目录，旧缓存不被覆盖。可用
`--producer-index-cache-root` 改变缓存根目录。

显式传 `--producer-index` 时保留旧的固定路径更新行为。只有调用方能保证 `data-root`
是运行期间不可变的冻结快照时，才可同时传 `--trust-existing-index`，跳过启动阶段的
全文件 hash；该模式必须提供显式 index 及其 manifest。report 的 `initialIndexMode` 和
`producerIndexInputFingerprint` 会保留这一证据边界。

默认入口带有明确的 V8 old-space 边界：单根 384 MiB、批量 512 MiB。
`bounded` 是同一配置的显式别名。内存充足且更关注吞吐时，可选择不设上限的
`throughput` 入口：

```text
npm run reconcile-multi-hop:bounded -- <与单根入口相同的参数>
npm run reconcile-multi-hop:batch:bounded -- <与批量入口相同的参数>
npm run reconcile-multi-hop:throughput -- <与单根入口相同的参数>
npm run reconcile-multi-hop:batch:throughput -- <与批量入口相同的参数>
```

批量入口按唯一访问 Task 复用解析结果和按需 DDL Schema，不会为每个 root
重新建立全量上下文。bounded/default 会增加 GC CPU，但复杂样本默认不会任由 V8
堆持续膨胀；`throughput` 只适用于调用方已提供外部内存隔离的场景。

### 批量闭包盘点（只统计，不补包）

需要先估算一批根任务跑 multi-hop 会涉及多少缺失 Input Pack 时，使用 closure audit：

```text
npm run reconcile-multi-hop:closure-audit -- \
  --data-root <input-pack-root> \
  --task-category sparkIndex \
  --producer-index <producer-index.json> \
  --schedule-evidence-cache-root <schedule-cache-root> \
  --max-depth 25 --max-tasks 100000 --max-edges 1000000 \
  --output <closure-audit.json>
```

脚本把所有根任务合并成一个去重 BFS：每个 Task 的 Horae 上游关系只查询一次，先命中
`schedule-evidence` 缓存，MISS/INVALID 才调用 `horae relation` 并回写缓存；确认的表生产者
优先来自 Producer Index，索引没有确认边时才查询 `szdata table`。它只写报告和调度证据缓存，
不会采集或修改 Input Pack。报告的 `missingTaskIds` 可直接作为后续补包批次的输入。
这是“调度父任务 + confirmed producer”的候选闭包盘点，不替代每个根任务最终
one-hop primary frontier；因此它适合决定补包范围，最终 multi-hop artifact 仍要单独验收。

`--cache-only` 可做完全离线的预盘点，但结果只覆盖已有调度缓存，`summary.scheduleCacheMisses`
表示尚未核验的关系；此时 `summary.closureStatus=PARTIAL_CACHE`，
`missingTaskPackCountIsFinal=false`，不能把缺包数当作最终缺口。报告同时区分 `missingTaskPackCount` 和
`unresolvedTableCount`：前者是当前闭包已发现但本地没有的任务包，后者是没有确认生产者的表，
不是可以直接补采的 Task 数。
即使 schedule cache 全部命中，只要中间 Task Pack 缺失、存在未解析生产者的表，或遍历达到
`max-depth`，报告仍为 `PARTIAL`，且缺包数保持非最终值。

## 可视化

已生成的 multi-hop JSON 可以按调度 ID 转成离线 HTML 图：

```text
npm run visualize-multi-hop -- \\
  --task-id 181058 \\
  --artifact-dir <multi-hop-output-dir> \\
  --output <lineage.html>
```

命令会先生成同目录的 `viz-model-181058.json`，再由模板渲染 HTML；也可以显式指定
`--viz-model <viz-model.json>`。viz model 是展示层模型，不改变原始 multi-hop artifact。

也可以直接传单个 JSON：

```text
npm run visualize-multi-hop -- \\
  --task-id 181058 \\
  --artifact <reconcile-multi-181058.json>
```

页面按实际上游到目标方向排列 Task；同一物理表对应多个 producer Task 时合并为一个
血缘节点，卡内同时展示表名、关联 Task ID 和可证明的 WRITE 分区。ODATA 表仍逐表
展示；方向由从左到右的连线和箭头表达，不再把 READ/WRITE 技术计数或原始 evidence
JSON 塞进卡片。该命令只读取已生成 artifact，不重新解析 SQL，也不调用 Horae。

启动时会校验 producer index 的结构、`contentHash` 和当前 Input Pack 的 `inputFingerprint`。显式索引失效或陈旧时直接失败，不回退到实时补证。`PARTIAL` 索引可以消费其中 confirmed edge，但结果标为 `PARTIAL_EVIDENCE`。

## 遍历与预算

- 排序 BFS 保证 Task 的 `minDepth`；root depth 为 0，`maxDepth` 表示 producer Task 跳数。
- `maxTasks` 统计去重 Task node，包含 root 和尚未展开的终止节点。
- `maxEdges` 统计唯一 READ edge 与 WRITE edge；producer bridge 单独计数。
- 同一表可以有多个 confirmed producer，全部保留，不收敛成“唯一最佳”任务。
- 菱形路径保留每条 bridge，但共享 Task 只展开一次；真实回边标为 `CYCLE`。
- 达到边界时通过 `limits.truncationReason` 和 terminal 留证，不静默丢弃。

## SQL 与 identity 门槛

Task READ 仓库启动时只建立 Task/Table 元数据索引；Task SQL 只在 BFS 实际访问该
Task 时读取、校验和解析，解析完成后不保留 SQL 正文。one-hop 的 DDL Schema 也只为
当前 Task 涉及的表加载，并按表复用。全量 Task/Table Pack 的有效/无效计数和问题来自
已校验且 fingerprint 一致的 producer index；访问分支上的 Task Pack、SQL 或 DDL hash
失败仍 fail closed 到对应分支。

- 裸表名仅在 Task Pack 的限定任务名可证明默认 schema 且未与限定 target 冲突时继承该 schema；证据缺失或冲突时保持 `QUALIFIED_NAME_ONLY`。
- SQL syntax diagnostic 会阻断该 statement，reason 为 `SQL_PARSE_FAILED`。
- parser 的 `body` / `branches` topology unknown 会阻断该 statement。
- `native_lineage` / `output_columns` 属于字段层缺口，不阻断表级 READ。
- 多语句任务逐 statement 隔离；坏 statement 不污染同表或其他表的干净 statement。
- READ 只有唯一解析到 `(platform,dataSource,qualifiedName)`，且 `dataSource != default`，才可查询 producer。

## 调度骨架边界

可选 `rootOneHop` 是冻结的 root one-hop 证据快照，并参与 root 的
`finalUpstreamTaskIds.primary` 选择。没有提供后续 Task 的 one-hop 快照时，multi-hop
以显式离线空调度输入调用 one-hop：不会调用默认 Horae runner，此时 one-hop 只能在
有足够且不冲突的 producer-index 证据时走 `DATA_FALLBACK`；同表同分区的多个
overwrite writer 无唯一调度裁决时走 `MULTIPLE_OVERLAPPING_PRODUCERS` 并停止该分支。
有 scheduler primary 但没有
Table WRITE bridge 的任务会通过 `scheduleEdges` 保留调度来源和 evidence，不会伪造
Table bridge。

`scheduleSkeleton` 仍只保存 root depth=1 的兼容性投影；各层 one-hop 的调度来源在
Task node 的 `upstreamDecision.evidence` 和 `scheduleEdges` 中保留。

## 输出与 counts

artifact 保存 `taskNodes`、`tableNodes`、`readEdges`、`writeEdges`、`producerBridges`、
`scheduleEdges`、`terminals`、覆盖率和 provenance。`countSemantics=NODE_AND_UNIQUE_EDGE_COUNTS`：
counts 是去重节点/边观察计数，不是物理表全覆盖率，也不证明调度执行、数据到达或业务正确性。

86840 冻结 gate 在 depth=1 保持 27 个 READ、22 个本地 confirmed producer；仅来自实时 supplemental evidence 的 4 个父任务不进入离线 frontier，`pdata_n.ref_dw_cd_val` 保持无 confirmed producer 的 terminal。
