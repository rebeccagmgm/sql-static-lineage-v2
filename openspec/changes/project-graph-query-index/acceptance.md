## Phase 3 acceptance status

Status on 2026-08-29: **offline, accepted-source and isolated real-Neo4j live
gates passed**. Task 176827 topology plus its accepted `delta` field projection
is current, query-compatible and reproducibly indexed without changing the
Phase 1/2 evidence authority.

### Accepted immutable sources rechecked

All eight Phase 1/2 projection file hashes still equal the preflight bundle:

- topology manifest/snapshot/nodes/edges:
  `facada1453bdda4032a5417f7dfeada03723bd7d979e19848bb6a41e7c34c2d7`,
  `f8648b1041efd10aff96c70a16d8807270b4d2b29e9ad15cbbf9f6e7327b233c`,
  `38920f4418ab3b7e254b007185a9ebc22086f3e0f15a761c80b532292dbe194e`,
  `382f96bf59dd8df980ca0ee936cc7ee31267a173b46ff87eef0c0afd27a87c83`;
- field manifest/snapshot/nodes/edges:
  `65a50a5d30e7b90b75ac1c5112401dd23df0f250af6f09e50680ac98c65a7582`,
  `08fe2282193e0606e491db45b3461cc54a3ecc07cec79a41d39449163353fb6e`,
  `8e6a9da3522e3b893b8bb15b918c8ec28f1c6604b43273490f86303768f66235`,
  `f2cd83748dd377553d86e3511edd6cdf6d8955703c78d1da9a34084f060caab0`.

Canonical Task 176827 source artifacts are also unchanged from Phase 2:

- one-hop: `7c3082c8c1168650313a74f432c4b5f4a4cbf465e922f04ec138c7d87228580d`;
- multi-hop: `42967f45bc3f28838531123b32e5696a994bad48c9dc833125470beae67b0ec9`;
- field-lineage: `786d6866f07ece2f497bb37bd223c2164e735303b2565de79b71857cc52d7169`.

The two unrelated pre-existing dirty files also remained byte-identical across
live acceptance:

- `physical-field-expander.ts`:
  `2e04c4c2eb3c5b645ee44a4e49f0f38ebe3dd5f8ce15151f98beff96beb64408`;
- `physical-field-expander.test.ts`:
  `984d60b39b54cb9ee1ddffe93e16a66e3301bd75ce7654c2cfa6a6ac891cc954`.

### Real-source offline vertical loop

The accepted Task 176827 topology plus `delta` field snapshot completed the
entire builder against the contract-compatible in-memory store:

- source descriptor / build ID:
  `172cd2392395cb9c859e59c755bc3dfa5df194848d604541decbba9ff863e853`;
- indexed projections: 2;
- indexed records: 538 nodes and 936 edges (266 + 272 nodes, 619 + 317
  edges);
- required full-envelope parity: 14/14 passed across all six query families;
- parity content hash:
  `39d3ee1adbe7a0e9186b3d4373df641aba55155e63c6c3efc7ba8273330252b2`;
- first run: `CREATED`; exact second run: `REUSED` with the same build,
  manifest and parity identities;
- temporary audit file hashes: manifest
  `6fa988d06861482b1a7fe74a5073a4bdb00f1a075cea38ce7385c3ec48ddf740`,
  parity report
  `6c76ed488bc262eb5a963ecc89e1f8b4f1e60f82978e3e8d2434e7049f42b57c`.

Observed local timings were 27 ms source load and 154 ms build plus parity on
the first bounded run; the repeated in-memory runs were 159 ms and 125 ms.
These are diagnostic only and do not establish a Neo4j performance benefit.
The temporary in-memory audit is not published as live Neo4j acceptance.

### Repository validation

Passed:

- `npm run test:query-index`, repeated: 9 files and 42 tests;
- `npm run test:project-topology`: 14 tests;
- `npm run test:field-evidence-graph`: 13 tests;
- `npm run typecheck`;
- `npm run build`;
- focused Prettier check for every Phase 3 implementation, test, document and
  OpenSpec file;
- `openspec validate project-graph-query-index --strict`;
- `git diff --check`;
- production import audit and Cypher namespace/parameterization audit.

Known unrelated baselines remain unchanged:

- full `npm test`: 28/29 test files passed; 413 tests passed, 6 failed, 3
  skipped and 1 todo. The six failures remain in `tests/task-inspection.test.ts`
  because its generated fixture does not declare/provide
  `task-local-materializations.jsonl`;
- repository-wide `npm run format:check`: the same ten existing files under
  `docs/` plus `tests/gold/README.md` fail Prettier. All Phase 3 files pass the
  focused check.

### Import and security audit

Phase 3 production source loading depends only on Node read APIs, canonical
hash helpers and the accepted Phase 1/2 publication loaders/contracts. It has
no acquisition, OpenCLI, cache, parser, reconciliation, causal or historical-KG
dependency. Normal pipeline, Phase 1/2 publication and file query imports do
not initialize Neo4j.

The Neo4j implementation uses only the fixed `SLQueryIndexProject`,
`SLQueryIndexBuild`, `SLIndexedNode` labels and four fixed `SL_*` relationships.
All domain values are parameters. Cleanup matches one exact build ID and never
contains a global or project-wide delete. Direct password CLI values are
rejected; connection errors and structural parity diffs are bounded and
redacted.

### Isolated real-Neo4j live gate

The live gate used `neo4j-driver` 6.2.0 against an explicitly isolated local
Neo4j Enterprise 2026.06.0 database with Cypher 5/25. The acceptance server used
dedicated data, transaction-log, run, plugin, import, metrics and log directories
plus non-default loopback ports. It did not start, address, clear or borrow the
historical `kg-local` DBMS. All five Phase 3 constraints/indexes reported
`ONLINE` at 100 percent before final acceptance.

The first live attempts correctly remained non-current and exposed two defects
that fake-store acceptance could not reveal:

- large relationship `MERGE` batches caused pathological lock amplification on
  Neo4j 2026.06 even with endpoint indexes online;
- JavaScript numeric `SKIP`/`LIMIT` parameters were rejected by Neo4j as a
  statement argument error.

The implementation now caps relationship writes at ten records per transaction
without shrinking the configured node batch, and casts pagination parameters
with `toInteger(...)`. Failed staging records were removed by exact build ID
only after confirming that no current pointer existed.

The final clean live run proved:

- first build `CREATED`, validated and atomically activated in 4,060 ms;
- exactly one current pointer to build
  `172cd2392395cb9c859e59c755bc3dfa5df194848d604541decbba9ff863e853`;
- state `READY`, validation `PASSED`, parity `PASSED`;
- 2 projections, 538 nodes and 936 edges;
- 14/14 full-envelope parity cases passed across all six query families;
- parity content hash
  `39d3ee1adbe7a0e9186b3d4373df641aba55155e63c6c3efc7ba8273330252b2`;
- exact second build `REUSED` in 2,122 ms with unchanged audit bytes;
- a deliberately mismatched expected descriptor returned
  `QUERY_INDEX_STALE:SOURCE_DESCRIPTOR_MISMATCH` and left the same single
  current pointer unchanged;
- a bounded current-index query returned the accepted topology envelope with
  `QUERY_LIMIT_REACHED`, proving the public indexed query path after activation.

The live audit manifest and parity report hashes are respectively
`6fa988d06861482b1a7fe74a5073a4bdb00f1a075cea38ce7385c3ec48ddf740`
and `6c76ed488bc262eb5a963ecc89e1f8b4f1e60f82978e3e8d2434e7049f42b57c`.
The eight projection hashes and three canonical Task 176827 artifact hashes were
recomputed after all live probes and remained identical to preflight.

There was no previous accepted query-index build, so the recorded rollback
target is `null`; rollback is to disable the opt-in Phase 3 entry point and keep
serving the unchanged file-backed reference queries. Timings are bounded local
diagnostics, not a production performance claim.

### Three-task full-field scale extension

The same accepted implementation was then exercised without code-path changes
against the existing joint project topology for Tasks 176827, 181058 and 209119. No lineage pipeline or canonical artifact was rerun. Three new immutable
Phase 2 projections selected every target field already present in the accepted
field-lineage artifacts:

| Root task | Root fields | Coverage   |  Nodes |  Edges | Snapshot prefix              |
| --------- | ----------: | ---------- | -----: | -----: | ---------------------------- |
| 176827    |          97 | `COMPLETE` |  5,650 |  6,868 | `field-evidence-b99a418f...` |
| 181058    |          45 | `COMPLETE` |  3,449 |  4,288 | `field-evidence-d76f963f...` |
| 209119    |         137 | `PARTIAL`  | 14,164 | 16,517 | `field-evidence-1f42b891...` |

The `PARTIAL` status for Task 209119 preserves its seven canonical lineage gaps;
publication and indexing do not reinterpret them as confirmed evidence. All
three field snapshots bind to joint topology snapshot
`project-snapshot-fa0f0ed6fe71fa2c5c9efb82d6e512c2e444d80fc0b57f334369f08648375fce`,
which contains 695 nodes, 1,569 edges and 442 boundaries for the three root
tasks.

The isolated Neo4j scale run proved:

- source descriptor / build ID
  `885f7cd7f80e3e1973475d1784e959d441058ddd2ed85b968bd7055047a60a53`;
- 4 projections, 23,958 nodes and 29,242 edges;
- first build `CREATED`, validated and activated in 38,629 ms;
- 28/28 parity cases passed across all six query families, with parity content
  hash `2c4c8f5f35d74bd6c88ec1367865722215ca2a33854950be8601973ed97b7aa9`;
- exact second build `REUSED` in 5,677 ms;
- one and only one current pointer remained after a deliberate stale-descriptor
  query returned `QUERY_INDEX_STALE:SOURCE_DESCRIPTOR_MISMATCH`;
- indexed `TARGET_WRITE_HAS_OUTPUT` counts were exactly 97, 45 and 137 for the
  three field snapshots, proving that all 279 selected target fields were
  present in the activated index;
- bounded public field traces for `176827.delta`, `181058.accum_yield` and
  `209119.trade_id` returned indexed local paths; their `partial` statuses were
  caused by deliberately small query limits, while Task 209119 also retained
  its source warning.

The scale audit manifest and parity report hashes are respectively
`68b54b4cec543198d224185dab0eecf0bf33a735983febcdffcc5bb3a5fa33bd`
and `1e06b480c0f848a3546403567e17dd62c9f368891ed694c09c95cfac6687581f`.
All 16 topology/field projection files and all nine canonical one-hop,
multi-hop and field-lineage artifacts were rehashed after the live run and
remained byte-identical. The pre-existing single-task 176827 current index also
remained isolated and unchanged.
