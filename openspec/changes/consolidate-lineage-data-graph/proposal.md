## Why

`sql-static-lineage-v2` is a large filesystem copy of the SQL-lineage repository while useful cross-task continuation and investigation code lives in a separate `data-graph` repository. The split has produced duplicate contracts, real schema-version drift, a confusing command surface, and large amounts of historical or generated material that should not become the baseline of a new repository.

## What Changes

- Consolidate the current SQL-lineage core and the useful subset of `data-graph` into one TypeScript package with one contract source, one build, and one root CLI.
- Make the technical mainline explicit: `Input Pack -> Machine Facts -> table/field and task-local evidence -> continuation index -> target causal evidence -> one read-only investigation projection/query/view`.
- Move continuation-v2 semantics into the lineage core so investigation becomes a one-way consumer instead of participating in a cross-repository cycle.
- Keep current canonical artifact meanings, stable identities, read/write occurrences, certainty states, gaps, hashes, and deterministic output behavior.
- **BREAKING** Remove Neo4j, duplicated graph contracts and publishers, old schema readers, obsolete continuation entry points, experimental/survey/compiled leftovers, redundant command aliases, generated/runtime directories, and internal import-path compatibility facades. Replace the overlapping graph outputs with one file-backed investigation format. The untouched original repositories remain the historical fallback.
- **BREAKING** Accept only the current artifact versions used by the consolidated mainline; historical artifacts must be regenerated or inspected in the original repositories.
- Replace the current import-only build with a real production build and make typecheck cover production source plus retained tests.
- Preserve `docs/` as curated knowledge. Change it only where a moved public command or code path would otherwise make a reference false.
- Explicitly defer the V1/V2/V3 business application scenarios, governance lists, and their SQLite consumer to a later change.

## Capabilities

### New Capabilities

- `investigation-projection`: Preserve current topology, field drilldown, causal explanation, file query, and static view behavior through one read-only projection without adding V1/V2/V3 business logic.

### Modified Capabilities

- `task-local-graph-projection`: Replace identity parity with an external `data-graph` implementation by one repository-owned canonical identity/contract source, and make the current task-local artifact the only supported projection version.

## Impact

- Restructures production code from `scripts/` into cohesive `src/` modules and imports only selected current logic from `data-graph`; neither source repository is modified.
- Replaces many top-level scripts with lifecycle commands and one CLI while preserving the current canonical outputs needed by the mainline.
- Removes legacy commands and internal paths without compatibility wrappers; the old repositories remain available when historical behavior is needed.
- Imports only current continuation and file-investigation behavior from `data-graph`; duplicated publication paths and Neo4j are not carried over. Runtime Input Packs, Facts, indexes, snapshots, caches, and local configuration stay outside version control.
- Narrows the retained test suite to current contracts, core semantic boundaries, and a small representative end-to-end artifact flow that cannot silently skip.
