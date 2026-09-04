# Phase 1 Acceptance Evidence

## Frozen scope

Phase 1 publishes a read-only `PROJECT_TOPOLOGY` projection from explicitly supplied one-hop and multi-hop artifact pairs. It does not discover or rebuild inputs, call OpenCLI, read the old knowledge graph, expand fields, calculate causal conclusions, add UI code, or require Neo4j.

## Automated acceptance

- `npm run test:project-topology`: 14 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Full `npm test`: 24 files passed, including the Phase 1 suite; 6 of 12 assertions in the unrelated `tests/task-inspection.test.ts` failed because its generated fixture bundle does not declare `task-local-materializations.jsonl`. No task-inspection code imports the Phase 1 module.
- Focused Prettier check for `scripts/project-graph`, the new tests and this OpenSpec change: passed.
- Repository-wide `npm run format:check`: executed and failed on 12 pre-existing Markdown files; the Phase 1 files and the changed `package.json` are clean.
- `git diff --check`: run as the final repository check.

The frozen fixtures cover complete and partial roots, truncation, schedule-only relations, `PRIMARY` and `UNKNOWN` producers, two write observations on one write edge, same qualified table name on different data sources, invalid artifact pairs, interrupted publication, immutable conflicts, and two roots sharing one Task at different depths.

## Read-only Task 176827 acceptance

Logical input files:

- `artifacts/tasks/176827/one-hop.json`
- `artifacts/tasks/176827/multi-hop.json`

Exact source SHA-256 before and after both runs:

- one-hop: `7c3082c8c1168650313a74f432c4b5f4a4cbf465e922f04ec138c7d87228580d`
- multi-hop: `42967f45bc3f28838531123b32e5696a994bad48c9dc833125470beae67b0ec9`

The producer-index content hash and input fingerprint matched across the pair. The multi-hop source declared `COMPLETE_OBSERVED_EVIDENCE`, `truncated=false`, with 60 task nodes, 81 table nodes, 127 read edges, 59 write edges, 175 producer bridges, 73 schedule edges and 124 terminals.

Published snapshot:

- snapshot ID: `project-snapshot-e97cddd481527daee28e1fe7cebb28105f6fb46a97d43e7400197b969835eca4`
- first publication: `CREATED`
- identical second publication: `REUSED`
- output: 266 nodes, 619 edges and 124 boundary nodes
- coverage: `COMPLETE`
- producer observations: 113 `PRIMARY`, 50 `UNKNOWN`, 12 `CANDIDATE`
- relation layers: 361 data-production, 73 schedule, 60 projection-scope, 124 boundary and 1 project relation
- boundary reasons retained: 73 `ALREADY_DISCOVERED`, 3 `MULTIPLE_OVERLAPPING_PRODUCERS`, 18 `NO_CONFIRMED_PRODUCER_OBSERVED`, 6 `NO_DIRECT_READS`, 8 `REFERENCE_CONFIG`, and 16 `TASK_LOCAL_MATERIALIZATION`

Output SHA-256 remained byte-identical on the second run:

- `snapshot.json`: `f8648b1041efd10aff96c70a16d8807270b4d2b29e9ad15cbbf9f6e7327b233c`
- `topology.nodes.jsonl`: `38920f4418ab3b7e254b007185a9ebc22086f3e0f15a761c80b532292dbe194e`
- `topology.edges.jsonl`: `382f96bf59dd8df980ca0ee936cc7ee31267a173b46ff87eef0c0afd27a87c83`
- `projection-manifest.json`: `facada1453bdda4032a5417f7dfeada03723bd7d979e19848bb6a41e7c34c2d7`

The acceptance command used only the local source loader, pure projector and filesystem publisher. The CLI has no OpenCLI, cache-discovery, parser, collector, old-KG or network dependency path.

## Later-phase entry criteria

### Phase 2: field evidence projection

Start only when a concrete navigation/query use case needs on-demand field evidence and the canonical occurrence, write-observation and binding identities are stable enough to reference without inventing bridges. Phase 2 must consume Phase 1 identities and remain a separate projection module.

### Phase 3: optional Neo4j query index

Start only after file-backed reference queries have representative scale measurements showing a material latency or concurrency need. Neo4j remains a rebuildable index; parity fixtures must prove the same nodes, edges, roots, roles, boundaries and query semantics before it can serve reads.

### Phase 4: causal and business overlays

Start causal overlay work only after target-scoped assessment artifacts and channel semantics are stable. Start business-semantic overlay work only when ontology ownership, evidence sources and conflict rules are explicit. Neither overlay may rewrite the Phase 1 evidence facts.
