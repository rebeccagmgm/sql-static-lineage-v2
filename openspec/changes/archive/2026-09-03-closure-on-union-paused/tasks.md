## 1. Contracts and adapter

- [x] 1.1 Add optional `CandidateBranch.continuation` and typed union-v2 continuation stats without changing legacy serialization.
- [x] 1.2 Implement strict `UNION_CONTINUATION_INDEX` 1.0.0 parsing and exact `candidatesForRead(consumerTaskId, readOccurrenceId)` lookup.

## 2. Union-v2 attachment

- [x] 2.1 Add CLI parsing for `--candidate-source` and `--continuation-index`, keeping legacy as the default.
- [x] 2.2 Attach indexed candidates to existing multi-hop physical bridges with exact write-scope binding, DISJOINT pruning, and schedule-only suppression.
- [x] 2.3 Apply continuation certainty caps and evidence/gap references during closure propagation.
- [x] 2.4 Emit evidence-bounded continuation and bridge counts, including true read-level ambiguity and unmatched-read counts.

## 3. Verification

- [x] 3.1 Add adapter, synthetic multi-hop, 119044, and 105387 regression coverage, including the no-`:0` invariant.
- [x] 3.2 Run target closure tests, typecheck, build, and the legacy compatibility/hash check; record known C2+ limitations.

## 4. C2 follow-up: closure-on-union

- [x] 4.1 Make the union-v2 physical-producer universe INDEX-driven, retaining only multi-hop read/boundary scope and failing closed on unmatched reads.
- [x] 4.2 Cap legacy field-lineage at CONDITIONAL/L2 and gate union-v2 `valueCertain` on INDEX L1 continuation plus current Facts local closure.
- [x] 4.3 Emit and validate a machine-readable closure diff v0 for same-target legacy/union-v2 runs, with shrink reason codes and the 176827 tier-one anchor.
- [x] 4.4 Refresh a real 176827 UNION_CONTINUATION_INDEX with occurrence identities aligned to the current multi-hop/Facts snapshot and full closure coverage. The recovered batch has 58 PROJECTED tasks, 209 indexed external read occurrences, and no legacy occurrence ids; the resulting union-v2 closure has 157/157 decision coverage, 109 INDEX-backed physical producers, `l1=11`, and one tier-one task (`176827`). The 34 verified same-task self-read boundaries are now classified as `SELF_READ_NOT_EXTERNAL` and exposed separately as `selfReadBoundaries`; `unmatchedReads=0` for actual missing INDEX entries. The two earlier 103230 false unmatched reads were canonicalized by unique same-task/same-statement/same-table Facts evidence. Artifacts: `176827-continuation-index-full-recovered-v2/union-continuation-index.json`, `176827-union-v2-full-index-recovered-v7.json`, and `176827-union-v2-vs-legacy-full-index-recovered-v7.diff-v0.json` under the local C2 artifact root.

## 5. C3 Gate B-UNION acceptance

- [x] 5.1 Export a schema-versioned, content-hashed L1 closure set from a union-v2 closure and exact continuation INDEX, retaining task/write-observation/read-occurrence-chain/write-scope/evidence references and rejecting contaminated members.
- [x] 5.2 Add the independent `gate-b-union` CLI and regression coverage: 176827 reads the current real closure/INDEX and anchors the current `l1=11` set plus a sample member; 209119 records an explicit blocker when its union-v2 inputs are absent.
- [x] 5.3 Add the Gate B-UNION evidence section to `target-write-upstream-causal-closure/209119-gate-evidence.md` while preserving the historical Gate B `NOT VERIFIED / REOPENED` section unchanged.
- [x] 5.4 Run target closure tests, typecheck, build, and OpenSpec validation; record known C3 limitations without changing WP-8/WP-8.1 or adding C4 envelope work.
