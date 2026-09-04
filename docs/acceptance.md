# L1 Acceptance Entry

## Gate definitions

| Gate                           | Meaning                                                                                                 | Current state             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| `L1_TRUTH_READY`               | P0 Write identity, ordinal disposition, CTAS pairing, fail-closed errors and freshness regressions pass | `PENDING_ENGINE_BASELINE` |
| `L1_CONTRACT_READY`            | Contract 2.0 Core, exact Schema closure, capability truth and Consumer boundary pass                    | `NOT_STARTED`             |
| `CANONICAL_PROMOTION_PREPARED` | Frozen 86840/scope replay is deterministic and promotion attestation exists                             | `NOT_STARTED`             |

These gates are ordered. A green test or generated file never upgrades the next gate.

## Required test groups

1. Engine/parser: SQL span, statement preservation, Schema/View snapshot use, CTE/alias/Star/Join/Aggregate/Setop/Window and declared L1 dialect boundary.
2. Write facts: INSERT, resolvable CTAS, unprovable CTAS, independent SELECT after CTAS, same target with multiple Writes, static/dynamic partition and Schema drift.
3. Contract: one `write_observation_id` per Write; producer ordinal has exactly one Binding or same-Write gap; missing producer enumeration is not `NOT_APPLICABLE`; used Schema refs equal consultation trace; stale input rejects.
4. Consumer: Current Index only, no directory scan, no SQL reparse, no Profile inference, full SQL span/evidence refs, JSON/HTML deterministic, static/runtime/business boundaries visible, safe derived output path.
5. Negative/failure: unsupported parser/analyzer, missing Schema, ambiguous field, corrupt hash, duplicate Index row, missing required output, untraceable span and stale manifest all fail closed.

## 86840 vertical Gold Case

The acceptance input must be a newly frozen final SQL plus Schema/View dependency closure. The case is not satisfied by the old Reader Bundle or old Contract 1.3.0 facts. The acceptance replay must produce a Contract 2.0 Core Bundle first; only then may the Task Inspection card be generated.

The card must expose, at minimum, final output fields, exact target ordinal, expression and SQL span, physical input fields, Write identity, rowset controls, capability state, grouped gaps, manifest/schema hashes and next verification. `READY` is prohibited for unresolved or Profile-only evidence.

## Commands

```text
npm test
npm run typecheck
npm run build
npm run inspect -- --facts-root <facts-root> --task-id 86840 --question-spec <question.json> --output <derived-output>
```

Report `test`, `typecheck`, `build`, static evidence, runtime proof, business acceptance and user acceptance as separate states. The new directory does not execute schedules or query business rows.

## Current verification baseline

The focused runtime suite is green in this directory. `typecheck` and `build` remain red for inherited implementation debt: `plan-adapter.ts` passes ANTLR `ParserRuleContext` values to a narrower span helper, `machine-facts.ts` has one `unknown` ordinal typing error, and `src/databricks/lower.ts` has an existing discriminated-union error. These are engineering debt, not evidence of lineage closure. The old f335 baseline shows the same classes of diagnostics; they must be fixed or explicitly baselined before `L1_TRUTH_READY`.
