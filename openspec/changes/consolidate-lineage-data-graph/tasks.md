## 1. Independent Baseline and Real Build

- [x] 1.1 Add repository ignore rules for dependencies, build output, runtime artifacts, caches, logs, local configuration, and temporary worktrees; verify representative paths are ignored while source, tests, schemas, config examples, OpenSpec, and `docs/` remain visible.
- [x] 1.2 Record the source SQL-lineage commit and clean `data-graph` commit, initialize a new Git repository in v2 with no remote, and create the clean baseline commit; verify both original repositories keep their exact pre-existing status and neither old `.git` directory is copied.
- [x] 1.3 Define the retained production-source set and replace the import-only build with a TypeScript build that covers it; verify `npm run build` compiles production source and `npm run typecheck` covers production source plus retained tests before any source move.
- [x] 1.4 Freeze small non-skipping lineage stage fixtures for canonical IDs/hashes, Machine Facts, one-hop `1.1.0`, multi-hop `1.1.0`, field-lineage `1.2.0`, task-local `1.3.0`, and target-causal `1.2.0`; verify each fixture runs without sibling data or optional environment variables.
- [x] 1.5 Freeze small non-skipping `data-graph` behavior fixtures for continuation-v2, topology/field/causal file queries, and the static view; verify the fixtures assert observable semantics rather than an unavailable historical snapshot hash or a Neo4j mock.
- [x] 1.6 Run the pre-move build, typecheck, retained tests, and format check, fix baseline-only configuration defects, and verify any remaining failure has an exact documented cause before structural edits begin.

## 2. One Current Contract Source

- [x] 2.1 Write frozen tests for canonical JSON/hash and Task, physical dataset, physical field, read occurrence, target write, and write-observation identities; verify the expected vectors match the current producers before moving their implementations.
- [x] 2.2 Move canonical JSON/hash and identity implementations into `src/contracts/`, update current producers to use them, and verify the frozen vectors and artifact hashes are unchanged.
- [ ] 2.3 Consolidate the current one-hop, multi-hop, field-lineage, target-causal, task-local, continuation-index, and investigation contract types/loaders/validators under `src/contracts/`; verify every accepted version matches the design matrix.
- [ ] 2.4 Replace duplicate contract/runtime imports in v2 and the selected `data-graph` code, then delete the copied implementations; verify repository search finds exactly one runtime identity/hash implementation and one validator for each retained artifact.
- [ ] 2.5 Add current-version acceptance and historical-version rejection tests, including task-local `1.3.0`; verify unsupported versions and invalid hashes fail before output publication without coercion or fallback readers.

## 3. Continuation Becomes Lineage Core

- [ ] 3.1 Port the focused continuation-v2 test vectors for exact read occurrence, independent write observations, partition `CONFIRMED/ASSUMED/UNKNOWN/DISJOINT`, L1 eligibility, schedule-only exclusion, and ambiguous gaps; verify these tests initially describe current `data-graph` semantics without importing its old contracts.
- [ ] 3.2 Move only the continuation-v2 candidate-matching core into `src/lineage/continuation/`; verify the focused tests pass and no v1 continuation, schedule-edge implementation, or single-read envelope is introduced.
- [ ] 3.3 Implement the minimal current batch input over task-local `1.3.0` projections and the existing producer index, keeping each `writeObservationId` distinct; verify non-`PROJECTED` tasks contribute no candidates and missing write identities never receive synthetic fallback IDs.
- [ ] 3.4 Move the `UNION_CONTINUATION_INDEX 1.0.0` builder, deterministic ordering/hash, validator, manifest writer, and thin index command into lineage; verify a current task-local batch generates a valid index without a `data-graph` path or format conversion.
- [ ] 3.5 Make target-causal consume the repository-owned continuation contract and remove the `legacy|union-v2` candidate-source choice and copied schema logic; verify exact read-occurrence assessments, channels, write observations, certainty, and gap references remain intact.
- [ ] 3.6 Add a non-skipping checked-in flow `task-local 1.3.0 -> continuation-index 1.0.0 -> target-causal 1.2.0`; verify only exact confirmed alignments enter L1 and every ambiguity remains `UNKNOWN` or a named gap.

## 4. Mechanical Source Migration

- [ ] 4.1 Move Input Pack production/validation and its filesystem/table-evidence adapters from `scripts/` into `src/input/` and `src/adapters/` without algorithm edits; update all imports, delete the old paths, and verify the Input Pack tests and baseline artifacts pass.
- [ ] 4.2 Move SQL-plan and Machine Facts production/readers into `src/facts/` without algorithm edits; update all imports, delete the old paths, and verify Machine Facts plus plan-adapter baselines pass.
- [ ] 4.3 Move producer-index, one-hop, and multi-hop code into `src/lineage/table/` without algorithm edits; update all imports, delete the old paths, and verify their current contract and reconciliation tests pass.
- [ ] 4.4 Move field-lineage and task-local projection code into `src/lineage/field/` and `src/lineage/task-local/` without algorithm edits; update all imports, delete the old paths, and verify field and task-local baselines pass.
- [ ] 4.5 Move continuation and target-causal code into their final `src/lineage/` domains without algorithm edits; update all imports, delete the old paths, and verify the checked-in continuation/causal flow passes.
- [ ] 4.6 Move retained query, orchestration, collection, cache-fill, repair, and diagnostic code into `src/app/`, `src/ops/`, and `src/adapters/`; verify the default pipeline does not import `ops` and all retained command tests pass.
- [ ] 4.7 Add a lightweight dependency-boundary check and remove remaining production implementations from `scripts/`; verify core modules do not depend on CLI/ops, lineage does not depend on investigation, and `scripts/` contains only unavoidable build helpers or is absent.

## 5. Split Demonstrated Multi-Responsibility Files

- [ ] 5.1 Split the Input Pack collector into argument/config parsing, evidence loading, task collection, and publication modules while preserving its public command behavior; verify Input Pack fixtures and output hashes are unchanged.
- [ ] 5.2 Split the SQL plan adapter and Machine Facts orchestration at existing parse, normalize, emit, and store responsibilities; verify semantic-dependency, operator, read-occurrence, and Machine Facts tests remain unchanged.
- [ ] 5.3 Split producer-index into contract/model, build, store, and query modules; verify producer selection, pin/update behavior retained by the mainline, and writer identity tests pass.
- [ ] 5.4 Split one-hop and multi-hop into evidence loading, producer resolution, traversal, and publication modules; verify terminal-table handling, partition evidence, certainty, and gap outputs match the frozen baselines.
- [ ] 5.5 Split the main pipeline and target-causal orchestration into CLI parsing, stage coordination, pure assessment, and publication modules; verify the checked-in flow retains ordering, hashes, assessments, and failure codes.
- [ ] 5.6 Remove dead exports exposed only by the pre-split files and run repository-wide reference checks; verify no compatibility facade or speculative abstraction was added and all retained tests still pass.

## 6. One Read-Only Investigation Path

- [ ] 6.1 Add contract tests for `INVESTIGATION_SNAPSHOT 1.0.0`, including current input versions, canonical hash, stable ordering, certainty/gaps, evidence references, and schedule-reference isolation; verify invalid or historical inputs fail before publication.
- [ ] 6.2 Adapt the current topology, field-evidence, and target-causal projection behavior into one `src/investigation/projection/` model and publisher; verify one target write can expose topology, field drilldown, and causal explanation without losing evidence state.
- [ ] 6.3 Adapt bounded local file queries into `src/investigation/query/`; verify get/trace/explain, pagination or result limits, not-found, partial coverage, and tampered-manifest cases against temporary published snapshots.
- [ ] 6.4 Adapt the useful static view into `src/investigation/view/`, replacing the hand-maintained `.mjs`/declaration pair with TypeScript-built assets; verify the generated page shows task labels, search data, field drilldown, evidence details, certainty, and gaps offline.
- [ ] 6.5 Remove the old topology/field/causal publishers, copied graph contracts/runtime, query-index API, Neo4j store, and `neo4j-driver`; verify build and package metadata contain no Neo4j dependency and file investigation still passes.
- [ ] 6.6 Add one `test:graph-core` gate over projection, file query, and static view using current temporary artifacts; verify it contains no V1/V2/V3 classifications and cannot pass by skipping unavailable real data.

## 7. One CLI and Repository Cleanup

- [ ] 7.1 Implement the root `lineage run`, `lineage inspect`, and `lineage ops` command surface over the migrated modules; verify `run` follows the current technical mainline, `inspect` never rebuilds inputs implicitly, and `ops` is outside the default path.
- [ ] 7.2 Reduce root npm scripts to dependency preparation, build, typecheck, test, format check, the four focused gates, and `lineage`; verify help output contains no removed legacy aliases or V1/V2/V3 business commands.
- [ ] 7.3 Move hard-coded machine paths into an ignored local configuration with a committed example and explicit CLI overrides; verify a clean checkout can run fixtures without the author's absolute paths.
- [ ] 7.4 Delete compiled Calcite leftovers, survey code/tests, `scripts/input/tmp`, one-off hard-coded census/loop scripts, copied temporary worktrees, empty directories, generated artifacts, caches, dependencies, and build output; verify each exact target is absent and `docs/` content was not deleted.
- [ ] 7.5 Remove legacy-version tests, optional sibling-data tests that silently skip, unused barrels/configs, completed or superseded OpenSpec clutter other than this active change and current main specs, and unimported `data-graph` code; verify every retained test or plan maps to the current mainline.
- [ ] 7.6 Update only public command/path references in `README.md` and `docs/` that became false; verify the diff contains no rewrite or pruning of application-scenario, architecture, or evidence-boundary content.

## 8. Final Acceptance

- [ ] 8.1 Run the contract and current stage-fixture gate; verify canonical IDs/hashes, accepted version matrix, deterministic ordering, and fail-closed version/hash errors all pass.
- [ ] 8.2 Generate fresh task-local `1.3.0` artifacts for the bounded `105387 -> 119044 -> 176827` fixture, build continuation index, and run target-causal; verify exact read/write occurrences, partition states, L1 eligibility, channels, certainty, and gaps by reading outputs rather than checking exit code only.
- [ ] 8.3 Run `test:graph-core` and one static-view smoke from temporary current artifacts; verify topology, field, causal, search, evidence details, and boundary display work without Neo4j or network access.
- [ ] 8.4 Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check`; verify every command succeeds with no optional real-artifact skip counted as coverage.
- [ ] 8.5 Run one bounded smoke against existing local caches/Facts without recollection, inspect the published manifests and queries, and verify current canonical outputs are readable end to end.
- [ ] 8.6 Perform code-quality and security reviews of the final CLI, path handling, SQLite/file adapters, and publication boundaries, fix actionable findings, and verify no unresolved high-priority issue remains.
- [ ] 8.7 Inventory the final repository and Git state; verify there is one contract source, one current mainline, one CLI, one investigation path, no runtime data/Neo4j/V1-V2-V3 implementation/old-path facade, preserved `docs/`, and a clean committed worktree ready for a new remote.
