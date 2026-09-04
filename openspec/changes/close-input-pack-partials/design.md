## Context

See `proposal.md` for motivation. The existing `input-pack-from-cache` path is deliberately offline and already uses local schedule-evidence caches, restored JSONL catalogs, the existing Table Pack store, and the shared Input Pack writer. The current worktree also has active user changes, so this change must be additive and must not reset unrelated files.

## Goals / Non-Goals

**Goals:**

- Reconcile current PARTIAL tasks against stabilized cache state instead of historical summary counts.
- Reuse the current SQL/log cache formats and Input Pack writer wherever their evidence semantics are valid.
- Add a bounded, explicitly enabled online backup path for exact task SQL, Horae logs, table metadata, and table DDL.
- Make datasource ambiguity, duplicate evidence, permission failures, and missing catalog rows visible rather than silently selecting a value.
- Produce per-evidence repair records and a final current-state documentation update.

**Non-Goals:**

- Do not change the default `input-pack:from-cache` contract into an online collector.
- Do not use Horae relation rows as table or SQL evidence.
- Do not infer physical instances from service names, task names, topic names, or fuzzy string similarity.
- Do not prove scheduler execution, data arrival, data quality, or business correctness.
- Do not rewrite all successful Packs or delete/reorganize unrelated existing artifacts.

## Decisions

1. **Create a separate repair entrypoint.** The repair command is opt-in and owns online backup calls. The existing from-cache command remains local-only. A task-id file and the current inventory bound every repair batch.

2. **Use the current cache formats before adding a new one.** `hive-task.sql` remains the compatible task-sql cache file; `run-script.sql` and `hive-target-ddl.sql` remain the log-derived files. For non-specialized categories, an available task-sql query may be consumed as a query-slot fallback with a distinct evidence provider; create SQL is ignored outside the existing hiveTask route.

3. **Retry unavailable evidence explicitly.** `force` means retry an existing `UNAVAILABLE` cache, not overwrite an `AVAILABLE` cache. This applies to task SQL and run-script SQL. The repair runner never deletes a failed cache to hide the failure.

4. **Pass endpoint datasource hints without changing the Pack wire shape.** `TaskEvidence` may carry an internal source/target datasource hint so the resolver can use a uniquely mapped Horae server tag, but the hint is excluded from `task.json` and content hashes. The final endpoint still receives its physical identity only from a resolved Table Pack.

5. **Make datasource indexes conflict-aware.** Duplicate rows with the same server tag and different service/identity are represented as ambiguous. The `szdata-datasource` registry is not used as a physical catalog because its current manifest reports gaps, failures, and duplicates; it may be mentioned in the evidence manifest as a corroborating source.

6. **Make online table repair exact.** Reuse the existing `szdata table`/`table-search`/`table-ddl` adapter path, but accept a result only when the requested qualified name, expected platform/dataSource constraints, GUID, and non-empty current DDL agree. If the result is ambiguous or the adapter returns 403/429/timeout, do not write a Table Pack.

7. **Repair in cohorts.** Process SQL freshness first, then datasource-label contamination and endpoint disambiguation, then Hive DDL, RDBMS identity/DDL, and finally residual no-SQL categories. After each cohort, write evidence records, rerun only changed IDs, and regenerate the inventory. This keeps the before/after count attributable to one evidence route.

## Risks / Trade-offs

- [Cache writers may still be changing] → refuse to treat the inventory as final until relevant process handles are gone and two bounded file-state observations are stable.
- [A platform lookup can hide multiple physical instances] → require unique identity and DDL agreement; leave ambiguous otherwise.
- [Remote calls can be slow or rate-limited] → local-first lookup, serial gate, task-id worksets, error ceiling, and preserved upstream failure class.
- [Using a task-sql cache outside hiveTask could imply a table contract] → consume only a valid query slot and never use its create SQL as physical DDL.
- [Existing dirty worktree overlaps implementation files] → inspect and patch only the minimal relevant hunks; never reset, clean, or overwrite unrelated changes.

## Migration Plan

1. Create and validate the repair artifacts and focused unit tests.
2. Wait for the existing cache workers to finish, snapshot the current status/cache, and build the first inventory.
3. Apply code fixes, fill only missing or explicitly retryable evidence, and run targeted from-cache batches with a repair manifest.
4. Rebuild the inventory after every cohort and update the two Input Pack documents from the final stable manifest.
5. Rollback is limited to stopping the opt-in repair runner and preserving existing Packs; no default-path behavior or platform objects are modified. If a generated Table Pack conflicts with an existing same-identity Pack, stop the batch instead of overwriting it.
