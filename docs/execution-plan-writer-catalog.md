# Writer Catalog（表 → 谁写了它）

配套：

| 文档 | 关系 |
| --- | --- |
| `execution-plan-table-lineage-acceptance.md` | T3-C/D 的「全库是否有 writer」改问本目录 |
| `execution-plan-task-local-union.md` | 接续 INDEX 的批外 writer 源 |
| `execution-plan-gold-case-investigation.md` | `--expand-upstream` 不再依赖 `producer-index:update` |
| `execution-plan-field-evidence-v1.md` | continuation 端口换 catalog；**列级** `producerIndexForTask` 仍读 Facts bundle |

状态：**方案已定（2026-09-04）** — 先落地 SQLite + 端口 + Facts 挂钩，再改下游；表血缘第一批（sparkIndex SUCCESS）**不跑** `producer-index:update`。

---

## 0. 一页摘要

**要什么**：给定物理表，查出 confirmed writer 任务（及写观察）。

**不要什么**：再扫全库 Input Pack SQL、再维护 ~100MB `producer-index.json`、把调度邻接或字段边塞进同一库。

**怎么做**：Machine Facts `dataset-io.jsonl` 的 `WRITE` → SQLite 倒排 → `WriterCatalog` 点查。过期用 `task_content_hash` + Facts `manifest_sha256` 行级对账。

```text
Input Pack → Machine Facts (sqlglot)
                 │ dataset-io WRITE
                 ▼
        writer-catalog.sqlite
                 │
                 ▼
        WriterCatalog 端口
           ├── expand-upstream
           ├── union-continuation-index（T3-C/D）
           └── field-evidence continuation（批外 writer）
```

---

## 1. 为什么换

| 现状 | 问题 |
| --- | --- |
| `producer-index:update` 扫 `tasks/**/task.json` + SQL `extractSqlWrites` | 与已存 sqlglot/Facts 重复；fingerprint 一变整库重建 |
| `producer-index.json` ~100MB | 下游只要点查，却加载全部边 |
| 不更新则过期 | 会把「其实有 writer」误判成 `NO_KNOWN_WRITER` |

能力仍要保留：**全局谁写了这张表**。存储与更新路径换成 SQLite + Facts。

列级字段边索引（`FieldEdgeIndex` / `producerIndexForTask`）**不是**本目录，继续读各任务 Facts bundle。

---

## 2. 原则

1. **真相在 Facts**：只从 `dataset-io` 的数据写出派生行，不回 Pack 再 parse。
2. **SQLite 是目录**：行级 hash；对不上只重刷该 `task_id`。
3. **下游改端口**：`writersForTable` / `hasConfirmedWriter`，不把旧 `TableProducerIndex` 整包搬进 DB。
4. **诚实覆盖**：未出 Facts 的任务 = 目录没看见；T3 走 `NO_KNOWN_WRITER`（或报告 `factsMissing`），禁止用过期 JSON PI 装全知。
5. **先瘦**：第一期只入库 confirmed 物理写；`nonConfirmed`、任务内 temp、纯 truncate-only 不搬。

---

## 3. 落盘与 schema

默认（data-root **外面**）：

```text
<sql-static-lineage-data.writer-catalog>/writer-catalog.sqlite
```

引擎：`node:sqlite`（与 schedule-evidence sqlite 相同）。

### `meta`

| 列 | 含义 |
| --- | --- |
| `schema_version` | 目录 schema |
| `built_at` | 最近写入 |

### `task_coverage`

| 列 | 含义 |
| --- | --- |
| `task_id` | PK |
| `task_category` | 身份归一要用 |
| `task_content_hash` | Pack `task.json.contentHash` |
| `facts_manifest_sha256` | Facts bundle manifest |
| `facts_status` | `SUCCESS` / `FAILED` / `MISSING` |
| `indexed_at` | 写入时间 |

### `table_writers`

| 列 | 含义 |
| --- | --- |
| `table_key` | `lower(platform)\0lower(dataSource)\0lower(qualifiedName)` |
| `platform` / `data_source` / `qualified_name` | 查询与对账 |
| `writer_task_id` | writer |
| `write_observation_id` | Facts 已有则用；否则确定性派生 |
| `write_kind` / `resolution_status` / `physical_dataset` | 对账 |
| `partition_json` | 第一期可空；分区匹配仍以纸条 + Facts 为准 |

PK：`(table_key, writer_task_id, write_observation_id)`  
INDEX：`table_key`；`writer_task_id`

单任务刷新：`DELETE … WHERE writer_task_id=?` 再 `INSERT`，与 `task_coverage` 同一事务。

**不入库**：READ、字段边、expression、`upstreamTaskIds`、未解析身份、intra-task temp、`dataPathRole≠PRODUCER` 的纯清理。

---

## 4. 身份

与 continuation 现有 `resolveProducerTableIdentity` 同一套：

- 三段以上：`platform` / `dataSource` / `qualifiedName`
- sparkIndex / hiveTask / hiveTask-2.0 两段 `db.table` → `hive` + `gfhive`
- 不够格 → `unknown`（可查，不假装 Hive writer）

入库用 **writer** 的 `task_category` 归一 `physical_dataset`。

---

## 5. 写入时机

1. **挂钩**：`input-pack:machine-facts` 每个 SUCCESS 任务结束 UPSERT。
2. **回填**：扫描已有 `field-facts/registry/tasks/*`（只读 Facts，不扫 Pack SQL）。
3. **对账**：Pack hash 或 Facts manifest 变了只重刷该行。

表血缘第一批（12366 sparkIndex SUCCESS）：Facts 跑完目录自然齐；**命令里不要** `producer-index:update`。

---

## 6. 端口

模块建议：`scripts/query/writer-catalog.ts`（或 `scripts/reconcile/producer/writer-catalog.ts`）。

```ts
writersForTable(table): WriterHit[]
hasConfirmedWriter(table): boolean
```

`WriterHit`：`taskId` + `writeObservationId` + 表身份 + 可选 `writeKind`。

| 消费 | 改法 |
| --- | --- |
| union-continuation `PRODUCER_INDEX_ONLY` | catalog 点查；批内仍用纸条写观察 |
| `--expand-upstream` / input-pack closure | READ 表 → writers → 下一跳 taskId |
| field-evidence continuation 批外 writer | `ports.producerIndex` 整包 → `ports.writerCatalog` |
| 验收 T3-C/D | 「PI 有 writer」→「catalog 有 writer」 |

过渡期测试可 `WriterCatalog.fromLegacyProducerIndexJson()`；生产路径不读 JSON PI。

---

## 7. 与 T1–T4

| 尺子 | 是否依赖 catalog |
| --- | --- |
| T1/T2 任务内表级 | 否 |
| T3-A/B 批内接续 / DISJOINT | 否（纸条并集） |
| T3-C `WRITER_NOT_IN_UNION` | 是 |
| T3-D `NO_KNOWN_WRITER` | 是（仅「已入库 Facts 范围」） |
| T4 身份分叉 | 否 |

sparkIndex 已入库、上游 hiveTask 尚未 Facts → 合法 T3-D。要减少 D：给那些 writer 补 Facts 再 UPSERT，而不是重跑 PI。

H1 报告增加：`catalogTasksIndexed`、`factsMissingWritersLookedUp`。

---

## 8. 工作包

| 包 | 内容 | 完成定义 |
| --- | --- | --- |
| **WC-0** | 本文档 | 与验收 / 金样跑批命令对齐 |
| **WC-1** | schema + UPSERT + 回填 CLI + 单测 | 点查、过期、删任务；已有 Facts 可导入 |
| **WC-2** | Facts CLI 挂钩 | 每任务 SUCCESS 后目录可见 |
| **WC-3** | continuation / expand-upstream / T3 改端口 | 第一批命令无 `producer-index:update` |
| **WC-4** | 停写 JSON PI；夹具迁 sqlite/fixture rows | `producer-index:update` 退出主路径 |

顺序：**WC-0 → WC-1 → WC-2 → WC-3**；WC-4 可后置。不把压缩 Facts jsonl、调度邻接 sqlite 并进本 WP。

---

## 9. 硬约束

1. 不修改 SQLLens / Facts 发布器来「迎合」目录；写观察以 `dataset-io` 为准。
2. 调度 `upstreamTaskIds` 不得写入 `table_writers`。
3. 目录未覆盖 ≠ 物理上无 writer；报告必须能区分。
4. 输出路径必须在 data-root 外（与现 PI sibling 约定一致）。
5. 列级 Impact 仍走 Facts bundle，禁止把 expression/column-lineage 灌进本 SQLite。

---

## 10. 完成判据

1. 「谁写了表 X」只打 SQLite 索引。
2. 重刷单个任务 Facts 后，目录立刻更新，无需全库 rebuild。
3. 12366 表血缘批：Facts → 纸条 → continuation，中间没有 `producer-index:update`。
4. 过期靠行级 hash，不再依赖一份可能过期的 `producer-index.json`。
