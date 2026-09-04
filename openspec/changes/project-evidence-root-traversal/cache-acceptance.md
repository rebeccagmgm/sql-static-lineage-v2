# Task Evidence Cache Acceptance

Validated on 2026-08-29 with roots `176827`, `181058` and `209119`, the
existing Input Pack, Producer Index and schedule-evidence cache.

## Canonical raw one-hop cache

The reusable location is:

```text
E:\02_area\股衍数据-数据cookbook\sql-static-lineage-cache\
  one-hop\tasks\<taskId>\one-hop.json
```

The real run produced 183 Task directories and exactly 183 `one-hop.json`
files. The document identity contains no global Input Pack fingerprint or full
Producer Index hash. It binds the Task-local Input Pack content, validated
Machine Facts manifest, normalized schedule rows, terminal configuration,
algorithm version and consumed Producer evidence slice.

## Cold cache

- Machine Facts: 183 Tasks, 183 validated registry hits, 0 analyses.
- Raw one-hop: 0 hits, 183 misses, 183 computations, 183 atomic writes.
- One-hop stage: 8.63 seconds.
- Project result: `COMPLETE`, 697 nodes, 1572 edges, 444 boundaries.

## Hot cache

- Machine Facts: 183 Tasks, 183 validated registry hits, 0 analyses.
- Raw one-hop: 183 hits, 0 misses, 0 computations, 0 writes.
- One-hop batch calls: 0.
- Project result and snapshot identity were reused unchanged.
- Snapshot: `project-snapshot-5b4c9f8596147a30b7e683e4b47ccef9a9f1f2bea62bd6439bcca50f7efcdef8`.

## Failure and invalidation coverage

Focused tests prove that changing one Task's normalized schedule rows or adding
a producer for one of its direct-read tables recomputes only that Task. Adding
an unrelated Input Pack/Producer Index entry changes the global identities but
remains a Task-local cache hit. Invalid JSON or contract/content mismatch is an
invalid entry and is atomically replaced after successful recomputation.
Current schedule and Producer Index provenance are rebound after a hit.
Project-relative checkdbflag filtering remains outside the raw cache.

## Remaining runtime boundary

The hot real run still spends most time in full Input Pack closure/final
validation and Machine Facts input preparation. Those fail-closed publication
checks were not weakened in this change.
