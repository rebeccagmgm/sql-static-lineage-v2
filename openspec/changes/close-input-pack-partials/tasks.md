## 1. Baseline and inventory

- [x] 1.1 Add a bounded current-PARTIAL inventory command/output that reads the current status document and schedule-evidence cache, excludes relation-only evidence, records cache/log/catalog availability, and refuses final labeling while relevant cache writers are active.
- [x] 1.2 Add inventory tests for stale summary counts, active-worker instability, relation-cache non-evidence, and per-task unresolved reason preservation.

## 2. SQL evidence retry and fallback

- [x] 2.1 Include `runScript` in log-SQL task selection and add `force` retry semantics for existing `UNAVAILABLE` run-script caches while preserving AVAILABLE caches.
- [x] 2.2 Make hive task SQL `force` retry only existing unavailable evidence, preserving available local or MCP SQL and its provenance.
- [x] 2.3 Consume an available task-sql query as a fallback only when the specialized route has no query; preserve slot semantics and never use fallback create SQL as physical DDL.
- [x] 2.4 Add focused tests for runScript selection/retry, task-sql fallback, available-cache preservation, empty SQL, and provider provenance.

## 3. Datasource and offline table identity

- [x] 3.1 Make Horae datasource indexing conflict-aware and filter exact datasource labels without dropping unknown physical source values.
- [x] 3.2 Add internal endpoint datasource hints for uniquely mapped source/target servers and use them in offline RDBMS resolution without changing the Pack wire shape.
- [x] 3.3 Add resolver tests for exact label filtering, duplicate datasource conflicts, Hive2 Oracle endpoint hints, non-Oracle convention rejection, and multi-instance ambiguity.

## 4. Evidence repair runner

- [x] 4.1 Add an opt-in repair runner that processes an inventory/task-id workset in local-first order and writes a per-evidence JSONL manifest with provider, observedAt, hash, and failure class.
- [x] 4.2 Reuse exact platform adapters for task SQL, Horae logs, table metadata, and table DDL; require qualified-name/platform/dataSource/DDL agreement before writing evidence.
- [x] 4.3 Write successful remote Table evidence through the existing Table Pack writer and stop on same-identity conflicts; do not write evidence for ambiguous, missing, 403, 429, timeout, or malformed results.
- [x] 4.4 Add repair-runner tests for local hits, online fallback, exact matching, ambiguity, upstream failures, idempotence, and bounded task-id selection.

## 5. Cohort execution and verification

- [x] 5.1 After cache stabilization, generate the authoritative current inventory and select the first SQL-freshness cohort.
- [x] 5.2 Fill/retry only the selected SQL/log evidence, rerun only changed task IDs through from-cache, and verify task/table hashes and status transitions.
- [x] 5.3 Process datasource-label, Hive DDL, RDBMS identity/DDL, and residual no-SQL cohorts in that order; record each cohort's before/after counts and unresolved reasons.
- [x] 5.4 Run the prescribed targeted tests, typecheck, full test suite, format check, build, and inspect; preserve exact failures and stop rather than weakening evidence rules.

## 6. Documentation and final audit

- [x] 6.1 Update `docs/input-pack-from-cache.md` with the opt-in repair path, retry semantics, datasource boundaries, and unchanged offline default.
- [x] 6.2 Update `docs/input-pack-from-cache-partial-analysis.md` from the final stable inventory/repair manifest while retaining historical snapshots with dates and sources.
- [x] 6.3 Perform a requirement-by-requirement audit: every original PARTIAL is either repaired with verified evidence or listed with an explicit UNKNOWN/PARTIAL reason and boundary.
