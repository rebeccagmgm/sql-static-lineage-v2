## Context

The existing consumer projects `TABLE_MULTI_HOP_RECONCILIATION` into
table-level `PHYSICAL_PRODUCER` branches, then enriches each branch from the
producer task's Facts. Its legacy enrichment expands every write for a
same-table multi-write producer. WP-8.1 now publishes a JSON-only
`UNION_CONTINUATION_INDEX` 1.0.0 with exact read-occurrence entries and
write-observation partition judgments.

## Goals / Non-Goals

**Goals:**

- Keep legacy projection/enrichment byte-for-byte compatible by isolating the
  new path behind an opt-in mode.
- Add a strict index DTO/parser and exact read lookup.
- Attach WP-8 statuses to existing multi-hop table edges, bind exact write
  scopes, and expose evidence-bounded counters.
- Export a separate Gate B-UNION L1 set with content-hashed closure/INDEX
  input references and bounded 176827/209119 acceptance evidence.

**Non-Goals:**

- The C2 follow-up may replace the union-v2 physical candidate source with the
  continuation INDEX; legacy projection remains unchanged.
- Do not implement partition matching, WP-8/8.1 kernels, producer-index-query,
  or the L0-L3 envelope. Gate B-UNION is the C3 acceptance projection in this
  follow-up; it does not revise the historical runtime Gate B.

## Decisions

### 1. Isolate union-v2 at the consumer boundary

`runTargetTableCausalClosure` will branch after the existing table projection.
Legacy continues through the current `enrichProducerWriteBridges` function.
Union-v2 normalizes read occurrences before exact index lookup. In the C2
candidate projection, every physical producer comes from an INDEX candidate;
the raw multi-hop `scheduleEdges` are passed independently as a consumer-side
whitelist for cross-Task candidates. A schedule edge never creates a producer
branch, and a missing/unparseable relation produces an UNKNOWN boundary rather
than an INDEX fan-out. Same-Task candidates do not require a scheduler edge.
If a base bridge has no exact INDEX entry, it remains an UNKNOWN boundary.

### 2. Use a local, strict DTO adapter

`union-continuation-candidate-source.ts` owns file loading, schema/hash
validation, enum validation, duplicate read detection, and an immutable map
keyed by `consumerTaskId` plus `readOccurrenceId`. The adapter emits a stable
`indexEntryRef` derived from the index content hash and exact read key. It
never imports data-graph code or evaluates partition predicates.

### 3. Bind scopes from the indexed write id

The union path calls the existing `producerWriteScope` logic with one indexed
`writeObservationId` at a time. It does not enumerate all `dataset-io` writes
for the table. A missing scope leaves the branch visible with the existing
UNKNOWN gap. Alignment ambiguity is carried as a continuation gap while the
distinct write id remains available for an exact scope lookup.

### 4. Cap propagation certainty with continuation evidence

The closure engine already composes local transfer certainty. Union-v2 adds a
branch-level cap: exact L1 candidates are CONFIRMED, ASSUMED candidates are
CONDITIONAL, and non-L1/PI-only candidates are UNKNOWN. This prevents legacy
field evidence or a relation summary from silently promoting L2 candidates.

### 5. Count read-level ambiguity separately from candidate-level resolution

The adapter stage counts retained candidates per exact read after DISJOINT
pruning. A read with two or more retained write observations contributes one
`ambiguousReads`/`bridgeStats.ambiguous`. `resolved` is incremented only while
binding an L1 candidate with a non-null exact scope.

### 6. Keep Gate B-UNION as a separate acceptance projection

The L1 set is derived only from union-v2 closure branches whose continuation
status and exact INDEX candidate agree. Its serialized members are keyed by
consumer task, producer task, write observation, and read occurrence; the
closure and INDEX hashes are retained as input references. 176827 is the
available real-input anchor. 209119 is accepted only as an explicit sample or
input blocker, never as an empty successful run. The historical Gate B evidence
remains unchanged and continues to describe the runtime rerun/product gate.

## Risks / Trade-offs

- [Index schema drift] → Reject the index before closure starts with a
  contract error; no partial union-v2 result is emitted.
- [Read occurrence mismatch] → Preserve the multi-hop branch as UNKNOWN and
  expose `CONTINUATION_READ_NOT_FOUND`; do not fuzzy-match or fan out.
- [Legacy regression] → Keep the old enrichment function and all new metrics
  optional/absent in legacy artifacts; run the existing target-table suite and
  compare a legacy artifact hash.
- [Schedule relation drift] → Apply the raw relation only as a whitelist for
  INDEX candidates; missing or malformed relation evidence remains UNKNOWN and
  never widens the candidate universe.
