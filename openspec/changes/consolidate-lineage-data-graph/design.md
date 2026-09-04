## Context

See `proposal.md` for motivation. The current repository has roughly 78,000 lines of production TypeScript under `scripts/`, many overlapping CLI aliases, a build that does not compile the production tree, and tests that cover only a selected file list. The separate `data-graph` repository contains useful continuation and investigation logic, but it duplicates canonical contracts and has drifted behind the current field-lineage, target-causal, and task-local artifact versions.

The business applications documented in `docs/value-scenarios-dm-otc-n.md` are the next phase, not deliverables of this change. The two original repositories remain intact as history. `docs/` in v2 is curated knowledge and must not be broadly reorganized or rewritten.

## Goals / Non-Goals

**Goals:**

- Produce a small, understandable repository with one current evidence mainline and one source of artifact truth.
- Fold the continuation semantics and useful file investigation behavior from `data-graph` into that mainline without carrying its duplicate architecture.
- Preserve current canonical evidence meanings, stable identities, certainty/gap boundaries, and deterministic artifacts.
- Make all retained production source part of a real build and typecheck.
- Delete historical compatibility, experiments, generated material, duplicate commands, and unused infrastructure that can be recovered from the old repositories.

**Non-Goals:**

- Implementing V1 indicator-caliber registry, V2 redundancy audit, V3 anomaly governance, or their SQLite consumer.
- Expanding `dm_otc_n`, `pdata`, or `odata` Facts coverage.
- Building a Horae scheduling graph, an 80,000-task graph, or a new business-facing product.
- Neo4j, a database service, or preservation of the old graph query-index API.
- Support for historical artifact versions or compatibility facades for old internal imports and commands.
- Rewriting validated SQL relation semantics merely to obtain a new folder layout.
- Rewriting or pruning curated content in `docs/`.

## Decisions

### 1. Keep one technical evidence mainline

The consolidated flow is:

```text
Input Pack -> Machine Facts
  |-> Producer Index -> One-hop -> Multi-hop
  |-> Field Lineage
  `-> Task-local Projection -> Continuation Index
                    combined evidence -> Target Causal Closure
                                      -> Investigation Projection
                                      -> File Query / HTML View
```

One-hop, multi-hop, field-lineage, task-local, and continuation remain internal stages, not competing product lines. Their canonical artifacts remain explicit so the next-stage consumers can be added without importing mutable implementation state.

Alternative considered: organize the repository around the next-stage V1/V2/V3 consumers. Rejected because those are separate product work and should be designed only after this foundation is clean and current.

### 2. Use a single-package modular monolith

The repository will contain one `package.json`, one lockfile, one TypeScript configuration family, and this production structure:

```text
src/
  app/                  # root CLI, configuration, orchestration
  contracts/            # current schemas, canonical JSON/hash, identities
  input/                # Input Pack assembly and validation
  facts/                # Machine Facts production and readers
  lineage/
    table/              # producer index, one-hop, multi-hop
    field/              # field lineage and relation semantics
    task-local/         # per-task projection
    continuation/       # read-occurrence to write-observation continuation
    target-causal/      # bounded target causal closure
  investigation/
    projection/         # one unified read-only investigation snapshot
    query/              # bounded file queries
    view/               # static local view
  adapters/             # filesystem, schedule/table evidence, local stores
  ops/                  # explicit collection, cache-fill, repair, diagnostics
tests/
  contracts/
  input/
  facts/
  lineage/
  investigation/
  acceptance/
  fixtures/
```

`app` may compose modules. Core modules depend on `contracts`, not on CLI or `ops`. `investigation` consumes published canonical artifacts and never becomes a source of lineage facts. `ops` does not sit on the default run path.

Alternative considered: npm workspaces with separate lineage, graph, and contract packages. Rejected because both repositories share one runtime and continuation participates in lineage semantics; multiple packages would add manifests and coordination without an independent deployment need.

### 3. Preserve artifact boundaries while removing duplicate publishers

The lineage stages continue to publish versioned JSON/JSONL artifacts with canonical hashes and stable ordering. Investigation reloads and validates those artifacts before projecting them; it does not import an in-memory lineage result and then become an alternate truth source.

The three near-duplicate topology, field, and causal graph publishers become one investigation snapshot format with typed node/edge payloads and one publication path. File queries and the HTML view read this snapshot. Runtime Input Packs, Facts, indexes, snapshots, caches, logs, and local configuration remain ignored external data.

### 4. Keep one current contract matrix

The repository owns canonical JSON, hashing, stable identities, loaders, and validators. Consumers do not copy these types or relax a version string. The consolidation target is:

| Artifact | Accepted version |
| --- | --- |
| one-hop | `1.1.0` |
| multi-hop | `1.1.0` |
| field-lineage | `1.2.0` |
| target causal closure | `1.2.0` |
| task-local projection | `1.3.0` |
| union continuation index | `1.0.0` |
| investigation snapshot | `1.0.0` |

Historical field/causal `1.1` and task-local `1.1`/`1.2` readers are deleted. Historical files are inspected in the old repositories; current inputs are regenerated. Hash validation applies to original current-version bytes, not coerced objects.

### 5. Import only the useful part of data-graph

The continuation-v2 candidate-matching core and current index behavior move into `src/lineage/continuation`. The bounded file query and static view behavior needed for current investigation move into `src/investigation` and use repository-owned contracts.

The following are not imported: `.git`, dependencies, build output, temporary data, copied canonical contracts/runtime helpers, legacy one-hop/multi-hop topology source, v1 continuation, single-read continuation envelope/CLI, duplicate snapshot publishers, old OpenSpec changes, and the Neo4j/query-index implementation.

Alternative considered: copy `data-graph` as a subdirectory and repair it in place. Rejected because that would preserve the current cross-repository cycle and two sources of truth.

### 6. Expose one CLI with a small technical surface

The root executable is `lineage`:

- `lineage run` executes the current canonical evidence pipeline from explicit inputs.
- `lineage inspect` queries or renders existing canonical artifacts without rebuilding them.
- `lineage ops` contains explicit collection, cache-fill, repair, and diagnostic subcommands.

Old top-level npm aliases and different-memory aliases are removed. Root npm scripts are limited to dependency preparation, build, typecheck, test, format check, and launching `lineage`.

### 7. Refactor without internal compatibility facades

Each domain move updates all imports and deletes the old path in the same stage. Validated algorithms move with their current semantic tests unless a real defect is found. Large files are split only at concrete responsibilities such as parsing arguments, loading evidence, matching, projection, and publication.

The refactor does not add generalized retries, fallback readers, legacy version adapters, or speculative abstraction layers. The compatibility boundary is the current canonical artifacts and their meaning, not old source paths or every historical command.

### 8. Keep tests small and outcome-focused

The retained suite has four purposes:

1. Frozen current identity/hash and artifact contract vectors.
2. Focused tests for read/write occurrence, partition matching, certainty, `UNKNOWN`, and gap boundaries.
3. Small checked-in current-version stage fixtures before migration, followed by one end-to-end continuation/causal/investigation fixture after continuation accepts task-local `1.3.0`; neither may silently skip.
4. A build/import-boundary check proving all `src` code compiles and investigation does not own lineage contracts.

Tests for deleted schemas, removed CLIs, old hash snapshots, unavailable sibling data, experiments, and unused graph backends are deleted. One representative local-data smoke run reuses existing caches and does not recollect inputs.

### 9. Use a new Git history and leave docs in place

Before implementation edits, initialize an independent Git repository in v2 with no remote and record the source SQL-lineage commit plus the clean `data-graph` commit in a short provenance file. Do not copy either old `.git` directory. Work proceeds in reviewable stages so failures can be reverted inside v2 without touching the source repositories.

The existing `docs/` tree remains in place. After paths and commands stabilize, only references made false by this change are mechanically updated. Application-scenario and evidence-boundary content is not rewritten.

## Risks / Trade-offs

- [A broad move can accidentally alter canonical artifacts] -> Freeze a small current artifact flow first, then move one domain at a time and compare semantic hashes and certainty/gap output.
- [Removing historical commands may surprise an unknown caller] -> Keep a concise removed-command map in the migration notes and use the untouched old repositories for recovery; do not add wrappers without a real caller.
- [Contract drift can be hidden by permissive readers] -> Delete copied readers, accept only the current matrix, and validate hashes before projection.
- [Removing Neo4j reduces one storage option] -> Keep bounded file queries and the static view; restore a database adapter later only for a measured need.
- [Repository cleanup could become a framework rewrite] -> Move only current mainline domains, split only demonstrated multi-responsibility files, and stop once build, contracts, and the representative flow are clear.

## Migration Plan

1. Add the independent `.gitignore`, source provenance, and clean v2 Git baseline; do not modify either source repository.
2. Make build/typecheck cover all retained production source and freeze independent current stage baselines from each source repository before moving code; do not require the currently incompatible cross-repository closed loop yet.
3. Centralize canonical contracts, hashes, and identities; align all consumers to the current contract matrix and remove duplicate/legacy readers.
4. Move continuation-v2 semantics into lineage, update current task-local `1.3.0` consumption, and then add the non-skipping end-to-end fixture through target-causal output.
5. Move mainline SQL-lineage domains from `scripts/` into `src/`, one domain at a time; split oversized mixed-responsibility files and delete old paths immediately.
6. Adapt one investigation projection, bounded file queries, and the static view; remove the legacy graph publishers, Neo4j/query-index, and copied data-graph architecture.
7. Consolidate the root CLI and remove redundant npm aliases, experiments, surveys, compiled leftovers, obsolete tests, runtime/generated directories, and superseded planning clutter retained in the old repository.
8. Run build, typecheck, the retained suite, and one bounded current-data smoke; then update only stale public path and command references in `docs/`.

Rollback is by reverting a failed stage in the new v2 history. The two original repositories remain untouched as the complete historical fallback.
