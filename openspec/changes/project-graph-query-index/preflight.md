## Task 176827 Phase 3 preflight

Recorded on 2026-08-29 from the accepted immutable Phase 1 and Phase 2
publication directories. The absolute directories below are runtime locators only;
they are not part of the canonical query-index source descriptor or build identity.
No source projection file was modified.

### Phase 1 topology source

Runtime locator:

`E:\02_area\股衍数据-数据cookbook\sql-static-lineage-cache\project-topology-phase1\projects\176827-acceptance\snapshots\project-snapshot-e97cddd481527daee28e1fe7cebb28105f6fb46a97d43e7400197b969835eca4`

- project key: `176827-acceptance`
- snapshot ID: `project-snapshot-e97cddd481527daee28e1fe7cebb28105f6fb46a97d43e7400197b969835eca4`
- coverage: `COMPLETE`
- manifest content hash: `a33f04d34b84da64a5c7d5c5ceb1cc7d562e83efe1396a78cca32f73b2c34f75`
- snapshot content hash: `62e263ce369bb180c1936b92eb553243513ec53ceb905c6a4ee22a51bad3ac63`
- counts: 266 nodes, 619 edges and 124 boundaries

Pre-run immutable file bundle:

| File                       | SHA-256                                                            |   Bytes |
| -------------------------- | ------------------------------------------------------------------ | ------: |
| `projection-manifest.json` | `facada1453bdda4032a5417f7dfeada03723bd7d979e19848bb6a41e7c34c2d7` |     992 |
| `snapshot.json`            | `f8648b1041efd10aff96c70a16d8807270b4d2b29e9ad15cbbf9f6e7327b233c` |   2,167 |
| `topology.nodes.jsonl`     | `38920f4418ab3b7e254b007185a9ebc22086f3e0f15a761c80b532292dbe194e` | 133,640 |
| `topology.edges.jsonl`     | `382f96bf59dd8df980ca0ee936cc7ee31267a173b46ff87eef0c0afd27a87c83` | 834,198 |

### Phase 2 field-evidence source

Runtime locator:

`E:\02_area\股衍数据-数据cookbook\sql-static-lineage-cache\project-topology-phase1\projects\176827-acceptance\field-evidence\field-evidence-d9524404b5d761fe8e09ba456c8c298c1ba2e36ec7196729650221bb6099366b`

- project key: `176827-acceptance`
- snapshot ID: `field-evidence-d9524404b5d761fe8e09ba456c8c298c1ba2e36ec7196729650221bb6099366b`
- coverage: `COMPLETE`
- manifest content hash: `524f17345a9ba310122afb1c23605466cbc98987ca949617422002b51da4f59c`
- snapshot content hash: `d77cdfb1ff0b90391dcada8043f803d719cd80515bef2755fe1c68990537be12`
- counts: 272 nodes, 317 edges and 0 boundaries
- root Task: `176827`
- root Write Observation: `write-observation:176827:platform-target:0`
- selected field: `delta`
- root field state: `binding-state:91c4272e09c50213912766926d4a068b67192e4644d29e3b7714ecdab24cfb84`
- target: `hive | gfhive | dm_rsk_n.otc_opt_greek_val_det_h__gfhive | dm_rsk_n.otc_opt_greek_val_det_h`

Pre-run immutable file bundle:

| File                         | SHA-256                                                            |   Bytes |
| ---------------------------- | ------------------------------------------------------------------ | ------: |
| `projection-manifest.json`   | `65a50a5d30e7b90b75ac1c5112401dd23df0f250af6f09e50680ac98c65a7582` |   1,482 |
| `snapshot.json`              | `08fe2282193e0606e491db45b3461cc54a3ecc07cec79a41d39449163353fb6e` |   2,541 |
| `field-evidence.nodes.jsonl` | `8e6a9da3522e3b893b8bb15b918c8ec28f1c6604b43273490f86303768f66235` | 392,046 |
| `field-evidence.edges.jsonl` | `f2cd83748dd377553d86e3511edd6cdf6d8955703c78d1da9a34084f060caab0` | 206,844 |

### Cross-source binding

The Phase 2 `projectSource` points to the exact Phase 1 source above:

- topology snapshot ID: `project-snapshot-e97cddd481527daee28e1fe7cebb28105f6fb46a97d43e7400197b969835eca4`
- project key: `176827-acceptance`
- topology manifest content hash: `a33f04d34b84da64a5c7d5c5ceb1cc7d562e83efe1396a78cca32f73b2c34f75`
- topology manifest SHA-256: `facada1453bdda4032a5417f7dfeada03723bd7d979e19848bb6a41e7c34c2d7`
- topology snapshot SHA-256: `f8648b1041efd10aff96c70a16d8807270b4d2b29e9ad15cbbf9f6e7327b233c`
- topology nodes SHA-256: `38920f4418ab3b7e254b007185a9ebc22086f3e0f15a761c80b532292dbe194e`
- topology edges SHA-256: `382f96bf59dd8df980ca0ee936cc7ee31267a173b46ff87eef0c0afd27a87c83`

Phase 3 acceptance must recheck all eight file hashes immediately before live
import and after acceptance. The immutable files remain authoritative; the
query index is rebuildable and must never repair or rewrite them.

### Source-loader import audit

The Phase 3 source loader imports only Node read APIs, canonical hash helpers,
the two accepted publication contracts/loaders and its local query-index
contract. The transitive publication-loader seam is limited to Node file/path
APIs, canonical serialization/hash helpers and Phase 1/2 projection validators.

The focused source-contract suite asserts that this loader has no OpenCLI,
acquisition-cache, parser, Machine Facts construction, reconciliation, causal,
Neo4j or historical-KG dependency. Six tests cover deterministic ordering and
identity, changed-source invalidation, cross-project rejection, exact duplicate
and byte-conflicting snapshots, corrupt files and the import boundary.
