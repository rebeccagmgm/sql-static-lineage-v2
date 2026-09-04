# Input Pack 驱动的跨 Task 字段血缘

## 目标与边界

该流程从同一个 Task/Table Input Pack 准备任务级 Machine Facts，再沿表级 multi-hop 已记录的 one-hop `primary` 决策追踪字段值来源。它解决“表级树已知，但字段级链路仍需人工拼 profile”的问题。

输出仍然是静态 SQL、Task 配置和 Table Pack DDL 能证明的技术证据，不代表调度实际运行、数据已经到达、数据正确或业务验收通过。

## 证据链

```text
Task/Table Input Pack
  -> Input Pack Machine Facts builder
  -> task-scoped Machine Facts Bundle
  -> table multi-hop primary decisions
  -> FIELD_MULTI_HOP_RECONCILIATION JSON
  -> deterministic tree summary
```

Machine Facts 输入会记录 Task Pack、SQL slot、目标 Table Pack、DDL 的 locator、content hash/sha256。Canonical SQL 只读取和按原字节冻结，不执行格式化或覆盖。

## 第一步：从 Input Pack 生成 Machine Facts

```text
npm run input-pack:machine-facts -- \
  --data-root <input-pack-root> \
  --task-id 155015,114026,105387 \
  --output <facts-root>
```

SQL slot 准备规则：

1. 可用 `query` 唯一时，由 `query` 决定任务目标输出；同 Task 中含字段生产 CTAS/INSERT 的 `create`、`prepare` 等 slot 一并进入分析。
2. 每个原始 SQL slot 都按 Input Pack 原字节和 sha256 单独冻结；多 slot 联合快照仅是派生分析输入，不覆盖 canonical SQL。
3. statement 身份使用 Task ID、原 slot 名和 slot 内 ordinal。
4. 没有 `query` 时，只允许唯一一个结构上产生字段的 slot；多个候选或没有候选时返回 `SQL_SLOT_SELECTION_AMBIGUOUS`。

SQL 中的 INSERT/CTAS 使用 `SQL_EXPLICIT_WRITE`。纯查询任务只有在 Pack 目标唯一、目标 Schema 可用、查询 producer 唯一、非分区目标列与输出 ordinal 完整对应，并且分区处理可证明时，才使用 `PACK_DECLARED_QUERY_OUTPUT`。该写观察和绑定同时保留 `provenance=PLATFORM_TARGET` 与原始 Pack SQL 的 `source_sql_sha256`；既有 Facts 中的 `PLATFORM_TARGET_QUERY_OUTPUT` 仅作为兼容读取别名。同一 Input Pack 中语义等价的重复查询输出候选会在派生分析视图中去重；原始 SQL slot 仍按原字节保留，真正不同的候选仍 fail-closed。

## 第二步：生成字段 multi-hop

```text
npm run reconcile-field-lineage -- \
  --data-root <input-pack-root> \
  --facts-root <facts-root> \
  --multi-hop-artifact <table-multi-hop.json> \
  --task-id 155015 \
  --target-table dm_rsk_n.v_risk_audit_log \
  [--write-observation-id <write-observation-id>] \
  [--fields entity_id,entity_field_name,modify_date] \
  --facts-policy allow-legacy-partial \
  --max-depth 8 \
  --max-states 5000 \
  --max-paths 10000 \
  --output <field-lineage.json> \
  --summary-output <field-lineage.txt>
```

字段血缘根按 `task_id + write_observation_id + physical_target` 定位。若目标表与
Task Pack 的平台目标不同，必须显式提供 `--write-observation-id`；Consumer 不会
仅凭表名在多个 SQL Write 中猜选。平台目标与根目标相同的旧调用，仍可由当前
Machine Facts 推导该目标下的 Write Observation 集合。

当字段链需要使用第二层及更深层的调度证据时，先为对应非根 Task 生成冻结的 one-hop artifact，并在表级 multi-hop 命令中通过 `--one-hop-snapshots <a.json,b.json>` 传入。每份快照必须与当前 producer-index 的 content hash 和 Input Pack fingerprint 一致；不一致时 multi-hop 会 fail-closed。

CLI 默认先从主 Input Pack 为表级 artifact 中可用的 Task 准备 Machine Facts。已有受控 facts 且不希望重建时可传 `--no-prepare-facts`。

省略 `--fields` 时，流程从根 Write Observation 的物理目标 Table Pack 的全部 Schema 列建立字段入口，再沿每个字段的可证明值流裁剪无关上游分支。显式传入 `--fields` 时仍只分析指定列。若当前 Task 自身与字段来源是同一物理目标表，其历史同表 producer 只保留为 `CANDIDATE`，不递归进入值流树。

`--facts-policy` 默认是 `current-only`。版本等于当前 Machine Facts 发布器 Contract 的 Bundle（当前为 1.3.0）可形成 `CONFIRMED` 字段证据；只有非当前发布版本才按 legacy 处理。显式使用 `allow-legacy-partial` 时，legacy 路径状态为 `PROVISIONAL_LEGACY`，整体结果不得为 `COMPLETE`。

## 图语义

- 主树只包含 `VALUE_FLOW`：目标输出字段表达式到 Schema-backed 物理输入字段，再精确桥接到上游 Task 的同一物理目标字段。
- 跨 SQL slot 的临时 CTAS 或 field-producing INSERT 字段使用 `TASK_LOCAL_SCHEMA_BACKED`，只在当前 Task 内回溯；它们不能成为跨 Task 物理桥。
- Machine Facts 额外发布 `task-local-materializations.jsonl`。只有同一 Task、同一物理表、写入语句严格早于读取语句且 output binding 唯一匹配的记录才是 `RESOLVED`；多次写入或绑定不完整时保留 `AMBIGUOUS/UNRESOLVED`。
- 字段 consumer 优先消费 Task-local materialization，再消费跨 Task `primary`。同 Task 自生产不会进入 Task frontier，也不会把 `additional` 提升为 `primary`。
- `ROWSET_CONTROL` 单独列出 Join、filter、aggregate、set operation、window 和 distinct。不能证明跨 CTE/子查询作用域时记录 `ROWSET_SCOPE_UNRESOLVED`。
- 控制证据中的 physical ref 若为裸表名，先继承当前 Task Pack 能证明的默认 schema（例如 Horae Hive 扩展信息中的 Hive 库），再按限定名匹配 Table Pack；没有默认 schema 时才要求裸表名在 Table Pack 中唯一匹配。当前 Task 的临时 CTAS 表则使用同 Task 的 `schema-refs`。多候选、缺失或别名无法由物理证据闭合时仍保持 `ROWSET_FIELD_IDENTITY_UNRESOLVED`。
- 只递归每层 `finalUpstreamTaskIds.primary`。
- `additional` 记录为 `CANDIDATE`，但不递归。
- `unknown` 在字段相关时保留为 `CANDIDATE` 并生成 gap，但不建立 `VALUE_FLOW`、不递归；物理身份不一致、缺失/排除 Task Pack、facts 不可用、cycle 和安全上限也都停止对应分支并生成 gap。
- `checkdbflag` 类检查任务不承载 SQL 字段生产，作为字段值流的非血缘终点跳过，不生成字段缺口；其他缺失或不可用 Task Pack 仍按证据缺口处理。
- 字段穿透必须同时存在本层 multi-hop 的 `producerBridges` 或 `scheduleEdges` confirmed Task 边；只在全局 artifact 中发现同名 writer、但从 `rootNodeIds` 不可达的节点不能进入字段值流。

物理字段桥接键为：

```text
platform | dataSource | stableTableId | qualifiedName | normalizedColumn
```

字段必须存在于 Table Pack DDL 解析出的 Schema。字段名相似、Task 名后缀或仅 SQL 文本候选都不能替代该身份。

## 状态

节点和边：

- `CONFIRMED`：当前 Contract/L1 facts 与 Schema-backed 物理身份闭合。
- `PROVISIONAL_LEGACY`：显式允许消费 Contract 1.3，但不能升级为 confirmed。
- `CANDIDATE`：one-hop `additional`，只展示不递归。
- `UNRESOLVED`：证据缺失、冲突、排除、超限或不可证明。

整体：

- `COMPLETE`：所有请求字段 primary 值流闭合，无 legacy、Unknown 或截断。
- `PARTIAL`：至少一部分字段可追踪，但存在 legacy 或 gap。
- `BLOCKED`：没有任何请求根字段能够从合格 facts 开始遍历。

## 155015 验收注意事项

155015 首版应显式使用 `allow-legacy-partial`。如果 112715 仍被 Input Pack 状态标记为 `EXCLUDED / PHYSICAL_TABLE_NOT_FOUND`，114026 的相应上游分支必须以 `TASK_INPUT_PACK_EXCLUDED` 停止，整体为 `PARTIAL`；不得读取 `.not-found-tasks` 目录后把结果标成闭合。

112715 经正常 Input Pack 收集流程恢复到主 data root 后，重新构建 producer-index、table multi-hop 和 Machine Facts，再用相同字段命令复验。
