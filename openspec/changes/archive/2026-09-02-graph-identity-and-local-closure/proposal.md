# WP-7：任务身份与任务内闭合

## Why

WP-6 已把 Pack 声明的写观察补进当前 Facts 生产路径。现有 task-local 投影仍把
读取压成 `TASK → PHYSICAL_DATASET`，按旧的 catalog fallback 处理裸名，也没有消费
`task-local-materializations.jsonl`。这会把读次、同任务临时表和身份资格混在一起，
下游无法在不猜测的前提下做 WP-8 的逐读次接续。

## What changes

- 将 task-local projection 的新产物版本提升为 `1.2.0`，同时继续验证已有 `1.1.0`
  投影，避免历史缓存和夹具被静默改写。
- 按 graph-accuracy-architecture §3 输出物理表身份、裸名资格和 reason code；不使用
  catalog tail 猜测或任务名正则推表。
- 将每个 `read_occurrence` 投影为 `READ_OCCURRENCE` 节点，并保留按读次、按列的
  `partitionPredicates`。
- 只按 Facts 的 `task-local-materializations.jsonl` 折叠已 `RESOLVED` 的本地临时列；
  `UNRESOLVED`/`AMBIGUOUS` 和没有 materialization 证据的 temp 名称保留边界。
- 将读本任务最终写表标成 `SELF_READ`，不产生上游 task 节点。
- 在投影上补充 `finalWrites`、`externalReads`、`localFieldPaths` 任务内闭合摘要，
  供 WP-8 读取；不在本包实现 UNION、跨任务闭包或新的 SQL 解析器。

## Non-goals

- 不修改 SQLLens、Plan Facts、Machine Facts、producer-index、one-hop 或 closure。
- 不把调度邻居转成数据边，不改已有 1.1.0 产物字节。
- 不用合成 SQL 或未证实的 temp 名称规则补全事实。

## Acceptance boundary

真实 sibling Pack/Facts 用 103928、103234、103230、105387、105380、176827、119044
做身份、materialization、读次和回归断言；自读形状用小型 Facts fixture 只验证契约，
不把合成 fixture 当唯一证据。
