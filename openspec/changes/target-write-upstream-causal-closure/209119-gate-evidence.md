# 209119 Target-rooted Propagation Gate Evidence

Date: 2026-08-29

## Execution boundary

This run used the existing Input Pack/Machine Facts, producer-index cache, table multi-hop artifact and existing field-lineage JSON. It did not collect tasks, rebuild the producer index, rebuild old field-lineage, invoke Calcite, or write `artifacts/tasks/209119`. The output was written to the separate `sql-static-lineage-artifacts/target-table-causal-closure/` directory.

## Baseline, M1 and M2

- Root is one resolved `TargetWriteIdentity` for `write-observation:209119:platform-target:0`.
- Candidate Universe contains 549 branch identities and is `INCOMPLETE` because the source table artifact exposes unbound/blocked/schedule/coverage boundaries.
- The main assessment key is `targetWriteId + candidateBranchId`; 137 target fields are not an assessment dimension.
- The field evidence adapter reads the old field-lineage JSON once (`fieldValueEvidenceScanCount=1`) and aggregates VALUE_FLOW evidence by consumer task, producer task and physical table.
- Occurrence-specific read identity remains on each candidate branch. Where the old field artifact does not carry a matching bridge occurrence, the result is not promoted to a fabricated unrelated conclusion.

## Gate A

The previously cached 209119 run completed in about 5 seconds wall time. The artifact records 1,750 ms of measured stage time, a peak RSS of 602,783,744 bytes (574.9 MiB), and no full field matrix. This is evidence for the earlier baseline artifact only; it is not a post-fix acceptance run.

| Metric | Result |
| --- | ---: |
| Candidate branches | 549 |
| Assessments | 549 |
| Field × branch matrix | not generated |
| Field evidence scans | 1 |
| Resolved physical producer branches | 238 |
| Ambiguous bridge/boundary observations | 44 |
| Missing/unbound/blocked boundary observations | 200 |
| Peak memory | 574.9 MiB |
| Decision coverage | 549/549 |

Gate A: **PASS WITH SCOPE** for branch cardinality and measured cached performance. Target-write identity, producer-write bridge closure and occurrence correctness are **PARTIAL / NOT VERIFIED** for the current post-fix code because the canonical 209119 field artifact was changed outside this run and was not overwritten or regenerated here.

## Historical pre-propagation result

The native summary consumes structured Machine Facts relation rows and relation edges. It covers the current first semantic batch: project expression control, filter, join (including outer/cross shape), grouping/aggregate markers, set operation, Top-N markers, COUNT(*), EXISTS and literal-from-relation relation dependence. An ordinary read alone is not treated as a confirmed relation-existence dependency.

For the earlier pre-propagation 209119 run:

- 239 branches are `CONFIRMED_RELATED` (238 physical producer branches plus the root write).
- 310 branches are `UNKNOWN`, with explicit gaps from schedule-only, unbound reads, blocked reads or coverage boundaries.
- There are no `PROVEN_UNRELATED` results because the observed table candidate universe is incomplete; this is intentional.
- The task rollup contains 78 upstream tasks. All 78 have at least one confirmed physical producer branch, so the minimum certain task set is also 78. The run does not claim task-count reduction for this SQL; the reduction is at branch level and the unresolved boundaries remain in the conservative safety set.

## Implementation fixes in the current code

The pre-propagation implementation fixed the CLI entry point, occurrence-scoped field lookup, statement-scoped summaries and negative-proof validation. It did not yet prove target-rooted multi-hop certainty.

## Gate B

Gate B: **NOT VERIFIED / REOPENED**. The current code does not yet provide evidence for target-rooted multi-hop certainty, same-channel alternative-path merging, or a product-level reduction in rerun tasks. M5/M6 remain paused, and Calcite remains the separately isolated Plan Facts-driven differential lane.

The output is a static candidate assessment, not a runtime rerun decision: `runtimeRerunDecision=NOT_EVALUATED`.

## Latest target-rooted read-only re-evaluation

On 2026-08-29 the target-table CLI was run in causal-only mode with the existing `field-facts`, producer-index, 209119 multi-hop artifact and the existing canonical field-lineage JSON as read-only inputs. Output was written only to `sql-static-lineage-artifacts/target-table-causal-closure/209119-path-propagation.{json,txt,html}`. No command in this run wrote or regenerated `sql-static-lineage-data/artifacts/tasks/209119`.

The latest artifact is schema `1.1.0` and records:

| Metric | Result |
| --- | ---: |
| Candidate branches / assessments | 542 / 542 |
| `CONFIRMED_RELATED` / `UNKNOWN` | 52 / 490 |
| Upstream tasks | 78 |
| Minimum certain tasks | 43 |
| Conservative safety tasks | 78 |
| Field evidence scans | 1 |
| Producer-write bridge enrichment | 155 resolved, 84 ambiguous, 193 missing |
| Decision coverage | 542/542 |
| Evidence closure | 100% for non-empty confirmed assessments |
| Explicit gaps | 1,377 |
| Runtime rerun decision | `NOT_EVALUATED` |
| Wall time / peak RSS | about 7 seconds end-to-end / 593,776,640 bytes (about 566 MiB) |

The propagation state is target-write rooted and carries write observation, channel, certainty, evidence/gap refs and a predecessor witness. It composes certainty along a path and merges same-channel alternatives by strongest evidence while retaining weaker-path gaps. The field-value adapter now handles the legacy opaque `occurrenceId:readRelationId` locator by exact whole-token comparison; it does not use substring matching.

The candidate universe remains `INCOMPLETE`, there are no `PROVEN_UNRELATED` assessments, and all unresolved evidence remains `UNKNOWN` with explicit gaps. `CONFIRMED_RELATED` is a static structural conclusion only; it does not establish runtime data change, partition overlap or a mandatory rerun. Therefore this run verifies the target-rooted propagation mechanics and bounded cost, but does not pass Gate B or establish a final runtime rerun list. M5/M6 remain paused.

## Canonical artifact isolation

The canonical directory `sql-static-lineage-data/artifacts/tasks/209119` was checked after the run. It still contains only the four pre-existing JSON files; `field-lineage.json` remains 23,290,979 bytes with SHA-256 `71487CE3869A9A5F2CD125263CB8AEC1B6408E6CAD1390F507551C25C6ADC768`, last written 2026-08-28 23:51:02. The target-table outputs remain in the separate `sql-static-lineage-artifacts/target-table-causal-closure/` directory.

## Current write-scoped propagation rerun

On 2026-08-29, using code baseline `cfe8d4e` plus the current write-scope and
channel-propagation changes, the same existing Input Pack/Machine Facts,
producer-index, table multi-hop artifact and canonical field-lineage JSON were
read. The CLI was given the already verified target write observation
`write-observation:209119:platform-target:0`. It wrote only the three isolated
target-table outputs under `sql-static-lineage-artifacts/target-table-causal-closure/`.
No Calcite process ran, and no file under `sql-static-lineage-data/artifacts/tasks/209119`
was written or regenerated.

| Metric | Result |
| --- | ---: |
| Candidate branches / assessments | 542 / 542 |
| `CONFIRMED_RELATED` / `CONDITIONAL_RELATED` / `UNKNOWN` | 46 / 0 / 496 |
| Confirmed assessments with write-scoped witness | 46 / 46 |
| Cross-channel confirmed branches (`VALUE_FLOW` → control/multiplicity) | 0 |
| Post-run cross-write scope leak invariant | 0 |
| Minimum certain tasks / conservative safety tasks | 41 / 78 |
| Field evidence scans | 1 |
| Explicit gaps | 1,240 |
| Peak RSS | 628,060,160 bytes (about 599 MiB) |
| End-to-end wall time | about 6 seconds |

The previous documented propagation run reported 52 confirmed and 490 unknown.
The current run intentionally removes six formerly positive assessments because
their read occurrence could not be proven to belong to the current consumer
write root. They remain `UNKNOWN` with explicit gaps; this is a fail-closed
scope correction, not a semantic expansion or a silent prune. No cross-write
branch was observed.

Unknown reason counts below are gap occurrences (one assessment can contribute
more than one reason), not a partition of the 496 branches:

```text
CANDIDATE_BOUNDARY=630
NOT_REACHED_FROM_ROOT=419
OCCURRENCE_EVIDENCE_NOT_FOUND=225
PRODUCER_WRITE_AMBIGUOUS=84
RELATION_SUMMARY=55
PRODUCER_WRITE_SCOPE_UNRESOLVED=10
OTHER=73
```

The new exact-field cross-channel fixture passes, but this 209119 run closed no
additional branch through that channel. Gate B therefore remains **NOT
VERIFIED / REOPENED**. M5/M6, Calcite expansion and `PROVEN_UNRELATED` remain
paused/disabled. `runtimeRerunDecision` remains `NOT_EVALUATED`.

## Phase 4 projection-readiness gate

The original Gate B remains a product-value gate for a runtime rerun decision;
it is not passed by a graph projection. A narrower prerequisite has now been
completed: the current 209119 result is fit to publish as an evidence-bounded
target causal overlay.

The overlay loader revalidated the exact joint project snapshot, matching
209119 all-field snapshot, target write identity, multi-hop source SHA-256,
field-lineage source SHA-256, causal file SHA-256, declared causal content hash,
542/542 assessment cardinality and all 1,240 referenced gaps. It did not replay
the unavailable historical producer-index bytes with a newer index.

Projection-readiness: **PASS WITH SCOPE**.

- 46 `CONFIRMED_RELATED` and 496 `UNKNOWN` branches remain distinct and
  queryable.
- The 41-task minimum-certain set and 78-task conservative-safety set are both
  preserved; neither is presented as a runtime rerun list.
- All unknown branches retain explicit gap context.
- `PROVEN_UNRELATED`, negative proof and cross-write leakage remain absent.
- `runtimeRerunDecision` remains `NOT_EVALUATED`.

This closes the input/publication prerequisite for Phase 4. It does not reopen
M5/M6 or change the original Gate B runtime conclusion.

## Gate B-UNION (C3 machine-readable acceptance; separate gate)

Date: 2026-09-03

This is the C3 acceptance projection defined by
`docs/experimental/execution-plan-closure-on-union.md` §5–§8. It is not a rewrite of the
historical Gate B section above. The historical Gate B remains
**NOT VERIFIED / REOPENED** and continues to mean the runtime rerun/product
gate; Gate B-UNION means that the union-v2 closure has produced an
evidence-bounded L1 set.

### 176827 real-input anchor

The exporter read the C2 union-v2 closure and continuation INDEX as read-only
inputs:

- Closure:
  `sql-static-lineage-artifacts/target-table-causal-closure/c2/176827-union-v2-full-index-recovered-v5.json`
  with content hash
  `08b4902d2a04804c860e91985f9dbde11331c213f32e5aad750b96f3f0bad5d6`.
- INDEX:
  `sql-static-lineage-artifacts/target-table-causal-closure/c2/176827-continuation-index-full-recovered-v2/union-continuation-index.json`
  with content hash
  `d7961a2b6493856fa75860ae3a330d851cc1e69590ce7987fa6c01f4e2a83ea1`.
- L1 set:
  `sql-static-lineage-artifacts/target-table-causal-closure/c3/176827-gate-b-union-l1-set.json`.

The set contains 11 members, matching the current closure's
`continuationStats.l1=11`; it records 109 INDEX-backed physical producer
branches in the source closure. A representative member is consumer `176827`
reading producer `103234` through the exact
`write-observation:103234:0` and its read occurrence. Every emitted member
retains the exact read occurrence, write scope, INDEX entry reference and
Facts write evidence. The exporter rejects non-`IN_UNION_FINAL_WRITE`,
non-`CONFIRMED`, non-`L1`, or non-`l1Eligible` branches and does not consume
legacy `field-lineage.json` as an L1 source.

The independent `gate-b-union` command revalidated the closure hash, INDEX
hash and output `contentHash=62bb34a568e288ac6bba6227bcf5fb96478ff4cf45df18afa6d984b3b39eebae`.
This is **Gate B-UNION PASS WITH SCOPE for the available 176827 anchor**.

### 209119 input blocker

The C3 sample was not run as an empty or legacy substitute. The required
union-v2 inputs are absent:

- `sql-static-lineage-artifacts/target-table-causal-closure/c2/209119-union-v2.json`
- `sql-static-lineage-artifacts/target-table-causal-closure/c2/209119-continuation-index/union-continuation-index.json`

The existing `209119.json` / `209119-path-propagation.json` artifacts are
historical closure outputs without the required union-v2 continuation INDEX,
so they cannot satisfy this gate. The automated test records
`GATE_B_UNION_INPUT_BLOCKER:209119` and deliberately emits no empty L1 set.
209119 is therefore **INPUT BLOCKED**, not passed.

### C3 limits and distinction

Gate B-UNION is a static, evidence-bounded closure-set check. It does not
prove scheduler execution, runtime data arrival, business correctness or the
historical runtime rerun decision. The known C2 residuals remain outside L1:
34 same-task self-read boundaries remain `UNKNOWN`, and two 103230 CTE paths
retain an alias gap. No self-read is forced into the L1 set, and no `:0`
write-observation identity is synthesized. The missing 209119 union-v2 inputs
are the remaining C3 sample limitation.
