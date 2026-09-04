# Unified Task Input Pack V1

The batch collector performs a bounded Horae lookup for the requested task IDs.
It uses the task-list label `手工` and frozen status `F` first, then checks the
Horae detail label `手动` for IDs not returned by the list search; these labels
refer to excluded scheduling states.
Tasks identified by the direct Horae cycle label `手工`/`手动`, or by the
direct Horae status `F` (冻结), are written under a
separate sibling root, by default `<data-root>.manual-tasks`, instead of under
the main Input Pack root. Existing matching Task Pack directories are moved
there without overwriting an existing archive directory; no evidence is
deleted. Use `--manual-data-root <path>` to choose another external archive
root. A failed manual-task lookup fails closed instead of silently creating
lineage noise. The checkpoint records these tasks as
`EXCLUDED/MANUAL_OR_FROZEN`; later batches skip them and `--force` retries the
Horae classification.

When Horae's exact all-status search returns no task record, the task is classified as
`HORAE_TASK_NOT_FOUND`, is not sent to `szdata task-source`, and is recorded as
`EXCLUDED` in the status file. Existing matching Task Pack directories are
moved to a separate sibling root, by default `<data-root>.not-found-tasks`,
without deletion. Use `--not-found-data-root <path>` to choose another
external archive root. A later batch skips the recorded ID; `--force` retries
the Horae lookup.

If collection succeeds technically but a required physical source/target table
cannot be confirmed, the Task Pack is classified as
`EXCLUDED/PHYSICAL_TABLE_NOT_FOUND` and moved to the same not-found archive.
This prevents a partial, non-physical endpoint from entering the main Input
Pack on later batches. A controlled database-to-Hive task may expose a data
source identifier rather than a physical source-table name in `source`; that
identifier is not treated as a table. The collector conservatively discovers
physical `FROM`/`JOIN` references from the SQL slots and resolves them against
the task category's controlled source data source before deciding whether the
source evidence is missing.

The input writer accepts direct evidence already obtained by the existing OpenCLI adapters. The batch entrypoint parses the task IDs, performs the bounded Horae manual-task lookup, and invokes one isolated single-task collector per ID. The production collector invokes the existing `opencli szdata task-source`, `table-search`, `table`, and `table-ddl` commands, and only when SzData reports SQL unavailable it tries the existing read-only `opencli horae detail` command for missing SQL slots. Normal OpenCLI calls have a 30-second process timeout; the Horae fallback has a five-second limit. Timeout or no-SQL results are reported in the command summary and leave the slot unavailable. It does not call HTTP, a database, or a source-control API directly, and it does not import the SQL parser/analyzer; SQL table discovery is limited to a conservative `FROM`/`JOIN` reference extractor.

To repair missing Table Pack evidence from a producer-index report, use the
bounded repair command below. It reads only the selected task category,
queries each unique qualified table name through the existing SZData adapters,
and writes a Table Pack only after GUID, physical data source, and DDL evidence
are all confirmed. `--include-intermediate` also checks the separately stored
task-internal materializations. Missing or ambiguous tables are reported and
are not fabricated.

```powershell
npm run repair:missing-table-packs -- --data-root "<input-pack-root>" `
  --producer-index "<producer-index.json>" --task-category sparkIndex `
  --include-intermediate
```

Run the four frozen production task collections from the repository root with one command:

```powershell
npm run input-pack:tasks -- --data-root "E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data" --task-ids "39045,180065,86840,246247"
```

The collector runs OpenCLI calls serially with at least one second between calls by default. The defaults are overridable for an explicitly authorized environment with `INPUT_PACK_OPENCLI_MIN_INTERVAL_MS`, `INPUT_PACK_OPENCLI_TIMEOUT_MS`, `INPUT_PACK_HORAE_TIMEOUT_MS`, and `INPUT_PACK_HORAE_SEARCH_TIMEOUT_MS`; the defaults are 1000ms, 30000ms, 5000ms, and 30000ms, and all overrides must be positive integers. A failed task is reported as a task-scoped `FAILED` summary and does not stop later task IDs. It writes only external `tasks/` and `tables/` assets and prints a compact per-task summary; SQL/DDL bodies are not printed. Ambiguous or unavailable table evidence remains uncollected. Pure task-count/status-size checks and status loading happen before the optional `--repair-malformed-tables` move, so a hard-rejected batch does not quarantine directories. The collector fails before making platform calls if the existing root has malformed direct children under `tables/`; use a new empty root or migrate/quarantine those directories separately. It does not delete them.

The batch entrypoint also maintains an operational status file outside the data root, by default next to it as `<data-root>.input-pack-status.json`. A custom `--status-file` must also be outside the data root. It records each requested task as `SUCCESS`, `PARTIAL`, or `FAILED`, including its actual main/archive directory, content hashes for the Task and written Tables, Table counts, unavailable references, warnings, and error. A clean `SUCCESS` task is printed as `SKIPPED` only when the Task JSON, every SQL file, every recorded Table JSON, and every recorded `ddl.sql` still exists and matches the saved hashes under the selected root. `PARTIAL`, `FAILED`, stale-legacy tasks, or externally changed/deleted assets are retried. Use `--force` to rerun successful tasks, `--status-file <path>` to choose another status file, or `--manual-data-root <path>` to select the manual-task archive root. The final `collectionStatusSummary` distinguishes `cleanSuccess`, `successWithWarnings`, and `successNeedingRefresh`, and reports both initial and final status-file bytes. Batches over 100 task IDs or status files over 2 MiB emit a split warning; batches over 1000 task IDs or status files over 8 MiB are rejected before OpenCLI calls. If a checkpoint crosses 8 MiB during a batch, the completed task is retained, remaining task IDs are stopped, and the command exits nonzero. The status file is a task execution index, not a complete inventory of the main or archive data root: its Table references cover only Tables written or observed by those task runs, not every `tables/` directory. The loader can recover a valid orphan `.bak`/`.tmp` checkpoint after an interrupted replacement. This status file is not a root Manifest, Snapshot, or latest pointer, and is not a Task/Table asset.

To keep using an existing root, explicitly quarantine malformed legacy Table directories and continue in the same root:

```cmd
npm run input-pack:tasks -- --data-root "..\sql-static-lineage-data" --repair-malformed-tables --task-ids "39045,180065,86840,246247"
```

The directories are moved to a new sibling quarantine directory and are not deleted. Without `--repair-malformed-tables`, the fail-fast check remains enabled.

The external data root has only these asset families:

```text
<data-root>/
├── tasks/<taskCategory>/<taskId>/task.json
│   └── sql/{create,query,prepare,truncate,finish}.sql  # only when supplied
└── tables/<platform>/<qualifiedName>__<dataSource>/
    ├── table.json
    └── ddl.sql
```

`create.sql` is the platform task's original CREATE slot. `ddl.sql` is the current physical-table DDL obtained from metadata or a controlled read-only source. Neither is generated from the other.

SQL slots are written exactly as returned by the platform. The collector does
not normalize comments, insert statement separators, or otherwise rewrite the
SQL before storing `sql/<slot>.sql`; these files are canonical source evidence
and their hashes cover the returned bytes. If a parser needs a conservative
repair for a malformed legacy artifact, that repair must be performed in a
derived analysis view and must not replace the canonical SQL file. The
Input Pack-driven Machine Facts builder uses this boundary explicitly: raw SQL
is frozen and hashed as source evidence, while a parser-only view may remove an
adjacent repeated response block before statement enumeration.

Legacy stored Task Packs may contain SQL that was rewritten by an older
collector. Before using the normalizer migration, prefer recollecting the Task
Pack from the platform so the canonical SQL is restored. If migration is
unavoidable, run it in dry-run mode first:

```powershell
npm run input-pack:repair-stored -- --data-root "<input-pack-root>"
```

Add `--apply` only after reviewing the summary. The migration validates each
existing SQL hash, stages each changed Task Pack, writes a new SQL hash and
`contentHash`, and copies the original directory to a timestamped
`.input-pack-repair-backups/` root before replacement. Packs with invalid
structure or mismatched hashes are skipped and reported; they are never
silently rewritten. The migration is idempotent, so a second dry-run over the
same root should report zero changes.

For a partition-only refresh of stored packs, use the local SQL/Table evidence
without recollecting task metadata:

```powershell
npm run input-pack:rebuild-partitions -- --data-root "<input-pack-root>" --dry-run
npm run input-pack:rebuild-partitions -- --data-root "<input-pack-root>"
```

This command only changes `task.json.partition` and its `contentHash`; it keeps
the existing task fields, SQL files, scheduler evidence, and code evidence.
Use `--task-ids 100717,119044` to update a bounded set, and add `--details` to
inspect internal per-task target statuses during a bounded dry-run.

`task.json.partition` keeps a compact configuration shape. A single complete
partition instance is an object, for example
`{ "busi_date": "${YYYY-MM-DD}" }`; multiple complete instances are an array
of such objects so values from different SQL branches stay paired, for example
`[{ "grp_id": "01", "busi_date": "${YYYY-MM-DD}" }, { "grp_id": "02", "busi_date": "${YYYY-MM-DD}" }]`.
It is `null` only when the target is confirmed non-partitioned, and is omitted
when the target partition or any required value is not uniquely proven.
Detailed task, target, write,
assignment, and reason-code evidence remains internal to collection/rebuild
and is never stored in the Input Pack. Source-table predicates and
source-extraction SQL are not target partition mappings; `SELECT *` plus a
same-named `WHERE` predicate does not prove a dynamic target partition binding.
Runtime values such as `${YYYY-MM-DD}` remain templates rather than rendered
business dates. For `sparkIndex`, when a target partition assignment contains a
concrete valid ISO date literal such as `'2026-05-24'`, the compact map
canonicalizes it to `${YYYY-MM-DD}`; this normalization is limited to target
partition assignments and does not rewrite source predicates or other SQL
values. In `sparkIndex` mode, a uniquely mapped non-literal target expression
may remain as its expression text, while a bare unresolved output field remains
insufficient evidence for non-temporal fields. `sparkIndex` uses controlled
templates for temporal partition fields when their write expression is
unresolved: `busi_date` uses `${YYYY-MM-DD}`, `busi_mon` uses the SQL-proven
month shape such as `${YYYYMM}` or `${YYYY-MM}`, and relative offsets such as
the previous month remain explicit (for example `${YYYY-MM,-1M}`). `busi_year`
and `mon_no` use year/month templates when their SQL shape supports that
interpretation. When the target table, its partition fields, and a target SQL
write are confirmed but a dynamic output value cannot be enumerated, the
resolver records `*` for that field; `*` means dynamic write range, not a
concrete partition value. This rule applies to SQL-writing task categories,
not source-extraction queries that have no target-write evidence. Unavailable
target or partition-field evidence still omits the whole map.

`canonicalJson` recursively sorts object keys while preserving array order. `sha256Text` hashes the exact UTF-8 bytes that will be written. Task/Table `contentHash` excludes only `collectedAt` and itself. Every task type uses the same task.json envelope: `taskId`, `taskCategory`, direct `taskType`, direct `taskName`/schedule name when supplied, direct `topicName` when supplied, direct schedule-cycle/status when supplied, direct one-hop Horae `upstreamTaskIds`/`downstreamTaskIds` when the corresponding relation cache is proven (empty array means no neighbors; omit when unproven), direct `source`/`target`, direct endpoint `dataSource` when the platform or a directly matched Table supplies it, direct `writeMode`, direct target `partition`, and actual SQL slots. `taskCategory` comes from the separate controlled Horae type dictionary; for example, type `30` is `hive2mysql`, while an unmapped code remains `taskType-<code>`. The current dictionary is sourced from `05_l_lb_task_type_Horae任务类型字典_20260819.xlsx` (columns `type_id`/`type_desc`, 60 rows). When a mapped numeric code and a stale platform type name disagree, the dictionary mapping wins; a direct platform type name is used only when the code is not in the dictionary. A physical endpoint is represented uniformly as `{ platform, qualifiedName, dataSource }` only when its identity is directly confirmed; without Table evidence, the original endpoint value remains unchanged. The controlled platform mapping is `sparkIndex → gfhive`, `hiveTask-2.0 → gfhive`, `mysql2hive.target → gfhive`, `hive2oracle.source → gfhive`, and `hive2starrocks.source → gfhive` / `hive2starrocks.target → gfstarrocks_idms_all`; it is used to select/check Table candidates, not to fabricate endpoint objects. For SQL READ tables, a connector/source label is passed as a bounded candidate hint: the collector may select a unique physical-source affinity, then requires the selected GUID's current DDL and task-category platform to agree. A hint never overrides an explicit data-source identity and an unresolved or tied match remains an evidence boundary. If task-source omits source/target, the collector first checks the direct `szdata table` task relation and uses `targetEvidenceKind=TABLE_TASK_RELATION_DIRECTION_UNKNOWN` when that relation lists the task ID. If a direct platform target exists but its Table Pack is unavailable, the collector may use a structurally identified terminal SQL target as a replacement only after Table validation; if the direct target is already resolved but SQL proves a distinct terminal write, it collects that additional Table Pack without replacing the direct target. A terminal SQL target may inherit only the task schema for an unqualified table token; the final physical identity still requires a unique `szdata table`/GUID and current DDL. Ordinary `FROM`/`JOIN` mentions and task-name matching alone are rejected. For 86840 this records `PDATA_N.T98_OTC_DERI_COMP_SALE_INFO` through the relation evidence; 163712 can use its explicit `INSERT OVERWRITE TABLE` target after Table validation. Task directories are grouped as `tasks/<taskCategory>/<taskId>`. If a category mapping changes and an older `tasks/<old-category>/<taskId>/task.json` remains, the collector does not delete it; the new run reports it as `staleLegacyTaskDirectories` and the old directory must be migrated or quarantined before treating the root as single-current-state. A table directory uses the readable identity `<qualifiedName>__<dataSource>`; the platform GUID, when present, remains in `table.json` and is not used as the directory name.
`SQL_EXACT_TABLE_TARGET` is only a structural SQL/Table/DDL evidence label; it does not assert a scheduler-configured target, runtime success, data correctness, or business acceptance. For a complex task with several CTAS/intermediate tables and more than one INSERT, the SQL fallback may prefer an INSERT target whose qualified name matches the Task Pack's target/task-name base; this is only candidate selection, and the target is still written only after unique Table/DDL evidence is obtained. If no such target can be selected, the task remains without a target instead of guessing from a task category or temporary-table name. The parser may use the SQL slot and operation internally for candidate selection, but does not persist statement roles or processing relations.
`collectedAt` is the evidence acquisition timestamp, not a business date or partition. It is retained for audit/freshness context but excluded from `contentHash`, so a repeated collection with unchanged facts does not rewrite the asset only because the clock changed. A platform-reported Table `description` is stored as optional display metadata in `table.json`; it never participates in `stableTableId`, qualifiedName matching, or physical identity.

The writer distinguishes omitted fields from explicit `null`. Empty strings, `-`, and empty SQL/DDL content are rejected. Task/Table documents have an explicit allow-list, so analyzer-derived `inputs`, `outputs`, `tableRef`, statement roles, lineage, and processing relations cannot be persisted by the writer. Direct Horae one-hop `upstreamTaskIds`/`downstreamTaskIds` are schedule configuration, not data lineage; they participate in `contentHash` when present.

`dataSource` must be a stable source identifier when one is available. The collector accepts a direct source ID/code or a metadata qualified-name suffix; the known display-name mapping `场外衍生品投资管理系统 → gforacle_gftzdb#gftzdb` is explicit. If only an unmapped display name is available, it uses the reserved sentinel `default`, meaning the physical source is unknown; it does not claim that `default` is a real source.

Writes are assembled and validated under a temporary child of the external root, then the corresponding latest Task/Table directory is replaced. An unchanged content hash leaves the existing directory untouched; a failed build or validation cleans only staging and leaves the previous valid directory.
Task and Table replacements are separate atomic operations; they are not a cross-asset transaction. If a Table write fails after the Task write succeeds, the summary marks `writePhase=TABLE_AFTER_TASK_COMMITTED` and records the committed Task directory so callers do not mistake the result for an all-or-nothing update. A non-physical direct target reference, such as `mysql_atp_tradingdb`, is reported with `tableReferencesUnavailable`, `warnings` containing `TABLE_REFERENCE_UNAVAILABLE`, and `collectionStatus=PARTIAL`; a bare source data-source label is not treated as a missing physical table because source identity must come from SQL READ evidence and Table Pack resolution.

For a SparkIndex task that can be reconstructed from Horae detail, use the isolated collector:

```powershell
npm run input-pack:sparkindex -- --data-root "<input-pack-root>" --task-id 100931
```

It first validates and reads
`<cache-root>/schedule-evidence/tasks/<taskId>/horae-task-type.json`. A cache
hit avoids the Horae request. A missing or invalid entry triggers one
`horae detail` call; a valid response is written back atomically before the
Task Pack is emitted. The independent Portal schedule-detail artifact is
`<cache-root>/schedule-evidence/tasks/<taskId>/szdata-schedule-detail.json`;
it is never written as or merged into `horae-task-type.json`. Fill that
artifact with the fixed-serial collector:

```powershell
npm run input-pack:fill-szdata-detail-cache -- --cache-root "<cache-root>" --limit 10 --max-errors 3
```

It skips valid HITs, calls `opencli szdata schedule-detail --full true` only
for MISS/INVALID entries, and writes each successful task atomically. The
default start-to-start interval is five seconds and can be lowered only with
the non-negative `--interval-ms` option. Use `--cache-root <path>` to override
the shared default cache root. The SparkIndex collector uses valid
schedule-detail evidence first for its target, write mode, and SQL slots, with
Horae detail retained as a separate fallback source. It does not fabricate
physical endpoints: table candidates come only from the structured target and
SQL relation/write clauses. The `lower(normalized db.table)@lower(dataSource)`
key is only an in-process SparkIndex matching key; formal Table Packs retain
the existing `<qualifiedName>__<dataSource>` `stableTableId` and directory
contract. A valid existing Table Pack is reused. Otherwise, a unique ACTIVE
Hive metadata snapshot must confirm the table before an exact task
`CREATE TABLE` supplies DDL or the read-only `szdata table-guid` + `table-ddl`
pair is called serially. The GUID is only a per-call locator and is not
persisted as identity. Use `--metadata-snapshot <path>` to select the Hive
metadata JSONL snapshot; ambiguous, missing, or non-unique ACTIVE rows remain
`PARTIAL`. There is no separate task-level table manifest or raw MCP DDL cache.
Neither collector proves runtime success or data arrival.

The direct cache-fill entrypoints for Horae relation, SZData schedule detail,
Hive task SQL, and the SparkIndex schedule-detail wrapper accept
`--order asc|desc`. The default is `asc`; `--start-task-id` and `--limit` are
applied in that selected order. This changes only processing order and does
not partition the work: do not run ascending and descending commands over the
same full task set at the same time, because they will overlap.

To fill only the tasks already identified as `sparkIndex` by a valid
`horae-task-type.json`, use the dedicated entrypoint:

```powershell
npm run input-pack:fill-sparkindex-schedule-detail-cache -- --cache-root "<cache-root>" --max-errors 10
```

This entrypoint keeps the same fixed-serial and atomic-write behavior, skips
valid detail-cache HITs, defaults to a two-second start-to-start interval, and
accepts `--limit` and non-negative `--interval-ms`. Missing or invalid
`horae-task-type.json` files are excluded rather than classified as
SparkIndex by inference.

Table `platform` is a standard token such as `hive` or `oracle`; the writer rejects values such as `hive / Hive内部表` and `oracle / 物理表`. A Table with direct metadata status `DELETED` may still be saved when current `table.json` and `ddl.sql` are available, and the status remains explicit in `table.json` and the collection summary. If the platform reports a SQL slot as unavailable, that slot is omitted; for 246247 this is why only the real `truncate.sql` is present and no `query.sql` is fabricated. The checked-in cases in `tests/fixtures/input-pack/cases.ts` are de-identified shapes for tasks 39045, 180065, 86840, and 246247. They are not production evidence and do not claim scheduler execution, data correctness, or business acceptance. Live platform fields not present in a supplied evidence object remain omitted; only the separately documented structural SQL-target fallback can add a target, and it requires unique Table/DDL confirmation.
