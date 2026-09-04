## Task 176827 Phase 2 preflight

Recorded on 2026-08-29 from local immutable artifacts. No canonical artifact was modified.

### Exact sources

Phase 1 snapshot:

- snapshot ID: `project-snapshot-e97cddd481527daee28e1fe7cebb28105f6fb46a97d43e7400197b969835eca4`
- manifest SHA-256: `facada1453bdda4032a5417f7dfeada03723bd7d979e19848bb6a41e7c34c2d7`
- snapshot SHA-256: `f8648b1041efd10aff96c70a16d8807270b4d2b29e9ad15cbbf9f6e7327b233c`
- nodes SHA-256: `38920f4418ab3b7e254b007185a9ebc22086f3e0f15a761c80b532292dbe194e`
- edges SHA-256: `382f96bf59dd8df980ca0ee936cc7ee31267a173b46ff87eef0c0afd27a87c83`

Field artifact:

- exact file SHA-256: `786d6866f07ece2f497bb37bd223c2164e735303b2565de79b71857cc52d7169`
- declared content hash: `cc80365d130801bde3108a87e502ba64433a535c32addff6ff2df78d0864e62e`
- schema/artifact: `1.1.0` / `FIELD_MULTI_HOP_RECONCILIATION`
- source status: `COMPLETE`
- source counts: 538 nodes, 441 value edges, 4,376 controls, 33 candidates, 0 gaps
- source limits: not truncated

Canonical task inputs retained for mutation checks:

- one-hop SHA-256: `7c3082c8c1168650313a74f432c4b5f4a4cbf465e922f04ec138c7d87228580d`
- multi-hop SHA-256: `42967f45bc3f28838531123b32e5696a994bad48c9dc833125470beae67b0ec9`

### Exact root contract

- root Task: `176827`
- singleton Write Observation: `write-observation:176827:platform-target:0`
- target: `hive | gfhive | dm_rsk_n.otc_opt_greek_val_det_h__gfhive | dm_rsk_n.otc_opt_greek_val_det_h`
- selected field: `delta`
- target dataset is absent from Phase 1 and is therefore expected to be `NOT_IN_PROJECT_TOPOLOGY`, not rejected or backfilled.

### Corrected selected-slice baseline

An independent reverse traversal over incoming canonical `VALUE_FLOW` edges and the Phase 2 source loader both produce:

- 31 source field states
- 30 value edges
- 10 Tasks
- 12 confirmed cross-Task value edges with matching Phase 1 `PRIMARY` producer pairs

The earlier planning estimate of 32 states, 31 edges and 11 Tasks was off by one. Acceptance uses the exact-byte 31/30/10 result rather than changing traversal to fit the estimate.
