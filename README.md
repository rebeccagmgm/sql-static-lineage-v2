# SQL Static Lineage L1

这是一个独立、只读、证据约束的 SQL Static Lineage L1 主线。它只回答本地 SQL 与声明的 Schema/View snapshot 能证明什么，不执行 SQL、不触发调度、不读取业务数据行，也不把 Consumer 的推断写回 Canonical Machine Facts。

## 当前结论

- 整理状态：`COMPLETE`。新目录已经有单一 L1 scope、架构、迁移清单和验收入口。
- 代码迁移状态：`BASELINE_MIGRATED`。已迁移 parser/analyzer engine、P0 写入绑定基线、Schema/Plan adapter 和 Task Inspection Consumer。
- 算法验收状态：Contract 2.0 仍为 `PENDING`；表级单跳 P0 已通过 86840 冻结证据回放（26 个直接父任务、27 张直接读表、26 个 `MATCHED`、1 个 `SQL_ONLY`）。单跳验收不等同于 Contract 2.0 或完整 L1 闭合。

唯一主线和边界见：

- [L1 scope 与架构](docs/l1-scope-and-architecture.md)
- [迁移清单与来源证据](docs/migration-inventory.md)
- [验收入口与 Gate](docs/acceptance.md)
- [金样调查页执行方案](docs/execution-plan-gold-case-investigation.md)（P0：`105387 → 119044 → 176827`）
- [数据资产图执行方案](docs/execution-plan-asset-graph.md)
- [图谱准确性架构](docs/graph-accuracy-architecture.md)
- [文档索引](docs/README.md)
- [86840 Gold Case 入口](tests/gold/README.md)
- [统一 Task/Table Input Pack V1](docs/input-pack.md)
- [表级单跳对账器](docs/reconcile-one-hop.md)
- [Table producer 反向索引](docs/producer-index.md)
- [表级多跳数据路径](docs/reconcile-multi-hop.md)
- [Input Pack 驱动的跨 Task 字段血缘](docs/field-lineage.md)
- 图谱消费、离线视图、query index 与目标因果 overlay：`E:\02_area\股衍数据-数据cookbook\scripts\data-graph\README.md`

## 最小运行入口

在本目录安装依赖后：

```text
npm test
npm run typecheck
npm run inspect -- --facts-root <current-facts-root> --task-id 86840 --question-spec <question.json> --output <derived-output>
npm run reconcile-one-hop -- --task-id 86840 --data-root <input-pack-root> [--producer-index <producer-index.json>] --output <result.json>
npm run reconcile-one-hop:batch -- --task-ids 181058,176827 --data-root <input-pack-root> --producer-index <producer-index.json> --output-dir <result-dir>
npm run producer-index -- --data-root <input-pack-root> --output <producer-index.json>
npm run reconcile-multi-hop -- --task-id 86840 --data-root <input-pack-root> --producer-index <producer-index.json> [--root-one-hop <root-one-hop.json>] [--one-hop-snapshots <child-a.json,child-b.json>] --max-depth 2 --max-tasks 1000 --max-edges 10000 --output <result.json>
npm run reconcile-multi-hop:autofill -- --task-id 181058 --data-root <input-pack-root> --max-depth 3 --max-tasks 1000 --max-edges 10000 --output <result.json> --report <autofill-report.json>
npm run reconcile-multi-hop:batch -- --task-ids 181058,176827 --data-root <input-pack-root> --producer-index <producer-index.json> --output-dir <result-dir>
npm run visualize-multi-hop -- --task-id 181058 --artifact-dir <multi-hop-output-dir> --output <lineage.html>
npm run visualize-task-local-machine-graph -- --help
npm run input-pack:machine-facts -- --data-root <input-pack-root> --task-id 155015,114026,105387 --output <facts-root>
npm run reconcile-field-lineage -- --data-root <input-pack-root> --facts-root <facts-root> --multi-hop-artifact <table-multi-hop.json> --task-id 155015 --target-table dm_rsk_n.v_risk_audit_log [--write-observation-id <write-observation-id>] [--fields entity_id,entity_field_name] --facts-policy allow-legacy-partial --output <field-lineage.json> --summary-output <field-lineage.txt>
```

该命令先输出压缩后的 `viz-model-181058.json`，再渲染离线 HTML；同一物理表的多个
Task 会合并到表节点中，并在详情里保留各 Task 的分区证据。

图谱消费、离线视图、query index 与目标因果 overlay 已迁移到独立的
`E:\02_area\股衍数据-数据cookbook\scripts\data-graph`。本仓库只负责生成和发布
one-hop、multi-hop、field-lineage 及 target-table causal closure Artifact；图层不回写事实。

`inspect` 只读 Current Index 选中的 Bundle，并输出 `task-inspection.json` 与 `index.html`。它不扫描任务目录、不重新解析 SQL、不使用 Profile 猜测字段。

## 目录边界

```text
(engine)                     npm package `sqllens@1.8.0` (no vendored src/)
scripts/plans/               engine -> L1 observation adapter
scripts/machine-facts/       per-task fact assembly and publication
scripts/input/               external Task/Table input collection, contracts and repairs
scripts/query/               validated Current Bundle loader and Reader
scripts/reconcile/           producer index, one-hop reconciliation, bounded table multi-hop
scripts/reconcile/consumer/field-lineage/  bounded cross-Task VALUE_FLOW and ROWSET_CONTROL projection
Artifact boundary          published canonical one-hop/multi-hop/field-lineage/target-causal artifacts; graph projections live in standalone data-graph
schemas/                     current baseline schemas; Contract 2.0 remains pending
tests/                       focused regression tests; no generated corpus
tests/gold/                  Contract 2.0 的 86840 acceptance entry; evidence is intentionally absent
tests/fixtures/reconcile-one-hop/  表级单跳 86840 冻结证据夹具
docs/                        scope, migration, acceptance and review records
```

不要把 Panorama、下游任务发现、业务语义、LLM/Wiki 或历史生成数据写入 L1 canonical facts。项目图、字段图、目标因果覆盖层和 Neo4j 只能是由已发布证据重建的只读投影/索引，不能反向成为事实源；任何新增能力仍须证明它服务于字段闭合或受证据约束的消费入口。
